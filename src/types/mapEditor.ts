export type Coord = [number, number]; // [lng, lat]

export interface EventRoute {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  waypoints: Coord[];
  routeCoords: Coord[];
  /** How many routeCoords each waypoint contributed. Enables precise undo without re-snapping. */
  segmentCoordCounts?: number[];
}

export type PoiType =
  | 'start'
  | 'finish'
  | 'water'
  | 'medical'
  | 'registration'
  | 'sponsor'
  | 'parking'
  | 'restroom'
  | 'aid-station'
  | 'custom';

export interface RoutePoi {
  id: string;
  type: PoiType;
  title: string;
  description: string;
  coordinates: Coord;
  imageUrl?: string;
  webLink?: string;
  imageDataUrl?: string;
  /**
   * Optional branded-sponsor unit. Presence of this block (with a
   * logoUrl or a ctaUrl) turns a `type: 'sponsor'` POI from a generic
   * ⭐ into an ad unit: logo-filled marker, branded popover, tracked
   * impressions + clicks. A bare `type: 'sponsor'` POI without this
   * block stays as the legacy generic sponsor pin. Lives nested on
   * the POI so we don't need a schema migration.
   */
  sponsor?: SponsorBlock;
}

export interface SponsorBlock {
  /** Uploaded logo URL (poi-images bucket). */
  logoUrl?: string;
  /** Pre-upload data URL; mirrors `imageDataUrl` pattern. */
  logoDataUrl?: string;
  /** Hex color used for the marker ring and filled CTA. */
  brandColor?: string;
  /** CTA button label. Defaults to "Learn more" at render time. */
  ctaText?: string;
  /** CTA destination. Must be http(s) — validated at render. */
  ctaUrl?: string;
  /** Optional promo code displayed + copyable in the popover. */
  promoCode?: string;
}

export interface BasemapOption {
  id: string;
  label: string;
  style: string;
}

/**
 * Volunteer-reported live state of a POI. Updated from the tokenized
 * /v/:token volunteer page; rendered as a colored dot overlay on the
 * public map + status line in the popover.
 *
 *   open   — default / operational
 *   low    — running out of something (water, supplies, bibs…)
 *   closed — not operational, runners should skip
 *   moved  — physically relocated; optional `moved_to_*` coords
 */
export type PoiStatusState = 'open' | 'low' | 'closed' | 'moved';

export interface PoiStatus {
  event_id: string;
  poi_id: string;
  state: PoiStatusState;
  note: string | null;
  moved_to_lng: number | null;
  moved_to_lat: number | null;
  updated_by_name: string | null;
  updated_via_token: string | null;
  updated_at: string;
}

/** A runner's live GPS position, received via Supabase Broadcast. */
export interface RunnerPosition {
  sessionId: string;
  name: string;
  color: string;
  lng: number;
  lat: number;
  accuracy: number;
  speed: number | null;    // m/s from Geolocation API
  heading: number | null;  // degrees from north
  timestamp: number;
}
