import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { totalDistanceMiles, getMileMarkers, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone } from '@/lib/pois';
import type { Coord, EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ElevationProfile from '@/components/editor/ElevationProfile';
import EventBranding from '@/components/public/EventBranding';
import PublicMapToolbar from '@/components/public/PublicMapToolbar';

interface RunnerViewProps {
  event: {
    name: string;
    city: string | null;
    event_date: string | null;
    routes: EventRoute[];
    pois: RoutePoi[];
    logo_url?: string | null;
    branding_style?: string;
  };
  onBack: () => void;
}

const RunnerView = ({ event, onBack }: RunnerViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const elevMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const { token } = useMapboxToken();

  const [selectedBasemap, setSelectedBasemap] = useState('outdoors');
  const [hiddenRouteIds, setHiddenRouteIds] = useState<Set<string>>(new Set());
  const [highlightedPoiType, setHighlightedPoiType] = useState<PoiType | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  const activeRouteForProfile = selectedRoute
    ? event.routes.find((r) => r.id === selectedRoute)
    : event.routes[0];

  const handleElevationHover = useCallback((coord: Coord | null) => {
    if (elevMarkerRef.current) { elevMarkerRef.current.remove(); elevMarkerRef.current = null; }
    if (coord && mapRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'width:14px;height:14px;border-radius:50%;border:2.5px solid white;box-shadow:0 0 6px rgba(0,0,0,0.4);pointer-events:none;background:' + (activeRouteForProfile?.color ?? '#2563eb');
      elevMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat(coord).addTo(mapRef.current);
    }
  }, [activeRouteForProfile?.color]);

  const toggleRoute = useCallback((id: string) => {
    setHiddenRouteIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || !token) return;
    mapboxgl.accessToken = token;

    const style = BASEMAP_OPTIONS.find(b => b.id === selectedBasemap)?.style ?? BASEMAP_OPTIONS[1].style;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style,
      center: [-98.5, 39.8],
      zoom: 4,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
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

      if (allCoords.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        allCoords.forEach((c) => bounds.extend(c));
        map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      }
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

    // Re-add sources/layers after style change
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
          map.addLayer({
            id: `route-line-${route.id}`,
            type: 'line',
            source: `route-${route.id}`,
            paint: { 'line-color': route.color, 'line-width': 4, 'line-opacity': hiddenRouteIds.has(route.id) ? 0 : 0.85 },
            layout: { 'line-cap': 'round', 'line-join': 'round', 'visibility': hiddenRouteIds.has(route.id) ? 'none' : 'visible' },
          });
        }
      });
    });
  }, [selectedBasemap, event.routes, hiddenRouteIds]);

  // Route visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    event.routes.forEach(route => {
      const layerId = `route-line-${route.id}`;
      if (!map.getLayer(layerId)) return;
      map.setLayoutProperty(layerId, 'visibility', hiddenRouteIds.has(route.id) ? 'none' : 'visible');
    });
  }, [hiddenRouteIds, event.routes]);

  // POI + mile markers (re-render on visibility/highlight changes)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const renderMarkers = () => {
      // Clear old markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      // Mile markers for visible routes
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

      // POI markers
      event.pois.forEach(poi => {
        // Hide POIs associated with hidden routes (auto start/finish)
        if (poi.id.startsWith('auto-start-') || poi.id.startsWith('auto-finish-')) {
          const routeId = poi.id.replace('auto-start-', '').replace('auto-finish-', '');
          if (hiddenRouteIds.has(routeId)) return;
        }

        const tone = poiTone(poi.type);
        const isHighlighted = !highlightedPoiType || highlightedPoiType === poi.type;
        const el = document.createElement('div');
        el.style.cssText = `display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:white;border:2px solid ${tone.dot};font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);opacity:${isHighlighted ? 1 : 0.25};transition:opacity 0.2s,transform 0.15s;`;
        el.textContent = tone.emoji;
        el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.2)'; });
        el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; });

        const popup = new mapboxgl.Popup({ offset: 14, maxWidth: '260px' }).setHTML(
          `<div style="font-family:var(--font-body)">
            <strong style="font-family:var(--font-display)">${poi.title}</strong>
            ${poi.description ? `<br/><span style="color:#6b7280;font-size:0.875rem">${poi.description}</span>` : ''}
            ${poi.imageData ? `<br/><img src="${poi.imageData}" style="margin-top:6px;border-radius:6px;max-width:100%;max-height:120px;object-fit:cover;" />` : ''}
            ${poi.webLink ? `<br/><a href="${poi.webLink}" target="_blank" rel="noopener" style="color:#2563eb;font-size:0.75rem">Visit link →</a>` : ''}
          </div>`
        );
        markersRef.current.push(new mapboxgl.Marker(el).setLngLat(poi.coordinates).setPopup(popup).addTo(map));
      });
    };

    if (map.isStyleLoaded()) renderMarkers();
    else map.once('style.load', renderMarkers);

    return () => { markersRef.current.forEach(m => m.remove()); markersRef.current = []; };
  }, [event.pois, event.routes, hiddenRouteIds, highlightedPoiType]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card z-10">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-foreground truncate" style={{ fontFamily: 'var(--font-display)' }}>
            {event.name}
          </h1>
          <p className="text-xs text-muted-foreground">Runner Course Map</p>
        </div>
      </div>

      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="w-full h-full" />

        <PublicMapToolbar
          routes={event.routes}
          hiddenRouteIds={hiddenRouteIds}
          onToggleRoute={toggleRoute}
          selectedBasemap={selectedBasemap}
          onBasemapChange={setSelectedBasemap}
          pois={event.pois}
          highlightedPoiType={highlightedPoiType}
          onHighlightPoiType={setHighlightedPoiType}
        />

        <EventBranding
          logoUrl={event.logo_url ?? null}
          brandingStyle={event.branding_style ?? 'none'}
          eventName={event.name}
        />
        {token && (
          <ElevationProfile
            route={activeRouteForProfile}
            mapboxToken={token}
            routeColor={activeRouteForProfile?.color ?? '#2563eb'}
            onHoverPoint={handleElevationHover}
          />
        )}
      </div>
    </div>
  );
};

export default RunnerView;
