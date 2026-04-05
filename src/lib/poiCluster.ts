import type mapboxgl from 'mapbox-gl';
import type { RoutePoi } from '@/types/mapEditor';

export interface PoiCluster {
  /** Display coordinates — centroid of the clustered POIs. */
  lng: number;
  lat: number;
  /** POIs in this cluster. Length 1 means "not actually clustered". */
  pois: RoutePoi[];
}

/**
 * Group POIs that render close together on screen at the current viewport.
 *
 * Greedy clustering: for each POI, attach to the first existing cluster whose
 * centroid is within `radiusPx` pixels, or start a new cluster. The centroid
 * is re-projected as new POIs join so the cluster tracks the group visually.
 *
 * This is recomputed on every map move/zoom in the views that consume it, so
 * clusters "unmerge" naturally as the user zooms in and the pixel distance
 * between POIs grows beyond the threshold.
 */
export function clusterPoisByPixels(
  pois: RoutePoi[],
  map: mapboxgl.Map,
  radiusPx = 44,
): PoiCluster[] {
  const working: Array<{
    sumLng: number;
    sumLat: number;
    px: { x: number; y: number };
    pois: RoutePoi[];
  }> = [];

  const r2 = radiusPx * radiusPx;

  for (const poi of pois) {
    const px = map.project(poi.coordinates as [number, number]);
    let attached = false;
    for (const c of working) {
      const dx = c.px.x - px.x;
      const dy = c.px.y - px.y;
      if (dx * dx + dy * dy <= r2) {
        c.pois.push(poi);
        c.sumLng += poi.coordinates[0];
        c.sumLat += poi.coordinates[1];
        const lng = c.sumLng / c.pois.length;
        const lat = c.sumLat / c.pois.length;
        c.px = map.project([lng, lat]);
        attached = true;
        break;
      }
    }
    if (!attached) {
      working.push({
        sumLng: poi.coordinates[0],
        sumLat: poi.coordinates[1],
        px,
        pois: [poi],
      });
    }
  }

  return working.map((c) => ({
    lng: c.sumLng / c.pois.length,
    lat: c.sumLat / c.pois.length,
    pois: c.pois,
  }));
}
