import { supabase } from '@/integrations/supabase/client';

/**
 * First-touch acquisition attribution.
 *
 * On the very first pageview we snapshot where the visitor came from
 * (referrer, utm_* params, landing path) into localStorage. Signup
 * rarely happens on the first pageview, so this is the only moment the
 * data exists — by the time someone creates an account the referrer is
 * long gone.
 *
 * The snapshot is consumed twice:
 *  1. `attributionProperties()` — merged into the `signup_form_submitted`
 *     product event so attribution is queryable even if (2) never runs.
 *  2. `claimFirstTouch(userId)` — after the first authenticated session,
 *     written onto the user's `profiles` row (first-touch only; the DB
 *     update is guarded on `attribution_captured_at IS NULL`).
 *
 * Everything here is best-effort and must never throw: localStorage can
 * be unavailable (private mode, blocked storage) and attribution is
 * never worth breaking a user flow over.
 */

const TOUCH_KEY = 'hd_first_touch';
const CLAIMED_KEY = 'hd_first_touch_claimed';

export interface FirstTouch {
  referrer: string | null;
  landing_page: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  /** Generic `?ref=` param, common in directory/newsletter links. */
  ref: string | null;
  captured_at: string;
}

/**
 * Record the first touch if we haven't already. Call once on app boot,
 * before the router mounts. Subsequent visits (and in-app navigation)
 * are no-ops — first touch wins.
 */
export function captureFirstTouch(): void {
  try {
    if (localStorage.getItem(TOUCH_KEY)) return;

    const params = new URLSearchParams(window.location.search);
    // An internal referrer means a same-site navigation reached this code
    // path somehow (e.g. hard reload mid-session) — that's not a source.
    const rawReferrer = document.referrer || null;
    const referrer =
      rawReferrer && !rawReferrer.startsWith(window.location.origin) ? rawReferrer : null;

    const touch: FirstTouch = {
      referrer,
      landing_page: window.location.pathname + window.location.search,
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_term: params.get('utm_term'),
      utm_content: params.get('utm_content'),
      ref: params.get('ref'),
      captured_at: new Date().toISOString(),
    };

    localStorage.setItem(TOUCH_KEY, JSON.stringify(touch));
  } catch {
    /* localStorage unavailable — nothing to do */
  }
}

export function getFirstTouch(): FirstTouch | null {
  try {
    const raw = localStorage.getItem(TOUCH_KEY);
    return raw ? (JSON.parse(raw) as FirstTouch) : null;
  } catch {
    return null;
  }
}

/**
 * First touch flattened for `logEvent()` properties. Nulls are dropped
 * so event rows stay compact; an empty object means "no data captured",
 * a `{ referrer: ... }`-less object with a landing page means "direct".
 */
export function attributionProperties(): Record<string, unknown> {
  const touch = getFirstTouch();
  if (!touch) return {};
  const entries = Object.entries(touch).filter(([key, value]) => value !== null && key !== 'captured_at');
  return Object.fromEntries(entries);
}

let claimInFlight = false;

/**
 * Write the first touch onto the signed-in user's profile, once.
 * Fire-and-forget; call on every auth-session event — the localStorage
 * flag and the `attribution_captured_at IS NULL` guard make it
 * idempotent, and `claimInFlight` stops concurrent attempts.
 */
export function claimFirstTouch(userId: string): void {
  try {
    if (claimInFlight || localStorage.getItem(CLAIMED_KEY)) return;
    const touch = getFirstTouch();
    if (!touch) return;
    claimInFlight = true;

    void supabase
      .from('profiles')
      .update({
        first_referrer: touch.referrer,
        first_landing_page: touch.landing_page,
        utm_source: touch.utm_source,
        utm_medium: touch.utm_medium,
        utm_campaign: touch.utm_campaign,
        utm_term: touch.utm_term,
        utm_content: touch.utm_content,
        attribution_captured_at: touch.captured_at,
      })
      .eq('user_id', userId)
      .is('attribution_captured_at', null)
      .then(({ error }) => {
        claimInFlight = false;
        if (!error) {
          try {
            localStorage.setItem(CLAIMED_KEY, '1');
          } catch {
            /* no-op */
          }
        } else {
          console.warn('[attribution] claim failed:', error.message);
        }
      });
  } catch {
    claimInFlight = false;
  }
}
