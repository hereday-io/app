import { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { getMileMarkers, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone } from '@/lib/pois';
import { clusterPoisByPixels } from '@/lib/poiCluster';
import { attachStatusDot, buildBrandedSponsorMarkerEl, parseAutoStartFinishId, setStatusDot } from '@/lib/mapMarkers';
import { selectBrandedSponsorIds } from '@/lib/sponsors';
import { usePoiStatuses } from '@/hooks/usePoiStatuses';
import type { Coord, EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { ArrowLeft, Trophy, Eye, Maximize2, Download } from 'lucide-react';
import EventBranding from '@/components/public/EventBranding';
import PublicMapToolbar from '@/components/public/PublicMapToolbar';
import MapBottomSheet from '@/components/map/MapBottomSheet';
import PoiReadonlyPopover from '@/components/public/PoiReadonlyPopover';
import MadeWithHeredayBadge from '@/components/public/MadeWithHeredayBadge';
import SubscribeButton from '@/components/public/SubscribeButton';
import PublicShareButton from '@/components/public/PublicShareButton';
import TrackMeButton from '@/components/public/TrackMeButton';
import LiveRunnerMarkers from '@/components/public/LiveRunnerMarkers';
import RunnerListPanel from '@/components/public/RunnerListPanel';
import { useTrackingSubscription } from '@/hooks/useTrackingSubscription';
import { LIVE_TRACKING_ENABLED } from '@/lib/featureFlags';
import { buildGpx, downloadGpx, gpxFilename } from '@/lib/gpx';
import { logEvent } from '@/lib/analytics';

export type PublicViewMode = 'runner' | 'spectator';

interface PublicEventViewProps {
  event: {
    id: string;
    name: string;
    city: string | null;
    event_date: string | null;
    start_time?: string | null;
    registration_url?: string | null;
    routes: EventRoute[];
    pois: RoutePoi[];
    logo_url?: string | null;
    branding_style?: string;
    /** isPro() as computed server-side by public_events (see EventPublic). */
    is_pro: boolean;
    tracking_start?: string | null;
    tracking_end?: string | null;
  };
  mode: PublicViewMode;
  onBack: () => void;
  onSwitchMode: (mode: PublicViewMode) => void;
}

// Everything that differs between Run and Watch lives here. Switching
// modes only restyles what's already on the map. It never rebuilds the
// map or reloads its style, so the basemap stays painted the whole time.
const MODE_STYLE = {
  runner: {
    // Initial basemap only. After that the visitor's pick sticks across
    // mode switches, because changing it would mean a full style reload.
    basemap: 'outdoors',
    routePaint: { width: 4, opacity: 0.85, dash: undefined as number[] | undefined },
    poiSize: 32,
    poiFontSize: 14,
    poiPopupOffset: 14,
    clusterSize: 36,
    clusterFontSize: 13,
    clusterPopupOffset: 18,
    clusterRadiusPx: 40,
  },
  spectator: {
    basemap: 'streets',
    routePaint: { width: 3, opacity: 0.45, dash: [2, 2] as number[] | undefined },
    poiSize: 36,
    poiFontSize: 16,
    poiPopupOffset: 16,
    clusterSize: 40,
    clusterFontSize: 14,
    clusterPopupOffset: 20,
    clusterRadiusPx: 44,
  },
} as const;

// How long to hold POI markers back waiting for the first complete
// render. On a dead connection the tiles may never arrive, and race-day
// POIs over a blank background are still better than nothing.
const MAP_LOAD_FALLBACK_MS = 8000;

/** Screen-reader name for a single POI marker: "Aid Station: Mile 6 table". */
function poiAccessibleName(poi: RoutePoi): string {
  const typeLabel = poiTone(poi.type).label;
  const title = poi.title?.trim();
  return title && title.toLowerCase() !== typeLabel.toLowerCase()
    ? `${typeLabel}: ${title}`
    : typeLabel;
}

const PublicEventView = ({ event, mode, onBack, onSwitchMode }: PublicEventViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const poiMarkersRef = useRef<mapboxgl.Marker[]>([]);
  // Track single POI markers by id so we can programmatically open
  // the right popup after a cluster breaks apart.
  const poiMarkerByIdRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  // React roots mounted into Mapbox popup DOM — one per open popup.
  const popoverRootsRef = useRef<Map<string, Root>>(new Map());
  // Per-POI status dot overlay elements, keyed so the subscription
  // effect can mutate their color without rebuilding the marker.
  const statusDotByPoiIdRef = useRef<Map<string, HTMLElement>>(new Map());

  const isPro = event.is_pro;
  const trackingWindowOpen = LIVE_TRACKING_ENABLED && isPro
    && !!event.tracking_start && !!event.tracking_end
    && new Date() <= new Date(event.tracking_end);
  const { runners } = useTrackingSubscription(event.id, trackingWindowOpen && mode === 'spectator');
  const [focusedRunnerId, setFocusedRunnerId] = useState<string | null>(null);

  // Live POI statuses via postgres_changes. Empty map until the first
  // snapshot resolves; marker build path treats unknown = 'open'.
  const poiStatuses = usePoiStatuses(event.id);
  // When a user taps a row in a cluster popup we queue the target
  // POI id here, fly the map in, and open that POI's popup after
  // the moveend rebuild fires.
  const pendingPoiPopupRef = useRef<string | null>(null);
  const elevMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const { token } = useMapboxToken();

  // The mode the page opened in picks the starting basemap; it is not
  // re-derived on later mode switches (see MODE_STYLE).
  const [selectedBasemap, setSelectedBasemap] = useState<string>(() => MODE_STYLE[mode].basemap);
  // Which style the map is actually showing. Lets the basemap effect skip
  // the style it was constructed with instead of loading it twice.
  const appliedBasemapRef = useRef<string | null>(null);
  const [hiddenRouteIds, setHiddenRouteIds] = useState<Set<string>>(new Set());
  const [highlightedPoiType, setHighlightedPoiType] = useState<PoiType | null>(null);
  // True once the map has done its first visually complete render (style,
  // tiles and route lines). Markers wait for it so they don't float over
  // an empty background while the tiles are still loading.
  const [mapReady, setMapReady] = useState(false);

  // Style callbacks fire outside React, so they read current values from
  // refs rather than from a stale closure.
  const modeRef = useRef(mode);
  const hiddenRouteIdsRef = useRef(hiddenRouteIds);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { hiddenRouteIdsRef.current = hiddenRouteIds; }, [hiddenRouteIds]);

  const weatherCoord: [number, number] | null = (() => {
    const lon = event.routes[0]?.routeCoords?.[0]?.[0] ?? event.routes[0]?.waypoints?.[0]?.[0];
    const lat = event.routes[0]?.routeCoords?.[0]?.[1] ?? event.routes[0]?.waypoints?.[0]?.[1];
    return lon != null && lat != null ? [lon, lat] : null;
  })();

  const activeRoute = event.routes[0];

  const handleElevationHover = useCallback((coord: Coord | null) => {
    if (elevMarkerRef.current) { elevMarkerRef.current.remove(); elevMarkerRef.current = null; }
    if (coord && mapRef.current) {
      const color = activeRoute?.color ?? '#2563eb';
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;width:20px;height:20px;pointer-events:none;';
      // Purely visual echo of the elevation chart hover.
      el.setAttribute('aria-hidden', 'true');
      const pulse = document.createElement('div');
      pulse.style.cssText = `position:absolute;inset:-6px;border-radius:50%;border:2px solid ${color};opacity:0.5;animation:elevPulse 1.2s ease-out infinite;`;
      el.appendChild(pulse);
      const ring = document.createElement('div');
      ring.style.cssText = 'position:absolute;inset:-3px;border-radius:50%;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.35);';
      el.appendChild(ring);
      const dot = document.createElement('div');
      dot.style.cssText = `position:absolute;inset:3px;border-radius:50%;background:${color};`;
      el.appendChild(dot);
      if (!document.getElementById('elev-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'elev-pulse-style';
        style.textContent = '@keyframes elevPulse{0%{transform:scale(1);opacity:0.6}70%{transform:scale(1.8);opacity:0}100%{transform:scale(1.8);opacity:0}}';
        document.head.appendChild(style);
      }
      elevMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(coord).addTo(mapRef.current);
    }
  }, [activeRoute?.color]);

  const toggleRoute = useCallback((id: string) => {
    setHiddenRouteIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleZoomIn = useCallback(() => { mapRef.current?.zoomIn(); }, []);
  const handleZoomOut = useCallback(() => { mapRef.current?.zoomOut(); }, []);

  const handleDownloadGpx = useCallback(() => {
    // Only export routes the user has left visible — respects the
    // legend toggle so filtering matches what they see on the map.
    const visibleRoutes = event.routes.filter(
      (r) => !hiddenRouteIds.has(r.id) && r.routeCoords.length >= 2
    );
    if (visibleRoutes.length === 0) return;

    const gpx = buildGpx({
      eventName: event.name,
      eventDate: event.event_date,
      routes: visibleRoutes,
      pois: event.pois,
    });
    downloadGpx(gpxFilename(event.name), gpx);
    logEvent('gpx_downloaded', event.id, {
      route_count: visibleRoutes.length,
      poi_count: event.pois.length,
    });
  }, [event.id, event.name, event.event_date, event.routes, event.pois, hiddenRouteIds]);

  const hasDownloadableRoute = event.routes.some((r) => r.routeCoords.length >= 2);

  const handleFitRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const coords: [number, number][] = [];
    event.routes.forEach((r) => {
      if (!hiddenRouteIds.has(r.id) && r.routeCoords.length >= 2) {
        coords.push(...(r.routeCoords as [number, number][]));
      }
    });
    if (coords.length === 0) return;
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new mapboxgl.LngLatBounds(coords[0], coords[0])
    );
    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 800 });
  }, [event.routes, hiddenRouteIds]);

  // Apply the current mode's line style and the legend's hidden set to
  // every route layer. Paint/layout changes only — no style reload.
  const applyRouteStyle = useCallback((map: mapboxgl.Map) => {
    const paint = MODE_STYLE[modeRef.current].routePaint;
    event.routes.forEach((route) => {
      const layerId = `route-line-${route.id}`;
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, 'line-width', paint.width);
      map.setPaintProperty(layerId, 'line-opacity', paint.opacity);
      // undefined resets to the default (a solid line).
      map.setPaintProperty(layerId, 'line-dasharray', paint.dash);
      map.setLayoutProperty(layerId, 'visibility', hiddenRouteIdsRef.current.has(route.id) ? 'none' : 'visible');
    });
  }, [event.routes]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || !token) return;
    mapboxgl.accessToken = token;

    const basemapId = selectedBasemap;
    const style = BASEMAP_OPTIONS.find(b => b.id === basemapId)?.style ?? BASEMAP_OPTIONS[1].style;
    appliedBasemapRef.current = basemapId;

    // Pre-compute bounds from route data so the map starts already framed
    // on the route — no initial globe-to-route zoom animation.
    const initialCoords: [number, number][] = [];
    event.routes.forEach((r) => {
      if (r.routeCoords.length >= 2) initialCoords.push(...(r.routeCoords as [number, number][]));
    });
    const initialBounds = initialCoords.length > 0
      ? initialCoords.reduce(
          (b, c) => b.extend(c),
          new mapboxgl.LngLatBounds(initialCoords[0], initialCoords[0])
        )
      : null;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style,
      attributionControl: false,
      logoPosition: 'bottom-left',
      ...(initialBounds
        ? { bounds: initialBounds, fitBoundsOptions: { padding: 60, maxZoom: 15, duration: 0 } }
        : { center: [-98.5, 39.8] as [number, number], zoom: 4 }),
    });
    mapRef.current = map;

    // Route lines are runtime layers, so every style load (the first one
    // and each basemap switch) wipes them. Re-add them on style.load,
    // which fires before the first render, so they arrive with the tiles
    // instead of popping in afterwards.
    const addRouteLayers = () => {
      event.routes.forEach((route) => {
        if (route.routeCoords.length < 2) return;
        if (!map.getSource(`route-${route.id}`)) {
          map.addSource(`route-${route.id}`, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.routeCoords } },
          });
        }
        if (!map.getLayer(`route-line-${route.id}`)) {
          map.addLayer({
            id: `route-line-${route.id}`,
            type: 'line',
            source: `route-${route.id}`,
            paint: { 'line-color': route.color },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
        }
      });
      applyRouteStyle(map);
    };
    map.on('style.load', addRouteLayers);

    // 'load' = first visually complete render. Release the markers then,
    // or after the fallback timeout if the tiles never make it.
    const markReady = () => setMapReady(true);
    const fallback = window.setTimeout(markReady, MAP_LOAD_FALLBACK_MS);
    map.once('load', () => {
      window.clearTimeout(fallback);
      // Hide the Mapbox logo — we render our own attribution in PublicMapBottom
      const logo = mapContainerRef.current?.querySelector('.mapboxgl-ctrl-logo');
      if (logo) (logo as HTMLElement).style.display = 'none';
      markReady();
    });

    return () => {
      window.clearTimeout(fallback);
      map.off('style.load', addRouteLayers);
      map.remove();
      mapRef.current = null;
      appliedBasemapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Basemap switching. Skips the style the map was built with, so the
  // first load isn't immediately thrown away by a second setStyle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedBasemapRef.current === selectedBasemap) return;
    const style = BASEMAP_OPTIONS.find(b => b.id === selectedBasemap)?.style;
    if (!style) return;
    appliedBasemapRef.current = selectedBasemap;
    // Route layers come back via the style.load handler from the init effect.
    map.setStyle(style);
  }, [selectedBasemap]);

  // Mode switch and legend toggles: restyle the existing route layers.
  // Deliberately not gated on isStyleLoaded(), which stays false while
  // tiles stream in after a pan. applyRouteStyle skips layers that don't
  // exist yet, and a style that is mid-load picks up the latest values
  // from the refs in its style.load handler.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyRouteStyle(map);
  }, [mode, hiddenRouteIds, applyRouteStyle]);

  // Mile markers — DOM markers, held back until the map has rendered.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const multiRoute = event.routes.filter(r => r.routeCoords.length >= 2).length > 1;
    event.routes.forEach(route => {
      if (hiddenRouteIds.has(route.id) || route.routeCoords.length < 2) return;
      const miles = getMileMarkers(route.routeCoords);
      miles.forEach(({ mile, coord }) => {
        const el = document.createElement('div');
        el.style.cssText = `width:22px;height:22px;border-radius:50%;background:${route.color};color:white;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;line-height:1;`;
        el.textContent = String(mile);
        el.setAttribute('aria-label', multiRoute ? `${route.name}, mile ${mile}` : `Mile ${mile}`);
        markersRef.current.push(new mapboxgl.Marker(el).setLngLat(coord).addTo(map));
      });
    });

    return () => { markersRef.current.forEach(m => m.remove()); markersRef.current = []; };
  }, [event.routes, hiddenRouteIds, mapReady]);

  // POI markers with pixel-based clustering. Rebuilt on every moveend so
  // clusters merge/unmerge naturally as the user pans and zooms.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const look = MODE_STYLE[mode];

    // All POIs — including start/finish — go through the same
    // clustering pass so they merge cleanly when zoomed out.
    // Hidden routes' POIs are dropped.
    const visiblePois: RoutePoi[] = [];
    event.pois.forEach((poi) => {
      const sf = parseAutoStartFinishId(poi.id);
      if (sf && hiddenRouteIds.has(sf.routeId)) return;
      visiblePois.push(poi);
    });

    // Soft-wall selection: Free events cap branded sponsor slots; extras
    // fall back to the generic ⭐. Organizer sees all branded in the
    // editor — this filter is the public-map enforcement point.
    const brandedSponsorIds = selectBrandedSponsorIds(event.pois, isPro);

    const buildSinglePoiMarker = (poi: RoutePoi) => {
      const tone = poiTone(poi.type);
      const isHighlighted = !highlightedPoiType || highlightedPoiType === poi.type;
      const isBrandedSponsor = brandedSponsorIds.has(poi.id);

      let el: HTMLElement;
      if (isBrandedSponsor) {
        el = buildBrandedSponsorMarkerEl({
          logoUrl: poi.sponsor?.logoUrl || poi.sponsor?.logoDataUrl,
          brandColor: poi.sponsor?.brandColor,
          fallbackGlyph: tone.emoji,
          isHighlighted,
        });
      } else {
        el = document.createElement('div');
        el.style.cssText = 'cursor:pointer;';
        const inner = document.createElement('div');
        const size = look.poiSize;
        inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${tone.dot};border:3px solid ${isHighlighted ? 'white' : 'rgba(255,255,255,0.5)'};box-shadow:0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1});display:flex;align-items:center;justify-content:center;font-size:${look.poiFontSize}px;opacity:${isHighlighted ? 1 : 0.4};transition:transform 0.15s ease,box-shadow 0.2s;pointer-events:none;`;
        inner.textContent = tone.emoji;
        el.appendChild(inner);
        el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.25)'; inner.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)'; });
        el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; inner.style.boxShadow = `0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1})`; });
      }
      // Set before constructing the Marker — Mapbox only applies its
      // generic "Map marker" label when the element has none.
      el.setAttribute('aria-label', poiAccessibleName(poi));

      // Attach a status dot overlay and register it so the
      // postgres_changes effect can mutate it imperatively when a
      // volunteer updates this POI's status. Initial state comes from
      // whatever the subscription has already hydrated.
      const statusDot = attachStatusDot(el);
      statusDotByPoiIdRef.current.set(poi.id, statusDot);
      const currentStatus = poiStatuses.get(poi.id);
      setStatusDot(statusDot, currentStatus?.state ?? null);

      // Mount the React PoiReadonlyPopover into a DOM node that
      // Mapbox owns. Create the root on popup 'open' and unmount
      // after popup 'close' (deferred via setTimeout so we don't
      // unmount during React's own render cycle).
      const popupHost = document.createElement('div');
      popupHost.style.fontFamily = '"DM Sans", system-ui, sans-serif';
      const popup = new mapboxgl.Popup({ offset: look.poiPopupOffset, maxWidth: '320px', closeButton: false });
      popup.setDOMContent(popupHost);

      popup.on('open', () => {
        const root = createRoot(popupHost);
        popoverRootsRef.current.set(poi.id, root);
        root.render(
          <PoiReadonlyPopover
            poi={poi}
            eventId={event.id}
            branded={isBrandedSponsor}
            status={poiStatuses.get(poi.id) ?? null}
            onClose={() => popup.remove()}
          />
        );
      });
      popup.on('close', () => {
        const root = popoverRootsRef.current.get(poi.id);
        if (root) {
          setTimeout(() => root.unmount(), 0);
          popoverRootsRef.current.delete(poi.id);
        }
      });

      return new mapboxgl.Marker(el).setLngLat(poi.coordinates).setPopup(popup);
    };

    const buildClusterMarker = (lng: number, lat: number, pois: RoutePoi[]) => {
      const el = document.createElement('div');
      el.style.cssText = 'cursor:pointer;';
      el.setAttribute('aria-label', `${pois.length} stops: ${pois.map(poiAccessibleName).join(', ')}`);

      const inner = document.createElement('div');
      const size = look.clusterSize;
      inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:#1e293b;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:${look.clusterFontSize}px;font-weight:800;font-family:'DM Sans',system-ui,sans-serif;letter-spacing:0.01em;transition:transform 0.15s ease;`;
      inner.textContent = String(pois.length);
      el.appendChild(inner);
      el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.1)'; });
      el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; });

      // Popup listing each POI in this cluster
      const container = document.createElement('div');
      container.style.cssText = "font-family:'DM Sans',system-ui,sans-serif;width:240px;";
      container.innerHTML = `
        <div style="font-size:10px;color:hsl(var(--muted-foreground));font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${pois.length} stops here</div>
      `;
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:220px;overflow-y:auto;';

      const popup = new mapboxgl.Popup({ offset: look.clusterPopupOffset, maxWidth: '280px' }).setDOMContent(container);

      pois.forEach((poi) => {
        const tone = poiTone(poi.type);
        const row = document.createElement('button');
        row.type = 'button';
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--card));cursor:pointer;text-align:left;font-family:inherit;transition:background 0.12s;';
        row.onmouseenter = () => { row.style.background = 'hsl(var(--secondary))'; };
        row.onmouseleave = () => { row.style.background = 'hsl(var(--card))'; };
        row.innerHTML = `
          <div style="width:28px;height:28px;border-radius:50%;background:${tone.dot};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.15);">${tone.emoji}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:10px;color:hsl(var(--muted-foreground));font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">${tone.label}</div>
            <div style="font-size:13px;font-weight:600;color:hsl(var(--card-foreground));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${poi.title || tone.label}</div>
          </div>
        `;
        row.addEventListener('click', () => {
          pendingPoiPopupRef.current = poi.id;
          popup.remove();
          map.flyTo({
            center: poi.coordinates,
            zoom: Math.max(map.getZoom() + 2, 17),
            duration: 700,
          });
        });
        list.appendChild(row);
      });
      container.appendChild(list);

      return new mapboxgl.Marker(el).setLngLat([lng, lat]).setPopup(popup);
    };

    const render = () => {
      poiMarkersRef.current.forEach(m => m.remove());
      poiMarkersRef.current = [];
      poiMarkerByIdRef.current.clear();

      const clusters = clusterPoisByPixels(visiblePois, map, look.clusterRadiusPx);
      clusters.forEach((c) => {
        if (c.pois.length === 1) {
          const marker = buildSinglePoiMarker(c.pois[0]);
          marker.addTo(map);
          poiMarkersRef.current.push(marker);
          poiMarkerByIdRef.current.set(c.pois[0].id, marker);
        } else {
          const marker = buildClusterMarker(c.lng, c.lat, c.pois);
          marker.addTo(map);
          poiMarkersRef.current.push(marker);
        }
      });

      // If a cluster-row click queued a pending popup, try to open
      // the matching single-marker popup now. If the target is still
      // inside a cluster (two POIs at identical coordinates), quietly
      // drop the request — the user can tap the cluster again.
      const pending = pendingPoiPopupRef.current;
      if (pending) {
        const targetMarker = poiMarkerByIdRef.current.get(pending);
        if (targetMarker) {
          targetMarker.togglePopup();
          pendingPoiPopupRef.current = null;
        }
      }
    };

    render();
    map.on('moveend', render);

    return () => {
      map.off('moveend', render);
      poiMarkersRef.current.forEach(m => m.remove());
      poiMarkersRef.current = [];
      poiMarkerByIdRef.current.clear();
      statusDotByPoiIdRef.current.clear();
      // Unmount any React roots left alive (e.g. popover was open
      // when the component unmounts). Deferred to escape React's
      // current render phase.
      const roots = popoverRootsRef.current;
      setTimeout(() => {
        roots.forEach((r) => r.unmount());
        roots.clear();
      }, 0);
    };
    // poiStatuses intentionally excluded — we don't want to rebuild
    // markers on every volunteer status tick; the separate effect
    // below mutates status dots in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, isPro, event.pois, event.routes, hiddenRouteIds, highlightedPoiType, mode, mapReady]);

  // Drive the status dots imperatively whenever the subscription
  // reports new data. Rebuilding markers on every status change would
  // cause flicker and lose popup state; mutating the already-attached
  // overlay keeps everything smooth.
  useEffect(() => {
    statusDotByPoiIdRef.current.forEach((dot, poiId) => {
      const s = poiStatuses.get(poiId);
      setStatusDot(dot, s?.state ?? null);
    });
  }, [poiStatuses]);

  const isRunner = mode === 'runner';
  const source = isRunner ? 'runner' : 'spectator';
  const modeButtonClass = (active: boolean) => active
    ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold'
    : 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-muted-foreground hover:text-foreground text-xs font-medium transition-colors active:scale-95';

  return (
    <div className="h-dvh relative overflow-hidden bg-black">
      {/* Map — full screen */}
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* Loading cover — hides the bare style background until the first
          complete render, then fades out. Sits under every control. */}
      <div
        aria-hidden={mapReady}
        className={`absolute inset-0 z-[5] flex items-center justify-center bg-muted transition-opacity duration-500 ${
          mapReady ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {!mapReady && (
          <div role="status" className="rounded-full bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-lg ring-1 ring-black/[0.06] animate-pulse">
            Loading map…
          </div>
        )}
      </div>

      {/* ── Top controls ────────────────────────────────────────── */}
      <div className="absolute left-3 right-3 z-30 flex items-center justify-between" style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}>
        {/* Left group: back + subscribe */}
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            aria-label="Back to Hereday home"
            className="shrink-0 w-10 h-10 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] flex items-center justify-center text-foreground hover:bg-card/95 active:scale-95 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <SubscribeButton eventId={event.id} eventName={event.name} source={source} expanded={!isRunner} />
          <PublicShareButton eventId={event.id} eventName={event.name} source={source} />
        </div>

        {/* Right group: Run/Watch toggle */}
        <div role="group" aria-label="Map view" className="flex rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] p-0.5 gap-0.5">
          <button
            onClick={() => { if (!isRunner) onSwitchMode('runner'); }}
            aria-pressed={isRunner}
            className={modeButtonClass(isRunner)}
          >
            <Trophy className="h-3 w-3" />
            Run
          </button>
          <button
            onClick={() => { if (isRunner) onSwitchMode('spectator'); }}
            aria-pressed={!isRunner}
            className={modeButtonClass(!isRunner)}
          >
            <Eye className="h-3 w-3" />
            Watch
          </button>
        </div>
      </div>

      {/* Basemap picker + fit-to-route */}
      <PublicMapToolbar
        selectedBasemap={selectedBasemap}
        onBasemapChange={setSelectedBasemap}
        className="top-[60px]"
      />
      <button
        onClick={handleFitRoute}
        className="absolute left-3 top-[108px] z-10 w-10 h-10 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] flex items-center justify-center text-foreground hover:bg-card/95 active:scale-95 transition-all"
        aria-label="Fit to route"
      >
        <Maximize2 className="w-4 h-4" />
      </button>
      {isRunner && hasDownloadableRoute && (
        <button
          onClick={handleDownloadGpx}
          className="absolute left-3 top-[156px] z-10 w-10 h-10 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] flex items-center justify-center text-foreground hover:bg-card/95 active:scale-95 transition-all"
          aria-label="Download GPX"
          title="Download GPX"
        >
          <Download className="w-4 h-4" />
        </button>
      )}

      <EventBranding
        logoUrl={event.logo_url ?? null}
        brandingStyle={event.branding_style ?? 'none'}
        eventName={event.name}
      />

      {/* Live tracking — Pro only. Gated off while web-only (see featureFlags).
          Runners get the Track Me button; spectators get the live dots. */}
      {LIVE_TRACKING_ENABLED && isPro && isRunner && (
        <TrackMeButton
          eventId={event.id}
          trackingStart={event.tracking_start ?? null}
          trackingEnd={event.tracking_end ?? null}
        />
      )}
      {LIVE_TRACKING_ENABLED && isPro && !isRunner && (
        <>
          <LiveRunnerMarkers
            runners={runners}
            mapRef={mapRef}
            focusedRunnerId={focusedRunnerId}
            onRunnerClick={(id) => setFocusedRunnerId(prev => prev === id ? null : id)}
          />
          {trackingWindowOpen && runners.size > 0 && (
            <div className="absolute bottom-[calc(45vh+16px)] right-3 z-20">
              <RunnerListPanel
                runners={runners}
                focusedRunnerId={focusedRunnerId}
                onFocusRunner={setFocusedRunnerId}
              />
            </div>
          )}
        </>
      )}

      {/* ── Bottom sheet ────────────────────────────────────────── */}
      {token && (
        <MapBottomSheet
          routes={event.routes}
          pois={event.pois}
          hiddenRouteIds={hiddenRouteIds}
          onToggleRoute={toggleRoute}
          highlightedPoiType={highlightedPoiType}
          onHighlightPoiType={setHighlightedPoiType}
          activeRoute={activeRoute}
          mapboxToken={token}
          routeColor={activeRoute?.color ?? '#2563eb'}
          onHoverPoint={handleElevationHover}
          eventDate={event.event_date}
          weatherCoord={weatherCoord}
          eventName={event.name}
          eventStartTime={event.start_time}
          eventLocation={event.city}
          registrationUrl={event.registration_url}
          badge={!isPro ? <MadeWithHeredayBadge /> : undefined}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          viewMode={mode}
        />
      )}
    </div>
  );
};

export default PublicEventView;
