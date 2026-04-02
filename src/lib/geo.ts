import type { Coord } from '@/types/mapEditor';

export function totalDistanceMiles(coords: Coord[]): number {
  if (coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1], coords[i]);
  }
  return total;
}

function haversine(a: Coord, b: Coord): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export async function getSnappedRoute(
  waypoints: Coord[],
  token: string
): Promise<Coord[]> {
  if (waypoints.length < 2) return [...waypoints];

  // Mapbox Directions API limits to 25 waypoints per request
  const chunks: Coord[][] = [];
  for (let i = 0; i < waypoints.length; i += 24) {
    const chunk = waypoints.slice(i, i + 25);
    if (chunk.length >= 2) chunks.push(chunk);
  }

  const allCoords: Coord[] = [];

  for (const chunk of chunks) {
    const coordStr = chunk.map((c) => `${c[0]},${c[1]}`).join(';');
    const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordStr}?geometries=geojson&overview=full&access_token=${token}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.routes?.[0]?.geometry?.coordinates) {
      const coords = data.routes[0].geometry.coordinates as Coord[];
      // Avoid duplicating the junction point between chunks
      if (allCoords.length > 0) {
        allCoords.push(...coords.slice(1));
      } else {
        allCoords.push(...coords);
      }
    }
  }

  return allCoords.length > 0 ? allCoords : [...waypoints];
}

/**
 * Returns coordinates at each whole-mile mark along a route.
 */
export function getMileMarkers(coords: Coord[]): { mile: number; coord: Coord }[] {
  if (coords.length < 2) return [];
  const markers: { mile: number; coord: Coord }[] = [];
  let cumulative = 0;
  let nextMile = 1;

  for (let i = 1; i < coords.length; i++) {
    const segDist = haversine(coords[i - 1], coords[i]);
    const prevCumulative = cumulative;
    cumulative += segDist;

    while (cumulative >= nextMile) {
      // Interpolate position along this segment
      const overshoot = nextMile - prevCumulative;
      const t = segDist > 0 ? overshoot / segDist : 0;
      const lng = coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]);
      const lat = coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1]);
      markers.push({ mile: nextMile, coord: [lng, lat] });
      nextMile++;
    }
  }
  return markers;
}

/**
 * Snaps a coordinate to the nearest point on any visible route.
 * Returns the snapped coordinate, or the original if no routes or too far (>0.05 miles ≈ 80m).
 */
export function snapToNearestRoute(
  coord: Coord,
  routes: { routeCoords: Coord[]; visible: boolean }[],
  maxDistMiles = 0.05
): Coord {
  let bestCoord = coord;
  let bestDist = Infinity;

  for (const route of routes) {
    if (!route.visible || route.routeCoords.length < 2) continue;
    for (let i = 1; i < route.routeCoords.length; i++) {
      const snapped = nearestPointOnSegment(coord, route.routeCoords[i - 1], route.routeCoords[i]);
      const d = haversine(coord, snapped);
      if (d < bestDist) {
        bestDist = d;
        bestCoord = snapped;
      }
    }
  }

  return bestDist <= maxDistMiles ? bestCoord : coord;
}

function nearestPointOnSegment(p: Coord, a: Coord, b: Coord): Coord {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return a;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * dx, a[1] + t * dy];
}

export const ROUTE_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#7c3aed',
  '#ea580c', '#0891b2', '#db2777', '#65a30d',
];

export const BASEMAP_OPTIONS: { id: string; label: string; style: string }[] = [
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'outdoors', label: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
];
