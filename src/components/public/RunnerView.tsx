import { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { totalDistanceMiles, getMileMarkers, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone } from '@/lib/pois';
import { clusterPoisByPixels } from '@/lib/poiCluster';
import type { Coord, EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { ArrowLeft, Trophy, Eye, Maximize2, Download } from 'lucide-react';
import EventBranding from '@/components/public/EventBranding';
import PublicMapToolbar from '@/components/public/PublicMapToolbar';
import MapBottomSheet from '@/components/map/MapBottomSheet';
import PoiReadonlyPopover from '@/components/public/PoiReadonlyPopover';
import MadeWithHeredayBadge from '@/components/public/MadeWithHeredayBadge';
import SubscribeButton from '@/components/public/SubscribeButton';
import TrackMeButton from '@/components/public/TrackMeButton';
import { buildGpx, downloadGpx, gpxFilename } from '@/lib/gpx';
import { logEvent } from '@/lib/analytics';

interface RunnerViewProps {
  event: {
    id: string;
    name: string;
    city: string | null;
    event_date: string | null;
    routes: EventRoute[];
    pois: RoutePoi[];
    logo_url?: string | null;
    branding_style?: string;
    plan?: 'free' | 'pro';
    tracking_start?: string | null;
    tracking_end?: string | null;
  };
  onBack: () => void;
  onSwitchToSpectator: () => void;
}

const RunnerView = ({ event, onBack, onSwitchToSpectator }: RunnerViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const poiMarkersRef = useRef<mapboxgl.Marker[]>([]);
  // Track single POI markers by id so we can programmatically open
  // the right popup after a cluster breaks apart.
  const poiMarkerByIdRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  // React roots mounted into Mapbox popup DOM — one per open popup.
  const popoverRootsRef = useRef<Map<string, Root>>(new Map());
  // When a user taps a row in a cluster popup we queue the target
  // POI id here, fly the map in, and open that POI's popup after
  // the moveend rebuild fires.
  const pendingPoiPopupRef = useRef<string | null>(null);
  const elevMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const { token } = useMapboxToken();

  const [selectedBasemap, setSelectedBasemap] = useState('outdoors');
  const [hiddenRouteIds, setHiddenRouteIds] = useState<Set<string>>(new Set());
  const hiddenRouteIdsRef = useRef(hiddenRouteIds);
  const [highlightedPoiType, setHighlightedPoiType] = useState<PoiType | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  // Keep ref in sync so basemap callbacks always read the latest value
  useEffect(() => { hiddenRouteIdsRef.current = hiddenRouteIds; }, [hiddenRouteIds]);

  const weatherCoord: [number, number] | null = (() => {
    const lon = event.routes[0]?.routeCoords?.[0]?.[0] ?? event.routes[0]?.waypoints?.[0]?.[0];
    const lat = event.routes[0]?.routeCoords?.[0]?.[1] ?? event.routes[0]?.waypoints?.[0]?.[1];
    return lon != null && lat != null ? [lon, lat] : null;
  })();

  const activeRouteForProfile = selectedRoute
    ? event.routes.find((r) => r.id === selectedRoute)
    : event.routes[0];

  const handleElevationHover = useCallback((coord: Coord | null) => {
    if (elevMarkerRef.current) { elevMarkerRef.current.remove(); elevMarkerRef.current = null; }
    if (coord && mapRef.current) {
      const color = activeRouteForProfile?.color ?? '#2563eb';
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;width:20px;height:20px;pointer-events:none;';
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
  }, [activeRouteForProfile?.color]);

  const toggleRoute = useCallback((id: string) => {
    setHiddenRouteIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleFlyToPoi = useCallback((poi: RoutePoi) => {
    mapRef.current?.flyTo({ center: poi.coordinates, zoom: 16, duration: 1200 });
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

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || !token) return;
    mapboxgl.accessToken = token;

    const style = BASEMAP_OPTIONS.find(b => b.id === selectedBasemap)?.style ?? BASEMAP_OPTIONS[1].style;

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

    // Hide the Mapbox logo — we render our own attribution in PublicMapBottom
    map.on('load', () => {
      const logo = mapContainerRef.current?.querySelector('.mapboxgl-ctrl-logo');
      if (logo) (logo as HTMLElement).style.display = 'none';
    });

    mapRef.current = map;

    map.on('load', () => {
      const allCoords: [number, number][] = [];

      event.routes.forEach((route) => {
        if (route.routeCoords.length < 2) return;
        allCoords.push(...route.routeCoords);

        map.addSource(`route-${route.id}`, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.routeCoords } },
        });
        map.addLayer({
          id: `route-line-${route.id}`,
          type: 'line',
          source: `route-${route.id}`,
          paint: { 'line-color': route.color, 'line-width': 4, 'line-opacity': 0.85 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      });

      // Initial framing is already applied via the Map constructor's
      // `bounds` option, so no fitBounds call is needed here.
    });

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Basemap switching
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = BASEMAP_OPTIONS.find(b => b.id === selectedBasemap)?.style;
    if (style) map.setStyle(style);

    // Re-add sources/layers after style change — use ref so hiddenRouteIds
    // is always current without this effect re-running on visibility changes
    map.once('style.load', () => {
      event.routes.forEach((route) => {
        if (route.routeCoords.length < 2) return;
        if (!map.getSource(`route-${route.id}`)) {
          map.addSource(`route-${route.id}`, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.routeCoords } },
          });
        }
        if (!map.getLayer(`route-line-${route.id}`)) {
          const hidden = hiddenRouteIdsRef.current.has(route.id);
          map.addLayer({
            id: `route-line-${route.id}`,
            type: 'line',
            source: `route-${route.id}`,
            paint: { 'line-color': route.color, 'line-width': 4, 'line-opacity': hidden ? 0 : 0.85 },
            layout: { 'line-cap': 'round', 'line-join': 'round', 'visibility': hidden ? 'none' : 'visible' },
          });
        }
      });
    });
  // hiddenRouteIds intentionally excluded — handled via ref to avoid calling
  // setStyle on every visibility toggle
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBasemap, event.routes]);

  // Route visibility — apply directly when style is ready, or wait for style.load
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      event.routes.forEach(route => {
        const layerId = `route-line-${route.id}`;
        if (!map.getLayer(layerId)) return;
        map.setLayoutProperty(layerId, 'visibility', hiddenRouteIds.has(route.id) ? 'none' : 'visible');
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
  }, [hiddenRouteIds, event.routes]);

  // POI + mile markers (re-render on visibility/highlight changes)
  // Mile markers — markers are DOM elements, no need to wait for style.load
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    event.routes.forEach(route => {
      if (hiddenRouteIds.has(route.id) || route.routeCoords.length < 2) return;
      const miles = getMileMarkers(route.routeCoords);
      miles.forEach(({ mile, coord }) => {
        const el = document.createElement('div');
        el.style.cssText = `width:22px;height:22px;border-radius:50%;background:${route.color};color:white;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;line-height:1;`;
        el.textContent = String(mile);
        markersRef.current.push(new mapboxgl.Marker(el).setLngLat(coord).addTo(map));
      });
    });

    return () => { markersRef.current.forEach(m => m.remove()); markersRef.current = []; };
  }, [event.routes, hiddenRouteIds]);

  // POI markers with pixel-based clustering. Rebuilt on every moveend so
  // clusters merge/unmerge naturally as the user pans and zooms.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const visiblePois = event.pois.filter(poi => {
      if (poi.id.startsWith('auto-start-') || poi.id.startsWith('auto-finish-')) {
        const routeId = poi.id.replace('auto-start-', '').replace('auto-finish-', '');
        if (hiddenRouteIds.has(routeId)) return false;
      }
      return true;
    });

    const buildSinglePoiMarker = (poi: RoutePoi) => {
      const tone = poiTone(poi.type);
      const isHighlighted = !highlightedPoiType || highlightedPoiType === poi.type;

      const el = document.createElement('div');
      el.style.cssText = 'cursor:pointer;';

      const inner = document.createElement('div');
      const size = 32;
      inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${tone.dot};border:3px solid ${isHighlighted ? 'white' : 'rgba(255,255,255,0.5)'};box-shadow:0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1});display:flex;align-items:center;justify-content:center;font-size:14px;opacity:${isHighlighted ? 1 : 0.4};transition:transform 0.15s ease,box-shadow 0.2s;pointer-events:none;`;
      inner.textContent = tone.emoji;
      el.appendChild(inner);
      el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.25)'; inner.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)'; });
      el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; inner.style.boxShadow = `0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1})`; });

      // Mount the React PoiReadonlyPopover into a DOM node that
      // Mapbox owns. Create the root on popup 'open' and unmount
      // after popup 'close' (deferred via setTimeout so we don't
      // unmount during React's own render cycle).
      const popupHost = document.createElement('div');
      popupHost.style.fontFamily = '"DM Sans", system-ui, sans-serif';
      const popup = new mapboxgl.Popup({ offset: 14, maxWidth: '320px', closeButton: false });
      popup.setDOMContent(popupHost);

      popup.on('open', () => {
        const root = createRoot(popupHost);
        popoverRootsRef.current.set(poi.id, root);
        root.render(
          <PoiReadonlyPopover
            poi={poi}
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

      const inner = document.createElement('div');
      const size = 36;
      inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:#1e293b;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:13px;font-weight:800;font-family:'DM Sans',system-ui,sans-serif;letter-spacing:0.01em;transition:transform 0.15s ease;`;
      inner.textContent = String(pois.length);
      el.appendChild(inner);
      el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.1)'; });
      el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; });

      const container = document.createElement('div');
      container.style.cssText = "font-family:'DM Sans',system-ui,sans-serif;width:240px;";
      container.innerHTML = `
        <div style="font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${pois.length} stops here</div>
      `;
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:220px;overflow-y:auto;';

      const popup = new mapboxgl.Popup({ offset: 18, maxWidth: '280px' }).setDOMContent(container);

      pois.forEach((poi) => {
        const tone = poiTone(poi.type);
        const row = document.createElement('button');
        row.type = 'button';
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #f1f5f9;border-radius:10px;background:white;cursor:pointer;text-align:left;font-family:inherit;transition:background 0.12s;';
        row.onmouseenter = () => { row.style.background = '#f8fafc'; };
        row.onmouseleave = () => { row.style.background = 'white'; };
        row.innerHTML = `
          <div style="width:28px;height:28px;border-radius:50%;background:${tone.dot};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.15);">${tone.emoji}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">${tone.label}</div>
            <div style="font-size:13px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${poi.title || tone.label}</div>
          </div>
        `;
        row.addEventListener('click', () => {
          // Queue the target POI so the post-moveend render can open
          // its popup once the cluster has broken apart, then close
          // this cluster popup and zoom in. The cluster distance is
          // 40px so bumping zoom by ~2 levels typically separates
          // stacked markers — enough to reveal the one tapped.
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
      const clusters = clusterPoisByPixels(visiblePois, map, 40);
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
      // Unmount any React roots left alive (e.g. popover was open
      // when the component unmounts). Deferred to escape React's
      // current render phase.
      const roots = popoverRootsRef.current;
      setTimeout(() => {
        roots.forEach((r) => r.unmount());
        roots.clear();
      }, 0);
    };
  }, [event.pois, hiddenRouteIds, highlightedPoiType]);

  return (
    <div className="h-dvh relative overflow-hidden bg-black">
      {/* Map — full screen */}
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* ── Top controls ────────────────────────────────────────── */}
      <div className="absolute left-3 right-3 z-30 flex items-center justify-between" style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}>
        {/* Left group: back + subscribe */}
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="shrink-0 w-10 h-10 rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] flex items-center justify-center text-foreground hover:bg-card/95 active:scale-95 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <SubscribeButton eventId={event.id} eventName={event.name} source="runner" />
        </div>

        {/* Right group: Run/Watch toggle */}
        <div className="flex rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] p-0.5 gap-0.5">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            <Trophy className="h-3 w-3" />
            Run
          </span>
          <button
            onClick={onSwitchToSpectator}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-muted-foreground hover:text-foreground text-xs font-medium transition-colors active:scale-95"
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
      {hasDownloadableRoute && (
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

      {/* Live tracking — Pro only */}
      {event.plan === 'pro' && (
        <TrackMeButton
          eventId={event.id}
          trackingStart={event.tracking_start ?? null}
          trackingEnd={event.tracking_end ?? null}
        />
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
          activeRoute={activeRouteForProfile}
          mapboxToken={token}
          routeColor={activeRouteForProfile?.color ?? '#2563eb'}
          onHoverPoint={handleElevationHover}
          eventDate={event.event_date}
          weatherCoord={weatherCoord}
          eventName={event.name}
          badge={event.plan !== 'pro' ? <MadeWithHeredayBadge /> : undefined}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          viewMode="runner"
        />
      )}
    </div>
  );
};

export default RunnerView;
