import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone } from '@/lib/pois';
import type { EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { ArrowLeft, Car, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SpectatorViewProps {
  event: {
    name: string;
    city: string | null;
    event_date: string | null;
    routes: EventRoute[];
    pois: RoutePoi[];
  };
  onBack: () => void;
}

// POI types relevant to spectators
const SPECTATOR_POI_TYPES: PoiType[] = ['start', 'finish', 'parking', 'restroom', 'sponsor', 'custom'];

const SpectatorView = ({ event, onBack }: SpectatorViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const { token } = useMapboxToken();

  const spectatorPois = event.pois.filter(p => SPECTATOR_POI_TYPES.includes(p.type));

  useEffect(() => {
    if (!mapContainerRef.current || !token) return;
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_OPTIONS.find(b => b.id === 'streets')?.style ?? BASEMAP_OPTIONS[0].style,
      center: [-98.5, 39.8],
      zoom: 4,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      const allCoords: [number, number][] = [];

      // Add simplified route lines (thinner, muted)
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
            'line-width': 3,
            'line-opacity': 0.45,
            'line-dasharray': [2, 2],
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      });

      // Add spectator-relevant POIs with larger markers
      spectatorPois.forEach((poi) => {
        const tone = poiTone(poi.type);
        const el = document.createElement('div');
        el.className = 'flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-lg border-2 text-lg cursor-pointer';
        el.style.borderColor = tone.dot;
        el.textContent = tone.emoji;
        allCoords.push(poi.coordinates);

        new mapboxgl.Marker(el)
          .setLngLat(poi.coordinates)
          .setPopup(
            new mapboxgl.Popup({ offset: 16, maxWidth: '260px' }).setHTML(
              `<div style="font-family:var(--font-body)">
                <strong style="font-family:var(--font-display);font-size:1rem">${poi.title}</strong>
                ${poi.description ? `<br/><span style="color:#6b7280;font-size:0.875rem">${poi.description}</span>` : ''}
                <br/><span style="font-size:0.75rem;color:#9ca3af">${tone.label}</span>
              </div>`
            )
          )
          .addTo(map);
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
  }, [token, event, spectatorPois]);

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
          <p className="text-xs text-muted-foreground">Spectator Guide</p>
        </div>
      </div>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <div className="w-72 border-r border-border bg-card overflow-y-auto p-4 space-y-5 hidden md:block">
          <div className="rounded-lg bg-accent/10 p-3 text-sm text-accent-foreground">
            <p className="font-medium text-accent" style={{ fontFamily: 'var(--font-display)' }}>👋 Spectator Tips</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>• Routes are shown as dashed lines</li>
              <li>• Tap POI markers for details</li>
              <li>• Look for 🅿️ parking and 🚻 restrooms</li>
            </ul>
          </div>

          {spectatorPois.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Key Locations
              </h3>
              <div className="space-y-1">
                {spectatorPois.map((poi) => {
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

          {/* Parking highlight */}
          {spectatorPois.some(p => p.type === 'parking') && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Car className="w-3.5 h-3.5" /> Parking
              </h3>
              <div className="space-y-1">
                {spectatorPois.filter(p => p.type === 'parking').map((poi) => (
                  <div key={poi.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/50">
                    <span className="text-base">🅿️</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{poi.title}</p>
                      {poi.description && (
                        <p className="text-xs text-muted-foreground truncate">{poi.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Map */}
        <div ref={mapContainerRef} className="flex-1" />
      </div>
    </div>
  );
};

export default SpectatorView;
