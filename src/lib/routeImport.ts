import type { Coord, EventRoute } from '@/types/mapEditor';

/**
 * Import a course from a GPX or GeoJSON file.
 *
 * **Why imported coordinates go straight into `routeCoords`:** a GPX track
 * is already a real trace along real roads — someone ran it, or a race
 * director drew it in a tool that snapped it. Pushing it back through the
 * Mapbox Directions API would replace known-good geometry with an
 * approximation, cost a round-trip, and quietly "correct" deliberate
 * choices like a path through a park or a lap of a track.
 *
 * So the file's geometry becomes `routeCoords` verbatim, and `waypoints`
 * is a decimated subset of it. That keeps the editor's click-to-extend and
 * undo working (both operate on waypoints) without re-snapping anything
 * the user imported.
 *
 * Parsing is regex-based rather than DOMParser-based so the module stays
 * pure and testable outside a browser. GPX is regular enough for this to
 * be safe: the only thing we need is the lat/lon attribute pair on each
 * point element, and attribute order is handled explicitly.
 */

export interface ParsedTrack {
  name: string;
  coords: Coord[];
}

export class RouteImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteImportError';
  }
}

/** Matches getSnappedRoute's Mapbox Directions chunk size, so an imported
 *  route that later gets extended behaves like a hand-drawn one. */
const MAX_WAYPOINTS = 25;

/** Ceiling on stored points. A 5K GPX is ~1–2k points; a marathon logged at
 *  1s can exceed 15k, which bloats the events JSONB row for no visual gain. */
const MAX_COORDS = 4000;

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Valid WGS84 [lng, lat], rejecting the classic swapped-pair mistake. */
function isValidCoord(c: unknown): c is Coord {
  if (!Array.isArray(c) || c.length < 2) return false;
  const [lng, lat] = c;
  return isFiniteNum(lng) && isFiniteNum(lat)
    && lng >= -180 && lng <= 180
    && lat >= -90 && lat <= 90;
}

/** Evenly thin a coordinate list, always keeping the first and last point. */
function thin(coords: Coord[], max: number): Coord[] {
  if (coords.length <= max) return coords;
  const out: Coord[] = [];
  for (let i = 0; i < max; i++) {
    out.push(coords[Math.round((i * (coords.length - 1)) / (max - 1))]);
  }
  return out;
}

// ── GPX ──────────────────────────────────────────────────────────────────────

/**
 * Pulls `<trkpt>` / `<rtept>` / `<wpt>` points. Attribute order varies between
 * exporters (Garmin writes lat first, some write lon first), so each attribute
 * is read by name rather than by position.
 */
function parseGpx(text: string): ParsedTrack[] {
  const segments: ParsedTrack[] = [];

  // Prefer <trk> blocks so a file with several tracks imports as several routes.
  const trackBlocks = [...text.matchAll(/<trk>([\s\S]*?)<\/trk>/gi)].map((m) => m[1]);
  const blocks = trackBlocks.length > 0 ? trackBlocks : [text];

  for (const block of blocks) {
    const coords: Coord[] = [];

    for (const m of block.matchAll(/<(?:trkpt|rtept|wpt)\b([^>]*)>/gi)) {
      const attrs = m[1];
      const lat = Number(attrs.match(/\blat\s*=\s*["']([^"']+)["']/i)?.[1]);
      const lon = Number(attrs.match(/\blon\s*=\s*["']([^"']+)["']/i)?.[1]);
      const coord: Coord = [lon, lat];
      if (isValidCoord(coord)) coords.push(coord);
    }

    if (coords.length >= 2) {
      const name = block.match(/<name>([\s\S]*?)<\/name>/i)?.[1]?.trim();
      segments.push({ name: name || '', coords });
    }
  }

  return segments;
}

// ── GeoJSON ──────────────────────────────────────────────────────────────────

