// GPX 1.1 export for Hereday events.
//
// Generates a standards-compliant GPX file containing:
//   - One <trk> per visible route, with a single <trkseg> of <trkpt>s
//   - One <wpt> per POI (aid stations, water stops, parking, etc.)
//
// The output is consumed by Garmin Connect, Strava, COROS, Wahoo, etc.
// All of these handle multi-track GPX files, so we export every route
// in a single document rather than forcing the user to pick one.

import type { EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { poiTone } from '@/lib/pois';

interface BuildGpxInput {
  eventName: string;
  eventDate: string | null;
  routes: EventRoute[];
  pois: RoutePoi[];
}

// XML 1.0 forbids control chars and requires escaping these five
// entities. Don't skip — user-supplied event names can contain
// anything.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control chars that would make the XML invalid.
    // Char codes 0-8, 11, 12, 14-31 are forbidden in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// Coords ship as [lng, lat] through our app but GPX wants lat/lon as
// attributes. Keep the conversion in one place.
function fmtCoord(n: number): string {
  return n.toFixed(6);
}

// POI type → GPX <sym> value. GPX doesn't standardize symbol names,
// but most clients (Garmin, Strava) recognize a common set. These
// fall back gracefully to a generic pin if unknown.
const POI_GPX_SYMBOL: Record<PoiType, string> = {
  start: 'Flag, Green',
  finish: 'Flag, Red',
  water: 'Drinking Water',
  medical: 'First Aid',
  registration: 'Information',
  sponsor: 'Star',
  parking: 'Parking Area',
  restroom: 'Restroom',
  'aid-station': 'First Aid',
  custom: 'Waypoint',
};

export function buildGpx({ eventName, eventDate, routes, pois }: BuildGpxInput): string {
  const now = new Date().toISOString();
  const metadataTime = eventDate ? new Date(`${eventDate}T00:00:00Z`).toISOString() : now;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<gpx version="1.1" creator="Hereday" xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">'
  );

  // ── Metadata ───────────────────────────────────────────────────
  lines.push('  <metadata>');
  lines.push(`    <name>${escapeXml(eventName)}</name>`);
  lines.push(`    <desc>${escapeXml(`${eventName} — exported from Hereday`)}</desc>`);
  lines.push(`    <time>${metadataTime}</time>`);
  lines.push('    <link href="https://hereday.io"><text>Hereday</text></link>');
  lines.push('  </metadata>');

  // ── Waypoints (POIs) ───────────────────────────────────────────
  // Exported before tracks by GPX convention. Auto-generated
  // start/finish markers (id prefix "auto-*") are included — runners
  // benefit from having the line on their device.
  for (const poi of pois) {
    const [lng, lat] = poi.coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    const sym = POI_GPX_SYMBOL[poi.type] ?? 'Waypoint';
    const label = poi.title || poiTone(poi.type).label;

    lines.push(`  <wpt lat="${fmtCoord(lat)}" lon="${fmtCoord(lng)}">`);
    lines.push(`    <name>${escapeXml(label)}</name>`);
    if (poi.description) {
      lines.push(`    <desc>${escapeXml(poi.description)}</desc>`);
    }
    lines.push(`    <sym>${escapeXml(sym)}</sym>`);
    lines.push(`    <type>${escapeXml(poi.type)}</type>`);
    lines.push('  </wpt>');
  }

  // ── Tracks (routes) ────────────────────────────────────────────
  for (const route of routes) {
    const coords = route.routeCoords ?? [];
    if (coords.length < 2) continue;

    lines.push('  <trk>');
    lines.push(`    <name>${escapeXml(route.name)}</name>`);
    lines.push('    <trkseg>');
    for (const [lng, lat] of coords) {
      if (typeof lng !== 'number' || typeof lat !== 'number') continue;
      lines.push(`      <trkpt lat="${fmtCoord(lat)}" lon="${fmtCoord(lng)}"></trkpt>`);
    }
    lines.push('    </trkseg>');
    lines.push('  </trk>');
  }

  lines.push('</gpx>');
  return lines.join('\n');
}

/**
 * Slugify an event name for use as a filename. Strips accents,
 * replaces non-alphanumerics with dashes, collapses repeats, and
 * bounds the length so we don't produce unusably long downloads.
 */
export function gpxFilename(eventName: string): string {
  const base = eventName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'event'}.gpx`;
}

/**
 * Trigger a browser download of a GPX string. Uses a temporary blob
 * URL so we never have to round-trip the file through the server.
 */
export function downloadGpx(filename: string, gpx: string): void {
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick to let the download actually start
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
