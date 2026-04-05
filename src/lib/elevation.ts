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
 * Decode elevation in meters from a Mapbox Terrain-RGB pixel.
 * Formula per Mapbox spec: elevation = -10000 + (R*256*256 + G*256 + B) * 0.1
 */
function rgbToElevationMeters(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
}

/**
 * Convert lon/lat to XYZ tile coordinates at a given zoom level.
 */
function lonLatToTile(lon: number, lat: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y, z: zoom };
}

/**
 * Get the pixel offset within a 256x256 tile for a given lon/lat.
 */
function lonLatToPixelOffset(lon: number, lat: number, zoom: number, tileX: number, tileY: number) {
  const n = Math.pow(2, zoom);
  const px = ((lon + 180) / 360) * n * 256 - tileX * 256;
  const latRad = (lat * Math.PI) / 180;
  const py =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * 256 -
    tileY * 256;
  return { px: Math.floor(px), py: Math.floor(py) };
}

/**
 * Fetch a Terrain-RGB tile and decode elevation for a single coordinate.
 * Uses zoom 14 — highest zoom available for terrain-rgb, ~5m horizontal resolution.
 */
async function fetchTerrainElevation(coord: Coord, token: string): Promise<number | null> {
  const zoom = 14;
  const [lon, lat] = coord;
  const { x, y, z } = lonLatToTile(lon, lat, zoom);

  const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}.pngraw?access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0);

    const { px, py } = lonLatToPixelOffset(lon, lat, zoom, x, y);
    const clampedX = Math.max(0, Math.min(255, px));
    const clampedY = Math.max(0, Math.min(255, py));

    const pixel = ctx.getImageData(clampedX, clampedY, 1, 1).data;
    return rgbToElevationMeters(pixel[0], pixel[1], pixel[2]);
  } catch {
    return null;
  }
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
 * Fetch elevation profile using Mapbox Terrain-RGB tiles.
 * Much higher vertical resolution (~0.1m) vs contour tilequery (~10-40m bands).
 * Fetches tiles in batches to avoid rate limits.
 */
export async function getElevationProfile(
  routeCoords: Coord[],
  token: string,
  maxPoints = 150
): Promise<ElevationPoint[]> {
  if (routeCoords.length < 2) return [];

  const sampled = samplePoints(routeCoords, maxPoints);

  // Batch fetches to avoid hammering the API (10 at a time)
  const BATCH_SIZE = 10;
  const elevations: (number | null)[] = [];

  for (let i = 0; i < sampled.length; i += BATCH_SIZE) {
    const batch = sampled.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((coord) => fetchTerrainElevation(coord, token)));
    elevations.push(...results);
  }

  // Build profile, filling null gaps by interpolating from neighbors
  const rawElevations: (number | null)[] = elevations;

  // Forward-fill then backward-fill any nulls
  for (let i = 1; i < rawElevations.length; i++) {
    if (rawElevations[i] === null) rawElevations[i] = rawElevations[i - 1];
  }
  for (let i = rawElevations.length - 2; i >= 0; i--) {
    if (rawElevations[i] === null) rawElevations[i] = rawElevations[i + 1];
  }

  const points: ElevationPoint[] = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < sampled.length; i++) {
    if (i > 0) {
      cumulativeDistance += haversineDistance(sampled[i - 1], sampled[i]);
    }
    const elev = rawElevations[i];
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
 * Calculate elevation gain/loss/min/max from profile data.
 * Uses a 3ft noise threshold to avoid counting GPS jitter as gain.
 */
export function elevationStats(points: ElevationPoint[]) {
  let gain = 0;
  let loss = 0;
  let min = Infinity;
  let max = -Infinity;
  const NOISE_THRESHOLD = 3; // feet

  for (let i = 0; i < points.length; i++) {
    const e = points[i].elevation;
    if (e < min) min = e;
    if (e > max) max = e;
    if (i > 0) {
      const diff = e - points[i - 1].elevation;
      if (diff > NOISE_THRESHOLD) gain += diff;
      else if (diff < -NOISE_THRESHOLD) loss += Math.abs(diff);
    }
  }

  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
    min: min === Infinity ? 0 : Math.round(min),
    max: max === -Infinity ? 0 : Math.round(max),
  };
}
