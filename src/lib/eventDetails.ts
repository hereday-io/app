// Formatting and validation for the "when / where / register" details
// shown to runners and spectators on the public event page.

/** "2026-11-22" → "Sun, Nov 22". Parsed as a local calendar day so the
 *  date never slides a day for visitors west of UTC. */
export function formatEventDay(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "08:00" or "08:00:00" (a Postgres TIME) → "8:00 AM". */
export function formatStartTime(time: string | null | undefined): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const MAX_URL_LENGTH = 2048;

/**
 * Normalize what an organizer typed into the registration-link field.
 * Blank → null (clears the link). A bare domain gets https:// so
 * "runsignup.com/MyRace" just works. Anything that still isn't an
 * http(s) URL is rejected — the database CHECK (20261014130000) would
 * refuse it anyway, this just says why before the save.
 */
export function normalizeRegistrationUrl(
  input: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: 'That doesn\'t look like a web address.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Use a link that starts with https://' };
  }
  if (!url.hostname.includes('.') || /\s/.test(withScheme)) {
    return { ok: false, error: 'That doesn\'t look like a web address.' };
  }
  if (withScheme.length > MAX_URL_LENGTH) {
    return { ok: false, error: 'That link is too long.' };
  }
  return { ok: true, value: withScheme };
}

/** The href to render for a stored registration link, or null when it
 *  isn't a plain http(s) URL. Belt-and-braces with the DB constraint:
 *  this string goes into an <a href> that anonymous visitors tap. */
export function safeRegistrationHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
