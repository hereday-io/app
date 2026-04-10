import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, LocateFixed, Plus, Loader2, Compass } from 'lucide-react';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { useToast } from '@/hooks/use-toast';
import { resolveScoutToken, type ResolvedScoutEvent } from '@/lib/scoutApi';
import { flushScoutPending } from '@/lib/scoutStorage';
import type { EventRoute, RoutePoi } from '@/types/mapEditor';
import { poiTone } from '@/lib/pois';
import DropPinSheet from '@/components/scout/DropPinSheet';
import { logEvent } from '@/lib/analytics';

/**
 * Mobile POI Scout — read + submit entry point.
 *
 * Anon-accessible. The `:token` route param is the authorization — anyone
 * with the URL can add POIs to the event's review queue. The desktop
 * editor gates the token's generation and surfaces the resulting POIs in
 * a review banner.
 *
 * This page deliberately does NOT reuse RouteEditor's map setup because
 * scout mode is purely additive and read-only on the existing data.
 * Keeping a minimal standalone map means the component is ~300 lines
 * instead of ~1500 and we don't have to plumb scout-specific flags
 * through the full editor.
 */
const ScoutPage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { token: mapboxToken, loading: mapboxLoading } = useMapboxToken();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const existingMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const scoutedMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const meMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const routeLayersAddedRef = useRef(false);

  const [event, setEvent] = useState<ResolvedScoutEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dropSheetOpen, setDropSheetOpen] = useState(false);
  const [pendingCoord, setPendingCoord] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);

  // ── 1. Resolve the token ───────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setLoadError('Missing scout token');
      return;
    }
    let cancelled = false;
    resolveScoutToken(token)
      .then((data) => {
        if (cancelled) return;
        setEvent(data);
        logEvent('scout_page_opened', data.eventId, { status: data.status });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoadError(err.message || 'Failed to load event');
      });
    return () => { cancelled = true; };
  }, [token]);

  // ── 2. Auto-flush any queued POIs when the network comes back ─────────
  useEffect(() => {
    if (!token) return;
    const handler = () => { void flushScoutPending(token); };
    // Try once on mount in case we came online between sessions.
    handler();
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, [token]);

  // ── 3. Initialize map once we have both the event and the mapbox token ──
  useEffect(() => {
    if (!event || !mapboxToken || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = mapboxToken;

    // Fit bounds: prefer union of all routeCoords; fall back to [0,0] if empty.
    const routes = (event.routes as unknown as EventRoute[]) ?? [];
    const allCoords = routes.flatMap((r) => r.routeCoords ?? []);
    const initialCenter: [number, number] = allCoords.length > 0
      ? allCoords[Math.floor(allCoords.length / 2)] as [number, number]
      : [-98.5, 39.8];

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: initialCenter,
      zoom: 14,
      attributionControl: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      // Fit to routes if we have any
      if (allCoords.length >= 2) {
        const bounds = new mapboxgl.LngLatBounds();
        allCoords.forEach((c) => bounds.extend(c as [number, number]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
      }
      drawRoutes(map, routes);
      drawExistingPois(map, (event.pois as unknown as RoutePoi[]) ?? []);
      routeLayersAddedRef.current = true;
    });

    return () => {
      existingMarkersRef.current.forEach((m) => m.remove());
      scoutedMarkersRef.current.forEach((m) => m.remove());
      meMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      routeLayersAddedRef.current = false;
    };
  }, [event, mapboxToken]);

  // ── Helpers for drawing layers (kept local — scout page doesn't share
  //     with the editor's marker system so we avoid leaking state between
  //     two rendering strategies) ──────────────────────────────────────────
  const drawRoutes = (map: mapboxgl.Map, routes: EventRoute[]) => {
    routes.forEach((route, idx) => {
      if (!route.routeCoords || route.routeCoords.length < 2) return;
      const sourceId = `scout-route-${idx}`;
      const layerId = `scout-route-line-${idx}`;
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: route.routeCoords },
        },
      });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': route.color || '#2563eb',
          'line-width': 4,
          'line-opacity': 0.85,
        },
      });
    });
  };

  const drawExistingPois = (map: mapboxgl.Map, pois: RoutePoi[]) => {
    existingMarkersRef.current.forEach((m) => m.remove());
    existingMarkersRef.current = [];
    pois.forEach((poi) => {
      const tone = poiTone(poi.type);
      const el = document.createElement('div');
      el.className =
        'flex items-center justify-center w-7 h-7 rounded-full bg-white text-base shadow-md border border-border/60 opacity-50 pointer-events-none';
      el.textContent = tone.emoji;
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(poi.coordinates)
        .addTo(map);
      existingMarkersRef.current.push(marker);
    });
  };

  // ── 3. Drop pin + submit loop ──────────────────────────────────────────
  const handleDropPin = () => {
    if (!mapRef.current) return;
    const c = mapRef.current.getCenter();
    setPendingCoord([c.lng, c.lat]);
    setDropSheetOpen(true);
  };

  const handleSubmitted = (coord: [number, number]) => {
    // Visual confirmation: drop a small green marker at the scouted coord.
    if (!mapRef.current) return;
    const el = document.createElement('div');
    el.className =
      'flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white shadow-md border-2 border-white';
    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat(coord)
      .addTo(mapRef.current);
    scoutedMarkersRef.current.push(marker);
  };

  // ── 4. My location ─────────────────────────────────────────────────────
  const handleMyLocation = () => {
    if (locating) return;
    if (!navigator.geolocation) {
      toast({ title: 'Location unavailable on this device', variant: 'destructive' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { longitude, latitude } = pos.coords;
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({ center: [longitude, latitude], zoom: 17, duration: 800 });

        // Drop / update a "you are here" dot.
        if (meMarkerRef.current) {
          meMarkerRef.current.setLngLat([longitude, latitude]);
        } else {
          const el = document.createElement('div');
          el.className =
            'w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg';
          meMarkerRef.current = new mapboxgl.Marker({ element: el })
            .setLngLat([longitude, latitude])
            .addTo(map);
        }
      },
      (err) => {
        setLocating(false);
        const msg = err.code === err.PERMISSION_DENIED
          ? 'Location permission denied. Enable it in your browser settings to center the map on you.'
          : 'Could not get your location.';
        toast({ title: 'Location unavailable', description: msg, variant: 'destructive' });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  // ── 5. Render ──────────────────────────────────────────────────────────
  const loading = !event && !loadError;
  const initialSheetCoord = useMemo(
    () => pendingCoord,
    [pendingCoord],
  );

  if (loadError) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center">
          <Compass className="h-7 w-7" />
        </div>
        <div className="space-y-1 max-w-sm">
          <h1 className="text-xl font-display font-bold text-foreground">Scout link unavailable</h1>
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="mt-2 text-sm text-primary font-medium hover:underline"
        >
          Back to Hereday
        </button>
      </div>
    );
  }

  if (loading || mapboxLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Top bar — event name + back */}
      <header className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card">
        <button
          onClick={() => navigate('/')}
          className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <Compass className="h-3 w-3" />
            Scout mode
          </div>
          <h1 className="text-sm font-display font-bold text-foreground truncate">
            {event?.name}
          </h1>
        </div>
      </header>

      {/* Map + overlays */}
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Center crosshair — fixed overlay, not tied to the map canvas. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative">
            <div className="w-10 h-10 rounded-full border-2 border-primary bg-primary/10" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            </div>
          </div>
        </div>

        {/* My location FAB */}
        <button
          onClick={handleMyLocation}
          disabled={locating}
          className="absolute bottom-4 right-4 h-12 w-12 rounded-full bg-background shadow-lg border border-border flex items-center justify-center text-foreground hover:bg-secondary active:scale-95 transition-all disabled:opacity-60"
          title="Center on my location"
        >
          {locating
            ? <Loader2 className="h-5 w-5 animate-spin" />
            : <LocateFixed className="h-5 w-5" />
          }
        </button>
      </div>

      {/* Drop pin CTA */}
      <div className="shrink-0 px-3 py-3 border-t border-border bg-card">
        <button
          onClick={handleDropPin}
          className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 active:scale-[0.98] transition-all shadow-sm"
        >
          <Plus className="h-5 w-5" />
          Drop pin here
        </button>
      </div>

      {/* Drop pin sheet */}
      {dropSheetOpen && initialSheetCoord && token && event && (
        <DropPinSheet
          token={token}
          eventId={event.eventId}
          coordinates={initialSheetCoord}
          onClose={() => setDropSheetOpen(false)}
          onSubmitted={(coord) => {
            handleSubmitted(coord);
            setDropSheetOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default ScoutPage;
