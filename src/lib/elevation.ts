import type { Coord } from '@/types/mapEditor';

export interface ElevationPoint {
  distance: number; // cumulative distance in miles
  elevation: number; // elevation in feet
  coord: Coord;
}

/**
 * Sample N evenly-spaced points along a route polyline.
 */
function samplePoints(coords: Coord[], count: number): Coord[] {
  if (coords.length <= count) return [...coords];

  const sampled: Coord[] = [coords[0]];
  const step = (coords.length - 1) / (count - 1);
  for (let i = 1; i < count - 1; i++) {
    const idx = Math.round(i * step);
    sampled.push(coords[idx]);
  }
  sampled.push(coords[coords.length - 1]);
  return sampled;
}

/**
 * Decode elevation from Mapbox Terrain-RGB tile pixel values.
 * Formula: elevation = -10000 + (R * 256 * 256 + G * 256 + B) * 0.1
 */
function rgbToElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
}

/**
 * Fetch elevation for a single coordinate using Mapbox Tilequery API.
 */
async function fetchElevationBatch(
  coords: Coord[],
  token: string
): Promise<(number | null)[]> {
  // Use Mapbox Tilequery API for each point (batched with Promise.all)
  const results = await Promise.all(
    coords.map(async (coord) => {
      try {
        const url = `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery/${coord[0]},${coord[1]}.json?layers=contour&access_token=${token}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        // Get the highest-resolution contour elevation
        const features = data?.features;
        if (!features || features.length === 0) return null;
        // Sort by distance (closest first) and get elevation
        const sorted = features.sort(
          (a: any, b: any) =>
            (a.properties?.tilequery?.distance ?? Infinity) -
            (b.properties?.tilequery?.distance ?? Infinity)
        );
        return (sorted[0]?.properties?.ele as number) ?? null;
      } catch {
        return null;
      }
    })
  );
  return results;
}

function haversineDistance(a: Coord, b: Coord): number {
  const R = 3958.8;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Fetch elevation profile for a route.
 * Samples up to `maxPoints` evenly along the route.
 */
export async function getElevationProfile(
  routeCoords: Coord[],
  token: string,
  maxPoints = 50
): Promise<ElevationPoint[]> {
  if (routeCoords.length < 2) return [];

  const sampled = samplePoints(routeCoords, maxPoints);
  const elevations = await fetchElevationBatch(sampled, token);

  const points: ElevationPoint[] = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < sampled.length; i++) {
    if (i > 0) {
      cumulativeDistance += haversineDistance(sampled[i - 1], sampled[i]);
    }
    const elev = elevations[i];
    if (elev !== null) {
      points.push({
        distance: cumulativeDistance,
        elevation: elev * 3.28084, // meters to feet
        coord: sampled[i],
      });
    }
  }

  return points;
}

/**
 * Calculate elevation gain/loss from profile data.
 */
export function elevationStats(points: ElevationPoint[]) {
  let gain = 0;
  let loss = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const e = points[i].elevation;
    if (e < min) min = e;
    if (e > max) max = e;
    if (i > 0) {
      const diff = e - points[i - 1].elevation;
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
  }

  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
    min: min === Infinity ? 0 : Math.round(min),
    max: max === -Infinity ? 0 : Math.round(max),
  };
}
