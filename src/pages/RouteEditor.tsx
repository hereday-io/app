import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import type { Coord, EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { totalDistanceMiles, getSnappedRoute, getMileMarkers, snapToNearestRoute, ROUTE_COLORS, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone, POI_TYPES } from '@/lib/pois';
import { uploadPoiImage, isDataUrl } from '@/lib/poiImageUpload';
import { logEvent } from '@/lib/analytics';
import EditorTopBar from '@/components/editor/EditorTopBar';
import RouteBuilderToolbar from '@/components/editor/RouteBuilderToolbar';
import EditorBottomSheet from '@/components/editor/EditorBottomSheet';
import EditorWelcomeModal from '@/components/editor/EditorWelcomeModal';
import EditorCoachMark from '@/components/editor/EditorCoachMark';
import SnapModePill from '@/components/editor/SnapModePill';
import MobileEditorGate from '@/components/editor/MobileEditorGate';
import EditorTour from '@/components/editor/EditorTour';
import KeyboardShortcutsOverlay from '@/components/editor/KeyboardShortcutsOverlay';
import UpgradeModal from '@/components/UpgradeModal';
import { usePaywall } from '@/hooks/usePaywall';

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

  const elevMarkerRef = useRef<mapboxgl.Marker | null>(null);


  const [eventName, setEventName] = useState('Untitled Event');
  const [eventDate, setEventDate] = useState('');
  const [city, setCity] = useState('');
  const [routes, setRoutes] = useState<EventRoute[]>([makeRoute('5K Route', ROUTE_COLORS[0])]);
  const [activeRouteId, setActiveRouteId] = useState('');
  const [pois, setPois] = useState<RoutePoi[]>([]);
  const [pendingPoiType, setPendingPoiType] = useState<PoiType | null>(null);
  const [snapToRoads, setSnapToRoads] = useState(true);
  const [poiSnapToRoute, setPoiSnapToRoute] = useState(true);
  const [isSnapping, setIsSnapping] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [statusText, setStatusText] = useState('Click on the map to start building your route.');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBasemap, setSelectedBasemap] = useState('light');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [mapboxToken, setMapboxToken] = useState(MAPBOX_TOKEN_FALLBACK);
  const [tourActive, setTourActive] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [eventStatus, setEventStatus] = useState('draft');
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const isDirtyRef = useRef(false);
  const initialLoadCompleteRef = useRef(false);
  const [eventSlug, setEventSlug] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [finishedRouteIds, setFinishedRouteIds] = useState<Set<string>>(new Set());
  const [highlightedPoiType, setHighlightedPoiType] = useState<PoiType | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brandingStyle, setBrandingStyle] = useState<'none' | 'corner' | 'banner' | 'both'>('none');
  const [isPaid, setIsPaid] = useState(false);
  const [upgradeModalTrigger, setUpgradeModalTrigger] = useState<'routes' | 'pois' | 'branding' | null>(null);
  // Fetch Mapbox token from backend
  useEffect(() => {
    if (mapboxToken) return; // already have it from env
    supabase.functions.invoke('get-mapbox-token').then(({ data, error }) => {
      if (!error && data?.token) setMapboxToken(data.token);
    });
  }, [mapboxToken]);

  // Fetch paid status from profile
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('is_paid').eq('user_id', user.id).single().then(({ data }) => {
      if (data) setIsPaid((data as any).is_paid ?? false);
    });
  }, [user]);

  useEffect(() => {
    if (!activeRouteId && routes.length > 0) setActiveRouteId(routes[0].id);
  }, [routes, activeRouteId]);

  const activeRoute = useMemo(() => routes.find((r) => r.id === activeRouteId), [routes, activeRouteId]);

  const handleElevationHover = useCallback((coord: Coord | null) => {
    if (elevMarkerRef.current) {
      elevMarkerRef.current.remove();
      elevMarkerRef.current = null;
    }
    if (coord && mapRef.current) {
      const color = activeRoute?.color ?? '#2563eb';
      const el = document.createElement('div');
      el.style.cssText = `position:relative;width:20px;height:20px;pointer-events:none;`;

      // Pulse ring
      const pulse = document.createElement('div');
      pulse.style.cssText = `position:absolute;inset:-6px;border-radius:50%;border:2px solid ${color};opacity:0.5;animation:elevPulse 1.2s ease-out infinite;`;
      el.appendChild(pulse);

      // Outer white ring
      const ring = document.createElement('div');
      ring.style.cssText = `position:absolute;inset:-3px;border-radius:50%;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.35);`;
      el.appendChild(ring);

      // Inner colored dot
      const dot = document.createElement('div');
      dot.style.cssText = `position:absolute;inset:3px;border-radius:50%;background:${color};`;
      el.appendChild(dot);

      // Inject keyframes once
      if (!document.getElementById('elev-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'elev-pulse-style';
        style.textContent = `@keyframes elevPulse{0%{transform:scale(1);opacity:0.6}70%{transform:scale(1.8);opacity:0}100%{transform:scale(1.8);opacity:0}}`;
        document.head.appendChild(style);
      }

      elevMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(coord)
        .addTo(mapRef.current);
    }
  }, [activeRoute?.color]);

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
        // Mark routes with existing waypoints as finished
        const finished = new Set<string>();
        loadedRoutes.forEach((r) => { if (r.waypoints.length >= 2) finished.add(r.id); });
        setFinishedRouteIds(finished);
        const rawPois = data.pois as unknown;
        setPois(Array.isArray(rawPois) ? (rawPois as RoutePoi[]) : []);

        setEventStatus(data.status ?? 'draft');
        setEventSlug(data.slug ?? null);
        setLogoUrl(data.logo_url ?? null);
        setBrandingStyle((data.branding_style as 'none' | 'corner' | 'banner' | 'both') ?? 'none');
        setStatusText('Event loaded.');
        setIsLoading(false);
        // Defer one tick so the state updates above commit before the
        // autosave dirty-tracking effect starts observing.
        setTimeout(() => { initialLoadCompleteRef.current = true; }, 0);

        // Fit map to route data or geocode city — run after data is in hand,
        // whether or not the map style has finished loading yet.
        if (!searchParams.get('lng')) {
          const allCoords = loadedRoutes.flatMap((r) => r.routeCoords ?? []);
          const fitMap = () => {
            const map = mapRef.current;
            if (!map) return;
            if (allCoords.length >= 2) {
              const bounds = new mapboxgl.LngLatBounds();
              allCoords.forEach((c) => bounds.extend(c as [number, number]));
              // duration: 0 — jump instantly so users don't wait on a
              // globe-to-route zoom animation when opening the editor.
              map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 0 });
            } else if (data.city) {
              fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(data.city)}.json?access_token=${MAPBOX_TOKEN_FALLBACK}&types=place&limit=1`)
                .then((r) => r.json())
                .then((geo) => {
                  const feature = geo?.features?.[0];
                  if (feature?.center) {
                    map.jumpTo({ center: feature.center as [number, number], zoom: 13 });
                  }
                })
                .catch(() => {});
            }
          };
          const map = mapRef.current;
          if (map) {
            if (map.isStyleLoaded()) fitMap();
            else map.once('load', fitMap);
          }
        }
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
    map.once('load', () => setMapReady(true));

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectedBasemap === currentBasemapRef.current) return;
    currentBasemapRef.current = selectedBasemap;
    const style = BASEMAP_OPTIONS.find((b) => b.id === selectedBasemap)?.style;
    if (style) map.setStyle(style);
  }, [selectedBasemap]);

  // Keep the map sized to its container. Mapbox does not auto-resize when the
  // parent flex container changes (e.g. when the sidebar is toggled), which
  // can leave the canvas with stale/zero dimensions and make the map appear
  // blank. A ResizeObserver fixes this reliably.
  useEffect(() => {
    const container = mapContainerRef.current;
    const map = mapRef.current;
    if (!container || !map) return;
    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [mapReady]);

  // Cursor tooltip that follows the mouse
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const tooltip = document.createElement('div');
    tooltip.style.cssText =
      'position:absolute;pointer-events:none;z-index:50;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:500;white-space:nowrap;background:hsl(var(--card));color:hsl(var(--foreground));border:1px solid hsl(var(--border));box-shadow:0 2px 8px rgba(0,0,0,0.15);opacity:0;transition:opacity 0.15s;';
    map.getContainer().appendChild(tooltip);

    const onMouseMove = (e: mapboxgl.MapMouseEvent) => {
      const point = e.point;
      tooltip.style.left = `${point.x + 16}px`;
      tooltip.style.top = `${point.y - 12}px`;

      if (pendingPoiType) {
        tooltip.textContent = `Click to place ${poiTone(pendingPoiType).label.toLowerCase()}`;
        tooltip.style.opacity = '1';
      } else if (activeRouteId && !finishedRouteIds.has(activeRouteId)) {
        const route = routes.find((r) => r.id === activeRouteId);
        const wpCount = route?.waypoints.length ?? 0;
        if (wpCount === 0) {
          tooltip.textContent = 'Click to start your route';
        } else {
          tooltip.textContent = 'Click to add point · Double-click to finish';
        }
        tooltip.style.opacity = '1';
      } else {
        tooltip.style.opacity = '0';
      }
    };

    const onMouseLeave = () => {
      tooltip.style.opacity = '0';
    };

    map.on('mousemove', onMouseMove);
    map.getContainer().addEventListener('mouseleave', onMouseLeave);

    return () => {
      map.off('mousemove', onMouseMove);
      map.getContainer().removeEventListener('mouseleave', onMouseLeave);
      tooltip.remove();
    };
  }, [activeRouteId, pendingPoiType, routes, finishedRouteIds]);

  // Helper to auto-place start/finish POIs for a route
  const autoPlaceStartFinish = useCallback((routeId: string, waypoints: Coord[]) => {
    if (waypoints.length < 2) return;
    const startCoord = waypoints[0];
    const finishCoord = waypoints[waypoints.length - 1];

    setPois((prev) => {
      // Remove any existing auto-placed start/finish for this route
      const filtered = prev.filter(
        (p) => !(p.id.startsWith(`auto-start-${routeId}`) || p.id.startsWith(`auto-finish-${routeId}`))
      );
      return [
        ...filtered,
        {
          id: `auto-start-${routeId}`,
          type: 'start' as PoiType,
          title: 'Start',
          description: '',
          coordinates: startCoord,
        },
        {
          id: `auto-finish-${routeId}`,
          type: 'finish' as PoiType,
          title: 'Finish',
          description: '',
          coordinates: finishCoord,
        },
      ];
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Disable default double-click zoom so our handler works
    map.doubleClickZoom.disable();

    const onClick = async (e: mapboxgl.MapMouseEvent) => {
      const rawCoord: Coord = [e.lngLat.lng, e.lngLat.lat];

      if (pendingPoiType) {
        const coord = poiSnapToRoute ? snapToNearestRoute(rawCoord, routes) : rawCoord;
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

      if (!activeRouteId || finishedRouteIds.has(activeRouteId)) return;

      const route = routes.find((r) => r.id === activeRouteId);
      if (!route) return;
      const nextWaypoints = [...route.waypoints, rawCoord];

      // ── Freeform: append coord directly ────────────────────────────────
      if (!snapToRoads) {
        const newCoords = [...route.routeCoords, rawCoord];
        const prevCounts = route.segmentCoordCounts ?? route.waypoints.map(() => 1);
        setRoutes((prev) =>
          prev.map((r) =>
            r.id === activeRouteId
              ? { ...r, waypoints: nextWaypoints, routeCoords: newCoords, segmentCoordCounts: [...prevCounts, 1] }
              : r
          )
        );
        return;
      }

      // ── First snap point: record it, snapping needs ≥2 waypoints ───────
      if (nextWaypoints.length < 2) {
        setRoutes((prev) =>
          prev.map((r) =>
            r.id === activeRouteId
              ? { ...r, waypoints: nextWaypoints, routeCoords: [rawCoord], segmentCoordCounts: [1] }
              : r
          )
        );
        return;
      }

      // ── Snap mode: snap only the new segment and append ─────────────────
      // This preserves any freeform segments already drawn and avoids
      // re-snapping the whole route when the user switches modes mid-draw.
      const prevWaypoint = route.waypoints[route.waypoints.length - 1];

      setRoutes((prev) =>
        prev.map((r) =>
          r.id === activeRouteId ? { ...r, waypoints: nextWaypoints } : r
        )
      );

      setIsSnapping(true);
      setStatusText('Snapping to roads...');
      try {
        const snappedSegment = await getSnappedRoute([prevWaypoint, rawCoord], mapboxToken);
        // Append snapped segment; skip its first coord (already end of existing path)
        const tail = snappedSegment.slice(route.routeCoords.length > 0 ? 1 : 0);
        const newCoords = [...route.routeCoords, ...tail];
        const prevCounts = route.segmentCoordCounts ?? route.waypoints.map(() => 1);
        setRoutes((prev) =>
          prev.map((r) =>
            r.id === activeRouteId
              ? { ...r, waypoints: nextWaypoints, routeCoords: newCoords, segmentCoordCounts: [...prevCounts, tail.length || 1] }
              : r
          )
        );
        setStatusText(`${nextWaypoints.length} waypoints · ${totalDistanceMiles(newCoords).toFixed(2)} mi`);
      } catch {
        const newCoords = route.routeCoords.length > 0
          ? [...route.routeCoords, rawCoord]
          : nextWaypoints;
        const prevCounts = route.segmentCoordCounts ?? route.waypoints.map(() => 1);
        setRoutes((prev) =>
          prev.map((r) =>
            r.id === activeRouteId
              ? { ...r, waypoints: nextWaypoints, routeCoords: newCoords, segmentCoordCounts: [...prevCounts, 1] }
              : r
          )
        );
        setStatusText('Road snap failed, using straight line.');
      } finally {
        setIsSnapping(false);
      }
    };

    const onDblClick = (e: mapboxgl.MapMouseEvent) => {
      e.preventDefault();
      if (!activeRouteId) return;

      const route = routes.find((r) => r.id === activeRouteId);
      if (!route || route.waypoints.length < 2) return;

      // Auto-place start & finish POIs
      autoPlaceStartFinish(activeRouteId, route.waypoints);
      setFinishedRouteIds((prev) => new Set(prev).add(activeRouteId));
      setStatusText(`Route finished · ${totalDistanceMiles(route.routeCoords).toFixed(2)} mi — Start & Finish added`);
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.doubleClickZoom.enable();
    };
  }, [activeRouteId, pendingPoiType, snapToRoads, routes, autoPlaceStartFinish, finishedRouteIds]);

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

      // Mile markers for visible routes
      routes
        .filter((r) => r.visible && r.routeCoords.length > 1)
        .forEach((route) => {
          const miles = getMileMarkers(route.routeCoords);
          miles.forEach(({ mile, coord }) => {
            const el = document.createElement('div');
            el.style.cssText = `
              width: 22px; height: 22px; border-radius: 50%;
              background: ${route.color}; color: white;
              border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
              display: flex; align-items: center; justify-content: center;
              font-size: 10px; font-weight: 700; line-height: 1;
              pointer-events: none;
            `;
            el.textContent = String(mile);
            const marker = new mapboxgl.Marker(el).setLngLat(coord).addTo(map);
            markersRef.current.push(marker);
          });
        });

      // POI markers — hide auto start/finish if their route is hidden
      const hiddenRouteIds = new Set(routes.filter((r) => !r.visible).map((r) => r.id));
      pois.forEach((poi) => {
        // Check if this is an auto start/finish POI for a hidden route
        const autoMatch = poi.id.match(/^auto-(start|finish)-(.+)$/);
        if (autoMatch && hiddenRouteIds.has(autoMatch[2])) return;

        const tone = poiTone(poi.type);
        const isHighlighted = highlightedPoiType === null || highlightedPoiType === poi.type;
        const el = document.createElement('div');
        el.style.cssText = `cursor:pointer;display:flex;align-items:center;justify-content:center;`;
        const inner = document.createElement('div');
        const size = isHighlighted ? 28 : 24;
        inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${tone.dot};border:3px solid ${isHighlighted ? 'white' : 'rgba(255,255,255,0.5)'};box-shadow:0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1});display:flex;align-items:center;justify-content:center;font-size:${isHighlighted ? 14 : 12}px;opacity:${isHighlighted ? 1 : 0.4};transition:transform 0.15s ease, box-shadow 0.2s;pointer-events:none;`;
        inner.textContent = tone.emoji;
        el.appendChild(inner);
        el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.25)'; inner.style.boxShadow = `0 4px 12px rgba(0,0,0,0.35)`; });
        el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; inner.style.boxShadow = `0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1})`; });

        const popupContent = document.createElement('div');
        popupContent.style.cssText = 'font-family:"DM Sans",system-ui,sans-serif;width:260px;';

        const escTitle = (poi.title || '').replace(/"/g, '&quot;');
        const escDesc = (poi.description || '').replace(/</g, '&lt;');
        const escImg = (poi.imageUrl || '').replace(/"/g, '&quot;');
        const escLink = (poi.webLink || '').replace(/"/g, '&quot;');
        const coordStr = `${poi.coordinates[1].toFixed(5)}, ${poi.coordinates[0].toFixed(5)}`;

        const hasWebLink = ['registration', 'sponsor', 'custom'].includes(poi.type);
        const existingImage = poi.imageDataUrl || poi.imageUrl || '';
        
        // All colors/borders use design-system CSS variables so the popup
        // renders correctly in dark mode and matches the rest of the editor.
        popupContent.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div style="width:40px;height:40px;border-radius:50%;background:${tone.dot}15;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;border:2px solid ${tone.dot}30;">${tone.emoji}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:10px;color:hsl(var(--muted-foreground));font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">${tone.label} Marker</div>
              <input data-field="title" value="${escTitle}" placeholder="${tone.label}" style="width:100%;padding:0;border:none;font-size:15px;font-weight:700;color:hsl(var(--foreground));outline:none;background:transparent;font-family:inherit;" />
            </div>
          </div>
          <div style="border-top:1px solid hsl(var(--border));padding-top:12px;">
            <label style="font-size:11px;font-weight:600;color:hsl(var(--muted-foreground));display:block;margin-bottom:4px;">Description</label>
            <textarea data-field="description" placeholder="Add notes about this marker location…" rows="2" style="width:100%;padding:8px 10px;border:1px solid hsl(var(--border));border-radius:8px;font-size:12px;resize:none;outline:none;box-sizing:border-box;font-family:inherit;color:hsl(var(--foreground));background:hsl(var(--background));">${escDesc}</textarea>
          </div>
          <div style="margin-top:10px;">
            <label style="font-size:11px;font-weight:600;color:hsl(var(--muted-foreground));display:flex;align-items:center;gap:4px;margin-bottom:4px;">📷 Photo</label>
            <div data-photo-area style="position:relative;">
              <img data-photo-preview src="${existingImage}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;border:1px solid hsl(var(--border));margin-bottom:6px;display:${existingImage ? 'block' : 'none'};" />
              <div style="display:flex;gap:6px;">
                <label data-photo-label style="flex:1;padding:8px;border:1px dashed hsl(var(--border));border-radius:8px;font-size:12px;color:hsl(var(--muted-foreground));cursor:pointer;text-align:center;font-family:inherit;transition:background 0.15s;display:flex;align-items:center;justify-content:center;gap:4px;background:transparent;">
                  📎 ${existingImage ? 'Change photo' : 'Attach photo'}
                  <input data-field="photoFile" type="file" accept="image/*" style="display:none;" />
                </label>
                <button data-action="removePhoto" style="padding:8px;border:1px solid hsl(var(--border));border-radius:8px;font-size:12px;color:hsl(var(--destructive));cursor:pointer;background:transparent;font-family:inherit;display:${existingImage ? 'block' : 'none'};">✕</button>
              </div>
            </div>
          </div>
          ${hasWebLink ? `
          <div style="margin-top:10px;">
            <label style="font-size:11px;font-weight:600;color:hsl(var(--muted-foreground));display:flex;align-items:center;gap:4px;margin-bottom:4px;">🔗 Web Link</label>
            <input data-field="webLink" value="${escLink}" placeholder="https://example.com" style="width:100%;padding:8px 10px;border:1px solid hsl(var(--border));border-radius:8px;font-size:12px;outline:none;box-sizing:border-box;font-family:inherit;color:hsl(var(--foreground));background:hsl(var(--background));" />
          </div>
          ` : ''}
          <div style="margin-top:10px;padding:6px 10px;background:hsl(var(--muted));border-radius:8px;font-size:11px;color:hsl(var(--muted-foreground));font-family:monospace;">${coordStr}</div>
           <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid hsl(var(--border));">
            <button data-action="remove" style="background:none;border:none;color:hsl(var(--destructive));font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;padding:4px 0;font-family:inherit;">🗑 Remove</button>
            <div style="display:flex;gap:6px;">
              <button data-action="move" style="padding:6px 12px;background:hsl(var(--secondary));color:hsl(var(--secondary-foreground));border:1px solid hsl(var(--border));border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">✥ Move</button>
              <button data-action="save" style="padding:6px 18px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Done</button>
            </div>
           </div>
        `;

        const popup = new mapboxgl.Popup({ offset: 14, maxWidth: '300px', closeOnClick: false });
        popup.setDOMContent(popupContent);

        popup.on('open', () => {
          const saveBtn = popupContent.querySelector('[data-action="save"]') as HTMLButtonElement;
          const removeBtn = popupContent.querySelector('[data-action="remove"]') as HTMLButtonElement;
          const fileInput = popupContent.querySelector('[data-field="photoFile"]') as HTMLInputElement;
          const photoPreview = popupContent.querySelector('[data-photo-preview]') as HTMLImageElement;
          const removePhotoBtn = popupContent.querySelector('[data-action="removePhoto"]') as HTMLButtonElement;
          // Track image edit intent explicitly so we can distinguish
          // "user didn't touch the photo" (keep existing imageUrl) from
          // "user cleared it" (wipe both fields) from "user picked a new
          // file" (replace with pending data URL, queue re-upload).
          let newImageDataUrl: string | undefined;
          let imageCleared = false;

          fileInput?.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              newImageDataUrl = reader.result as string;
              imageCleared = false;
              if (photoPreview) {
                photoPreview.src = newImageDataUrl;
                photoPreview.style.display = 'block';
              }
              if (removePhotoBtn) removePhotoBtn.style.display = 'block';
            };
            reader.readAsDataURL(file);
          });

          removePhotoBtn?.addEventListener('click', () => {
            newImageDataUrl = undefined;
            imageCleared = true;
            if (photoPreview) {
              photoPreview.src = '';
              photoPreview.style.display = 'none';
            }
            removePhotoBtn.style.display = 'none';
          });

          saveBtn?.addEventListener('click', () => {
            const t = (popupContent.querySelector('[data-field="title"]') as HTMLInputElement).value;
            const d = (popupContent.querySelector('[data-field="description"]') as HTMLTextAreaElement).value;
            const linkEl = popupContent.querySelector('[data-field="webLink"]') as HTMLInputElement | null;
            const link = linkEl?.value || '';
            setPois((prev) =>
              prev.map((p) => {
                if (p.id !== poi.id) return p;
                const base = { ...p, title: t, description: d, webLink: link || undefined };
                if (imageCleared) {
                  return { ...base, imageDataUrl: undefined, imageUrl: undefined };
                }
                if (newImageDataUrl) {
                  // New image queued — drop stale imageUrl, let save path upload.
                  return { ...base, imageDataUrl: newImageDataUrl, imageUrl: undefined };
                }
                // No image change — preserve whatever was there.
                return base;
              })
            );
            popup.remove();
          });

          removeBtn?.addEventListener('click', () => {
            setPois((prev) => prev.filter((p) => p.id !== poi.id));
            popup.remove();
          });

          const moveBtn = popupContent.querySelector('[data-action="move"]') as HTMLButtonElement;
          moveBtn?.addEventListener('click', () => {
            marker.setDraggable(true);
            el.style.cursor = 'grabbing';
            inner.style.boxShadow = '0 0 0 4px rgba(59,130,246,0.4), 0 4px 12px rgba(0,0,0,0.3)';
            popup.remove();
            const onDragEnd = () => {
              const lngLat = marker.getLngLat();
              const snappedCoord = poiSnapToRoute ? snapToNearestRoute([lngLat.lng, lngLat.lat] as Coord, routes) : [lngLat.lng, lngLat.lat] as Coord;
              marker.setLngLat(snappedCoord);
              setPois((prev) =>
                prev.map((p) =>
                  p.id === poi.id
                    ? { ...p, coordinates: snappedCoord }
                    : p
                )
              );
              marker.setDraggable(false);
              el.style.cursor = 'pointer';
              inner.style.boxShadow = `0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1})`;
              marker.off('dragend', onDragEnd);
            };
            marker.on('dragend', onDragEnd);
          });
        });

        const marker = new mapboxgl.Marker({ element: el, draggable: false })
          .setLngLat(poi.coordinates)
          .setPopup(popup)
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
  }, [routes, pois, activeRouteId, selectedBasemap, mapReady, highlightedPoiType]);

  // Materializes any POI images that are still base64 data URLs into the
  // poi-images storage bucket. Returns a POI array safe to persist (no
  // base64 payloads) and, as a side effect, updates in-memory state so
  // the next autosave doesn't re-upload the same bytes.
  const materializePoiImages = useCallback(async (input: RoutePoi[]): Promise<RoutePoi[]> => {
    if (!user || !eventId) return input;
    const out: RoutePoi[] = [];
    let mutated = false;
    for (const poi of input) {
      if (isDataUrl(poi.imageDataUrl)) {
        try {
          const url = await uploadPoiImage(poi.imageDataUrl!, user.id, eventId, poi.id);
          out.push({ ...poi, imageUrl: url, imageDataUrl: undefined });
          mutated = true;
          continue;
        } catch (err) {
          // If upload fails, drop the base64 rather than persist it. The
          // user keeps the in-memory preview until the next edit.
          console.error('POI image upload failed', err);
          out.push({ ...poi, imageDataUrl: undefined });
          mutated = true;
          continue;
        }
      }
      out.push(poi);
    }
    if (mutated) setPois(out);
    return out;
  }, [user, eventId]);

  const handleSave = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!eventId) return;
    setIsSaving(true);
    setSaveState('saving');
    if (!opts.silent) setStatusText('Saving...');

    const cleanPois = await materializePoiImages(pois);

    const { error } = await supabase
      .from('events')
      .update({
        name: eventName,
        city: city || null,
        event_date: eventDate || null,
        routes: JSON.parse(JSON.stringify(routes)),
        pois: JSON.parse(JSON.stringify(cleanPois)),
        route_count: routes.length,
        poi_count: cleanPois.length,
        logo_url: logoUrl,
        branding_style: brandingStyle,
      })
      .eq('id', eventId);

    if (error) {
      setSaveState('error');
      if (!opts.silent) {
        toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
        setStatusText('Save failed.');
      }
    } else {
      isDirtyRef.current = false;
      setSaveState('saved');
      setLastSavedAt(Date.now());
      if (!opts.silent) {
        toast({ title: 'Event saved' });
        setStatusText('Event saved.');
      }
    }
    setIsSaving(false);
  }, [eventId, eventName, city, eventDate, routes, pois, logoUrl, brandingStyle, toast, materializePoiImages]);

  // ── Autosave ───────────────────────────────────────────────────────────
  // Mark dirty whenever editable state changes. The initialLoadCompleteRef
  // gate prevents the first load from flagging the event as dirty.
  useEffect(() => {
    if (!initialLoadCompleteRef.current) return;
    isDirtyRef.current = true;
    setSaveState('dirty');
  }, [eventName, city, eventDate, routes, pois, logoUrl, brandingStyle]);

  // Debounced autosave: whenever dirty, schedule a silent save in ~2s.
  useEffect(() => {
    if (saveState !== 'dirty' || !eventId) return;
    const timer = setTimeout(() => {
      handleSave({ silent: true });
    }, 2000);
    return () => clearTimeout(timer);
  }, [saveState, eventId, handleSave]);

  // beforeunload guard: only if there are truly-pending changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  const handlePublish = useCallback(async () => {
    if (!eventId) return;
    setIsPublishing(true);
    // Save first, then publish
    const newStatus = eventStatus === 'published' ? 'draft' : 'published';
    const cleanPois = await materializePoiImages(pois);
    const { error } = await supabase
      .from('events')
      .update({
        name: eventName,
        city: city || null,
        event_date: eventDate || null,
        routes: JSON.parse(JSON.stringify(routes)),
        pois: JSON.parse(JSON.stringify(cleanPois)),
        route_count: routes.length,
        poi_count: cleanPois.length,
        status: newStatus,
        logo_url: logoUrl,
        branding_style: brandingStyle,
      })
      .eq('id', eventId);

    if (error) {
      toast({ title: 'Publish failed', description: error.message, variant: 'destructive' });
    } else {
      setEventStatus(newStatus);
      // Fetch the slug if we don't have it yet
      if (newStatus === 'published' && !eventSlug) {
        const { data: updated } = await supabase.from('events').select('slug').eq('id', eventId).single();
        if (updated?.slug) setEventSlug(updated.slug);
      }
      if (newStatus === 'published') {
        logEvent('event_published', eventId, {
          route_count: routes.length,
          poi_count: cleanPois.length,
          branding_style: brandingStyle,
        });
        toast({
          title: 'Event is live',
          description: 'Use the Share button to copy the public link.',
        });
      } else {
        logEvent('event_unpublished', eventId);
        toast({ title: 'Event unpublished' });
      }
    }
    setIsPublishing(false);
  }, [eventId, eventName, city, eventDate, routes, pois, eventStatus, eventSlug, toast, logoUrl, brandingStyle, materializePoiImages]);

  const handleResumeRoute = useCallback((id: string) => {
    setFinishedRouteIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // Remove the auto-finish POI — it'll be re-placed on the next double-click to finish
    setPois((prev) => prev.filter((p) => p.id !== `auto-finish-${id}`));
    setActiveRouteId(id);
    setStatusText('Route re-opened for editing.');
  }, []);

  const { canAddRoute, canAddPoi } = usePaywall({ isPaid });

  const addRoute = () => {
    if (!canAddRoute(routes.length)) {
      logEvent('paywall_hit', eventId, { trigger: 'routes', current_count: routes.length });
      setUpgradeModalTrigger('routes');
      return;
    }
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

    // Undoing always re-opens the route for editing
    setFinishedRouteIds((prev) => {
      const next = new Set(prev);
      next.delete(activeRouteId);
      return next;
    });

    if (nextWaypoints.length === 0) {
      setRoutes((prev) =>
        prev.map((r) => (r.id === activeRouteId ? { ...r, waypoints: [], routeCoords: [], segmentCoordCounts: [] } : r))
      );
      setStatusText('Route cleared.');
      return;
    }

    // If we have segment counts, trim routeCoords precisely — no re-snap needed.
    // This works correctly for mixed freeform+snap routes.
    const counts = activeRoute.segmentCoordCounts;
    if (counts && counts.length > 0) {
      const lastCount = counts[counts.length - 1];
      const newCoords = activeRoute.routeCoords.slice(0, -lastCount);
      setRoutes((prev) =>
        prev.map((r) => (r.id === activeRouteId
          ? { ...r, waypoints: nextWaypoints, routeCoords: newCoords, segmentCoordCounts: counts.slice(0, -1) }
          : r))
      );
      setStatusText('Undid last point.');
      return;
    }

    // Fallback for routes built before segmentCoordCounts was introduced
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
    // Un-finish the route so the user can start drawing again
    setFinishedRouteIds((prev) => {
      const next = new Set(prev);
      next.delete(activeRouteId);
      return next;
    });
    setStatusText('Route cleared.');
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoLastWaypoint();
        return;
      }

      if (isInput) return;

      if (e.key === 's' || e.key === 'S') {
        setSnapToRoads(prev => !prev);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        clearActiveRoute();
        return;
      }
      if (e.key === 'Escape') {
        setPendingPoiType(null);
        return;
      }
      if (e.key === '?') {
        setShortcutsOpen(true);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, undoLastWaypoint, clearActiveRoute]);

  const activeDistance = activeRoute ? totalDistanceMiles(activeRoute.routeCoords) : 0;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading editor…</div>
      </div>
    );
  }

  // Desktop-only gate: editor needs precision pointer + sidebar. Phone users
  // see a friendly takeover rather than a broken layout.
  const isTouchDevice = typeof window !== 'undefined' && (
    window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768
  );
  if (isTouchDevice) {
    return <MobileEditorGate onBack={() => navigate('/dashboard')} />;
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <EditorWelcomeModal onStartTour={() => setTourActive(true)} userId={user?.id ?? ''} />
      <EditorTour active={tourActive} onEnd={() => setTourActive(false)} />
      <KeyboardShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <UpgradeModal
        open={upgradeModalTrigger !== null}
        onClose={() => setUpgradeModalTrigger(null)}
        trigger={upgradeModalTrigger ?? 'routes'}
      />

      <EditorTopBar
        eventName={eventName}
        setEventName={setEventName}
        city={city}
        setCity={setCity}
        eventDate={eventDate}
        setEventDate={setEventDate}
        isSaving={isSaving}
        isSnapping={isSnapping}
        mapboxToken={mapboxToken}
        onSave={() => handleSave()}
        saveState={saveState}
        lastSavedAt={lastSavedAt}
        onBack={() => navigate('/dashboard')}
        onUndo={undoLastWaypoint}
        onClearRoute={clearActiveRoute}
        onLocationSelect={(center) => {
          mapRef.current?.flyTo({ center, zoom: 14, duration: 1500 });
        }}
        onHelp={() => setTourActive(true)}
        onPublish={handlePublish}
        isPublishing={isPublishing}
        isPublished={eventStatus === 'published'}
        publicUrl={eventSlug ? `${window.location.origin}/event/${eventSlug}` : undefined}
        eventId={eventId}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      <div className="flex-1 flex overflow-hidden">

        {/* ── Persistent sidebar ──────────────────────────────────────── */}
        {sidebarOpen && (
          <div className="w-60 shrink-0 overflow-hidden">
            <RouteBuilderToolbar
              routes={routes}
              activeRouteId={activeRouteId}
              setActiveRouteId={setActiveRouteId}
              setRoutes={setRoutes}
              onAddRoute={addRoute}
              onDeleteRoute={deleteRoute}
              pendingPoiType={pendingPoiType}
              setPendingPoiType={(type) => {
                if (type !== null && !canAddPoi(pois.filter(p => !p.id.startsWith('auto-')).length)) {
                  logEvent('paywall_hit', eventId, { trigger: 'pois', poi_type: type });
                  setUpgradeModalTrigger('pois');
                  return;
                }
                setPendingPoiType(type);
              }}
              pois={pois}
              setPois={setPois}
              selectedBasemap={selectedBasemap}
              setSelectedBasemap={setSelectedBasemap}
              poiSnapToRoute={poiSnapToRoute}
              setPoiSnapToRoute={setPoiSnapToRoute}
              highlightedPoiType={highlightedPoiType}
              setHighlightedPoiType={setHighlightedPoiType}
              isPaid={isPaid}
              finishedRouteIds={finishedRouteIds}
              onResumeRoute={handleResumeRoute}
              logoUrl={logoUrl}
              brandingStyle={brandingStyle}
              onLogoChange={(url) => {
                setLogoUrl(url);
                if (eventId) supabase.from('events').update({ logo_url: url }).eq('id', eventId);
              }}
              onBrandingStyleChange={(style) => {
                setBrandingStyle(style);
                if (eventId) supabase.from('events').update({ branding_style: style }).eq('id', eventId);
              }}
              eventId={eventId || ''}
              userId={user?.id || ''}
            />
          </div>
        )}

        {/* ── Map canvas ──────────────────────────────────────────────── */}
        <div className="flex-1 relative" data-tour="map-area">
          <div ref={mapContainerRef} className="w-full h-full" />

          {user && (
            <EditorCoachMark
              userId={user.id}
              hasRouteWaypoints={routes.some((r) => r.waypoints.length > 0)}
            />
          )}

          <SnapModePill snapToRoads={snapToRoads} onToggle={setSnapToRoads} />

          {/* Status toast — transient feedback from map actions */}
          {statusText && !statusText.startsWith('Click on the map') && (
            <div className="absolute bottom-4 right-4 z-10 bg-background/95 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs text-foreground shadow-sm max-w-xs">
              {statusText}
            </div>
          )}

          {isLoading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="animate-pulse text-muted-foreground">Loading event…</div>
            </div>
          )}

          <EditorBottomSheet
            route={activeRoute}
            mapboxToken={mapboxToken}
            routeColor={activeRoute?.color ?? '#2563eb'}
            onHoverPoint={handleElevationHover}
            eventDate={eventDate}
            weatherCoord={
              activeRoute?.routeCoords?.[0]
                ? [activeRoute.routeCoords[0][0], activeRoute.routeCoords[0][1]]
                : null
            }
          />

          {pendingPoiType && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 bg-background border border-border rounded-full px-4 py-2 text-sm font-medium shadow-sm flex items-center gap-2">
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
