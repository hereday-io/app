/**
 * Sum the Haversine distance along a sequence of `[lng, lat]` coordinates.
 * Returns meters. Pass through `metersToMiles` for display.
 *
 * No external geo lib — Haversine is a six-line formula and avoids
 * pulling in turf (~100KB) just for one routine.
 */
export function haversineMeters(coords: [number, number][]): number {
  if (!coords || coords.length < 2) return 0;
  const R = 6371000; // Earth radius in meters
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(Δφ / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    total += 2 * R * Math.asin(Math.sqrt(a));
  }
  return total;
}

export const metersToMiles = (m: number) => m / 1609.344;

/* ------------------------------------------------------------------ */
/*  Point-on-line projection for mile markers                         */
/* ------------------------------------------------------------------ */

/** Distance in meters between two [lng, lat] points. */
function ptDist(a: [number, number], b: [number, number]): number {
  return haversineMeters([a, b]);
}

/**
 * Project a point onto a polyline and return the distance-along-line
 * from the polyline start to the projected point, in meters.
 *
 * Algorithm: for each segment of the polyline, find the closest point
 * on that segment to `pt` (clamped perpendicular projection). Track
 * the segment whose projection is closest, then sum Haversine distances
 * from start to that projected point.
 *
 * Returns `null` if the polyline has fewer than 2 points.
 */
export function mileMarkerForPoi(
  pt: [number, number],
  routeCoords: [number, number][],
): number | null {
  if (!routeCoords || routeCoords.length < 2) return null;

  let bestDist = Infinity;
  let bestSegIdx = 0;
  let bestT = 0; // interpolation factor [0..1] along best segment

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const a = routeCoords[i];
    const b = routeCoords[i + 1];

    // Project pt onto segment a→b (in lng/lat space — good enough for
    // short segments which is what snapped-route coords give us).
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const d = ptDist(pt, proj);

    if (d < bestDist) {
      bestDist = d;
      bestSegIdx = i;
      bestT = t;
    }
  }

  // Sum distance from start to the beginning of the best segment.
  let along = 0;
  for (let i = 0; i < bestSegIdx; i++) {
    along += ptDist(routeCoords[i], routeCoords[i + 1]);
  }
  // Add the fractional distance within the best segment.
  along += ptDist(routeCoords[bestSegIdx], [
    routeCoords[bestSegIdx][0] + bestT * (routeCoords[bestSegIdx + 1][0] - routeCoords[bestSegIdx][0]),
    routeCoords[bestSegIdx][1] + bestT * (routeCoords[bestSegIdx + 1][1] - routeCoords[bestSegIdx][1]),
  ]);

  return along;
}

/**
 * Total miles across all provided routes, summing each route's
 * `routeCoords` (falling back to `waypoints` if routeCoords is missing).
 */
export function totalRouteMiles(
  routes: Array<{ routeCoords?: [number, number][]; waypoints?: [number, number][] } | undefined | null> | undefined | null,
): number {
  if (!routes || routes.length === 0) return 0;
  let totalMeters = 0;
  for (const r of routes) {
    const coords = r?.routeCoords?.length ? r.routeCoords : r?.waypoints;
    if (coords) totalMeters += haversineMeters(coords);
  }
  return metersToMiles(totalMeters);
}