function coordsFromGeometry(geometry: unknown): Coord[][] {
  if (!geometry || typeof geometry !== 'object') return [];
  const g = geometry as { type?: string; coordinates?: unknown };

  if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
    return [g.coordinates.filter(isValidCoord)];
  }
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    return g.coordinates
      .filter(Array.isArray)
      .map((line) => (line as unknown[]).filter(isValidCoord));
  }
  return [];
}

function parseGeoJson(text: string): ParsedTrack[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RouteImportError("That file isn't valid GeoJSON — it couldn't be parsed as JSON.");
  }

  const tracks: ParsedTrack[] = [];

  const addFeature = (feature: unknown) => {
    const f = feature as { geometry?: unknown; properties?: { name?: unknown } };
    const name = typeof f?.properties?.name === 'string' ? f.properties.name : '';
    for (const coords of coordsFromGeometry(f?.geometry)) {
      if (coords.length >= 2) tracks.push({ name, coords });
    }
  };

  const root = json as { type?: string; features?: unknown };
  if (root?.type === 'FeatureCollection' && Array.isArray(root.features)) {
    root.features.forEach(addFeature);
  } else if (root?.type === 'Feature') {
    addFeature(root);
  } else {
    for (const coords of coordsFromGeometry(root)) {
      if (coords.length >= 2) tracks.push({ name: '', coords });
    }
  }

  return tracks;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a `.gpx` or `.geojson` / `.json` file into one or more tracks.
 * Throws `RouteImportError` with a message suitable for showing the user.
 */
export function parseRouteFile(text: string, filename = ''): ParsedTrack[] {
  const trimmed = text.trim();
  if (!trimmed) throw new RouteImportError('That file is empty.');

  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const looksGpx = ext === 'gpx' || /<gpx[\s>]/i.test(trimmed) || /<trkpt\b/i.test(trimmed);

  const tracks = looksGpx ? parseGpx(trimmed) : parseGeoJson(trimmed);

  if (tracks.length === 0) {
    throw new RouteImportError(
      looksGpx
        ? "No track points found in that GPX file. It may contain only waypoints, not a route."
        : "No line geometry found in that file. A course needs a LineString, not points or polygons."
    );
  }

  return tracks.map((t) => ({ ...t, coords: thin(t.coords, MAX_COORDS) }));
}

/**
 * Turn a parsed track into an `EventRoute`.
 *
 * `routeCoords` is the imported geometry untouched. `waypoints` is a
 * decimated subset, with `segmentCoordCounts` summing to `routeCoords.length`
 * so the editor's per-waypoint undo trims the right number of points.
 */
export function trackToRoute(track: ParsedTrack, name: string, color: string): EventRoute {
  const routeCoords = track.coords;
  const n = routeCoords.length;
  const target = Math.min(MAX_WAYPOINTS, n);

  // Evenly spaced indices into routeCoords, always including first and last.
  const indices: number[] = [];
  for (let i = 0; i < target; i++) {
    const idx = target === 1 ? 0 : Math.round((i * (n - 1)) / (target - 1));
    if (indices[indices.length - 1] !== idx) indices.push(idx);
  }

  const waypoints = indices.map((i) => routeCoords[i]);

  // Must match the editor's convention exactly, not merely sum correctly.
  // RouteEditor seeds `segmentCoordCounts: [1]` on the first click — a
  // placeholder for the single starting coordinate — and thereafter appends
  // the length of each snapped segment. So counts[0] is always 1, and
  // counts[i>=1] is what the segment waypoint[i-1] -> waypoint[i] contributed.
  //
  // Emitting the other (equally sensible) reading — counts[i] = the segment
  // starting at waypoint i — is an exact left-rotation of this array. It still
  // sums to routeCoords.length, so it looks right, but it makes counts[last]
  // always 1: undo then trims one coordinate instead of a whole segment, and
  // the Finish-pin drag keeps the entire track before appending a re-routed
  // tail, drawing a visible backtrack.
  const segmentCoordCounts = indices.map((idx, i) => (i === 0 ? 1 : idx - indices[i - 1]));

  return {
    id: crypto.randomUUID(),
    name,
    color,
    visible: true,
    waypoints,
    routeCoords,
    segmentCoordCounts,
  };
}
