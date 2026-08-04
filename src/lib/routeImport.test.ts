import { describe, it, expect } from 'vitest';
import { parseRouteFile, trackToRoute, RouteImportError } from './routeImport';

const gpx = (points: string, extra = '') => `<?xml version="1.0"?>
<gpx version="1.1" creator="test"><trk><name>McHenry 5K</name>${extra}<trkseg>
${points}
</trkseg></trk></gpx>`;

const pt = (lat: number, lon: number) => `<trkpt lat="${lat}" lon="${lon}"><ele>230</ele></trkpt>`;

describe('parseRouteFile — GPX', () => {
  it('extracts track points as [lng, lat] and keeps the track name', () => {
    const tracks = parseRouteFile(gpx([pt(42.34, -88.27), pt(42.35, -88.28)].join('\n')), 'a.gpx');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].name).toBe('McHenry 5K');
    // GPX is lat/lon; we store lng/lat. Getting this backwards puts the
    // course in the Indian Ocean, so it is worth an explicit assertion.
    expect(tracks[0].coords).toEqual([[-88.27, 42.34], [-88.28, 42.35]]);
  });

  it('handles lon-before-lat attribute order', () => {
    const text = gpx('<trkpt lon="-88.27" lat="42.34"/><trkpt lon="-88.28" lat="42.35"/>');
    expect(parseRouteFile(text, 'a.gpx')[0].coords).toEqual([[-88.27, 42.34], [-88.28, 42.35]]);
  });

  it('accepts single quotes and self-closing points', () => {
    const text = gpx("<trkpt lat='42.34' lon='-88.27'/><trkpt lat='42.35' lon='-88.28'/>");
    expect(parseRouteFile(text, 'a.gpx')[0].coords).toHaveLength(2);
  });

  it('returns one track per <trk> block', () => {
    const text = `<gpx>
      <trk><name>5K</name><trkseg>${pt(42.1, -88.1)}${pt(42.2, -88.2)}</trkseg></trk>
      <trk><name>Kids Dash</name><trkseg>${pt(42.3, -88.3)}${pt(42.4, -88.4)}</trkseg></trk>
    </gpx>`;
    expect(parseRouteFile(text, 'a.gpx').map((t) => t.name)).toEqual(['5K', 'Kids Dash']);
  });

  it('detects GPX by content when the filename has no extension', () => {
    expect(parseRouteFile(gpx(pt(42.1, -88.1) + pt(42.2, -88.2)), '')).toHaveLength(1);
  });

  it('drops points with out-of-range or missing coordinates', () => {
    const text = gpx([
      pt(42.34, -88.27),
      '<trkpt lat="999" lon="-88.28"/>',
      '<trkpt lon="-88.29"/>',
      pt(42.36, -88.30),
    ].join('\n'));
    expect(parseRouteFile(text, 'a.gpx')[0].coords).toEqual([[-88.27, 42.34], [-88.3, 42.36]]);
  });

  it('rejects a GPX with only waypoints and no usable track', () => {
    expect(() => parseRouteFile('<gpx><wpt lat="42.1" lon="-88.1"/></gpx>', 'a.gpx'))
      .toThrow(RouteImportError);
  });

  it('thins very long tracks but keeps the endpoints', () => {
    const many = Array.from({ length: 9000 }, (_, i) => pt(42 + i / 100000, -88 - i / 100000));
    const coords = parseRouteFile(gpx(many.join('\n')), 'a.gpx')[0].coords;
    expect(coords.length).toBeLessThanOrEqual(4000);
    expect(coords[0]).toEqual([-88, 42]);
    expect(coords[coords.length - 1]).toEqual([-88 - 8999 / 100000, 42 + 8999 / 100000]);
  });
});

describe('parseRouteFile — GeoJSON', () => {
  it('reads a bare LineString', () => {
    const text = JSON.stringify({ type: 'LineString', coordinates: [[-88.1, 42.1], [-88.2, 42.2]] });
    expect(parseRouteFile(text, 'a.geojson')[0].coords).toHaveLength(2);
  });

  it('reads a Feature and takes its properties.name', () => {
    const text = JSON.stringify({
      type: 'Feature',
      properties: { name: 'Turkey Trot 5K' },
      geometry: { type: 'LineString', coordinates: [[-88.1, 42.1], [-88.2, 42.2]] },
    });
    expect(parseRouteFile(text, 'a.geojson')[0].name).toBe('Turkey Trot 5K');
  });

  it('reads every LineString in a FeatureCollection and ignores non-line features', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: '5K' }, geometry: { type: 'LineString', coordinates: [[-88.1, 42.1], [-88.2, 42.2]] } },
        { type: 'Feature', properties: { name: 'Water' }, geometry: { type: 'Point', coordinates: [-88.15, 42.15] } },
        { type: 'Feature', properties: { name: 'Dash' }, geometry: { type: 'LineString', coordinates: [[-88.3, 42.3], [-88.4, 42.4]] } },
      ],
    });
    expect(parseRouteFile(text, 'a.geojson').map((t) => t.name)).toEqual(['5K', 'Dash']);
  });

  it('splits a MultiLineString into separate tracks', () => {
    const text = JSON.stringify({
      type: 'MultiLineString',
      coordinates: [[[-88.1, 42.1], [-88.2, 42.2]], [[-88.3, 42.3], [-88.4, 42.4]]],
    });
    expect(parseRouteFile(text, 'a.geojson')).toHaveLength(2);
  });

  it('throws a readable error for malformed JSON', () => {
    expect(() => parseRouteFile('{ not json', 'a.geojson')).toThrow(/valid GeoJSON/);
  });

  it('throws when the file has no line geometry', () => {
    const text = JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [-88, 42] } });
    expect(() => parseRouteFile(text, 'a.geojson')).toThrow(/LineString/);
  });

  it('rejects an empty file', () => {
    expect(() => parseRouteFile('   ', 'a.gpx')).toThrow(/empty/);
  });
});

