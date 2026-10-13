export const FREE_MARKER_LIMIT = 30;
export const MARKER_LIMIT_WARNING_THRESHOLD = 8;

export interface EventStatusFields {
  status: string;
  route_count: number;
  poi_count: number;
  paid_at?: string | null;
}

/**
 * The one definition of Pro: Pro is per event, and `events.paid_at` is the
 * source of truth (20260411120000_event_billing_columns). `events.plan` is a
 * legacy mirror and `profiles.plan` / `is_paid` predate per-event billing —
 * don't read either for gating. Public pages can't see paid_at; the
 * public_events view exposes the same test as `owner_is_paid`.
 */
export function isPro(event: Pick<EventStatusFields, 'paid_at'>): boolean {
  return !!event.paid_at;
}

export function isReadyToPublish(event: EventStatusFields): boolean {
  return event.status === 'draft' && event.route_count >= 1 && event.poi_count >= 1;
}

export function isApproachingMarkerLimit(event: EventStatusFields): boolean {
  if (isPro(event)) return false;
  if (event.status !== 'published') return false;
  return event.poi_count >= FREE_MARKER_LIMIT - MARKER_LIMIT_WARNING_THRESHOLD;
}

export function markersUntilLimit(event: Pick<EventStatusFields, 'poi_count'>): number {
  return Math.max(0, FREE_MARKER_LIMIT - event.poi_count);
}
