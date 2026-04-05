import { supabase } from '@/integrations/supabase/client';

/**
 * Fire-and-forget product analytics. Logs a row to `product_events`.
 *
 * - Never throws. Errors are swallowed so analytics bugs never break
 *   the user flow.
 * - `user_id` is filled server-side from the request auth when
 *   available; we don't bother reading the current session here to
 *   keep this hot path cheap.
 * - `event_id` is a convenience column for the most common case —
 *   attribute an event to a specific Hereday event. Pass null for
 *   global actions (signup, dashboard opened, etc.).
 *
 * Usage:
 *   logEvent('event_published', eventId, { route_count: 2 });
 *   logEvent('paywall_hit', eventId, { trigger: 'routes' });
 *   logEvent('public_view', eventId, { mode: 'runner' });
 *
 * Event names should be snake_case verbs. Grep the codebase before
 * inventing a new name — consistency matters for SQL queries later.
 */
export function logEvent(
  eventType: string,
  eventId: string | null = null,
  properties: Record<string, unknown> = {},
): void {
  // Get current user id if available, but don't await — we fire the
  // insert immediately either way.
  supabase.auth.getUser().then(({ data }) => {
    // Cast: product_events isn't in the generated types.ts yet. Regenerate
    // with `supabase gen types` when convenient.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase.from('product_events' as any) as any)
      .insert({
        event_type: eventType,
        user_id: data.user?.id ?? null,
        event_id: eventId,
        properties,
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          // Log locally but never surface to users.
          console.warn('[analytics] logEvent failed:', eventType, error.message);
        }
      });
  }).catch(() => { /* no-op */ });
}
