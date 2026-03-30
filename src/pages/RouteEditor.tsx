import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import type { Coord, EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { totalDistanceMiles, getSnappedRoute, ROUTE_COLORS, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone, POI_TYPES } from '@/lib/pois';
import EditorSidebar from '@/components/editor/EditorSidebar';
import EditorTopBar from '@/components/editor/EditorTopBar';

// Mapbox token fetched from backend at runtime
const MAPBOX_TOKEN_FALLBACK = import.meta.env.VITE_MAPBOX_TOKEN as string || '';

function makeRoute(name: string, color: string): EventRoute {
  return {
    id: crypto.randomUUID(),
    name,
    color,
    visible: true,
    waypoints: [],
    routeCoords: [],
  };
}

const RouteEditor = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('id');
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const currentBasemapRef = useRef('light');
  const initialBoundsRef = useRef<{ coords: Coord[]; city: string } | null>(null);

  const [eventName, setEventName] = useState('Untitled Event');
  const [eventDate, setEventDate] = useState('');
  const [city, setCity] = useState('');
  const [routes, setRoutes] = useState<EventRoute[]>([makeRoute('5K Route', ROUTE_COLORS[0])]);
  const [activeRouteId, setActiveRouteId] = useState('');
  const [pois, setPois] = useState<RoutePoi[]>([]);
  const [pendingPoiType, setPendingPoiType] = useState<PoiType | null>(null);
  const [snapToRoads, setSnapToRoads] = useState(true);
  const [isSnapping, setIsSnapping] = useState(false);
  const [statusText, setStatusText] = useState('Click on the map to start building your route.');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBasemap, setSelectedBasemap] = useState('light');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mapboxToken, setMapboxToken] = useState(MAPBOX_TOKEN_FALLBACK);

  // Fetch Mapbox token from backend
  useEffect(() => {
    if (mapboxToken) return; // already have it from env
    supabase.functions.invoke('get-mapbox-token').then(({ data, error }) => {
      if (!error && data?.token) setMapboxToken(data.token);
    });
  }, [mapboxToken]);

  useEffect(() => {
    if (!activeRouteId && routes.length > 0) setActiveRouteId(routes[0].id);
  }, [routes, activeRouteId]);

  const activeRoute = useMemo(() => routes.find((r) => r.id === activeRouteId), [routes, activeRouteId]);

  useEffect(() => {
    if (!authLoading && !user) navigate('/login');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!eventId || !user) return;
    setIsLoading(true);
    supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast({ title: 'Could not load event', variant: 'destructive' });
          setIsLoading(false);
          return;
        }
        setEventName(data.name);
        setEventDate(data.event_date ?? '');
        setCity(data.city ?? '');

        const rawRoutes = data.routes as unknown;
        const loadedRoutes = Array.isArray(rawRoutes) && (rawRoutes as EventRoute[]).length > 0
          ? (rawRoutes as EventRoute[])
          : [makeRoute('5K Route', ROUTE_COLORS[0])];
        setRoutes(loadedRoutes);
        setActiveRouteId(loadedRoutes[0]?.id ?? '');
        const rawPois = data.pois as unknown;
        setPois(Array.isArray(rawPois) ? (rawPois as RoutePoi[]) : []);

        // Collect all route coordinates for initial map bounds
        const allCoords = loadedRoutes.flatMap((r) => r.routeCoords ?? []);
        initialBoundsRef.current = { coords: allCoords, city: data.city ?? '' };

        setStatusText('Event loaded.');
        setIsLoading(false);
      });
  }, [eventId, user, toast]);

  useEffect(() => {
    if (!mapContainerRef.current || !mapboxToken) return;
    mapboxgl.accessToken = mapboxToken;

    const lng = parseFloat(searchParams.get('lng') || '') || -98.5;
    const lat = parseFloat(searchParams.get('lat') || '') || 39.8;
    const initialZoom = searchParams.get('lng') ? 13 : 4;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_OPTIONS.find((b) => b.id === selectedBasemap)?.style ?? BASEMAP_OPTIONS[2].style,
      center: [lng, lat],
      zoom: initialZoom,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    // Fit map to existing route data or geocode city
    const boundsData = initialBoundsRef.current;
    if (boundsData && boundsData.coords.length >= 2 && !searchParams.get('lng')) {
      map.once('load', () => {
        const bounds = new mapboxgl.LngLatBounds();
        boundsData.coords.forEach((c) => bounds.extend(c as [number, number]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
      });
    } else if (!searchParams.get('lng') && boundsData?.city) {
      // Geocode the city to center the map
      fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(boundsData.city)}.json?access_token=${mapboxToken}&types=place&limit=1`)
        .then((r) => r.json())
        .then((data) => {
          const feature = data?.features?.[0];
          if (feature?.center) {
            map.flyTo({ center: feature.center as [number, number], zoom: 13, duration: 1000 });
          }
        })
        .catch(() => {});
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken, isLoading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectedBasemap === currentBasemapRef.current) return;
    currentBasemapRef.current = selectedBasemap;
    const style = BASEMAP_OPTIONS.find((b) => b.id === selectedBasemap)?.style;
    if (style) map.setStyle(style);
  }, [selectedBasemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = async (e: mapboxgl.MapMouseEvent) => {
      const coord: Coord = [e.lngLat.lng, e.lngLat.lat];

      if (pendingPoiType) {
        const tone = poiTone(pendingPoiType);
        const newPoi: RoutePoi = {
          id: crypto.randomUUID(),
          type: pendingPoiType,
          title: tone.label,
          description: '',
          coordinates: coord,
        };
        setPois((prev) => [...prev, newPoi]);
        setPendingPoiType(null);
        setStatusText(`${tone.label} placed.`);
        return;
      }

      if (!activeRouteId) return;

      setRoutes((prev) => {
        const route = prev.find((r) => r.id === activeRouteId);
        if (!route) return prev;

        const nextWaypoints = [...route.waypoints, coord];

        if (!snapToRoads || nextWaypoints.length < 2) {
          return prev.map((r) =>
            r.id === activeRouteId
              ? { ...r, waypoints: nextWaypoints, routeCoords: nextWaypoints }
              : r
          );
        }

        return prev.map((r) =>
          r.id === activeRouteId ? { ...r, waypoints: nextWaypoints } : r
        );
      });

      const route = routes.find((r) => r.id === activeRouteId);
      if (snapToRoads && route && route.waypoints.length >= 1) {
        const nextWaypoints = [...route.waypoints, coord];
        setIsSnapping(true);
        setStatusText('Snapping to roads...');
        try {
          const snapped = await getSnappedRoute(nextWaypoints, mapboxToken);
          setRoutes((prev) =>
            prev.map((r) =>
              r.id === activeRouteId
                ? { ...r, waypoints: nextWaypoints, routeCoords: snapped }
                : r
            )
          );
          setStatusText(`${nextWaypoints.length} waypoints · ${totalDistanceMiles(snapped).toFixed(2)} mi`);
        } catch {
          setStatusText('Road snap failed, using straight line.');
        } finally {
          setIsSnapping(false);
        }
      }
    };

    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [activeRouteId, pendingPoiType, snapToRoads, routes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const render = () => {
      // Clean up existing route layers/sources
      routes.forEach((route) => {
        const srcId = `route-${route.id}`;
        if (map.getLayer(srcId)) map.removeLayer(srcId);
        if (map.getSource(srcId)) map.removeSource(srcId);
      });

      routes
        .filter((r) => r.visible && r.routeCoords.length > 1)
        .forEach((route) => {
          const srcId = `route-${route.id}`;
          map.addSource(srcId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: route.routeCoords,
              },
            },
          });
          map.addLayer({
            id: srcId,
            type: 'line',
            source: srcId,
            paint: {
              'line-color': route.color,
              'line-width': route.id === activeRouteId ? 5 : 3,
              'line-opacity': route.id === activeRouteId ? 1 : 0.6,
            },
          });
        });

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      pois.forEach((poi) => {
        const tone = poiTone(poi.type);
        const el = document.createElement('div');
        el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${tone.dot};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;`;
        el.textContent = tone.emoji;

        const marker = new mapboxgl.Marker(el)
          .setLngLat(poi.coordinates)
          .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(`<strong>${poi.title}</strong><br/>${poi.description || poi.type}`))
          .addTo(map);
        markersRef.current.push(marker);
      });
    };

    if (map.isStyleLoaded()) {
      render();
    } else {
      map.once('style.load', render);
    }

    // Also re-render when style changes (basemap switch)
    map.on('style.load', render);
    return () => {
      map.off('style.load', render);
    };
  }, [routes, pois, activeRouteId, selectedBasemap]);

  const handleSave = useCallback(async () => {
    if (!eventId) return;
    setIsSaving(true);
    setStatusText('Saving...');

    const { error } = await supabase
      .from('events')
      .update({
        name: eventName,
        city: city || null,
        event_date: eventDate || null,
        routes: JSON.parse(JSON.stringify(routes)),
        pois: JSON.parse(JSON.stringify(pois)),
        route_count: routes.length,
        poi_count: pois.length,
      })
      .eq('id', eventId);

    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      setStatusText('Save failed.');
    } else {
      toast({ title: 'Event saved' });
      setStatusText('Event saved.');
    }
    setIsSaving(false);
  }, [eventId, eventName, city, eventDate, routes, pois, toast]);

  const addRoute = () => {
    const color = ROUTE_COLORS[routes.length % ROUTE_COLORS.length];
    const r = makeRoute(`Route ${routes.length + 1}`, color);
    setRoutes((prev) => [...prev, r]);
    setActiveRouteId(r.id);
  };

  const deleteRoute = (id: string) => {
    const remaining = routes.filter((r) => r.id !== id);
    const next = remaining.length > 0 ? remaining : [makeRoute('5K Route', ROUTE_COLORS[0])];
    setRoutes(next);
    if (activeRouteId === id) setActiveRouteId(next[0].id);
  };

  const undoLastWaypoint = useCallback(async () => {
    if (!activeRoute || activeRoute.waypoints.length === 0) return;
    const nextWaypoints = activeRoute.waypoints.slice(0, -1);

    if (nextWaypoints.length === 0) {
      setRoutes((prev) =>
        prev.map((r) => (r.id === activeRouteId ? { ...r, waypoints: [], routeCoords: [] } : r))
      );
      setStatusText('Route cleared.');
      return;
    }

    if (snapToRoads && nextWaypoints.length >= 2) {
      setIsSnapping(true);
      try {
        const snapped = await getSnappedRoute(nextWaypoints, mapboxToken);
        setRoutes((prev) =>
          prev.map((r) => (r.id === activeRouteId ? { ...r, waypoints: nextWaypoints, routeCoords: snapped } : r))
        );
      } catch {
        setRoutes((prev) =>
          prev.map((r) => (r.id === activeRouteId ? { ...r, waypoints: nextWaypoints, routeCoords: nextWaypoints } : r))
        );
      } finally {
        setIsSnapping(false);
      }
    } else {
      setRoutes((prev) =>
        prev.map((r) => (r.id === activeRouteId ? { ...r, waypoints: nextWaypoints, routeCoords: nextWaypoints } : r))
      );
    }
    setStatusText('Undid last point.');
  }, [activeRoute, activeRouteId, snapToRoads]);

  const clearActiveRoute = () => {
    if (!activeRoute) return;
    setRoutes((prev) =>
      prev.map((r) => (r.id === activeRouteId ? { ...r, waypoints: [], routeCoords: [] } : r))
    );
    setStatusText('Route cleared.');
  };

  const activeDistance = activeRoute ? totalDistanceMiles(activeRoute.routeCoords) : 0;

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading editor…</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <EditorTopBar
        eventName={eventName}
        city={city}
        eventDate={eventDate}
        statusText={statusText}
        isSaving={isSaving}
        isSnapping={isSnapping}
        mapboxToken={mapboxToken}
        onSave={handleSave}
        onBack={() => navigate('/dashboard')}
        onUndo={undoLastWaypoint}
        onClearRoute={clearActiveRoute}
        onLocationSelect={(center) => {
          mapRef.current?.flyTo({ center, zoom: 14, duration: 1500 });
        }}
      />

      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <EditorSidebar
            eventName={eventName}
            setEventName={setEventName}
            eventDate={eventDate}
            setEventDate={setEventDate}
            city={city}
            setCity={setCity}
            routes={routes}
            activeRouteId={activeRouteId}
            setActiveRouteId={setActiveRouteId}
            setRoutes={setRoutes}
            onAddRoute={addRoute}
            onDeleteRoute={deleteRoute}
            pois={pois}
            setPois={setPois}
            pendingPoiType={pendingPoiType}
            setPendingPoiType={setPendingPoiType}
            snapToRoads={snapToRoads}
            setSnapToRoads={setSnapToRoads}
            activeDistance={activeDistance}
            selectedBasemap={selectedBasemap}
            setSelectedBasemap={setSelectedBasemap}
          />
        )}

        <div className="flex-1 relative">
          <div ref={mapContainerRef} className="w-full h-full" />

          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="absolute top-4 left-4 z-10 bg-card/95 backdrop-blur border border-border rounded-full px-3 py-2 text-xs font-semibold shadow-lg hover:bg-secondary transition-colors"
          >
            {sidebarOpen ? '← Hide panel' : '→ Show panel'}
          </button>

          {pendingPoiType && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-card/95 backdrop-blur border border-border rounded-full px-4 py-2 text-sm font-medium shadow-lg flex items-center gap-2">
              <span>{poiTone(pendingPoiType).emoji}</span>
              Click map to place {poiTone(pendingPoiType).label.toLowerCase()}
              <button
                onClick={() => setPendingPoiType(null)}
                className="ml-2 text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RouteEditor;
