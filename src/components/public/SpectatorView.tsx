import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { getMileMarkers, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone } from '@/lib/pois';
import { clusterPoisByPixels } from '@/lib/poiCluster';
import type { Coord, EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { ArrowLeft, Trophy, Eye } from 'lucide-react';
import EventBranding from '@/components/public/EventBranding';
import PublicMapToolbar from '@/components/public/PublicMapToolbar';
import PublicMapBottom from '@/components/public/PublicMapBottom';
import MadeWithHeredayBadge from '@/components/public/MadeWithHeredayBadge';
import SubscribeButton from '@/components/public/SubscribeButton';

interface SpectatorViewProps {
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
  };
  onBack: () => void;
  onSwitchToRunner: () => void;
}

const SpectatorView = ({ event, onBack, onSwitchToRunner }: SpectatorViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const poiMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const elevMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const { token } = useMapboxToken();

  const [selectedBasemap, setSelectedBasemap] = useState('streets');
  const [hiddenRouteIds, setHiddenRouteIds] = useState<Set<string>>(new Set());
  const hiddenRouteIdsRef = useRef(hiddenRouteIds);
  const [highlightedPoiType, setHighlightedPoiType] = useState<PoiType | null>(null);

  // Keep ref in sync so basemap callbacks always read the latest value
  useEffect(() => { hiddenRouteIdsRef.current = hiddenRouteIds; }, [hiddenRouteIds]);

  const weatherCoord: [number, number] | null = (() => {
    const lon = event.routes[0]?.routeCoords?.[0]?.[0] ?? event.routes[0]?.waypoints?.[0]?.[0];
    const lat = event.routes[0]?.routeCoords?.[0]?.[1] ?? event.routes[0]?.waypoints?.[0]?.[1];
    return lon != null && lat != null ? [lon, lat] : null;
  })();

  const handleElevationHover = useCallback((coord: Coord | null) => {
    if (elevMarkerRef.current) { elevMarkerRef.current.remove(); elevMarkerRef.current = null; }
    if (coord && mapRef.current) {
      const color = event.routes[0]?.color ?? '#2563eb';
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
  }, [event.routes]);

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

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || !token) return;
    mapboxgl.accessToken = token;

    const style = BASEMAP_OPTIONS.find(b => b.id === selectedBasemap)?.style ?? BASEMAP_OPTIONS[0].style;

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
          paint: { 'line-color': route.color, 'line-width': 3, 'line-opacity': 0.45, 'line-dasharray': [2, 2] },
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
            paint: { 'line-color': route.color, 'line-width': 3, 'line-opacity': hidden ? 0 : 0.45, 'line-dasharray': [2, 2] },
            layout: { 'line-cap': 'round', 'line-join': 'round', 'visibility': hidden ? 'none' : 'visible' },
          });
        }
      });
    });
  // hiddenRouteIds intentionally excluded — handled via ref
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

    // POIs that should be shown (auto start/finish belong to hidden routes → skip)
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
      const size = 36;
      inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${tone.dot};border:3px solid ${isHighlighted ? 'white' : 'rgba(255,255,255,0.5)'};box-shadow:0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1});display:flex;align-items:center;justify-content:center;font-size:16px;opacity:${isHighlighted ? 1 : 0.4};transition:transform 0.15s ease,box-shadow 0.2s;pointer-events:none;`;
      inner.textContent = tone.emoji;
      el.appendChild(inner);
      el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.25)'; inner.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)'; });
      el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; inner.style.boxShadow = `0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1})`; });

      // Prefer uploaded imageUrl; fall back to legacy base64 imageDataUrl
      // for events saved before the storage-bucket migration.
      const existingImage = poi.imageUrl || poi.imageDataUrl || '';
      const hasWebLink = ['registration', 'sponsor', 'custom'].includes(poi.type);
      const popupHtml = `
        <div style="font-family:'DM Sans',system-ui,sans-serif;width:240px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="width:36px;height:36px;border-radius:50%;background:${tone.dot}15;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;border:2px solid ${tone.dot}30;">${tone.emoji}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">${tone.label}</div>
              <div style="font-size:15px;font-weight:700;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${poi.title}</div>
            </div>
          </div>
          ${poi.description ? `<p style="font-size:13px;color:#475569;line-height:1.4;margin:0 0 8px;">${poi.description}</p>` : ''}
          ${existingImage ? `<img src="${existingImage}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:8px;" />` : ''}
          ${hasWebLink && poi.webLink ? `<a href="${poi.webLink}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#2563eb;font-weight:600;text-decoration:none;">🔗 Visit link →</a>` : ''}
        </div>`;

      const popup = new mapboxgl.Popup({ offset: 16, maxWidth: '280px' }).setHTML(popupHtml);
      return new mapboxgl.Marker(el).setLngLat(poi.coordinates).setPopup(popup);
    };

    const buildClusterMarker = (lng: number, lat: number, pois: RoutePoi[]) => {
      const el = document.createElement('div');
      el.style.cssText = 'cursor:pointer;';

      const inner = document.createElement('div');
      const size = 40;
      inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:#1e293b;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:14px;font-weight:800;font-family:'DM Sans',system-ui,sans-serif;letter-spacing:0.01em;transition:transform 0.15s ease;`;
      inner.textContent = String(pois.length);
      el.appendChild(inner);
      el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.1)'; });
      el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; });

      // Popup listing each POI in this cluster
      const container = document.createElement('div');
      container.style.cssText = "font-family:'DM Sans',system-ui,sans-serif;width:240px;";
      container.innerHTML = `
        <div style="font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${pois.length} stops here</div>
      `;
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:220px;overflow-y:auto;';
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
          // Zoom in to split the cluster apart — the moveend handler will
          // rebuild markers and the POI will render on its own.
          map.flyTo({ center: poi.coordinates, zoom: Math.max(map.getZoom() + 2, 16), duration: 700 });
        });
        list.appendChild(row);
      });
      container.appendChild(list);

      const popup = new mapboxgl.Popup({ offset: 20, maxWidth: '280px' }).setDOMContent(container);
      return new mapboxgl.Marker(el).setLngLat([lng, lat]).setPopup(popup);
    };

    const render = () => {
      poiMarkersRef.current.forEach(m => m.remove());
      poiMarkersRef.current = [];
      const clusters = clusterPoisByPixels(visiblePois, map, 44);
      clusters.forEach((c) => {
        const marker = c.pois.length === 1
          ? buildSinglePoiMarker(c.pois[0])
          : buildClusterMarker(c.lng, c.lat, c.pois);
        marker.addTo(map);
        poiMarkersRef.current.push(marker);
      });
    };

    render();
    map.on('moveend', render);

    return () => {
      map.off('moveend', render);
      poiMarkersRef.current.forEach(m => m.remove());
      poiMarkersRef.current = [];
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
          <SubscribeButton eventId={event.id} eventName={event.name} source="spectator" />
        </div>

        {/* Right group: Run/Watch toggle */}
        <div className="flex rounded-full bg-card/80 backdrop-blur-xl shadow-lg ring-1 ring-black/[0.06] p-0.5 gap-0.5">
          <button
            onClick={onSwitchToRunner}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-muted-foreground hover:text-foreground text-xs font-medium transition-colors active:scale-95"
          >
            <Trophy className="h-3 w-3" />
            Run
          </button>
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            <Eye className="h-3 w-3" />
            Watch
          </span>
        </div>
      </div>

      {/* Basemap picker */}
      <PublicMapToolbar
        selectedBasemap={selectedBasemap}
        onBasemapChange={setSelectedBasemap}
        className="top-[60px]"
      />

      <EventBranding
        logoUrl={event.logo_url ?? null}
        brandingStyle={event.branding_style ?? 'none'}
        eventName={event.name}
      />

      {/* ── Bottom sheet ────────────────────────────────────────── */}
      {token && (
        <PublicMapBottom
          routes={event.routes}
          pois={event.pois}
          hiddenRouteIds={hiddenRouteIds}
          onToggleRoute={toggleRoute}
          highlightedPoiType={highlightedPoiType}
          onHighlightPoiType={setHighlightedPoiType}
          activeRoute={event.routes[0]}
          mapboxToken={token}
          routeColor={event.routes[0]?.color ?? '#2563eb'}
          onHoverPoint={handleElevationHover}
          eventDate={event.event_date}
          weatherCoord={weatherCoord}
          eventName={event.name}
          badge={event.plan !== 'pro' ? <MadeWithHeredayBadge /> : undefined}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
      )}
    </div>
  );
};

export default SpectatorView;
