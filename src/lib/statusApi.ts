// Live-status POIs — client-side API helpers.
//
// Mirrors scoutApi.ts in pattern: thin wrappers around
// supabase.functions.invoke() for the two status edge functions, plus
// a token generator ergonomically prefixed for debugging.

import { supabase } from '@/integrations/supabase/client';
import type { PoiStatusState, RoutePoi } from '@/types/mapEditor';

export interface ResolvedStatusEvent {
  eventId: string;
  name: string;
  city: string | null;
  routes: unknown[];
  pois: RoutePoi[];
  status: string;
  tokenLabel: string | null;
  /** Current statuses keyed by poi_id. Empty when nothing's been set yet. */
  statuses: Record<string, PoiStatusSnapshot>;
}

export interface PoiStatusSnapshot {
  poi_id: string;
  state: PoiStatusState;
  note: string | null;
  moved_to_lng: number | null;
  moved_to_lat: number | null;
  updated_by_name: string | null;
  updated_at: string;
}

export interface UpdateStatusInput {
  token: string;
  poi_id: string;
  state: PoiStatusState;
  note?: string;
  moved_to?: { lng: number; lat: number };
  volunteer_name?: string;
}

/** Resolves a status-purpose token to the event + POIs + current statuses. */
export async function resolveStatusToken(token: string): Promise<ResolvedStatusEvent> {
  const { data, error } = await supabase.functions.invoke('resolve-status-token', {
    body: { token },
  });
  if (error) throw new Error(error.message || 'Failed to resolve status link');
  if (data?.error) throw new Error(data.error);
  return data as ResolvedStatusEvent;
}

/** Pushes a single POI status update. Returns the persisted snapshot. */
export async function updatePoiStatus(input: UpdateStatusInput): Promise<PoiStatusSnapshot> {
  const { data, error } = await supabase.functions.invoke('update-poi-status', {
    body: input,
  });
  if (error) throw new Error(error.message || 'Failed to update status');
  if (data?.error) throw new Error(data.error);
  return data.status as PoiStatusSnapshot;
}

/**
 * 32-char random token prefixed with `sta_` so a human skimming logs
 * can distinguish status tokens from scout (`sct_`) / upload (`upl_`)
 * at a glance. Generation is client-side via Web Crypto — same pattern
 * as generateScoutToken().
 */
export function generateStatusToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `sta_${hex}`;
}
