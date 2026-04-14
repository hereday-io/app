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
