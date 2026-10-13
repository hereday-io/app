// Mobile POI Scout — client-side API helpers.
//
// Thin wrappers around supabase.functions.invoke() for the two scout edge
// functions. Also holds the random-token generator used by ScoutLinkDialog
// when an organizer asks for a new scout link.

import { invokeFunction } from '@/lib/userFacingError';
import type { PoiType } from '@/types/mapEditor';

export interface ScoutedPoi {
  id: string;
  type: PoiType;
  title: string;
  description: string;
  coordinates: [number, number];
  scouted_at: string;
  scouted_via_token: string;
}

export interface ResolvedScoutEvent {
  eventId: string;
  name: string;
  city: string | null;
  // Routes/pois are passed through opaquely — the scout page type-asserts
  // them to the editor types on the consumer side. Server has already
  // confirmed they're arrays.
  routes: unknown[];
  pois: unknown[];
  status: string;
}

export interface SubmitScoutedPoiInput {
  token: string;
  poi: {
    type: PoiType;
    title: string;
    description?: string;
    coordinates: [number, number];
  };
}

// Resolves a scout token to the event it targets. Works on draft events
// too — that's the whole point of scout mode. Throws an EdgeFunctionError
// carrying the server's message; run it through userFacingError() for copy.
export async function resolveScoutToken(token: string): Promise<ResolvedScoutEvent> {
  return invokeFunction<ResolvedScoutEvent>('resolve-scout-token', { token });
}

// Submits a single POI against a scout token. The server assigns the id,
// scouted_at, and scouted_via_token fields; the caller only needs to
// provide the POI content.
export async function submitScoutedPoi(
  input: SubmitScoutedPoiInput,
): Promise<ScoutedPoi> {
  const data = await invokeFunction<{ poi: ScoutedPoi }>('submit-scouted-poi', input);
  return data.poi;
}

// Generates a 32-char random token prefixed with the purpose code.
// Uses the Web Crypto API (available in all modern browsers and edge
// runtimes). The prefix is purely ergonomic — it lets humans distinguish
// a scout token from other purposes at a glance when debugging.
export function generateScoutToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `sct_${hex}`;
}