describe('trackToRoute', () => {
  const track = (n: number) => ({
    name: 't',
    coords: Array.from({ length: n }, (_, i) => [-88 - i / 1000, 42 + i / 1000] as [number, number]),
  });

  it('keeps the imported geometry verbatim as routeCoords', () => {
    const t = track(500);
    expect(trackToRoute(t, '5K', '#f00').routeCoords).toEqual(t.coords);
  });

  it('decimates waypoints to the Mapbox chunk limit', () => {
    expect(trackToRoute(track(500), '5K', '#f00').waypoints.length).toBeLessThanOrEqual(25);
  });

  it('starts and ends waypoints on the real endpoints', () => {
    const t = track(500);
    const r = trackToRoute(t, '5K', '#f00');
    expect(r.waypoints[0]).toEqual(t.coords[0]);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual(t.coords[499]);
  });

  it('segmentCoordCounts sums to routeCoords.length', () => {
    for (const n of [2, 3, 24, 25, 26, 500, 3999]) {
      const r = trackToRoute(track(n), '5K', '#f00');
      const sum = r.segmentCoordCounts!.reduce((a, b) => a + b, 0);
      expect(sum, `n=${n}`).toBe(r.routeCoords.length);
      expect(r.segmentCoordCounts!.length, `n=${n}`).toBe(r.waypoints.length);
    }
  });

  // Summing correctly is not enough — the previous implementation summed
  // correctly while being an exact left-rotation of what RouteEditor expects,
  // which broke undo and the Finish-pin drag. These lock the convention:
  // counts[0] is a placeholder 1, counts[i>=1] is the span of segment i-1 -> i.
  it("counts[0] is always 1, matching the editor's seed of segmentCoordCounts: [1]", () => {
    for (const n of [2, 3, 25, 26, 500, 3999]) {
      expect(trackToRoute(track(n), '5K', '#f00').segmentCoordCounts![0], `n=${n}`).toBe(1);
    }
  });

  it('counts[i>=1] is the coordinate span of the segment ending at waypoint i', () => {
    const t = track(500);
    const r = trackToRoute(t, '5K', '#f00');
    const counts = r.segmentCoordCounts!;
    // Walking the counts from the start must land exactly on each waypoint.
    let idx = 0;
    for (let i = 1; i < counts.length; i++) {
      idx += counts[i];
      expect(r.routeCoords[idx], `waypoint ${i}`).toEqual(r.waypoints[i]);
    }
    expect(idx).toBe(r.routeCoords.length - 1);
  });

  it("undo trims a whole segment, not a single point (RouteEditor's trim path)", () => {
    const r = trackToRoute(track(500), '5K', '#f00');
    const counts = r.segmentCoordCounts!;
    const lastCount = counts[counts.length - 1];
    // Under the old rotated convention this was always 1, so the first undo
    // removed one coordinate out of 500 and looked like a no-op.
    expect(lastCount).toBeGreaterThan(1);
    const trimmed = r.routeCoords.slice(0, -lastCount);
    expect(trimmed[trimmed.length - 1]).toEqual(r.waypoints[r.waypoints.length - 2]);
  });

  it('Finish-pin drag drops exactly the last segment, leaving no backtrack', () => {
    const r = trackToRoute(track(500), '5K', '#f00');
    const counts = r.segmentCoordCounts!;
    // Mirrors RouteEditor.tsx:881-883.
    const rest = r.routeCoords.slice(0, r.routeCoords.length - counts[counts.length - 1]);
    // `rest` must end at the second-to-last waypoint. If it ended at the true
    // finish, appending a re-routed tail would draw a line that runs to the
    // end, jumps backward, and retraces.
    expect(rest[rest.length - 1]).toEqual(r.waypoints[r.waypoints.length - 2]);
  });

  it('handles a two-point track without producing duplicate waypoints', () => {
    const r = trackToRoute(track(2), '5K', '#f00');
    expect(r.waypoints).toHaveLength(2);
    expect(r.segmentCoordCounts).toEqual([1, 1]);
  });
});
