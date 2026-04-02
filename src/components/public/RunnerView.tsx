import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { totalDistanceMiles, getMileMarkers, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone } from '@/lib/pois';
import type { EventRoute, RoutePoi } from '@/types/mapEditor';
import { ArrowLeft, Route, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ElevationProfile from '@/components/editor/ElevationProfile';

interface RunnerViewProps {
  event: {
    name: string;
    city: string | null;
    event_date: string | null;
    routes: EventRoute[];
    pois: RoutePoi[];
  };
  onBack: () => void;
}

const RunnerView = ({ event, onBack }: RunnerViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mileMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const { token } = useMapboxToken();
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  const activeRouteForProfile = selectedRoute
    ? event.routes.find((r) => r.id === selectedRoute)
    : event.routes[0];

  useEffect(() => {
    if (!mapContainerRef.current || !token) return;
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_OPTIONS.find(b => b.id === 'outdoors')?.style ?? BASEMAP_OPTIONS[1].style,
      center: [-98.5, 39.8],
      zoom: 4,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      // Add routes
      const allCoords: [number, number][] = [];

      event.routes.forEach((route) => {
        if (route.routeCoords.length < 2) return;
        allCoords.push(...route.routeCoords);

        map.addSource(`route-${route.id}`, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: route.routeCoords },
          },
        });

        map.addLayer({
          id: `route-line-${route.id}`,
          type: 'line',
          source: `route-${route.id}`,
          paint: {
            'line-color': route.color,
            'line-width': 4,
            'line-opacity': 0.85,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      });

      // Add POI markers
      event.pois.forEach((poi) => {
        const tone = poiTone(poi.type);
        const el = document.createElement('div');
        el.className = 'flex items-center justify-center w-8 h-8 rounded-full bg-white shadow-md border-2 text-base cursor-pointer';
        el.style.borderColor = tone.dot;
        el.textContent = tone.emoji;
        allCoords.push(poi.coordinates);

        new mapboxgl.Marker(el)
          .setLngLat(poi.coordinates)
          .setPopup(
            new mapboxgl.Popup({ offset: 14, maxWidth: '240px' }).setHTML(
              `<div style="font-family:var(--font-body)">
                <strong style="font-family:var(--font-display)">${poi.title}</strong>
                ${poi.description ? `<br/><span style="color:#6b7280;font-size:0.875rem">${poi.description}</span>` : ''}
                <br/><span style="font-size:0.75rem;color:#9ca3af">${tone.label}</span>
              </div>`
            )
          )
          .addTo(map);
      });

      // Mile markers
      mileMarkersRef.current.forEach((m) => m.remove());
      mileMarkersRef.current = [];
      event.routes.forEach((route) => {
        if (route.routeCoords.length < 2) return;
        const miles = getMileMarkers(route.routeCoords);
        miles.forEach(({ mile, coord }) => {
          const el = document.createElement('div');
          el.style.cssText = `
            width: 22px; height: 22px; border-radius: 50%;
            background: ${route.color}; color: white;
            border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            display: flex; align-items: center; justify-content: center;
            font-size: 10px; font-weight: 700; line-height: 1;
          `;
          el.textContent = String(mile);
          const marker = new mapboxgl.Marker(el).setLngLat(coord).addTo(map);
          mileMarkersRef.current.push(marker);
        });
      });

      // Fit bounds
      if (allCoords.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        allCoords.forEach((c) => bounds.extend(c as [number, number]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token, event]);

  // Highlight a single route
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    event.routes.forEach((route) => {
      const layerId = `route-line-${route.id}`;
      if (!map.getLayer(layerId)) return;

      if (!selectedRoute) {
        map.setPaintProperty(layerId, 'line-opacity', 0.85);
        map.setPaintProperty(layerId, 'line-width', 4);
      } else if (selectedRoute === route.id) {
        map.setPaintProperty(layerId, 'line-opacity', 1);
        map.setPaintProperty(layerId, 'line-width', 6);
      } else {
        map.setPaintProperty(layerId, 'line-opacity', 0.25);
        map.setPaintProperty(layerId, 'line-width', 3);
      }
    });
  }, [selectedRoute, event.routes]);

  // Runner-relevant POI types
  const runnerPois = event.pois.filter(p =>
    ['start', 'finish', 'water', 'medical', 'aid-station', 'registration', 'restroom'].includes(p.type)
  );

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

      <div className="flex-1 flex">
        {/* Sidebar */}
        <div className="w-72 border-r border-border bg-card overflow-y-auto p-4 space-y-5 hidden md:block">
          {/* Routes */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Route className="w-3.5 h-3.5" /> Routes
            </h3>
            <div className="space-y-2">
              {event.routes.map((route) => {
                const dist = totalDistanceMiles(route.routeCoords);
                return (
                  <button
                    key={route.id}
                    onClick={() => setSelectedRoute(prev => prev === route.id ? null : route.id)}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors border ${
                      selectedRoute === route.id
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-transparent hover:bg-muted'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: route.color }} />
                    <span className="flex-1 font-medium text-foreground">{route.name}</span>
                    {dist > 0 && (
                      <Badge variant="secondary" className="text-xs">{dist.toFixed(1)} mi</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* POI list */}
          {runnerPois.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Aid & Stations
              </h3>
              <div className="space-y-1">
                {runnerPois.map((poi) => {
                  const tone = poiTone(poi.type);
                  return (
                    <div key={poi.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted transition-colors">
                      <span className="text-base">{tone.emoji}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{poi.title}</p>
                        {poi.description && (
                          <p className="text-xs text-muted-foreground truncate">{poi.description}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <div ref={mapContainerRef} className="w-full h-full" />
          {token && (
            <ElevationProfile
              route={activeRouteForProfile}
              mapboxToken={token}
              routeColor={activeRouteForProfile?.color ?? '#2563eb'}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RunnerView;
