import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSearchParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import type { Coord, EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { totalDistanceMiles, getSnappedRoute, getMileMarkers, snapToNearestRoute, ROUTE_COLORS, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone, POI_TYPES } from '@/lib/pois';
import { uploadPoiImage, isDataUrl } from '@/lib/poiImageUpload';
import { logEvent } from '@/lib/analytics';
import EditorTopBar from '@/components/editor/EditorTopBar';
import RouteBuilderToolbar from '@/components/editor/RouteBuilderToolbar';
import MapBottomSheet from '@/components/map/MapBottomSheet';
import EditorCoachMark from '@/components/editor/EditorCoachMark';
import SnapModePill from '@/components/editor/SnapModePill';
import MobileEditorGate from '@/components/editor/MobileEditorGate';
import ScoutLinkDialog from '@/components/editor/ScoutLinkDialog';
import ScoutReviewBanner from '@/components/editor/ScoutReviewBanner';
import ScoutReviewPanel, { type ScoutedPoiRecord } from '@/components/editor/ScoutReviewPanel';
import EditorTour from '@/components/editor/EditorTour';
import KeyboardShortcutsOverlay from '@/components/editor/KeyboardShortcutsOverlay';
import PoiEditPopover from '@/components/editor/PoiEditPopover';
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
  const scoutedMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const currentBasemapRef = useRef('light');
  // Track React roots mounted into Mapbox popup DOM nodes so we can
  // cleanly unmount them on popup close / marker rebuild and avoid
  // leaking one root per POI click.
  const popoverRootsRef = useRef<Map<string, Root>>(new Map());

  const elevMarkerRef = useRef<mapboxgl.Marker | null>(null);


  const [eventName, setEventName] = useState('Untitled Event');
  const [eventDate, setEventDate] = useState('');
  const [city, setCity] = useState('');
  const [routes, setRoutes] = useState<EventRoute[]>([makeRoute('5K Route', ROUTE_COLORS[0])]);
  const [activeRouteId, setActiveRouteId] = useState('');
  const [pois, setPois] = useState<RoutePoi[]>([]);
  const [pendingPoiType, setPendingPoiType] = useState<PoiType | null>(null);
  // When true, the picker stays armed after each placement so the user
  // can drop multiple of the same type without re-opening the dropdown.
  // Set by Shift-clicking a type in the MapToolbar. Cleared by Esc.
  const [keepPoiTypeArmed, setKeepPoiTypeArmed] = useState(false);
  // Currently selected POI (for keyboard delete + visual selection ring).
  // Set when a marker is clicked; cleared on Esc or background click.
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [snapToRoads, setSnapToRoads] = useState(true);
  const [poiSnapToRoute, setPoiSnapToRoute] = useState(true);
  const [isSnapping, setIsSnapping] = useState(false);
  const isSnappingRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [statusText, setStatusText] = useState('Click on the map to start building your route.');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBasemap, setSelectedBasemap] = useState('light');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [mapboxToken, setMapboxToken] = useState(MAPBOX_TOKEN_FALLBACK);
  const [tourActive, setTourActive] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [scoutLinkDialogOpen, setScoutLinkDialogOpen] = useState(false);
  const [scoutedPois, setScoutedPois] = useState<ScoutedPoiRecord[]>([]);
  const [scoutReviewPanelOpen, setScoutReviewPanelOpen] = useState(false);
  const [eventStatus, setEventStatus] = useState('draft');
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  // Countdown (seconds) until the next auto-retry of a failed save.
  // Drives the "Retrying in Ns…" chip label. Null when no retry is
  // pending — either never failed, already recovered, or we've run
  // out of auto-retries and now need the user to click.
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const isDirtyRef = useRef(false);
  const initialLoadCompleteRef = useRef(false);
  const [eventSlug, setEventSlug] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [finishedRouteIds, setFinishedRouteIds] = useState<Set<string>>(new Set());
  const [highlightedPoiType, setHighlightedPoiType] = useState<PoiType | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brandingStyle, setBrandingStyle] = useState<'none' | 'corner' | 'banner' | 'both'>('none');
  const [eventPlan, setEventPlan] = useState<'free' | 'pro'>('free');
  const [trackingStart, setTrackingStart] = useState<string | null>(null);
  const [trackingEnd, setTrackingEnd] = useState<string | null>(null);
  const [upgradeModalTrigger, setUpgradeModalTrigger] = useState<'routes' | 'pois' | 'branding' | 'publish' | null>(null);
  // Fetch Mapbox token from backend
  useEffect(() => {
    if (mapboxToken) return; // already have it from env
    supabase.functions.invoke('get-mapbox-token').then(({ data, error }) => {
      if (!error && data?.token) setMapboxToken(data.token);
    });
  }, [mapboxToken]);

  // Check for upgrade success redirect on mount only. Clean the URL
  // param immediately so the map-init effect (which reads searchParams
  // for lng/lat) doesn't re-fire when the URL changes.
  const upgradeHandledRef = useRef(false);
  useEffect(() => {
    if (upgradeHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === 'true') {
      upgradeHandledRef.current = true;
      setEventPlan('pro');
      toast({ title: 'Upgrade complete!', description: 'This event is now on the Pro plan.' });
      params.delete('upgraded');
      const clean = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', clean);
    }
  }, [toast]);

  useEffect(() => {
    if (!activeRouteId && routes.length > 0) setActiveRouteId(routes[0].id);
  }, [routes, activeRouteId]);

  const activeRoute = useMemo(() => routes.find((r) => r.id === activeRouteId), [routes, activeRouteId]);

  // Adapter: MapBottomSheet takes `hiddenRouteIds: Set<string>`, but
  // the editor tracks visibility as `route.visible` on each route
  // object. Derive the set on the fly and flip the flag in-place when
  // the bottom sheet's legend toggles a row.
  const hiddenRouteIdsForLegend = useMemo(
    () => new Set(routes.filter((r) => !r.visible).map((r) => r.id)),
    [routes],
  );
  const toggleRouteVisible = useCallback((id: string) => {
    setRoutes((prev) => prev.map((r) => r.id === id ? { ...r, visible: !r.visible } : r));
  }, []);

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
        const rawScouted = (data as { scouted_pois?: unknown }).scouted_pois;
        setScoutedPois(Array.isArray(rawScouted) ? (rawScouted as ScoutedPoiRecord[]) : []);

        setEventStatus(data.status ?? 'draft');
        setEventSlug(data.slug ?? null);
        setLogoUrl(data.logo_url ?? null);
        setBrandingStyle((data.branding_style as 'none' | 'corner' | 'banner' | 'both') ?? 'none');
        setEventPlan(data.plan === 'pro' ? 'pro' : 'free');
        setTrackingStart(data.tracking_start ?? null);
        setTrackingEnd(data.tracking_end ?? null);
        setStatusText('Event loaded.');
        setIsLoading(false);
        // Defer one tick so the state updates above commit before the
        // autosave dirty-tracking effect starts observing.
        setTimeout(() => { initialLoadCompleteRef.current = true; }, 0);
        logEvent('editor_opened', eventId);

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
            } else {
              // No route data, no city — don't leave the user staring at
              // a continental zoom-4 view. Try the last editor center
              // from localStorage first (instant, no prompt), then fall
              // back to navigator.geolocation (async, requires consent).
              // The continental default stays as the absolute last resort.
              try {
                const last = localStorage.getItem('hereday:lastEditorCenter');
                if (last) {
                  const parsed = JSON.parse(last) as { lng: number; lat: number };
                  if (Number.isFinite(parsed.lng) && Number.isFinite(parsed.lat)) {
                    map.jumpTo({ center: [parsed.lng, parsed.lat], zoom: 13 });
                    return;
                  }
                }
              } catch {
                // Ignore parse errors — fall through to geolocation.
              }
              if (typeof navigator !== 'undefined' && navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    const m = mapRef.current;
                    if (!m) return;
                    m.jumpTo({
                      center: [pos.coords.longitude, pos.coords.latitude],
                      zoom: 13,
                    });
                  },
                  () => {
                    // Permission denied or unavailable — stay put.
                  },
                  { timeout: 5000, maximumAge: 60_000 },
                );
              }
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
    // Wait until auth has resolved — while authLoading is true the map
    // container div isn't in the DOM (a loading placeholder is shown
    // instead), so mapContainerRef.current would be null and the effect
    // would silently bail. Without authLoading in the deps the effect
    // never re-runs once the real editor mounts.
    if (authLoading) return;
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

    // Remember where the user last looked so the next cold-start of a
    // new cityless event can warp there instead of a continental view.
    // Debounced to keep the write cost minimal on repeated pan/zoom.
    let persistCenterTimer: ReturnType<typeof setTimeout> | null = null;
    const handleMoveEnd = () => {
      if (persistCenterTimer) clearTimeout(persistCenterTimer);
      persistCenterTimer = setTimeout(() => {
        try {
          const c = map.getCenter();
          if (map.getZoom() >= 8) {
            localStorage.setItem(
              'hereday:lastEditorCenter',
              JSON.stringify({ lng: c.lng, lat: c.lat }),
            );
          }
        } catch {
          // localStorage unavailable — silently drop.
        }
      }, 500);
    };
    map.on('moveend', handleMoveEnd);

    return () => {
      if (persistCenterTimer) clearTimeout(persistCenterTimer);
      map.off('moveend', handleMoveEnd);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken, authLoading]);

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

    // Set cursor based on editor mode
    const canvas = map.getCanvas();
    if (pendingPoiType) {
      canvas.style.cursor = 'copy';
    } else if (activeRouteId && !finishedRouteIds.has(activeRouteId)) {
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = '';
    }

    const onMouseMove = (e: mapboxgl.MapMouseEvent) => {
      const point = e.point;
      tooltip.style.left = `${point.x + 16}px`;
      tooltip.style.top = `${point.y - 12}px`;

      if (pendingPoiType) {
        tooltip.textContent = `Click to drop a ${poiTone(pendingPoiType).label.toLowerCase()}`;
        tooltip.style.opacity = '1';
      } else if (activeRouteId && !finishedRouteIds.has(activeRouteId)) {
        const route = routes.find((r) => r.id === activeRouteId);
        const wpCount = route?.waypoints.length ?? 0;
        if (wpCount === 0) {
          tooltip.textContent = 'Click the map to start drawing';
        } else {
          tooltip.textContent = 'Click to extend · double-click to finish';
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
      canvas.style.cursor = '';
    };
  }, [activeRouteId, pendingPoiType, routes, finishedRouteIds]);

  // Rubber-band preview line — dashed line from last waypoint to cursor
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const route = routes.find((r) => r.id === activeRouteId);
    const isDrawing = activeRouteId && !finishedRouteIds.has(activeRouteId) && !pendingPoiType && route && route.waypoints.length > 0;

    const srcId = 'rubber-band';
    const layerId = 'rubber-band-line';

    // Empty GeoJSON for initial / non-drawing state
    const emptyLine: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [] },
    };

    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'geojson', data: emptyLine });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: srcId,
        paint: {
          'line-color': route?.color ?? '#3b82f6',
          'line-width': 3,
          'line-opacity': 0.5,
          'line-dasharray': [3, 3],
        },
      });
    } else {
      // Update color to match active route
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'line-color', route?.color ?? '#3b82f6');
      }
    }

    if (!isDrawing) {
      (map.getSource(srcId) as mapboxgl.GeoJSONSource)?.setData(emptyLine);
      return;
    }

    const lastWp = route.waypoints[route.waypoints.length - 1];

    const onMove = (e: mapboxgl.MapMouseEvent) => {
      const src = map.getSource(srcId) as mapboxgl.GeoJSONSource;
      if (!src) return;
      src.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [lastWp, [e.lngLat.lng, e.lngLat.lat]],
        },
      });
    };

    map.on('mousemove', onMove);
    return () => {
      map.off('mousemove', onMove);
      const src = map.getSource(srcId) as mapboxgl.GeoJSONSource;
      if (src) src.setData(emptyLine);
    };
  }, [activeRouteId, finishedRouteIds, pendingPoiType, routes]);

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
      // Block clicks while a snap API call is in-flight to prevent
      // race conditions and double-queuing of waypoints.
      if (isSnappingRef.current) return;

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
        // Shift-click on the picker arms batch mode — the type stays
        // selected after each placement until the user presses Esc or
        // picks a different type.
        if (!keepPoiTypeArmed) setPendingPoiType(null);
        setStatusText(keepPoiTypeArmed ? `${tone.label} dropped. Click to add another.` : `${tone.label} dropped.`);
        return;
      }

      // Click on empty map (no pending type, not drawing) — clear
      // any POI selection so Delete doesn't accidentally remove it.
      if (!activeRouteId || finishedRouteIds.has(activeRouteId)) {
        setSelectedPoiId(null);
        return;
      }

      const route = routes.find((r) => r.id === activeRouteId);
      if (!route) return;
      if (route.waypoints.length === 0) logEvent('first_waypoint_placed', eventId);
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

      setIsSnapping(true); isSnappingRef.current = true;
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
        setIsSnapping(false); isSnappingRef.current = false;
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
      logEvent('route_finished', eventId, {
        waypoint_count: route.waypoints.length,
        distance_mi: parseFloat(totalDistanceMiles(route.routeCoords).toFixed(2)),
      });
      setStatusText(`Route finished · ${totalDistanceMiles(route.routeCoords).toFixed(2)} mi — Start & Finish added`);

      // Brief glow pulse on the route line to celebrate finishing
      const layerId = `route-${activeRouteId}`;
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'line-width', 8);
        map.setPaintProperty(layerId, 'line-opacity', 0.8);
        setTimeout(() => {
          if (map.getLayer(layerId)) {
            map.setPaintProperty(layerId, 'line-width', 5);
            map.setPaintProperty(layerId, 'line-opacity', 1);
          }
        }, 500);
      }
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.doubleClickZoom.enable();
    };
  }, [activeRouteId, pendingPoiType, keepPoiTypeArmed, poiSnapToRoute, snapToRoads, routes, autoPlaceStartFinish, finishedRouteIds]);

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
      scoutedMarkersRef.current.forEach((m) => m.remove());
      scoutedMarkersRef.current = [];

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

      // Waypoint dots — small circles at each waypoint so the user can
      // see the points they placed. Last waypoint is slightly larger.
      routes
        .filter((r) => r.visible && r.waypoints.length > 0)
        .forEach((route) => {
          route.waypoints.forEach((wp, i) => {
            const isLast = i === route.waypoints.length - 1;
            const size = isLast ? 10 : 6;
            const el = document.createElement('div');
            el.style.cssText = `
              width: ${size}px; height: ${size}px; border-radius: 50%;
              background: ${route.color}; border: 2px solid white;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
              pointer-events: none;
            `;
            const marker = new mapboxgl.Marker(el).setLngLat(wp).addTo(map);
            markersRef.current.push(marker);
          });
        });

      // POI markers — hide auto start/finish if their route is hidden.
      // Markers are always draggable now (see plan step 6) — the
      // separate "Move" button is gone. Click opens the React popover
      // for editing; drag repositions directly. The popover mounts
      // into a DOM node via React portal and is cleaned up on close
      // to avoid leaking roots across re-renders.
      const hiddenRouteIds = new Set(routes.filter((r) => !r.visible).map((r) => r.id));
      pois.forEach((poi) => {
        const autoMatch = poi.id.match(/^auto-(start|finish)-(.+)$/);
        if (autoMatch && hiddenRouteIds.has(autoMatch[2])) return;

        const tone = poiTone(poi.type);
        const isHighlighted = highlightedPoiType === null || highlightedPoiType === poi.type;
        const isSelected = selectedPoiId === poi.id;
        const el = document.createElement('div');
        el.style.cssText = `cursor:grab;display:flex;align-items:center;justify-content:center;`;
        const inner = document.createElement('div');
        const size = isHighlighted ? 28 : 24;
        const selectionRing = isSelected ? '0 0 0 3px hsl(var(--primary) / 0.4), ' : '';
        inner.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${tone.dot};border:3px solid ${isHighlighted ? 'white' : 'rgba(255,255,255,0.5)'};box-shadow:${selectionRing}0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1});display:flex;align-items:center;justify-content:center;font-size:${isHighlighted ? 14 : 12}px;opacity:${isHighlighted ? 1 : 0.4};transition:transform 0.15s ease, box-shadow 0.2s;pointer-events:none;`;
        inner.textContent = tone.emoji;
        inner.classList.add('poi-drop-in');
        el.appendChild(inner);
        el.addEventListener('mouseenter', () => {
          inner.style.transform = 'scale(1.25)';
          inner.style.boxShadow = `${selectionRing}0 4px 12px rgba(0,0,0,0.35)`;
        });
        el.addEventListener('mouseleave', () => {
          inner.style.transform = 'scale(1)';
          inner.style.boxShadow = `${selectionRing}0 2px 8px rgba(0,0,0,${isHighlighted ? 0.3 : 0.1})`;
        });

        // The DOM node Mapbox anchors our React popover into.
        const popupHost = document.createElement('div');
        popupHost.style.fontFamily = '"DM Sans", system-ui, sans-serif';

        // Hide Mapbox's default X — PoiEditPopover renders its own
        // close button styled to match the rest of the card.
        const popup = new mapboxgl.Popup({ offset: 14, maxWidth: '320px', closeOnClick: false, closeButton: false });
        popup.setDOMContent(popupHost);

        popup.on('open', () => {
          // Fresh React root per open — cheaper than keeping them
          // around between interactions, and guarantees the popover
          // reads the latest POI data from the closure.
          const root = createRoot(popupHost);
          popoverRootsRef.current.set(poi.id, root);
          root.render(
            <PoiEditPopover
              poi={poi}
              onSave={(patch) => {
                setPois((prev) => prev.map((p) => (p.id === poi.id ? { ...p, ...patch } : p)));
              }}
              onDelete={() => {
                deletePoiWithUndo(poi.id);
                popup.remove();
              }}
              onClose={() => popup.remove()}
            />
          );
        });

        popup.on('close', () => {
          const root = popoverRootsRef.current.get(poi.id);
          if (root) {
            // Defer unmount to the next tick — React complains if you
            // unmount synchronously from within an event that was
            // itself dispatched from React's render cycle.
            setTimeout(() => root.unmount(), 0);
            popoverRootsRef.current.delete(poi.id);
          }
        });

        const marker = new mapboxgl.Marker({ element: el, draggable: true })
          .setLngLat(poi.coordinates)
          .setPopup(popup)
          .addTo(map);

        // Click to select (the popup auto-opens via setPopup binding,
        // but we also want to flag this POI as "selected" so keyboard
        // delete works).
        el.addEventListener('click', () => setSelectedPoiId(poi.id));

        // Always-on drag handling. Close any open popup on drag start
        // so it doesn't float stale above the marker, then on drag end
        // snap-to-route if enabled and commit the new position.
        marker.on('dragstart', () => {
          popup.remove();
          el.style.cursor = 'grabbing';
        });
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat();
          const snapped = poiSnapToRoute
            ? snapToNearestRoute([lngLat.lng, lngLat.lat] as Coord, routes)
            : ([lngLat.lng, lngLat.lat] as Coord);
          marker.setLngLat(snapped);
          setPois((prev) => prev.map((p) => (p.id === poi.id ? { ...p, coordinates: snapped } : p)));
          el.style.cursor = 'grab';
          // Elastic settle animation when snapping to route
          if (poiSnapToRoute) {
            inner.classList.remove('poi-snap-settle');
            void inner.offsetWidth; // force reflow
            inner.classList.add('poi-snap-settle');
          }
        });

        markersRef.current.push(marker);
      });

      // Scouted POIs — rendered with a distinct "pending review" style
      // (dashed amber ring + pulsing shadow) so organizers can visually
      // locate what they're about to accept or reject. Non-draggable,
      // non-editable; all interaction flows through the review panel.
      scoutedPois.forEach((poi) => {
        const tone = poiTone(poi.type);
        const el = document.createElement('div');
        el.style.cssText = 'cursor:pointer;display:flex;align-items:center;justify-content:center;';
        const inner = document.createElement('div');
        inner.style.cssText = `width:30px;height:30px;border-radius:50%;background:${tone.dot};border:2.5px dashed #f59e0b;box-shadow:0 2px 8px rgba(245,158,11,0.45);display:flex;align-items:center;justify-content:center;font-size:14px;pointer-events:none;animation:scoutPulse 2s ease-in-out infinite;`;
        inner.textContent = tone.emoji;
        el.appendChild(inner);
        el.addEventListener('click', () => {
          // Inlined rather than calling handleScoutedFlyTo so the
          // render effect doesn't need that callback in its deps.
          mapRef.current?.flyTo({
            center: poi.coordinates,
            zoom: 16,
            duration: 800,
            offset: [-176, 0],
          });
          setScoutReviewPanelOpen(true);
        });
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(poi.coordinates)
          .addTo(map);
        scoutedMarkersRef.current.push(marker);
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
  }, [routes, pois, scoutedPois, activeRouteId, selectedBasemap, mapReady, highlightedPoiType]);

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

  // Clear any pending retry timers. Called on successful save, on
  // fresh user edits (so a dirty state restarts the clock), and on
  // unmount.
  const clearRetryTimers = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setRetryCountdown(null);
  }, []);

  const handleSave = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!eventId) return;
    // A manual click (non-silent) should cancel any pending auto-retry
    // — the user has decided to try now, not in 6s. Silent autosaves
    // triggered by the retry logic itself obviously must not wipe
    // their own scheduling; retryTimerRef has already fired by then
    // so there's nothing to cancel.
    if (!opts.silent) clearRetryTimers();
    setIsSaving(true);
    setSaveState('saving');
    if (!opts.silent) setStatusText('Saving...');

    const cleanPois = await materializePoiImages(pois);

    const { error } = await supabase.from('events')
      .update({
        name: eventName,
        city: city || null,
        event_date: eventDate || null,
        routes: JSON.parse(JSON.stringify(routes)),
        pois: JSON.parse(JSON.stringify(cleanPois)),
        scouted_pois: JSON.parse(JSON.stringify(scoutedPois)),
        route_count: routes.length,
        poi_count: cleanPois.length,
        logo_url: logoUrl,
        branding_style: brandingStyle,
        tracking_start: trackingStart,
        tracking_end: trackingEnd,
      })
      .eq('id', eventId);

    if (error) {
      setSaveState('error');
      if (!opts.silent) {
        toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
        setStatusText('Save failed.');
      }
      // Auto-retry: 3s → 6s → 12s. After three strikes, leave the
      // error chip in its clickable state so the user can take over.
      // Every retry rolls through this same handler, so a recovery
      // cleanly resets retryAttemptRef via the success branch below.
      const attempt = retryAttemptRef.current + 1;
      if (attempt <= 3) {
        retryAttemptRef.current = attempt;
        const delaySec = 3 * Math.pow(2, attempt - 1);
        setRetryCountdown(delaySec);
        // Visible 1hz countdown so the chip label feels alive instead
        // of stuck. The actual retry fires off the stored timeout.
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = setInterval(() => {
          setRetryCountdown((c) => (c !== null && c > 0 ? c - 1 : c));
        }, 1000);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          setRetryCountdown(null);
          // Retry is always silent — we don't want a parade of toasts.
          handleSave({ silent: true });
        }, delaySec * 1000);
      } else {
        // Out of automatic retries. Clear the countdown so the chip
        // switches back to "Save failed — retry" and waits for click.
        setRetryCountdown(null);
      }
    } else {
      isDirtyRef.current = false;
      retryAttemptRef.current = 0;
      clearRetryTimers();
      setSaveState('saved');
      setLastSavedAt(Date.now());
      if (!opts.silent) {
        toast({ title: 'Event saved' });
        setStatusText('Event saved.');
      }
    }
    setIsSaving(false);
  }, [eventId, eventName, city, eventDate, routes, pois, scoutedPois, logoUrl, brandingStyle, trackingStart, trackingEnd, toast, materializePoiImages, clearRetryTimers]);

  // ── Autosave ───────────────────────────────────────────────────────────
  // Mark dirty whenever editable state changes. The initialLoadCompleteRef
  // gate prevents the first load from flagging the event as dirty.
  useEffect(() => {
    if (!initialLoadCompleteRef.current) return;
    isDirtyRef.current = true;
    setSaveState('dirty');
    // A fresh edit means whatever retry was queued is stale — the
    // retry would have sent old state. Reset the attempt counter so
    // the new dirty cycle gets its full 3-strike budget.
    retryAttemptRef.current = 0;
    clearRetryTimers();
  }, [eventName, city, eventDate, routes, pois, scoutedPois, logoUrl, brandingStyle, clearRetryTimers]);

  // Tear down any pending retry timers on unmount so they don't fire
  // into a detached component and trigger a "setState on unmounted"
  // warning (or worse, a ghost network call).
  useEffect(() => () => clearRetryTimers(), [clearRetryTimers]);

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
  // Delete a POI with an Undo toast. Both the popover trash button and
  // the keyboard Delete/Backspace handler funnel through here so neither
  // can destroy work with a single click. Matches the Gmail / Notion
  // pattern — destructive, instantly reversible for 5s. The snapshot +
  // original index are captured inside a functional setState so the
  // callback is stable even when it's called from a stale closure
  // (e.g. the Mapbox popup built during an earlier render).
  const deletePoiWithUndo = useCallback((poiId: string) => {
    let snapshot: RoutePoi | null = null;
    let snapshotIndex = -1;
    setPois((prev) => {
      snapshotIndex = prev.findIndex((p) => p.id === poiId);
      if (snapshotIndex < 0) return prev;
      snapshot = prev[snapshotIndex];
      return prev.filter((p) => p.id !== poiId);
    });
    setSelectedPoiId((curr) => (curr === poiId ? null : curr));
    // Defer the toast a tick so the above state update flushes first —
    // prevents the "setState during render" warning that can fire when
    // deletePoiWithUndo is invoked from inside a React event inside a
    // Mapbox popup.
    setTimeout(() => {
      if (!snapshot) return;
      const restored: RoutePoi = snapshot;
      const restoredIndex = snapshotIndex;
      toast({
        title: 'Marker removed',
        description: restored.title || undefined,
        action: (
          <ToastAction
            altText="Undo delete"
            onClick={() => {
              setPois((prev) => {
                // Idempotent: if the same POI id is already back, skip.
                if (prev.some((p) => p.id === restored.id)) return prev;
                const next = [...prev];
                next.splice(Math.min(restoredIndex, next.length), 0, restored);
                return next;
              });
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    }, 0);
  }, [toast]);

  // Pre-publish validation: an event must have at least one route with
  // ≥2 waypoints before we expose it to the public. Without this, the
  // share flow surfaces a blank map to the organizer's audience at the
  // exact moment first impressions matter most. Unpublish (published →
  // draft) is always allowed so the organizer can yank a live event
  // regardless of its current content.
  const canPublish = useMemo(
    () => routes.some((r) => (r.waypoints?.length ?? 0) >= 2),
    [routes],
  );

  const handlePublish = useCallback(async () => {
    if (!eventId) return;
    logEvent('publish_clicked', eventId, { current_status: eventStatus });
    // Going live? Enforce validation. Unpublishing always allowed.
    if (eventStatus !== 'published' && !user?.email_confirmed_at) {
      toast({
        title: 'Verify your email to publish',
        description: 'Check your inbox for a confirmation link, then try again.',
        variant: 'destructive',
      });
      return;
    }
    if (eventStatus !== 'published' && !canPublish) {
      toast({
        title: 'Draw a route first',
        description: 'Draw a route with at least 2 points, then you can publish.',
        variant: 'destructive',
      });
      return;
    }
    setIsPublishing(true);
    // Save first, then publish
    const newStatus = eventStatus === 'published' ? 'draft' : 'published';
    const cleanPois = await materializePoiImages(pois);
    const { error } = await supabase.from('events')
      .update({
        name: eventName,
        city: city || null,
        event_date: eventDate || null,
        routes: JSON.parse(JSON.stringify(routes)),
        pois: JSON.parse(JSON.stringify(cleanPois)),
        scouted_pois: JSON.parse(JSON.stringify(scoutedPois)),
        route_count: routes.length,
        poi_count: cleanPois.length,
        status: newStatus,
        logo_url: logoUrl,
        branding_style: brandingStyle,
        tracking_start: trackingStart,
        tracking_end: trackingEnd,
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
        // Soft Pro upsell at the publish moment — only for free events.
        // Skip on first-ever publish so the activation dopamine isn't
        // interrupted. Show from the second publish onward.
        const hasPublishedBefore = localStorage.getItem('hereday_has_published');
        localStorage.setItem('hereday_has_published', '1');
        if (eventPlan === 'free' && hasPublishedBefore) {
          setTimeout(() => setUpgradeModalTrigger('publish'), 600);
        }
      } else {
        logEvent('event_unpublished', eventId);
        toast({ title: 'Event unpublished' });
      }
    }
    setIsPublishing(false);
  }, [eventId, eventName, city, eventDate, routes, pois, scoutedPois, eventStatus, eventSlug, toast, logoUrl, brandingStyle, trackingStart, trackingEnd, eventPlan, materializePoiImages]);

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

  const handleFinishRoute = useCallback(() => {
    if (!activeRouteId) return;
    const route = routes.find((r) => r.id === activeRouteId);
    if (!route || route.waypoints.length < 2) return;
    autoPlaceStartFinish(activeRouteId, route.waypoints);
    setFinishedRouteIds((prev) => new Set(prev).add(activeRouteId));
    logEvent('route_finished', eventId, {
      waypoint_count: route.waypoints.length,
      distance_mi: parseFloat(totalDistanceMiles(route.routeCoords).toFixed(2)),
      source: 'button',
    });
    setStatusText(`Route finished · ${totalDistanceMiles(route.routeCoords).toFixed(2)} mi — Start & Finish added`);
  }, [activeRouteId, routes, autoPlaceStartFinish, eventId]);

  const canFinishRoute = !!(activeRoute && activeRoute.waypoints.length >= 3 && !finishedRouteIds.has(activeRouteId));

  const isPaid = eventPlan === 'pro';
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
      setIsSnapping(true); isSnappingRef.current = true;
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
        setIsSnapping(false); isSnappingRef.current = false;
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
    // Cache route data for undo
    const cachedWaypoints = [...activeRoute.waypoints];
    const cachedCoords = [...activeRoute.routeCoords];
    const cachedSegmentCounts = activeRoute.segmentCoordCounts ? [...activeRoute.segmentCoordCounts] : undefined;
    const wasFinished = finishedRouteIds.has(activeRouteId);
    const clearedRouteId = activeRouteId;

    setRoutes((prev) =>
      prev.map((r) => (r.id === activeRouteId ? { ...r, waypoints: [], routeCoords: [], segmentCoordCounts: undefined } : r))
    );
    // Un-finish the route so the user can start drawing again
    setFinishedRouteIds((prev) => {
      const next = new Set(prev);
      next.delete(activeRouteId);
      return next;
    });
    setStatusText('Route cleared.');

    if (cachedWaypoints.length > 0) {
      toast({
        title: 'Route cleared',
        description: `${cachedWaypoints.length} waypoints removed`,
        action: (
          <ToastAction
            altText="Undo clear"
            onClick={() => {
              setRoutes((prev) =>
                prev.map((r) =>
                  r.id === clearedRouteId
                    ? { ...r, waypoints: cachedWaypoints, routeCoords: cachedCoords, segmentCoordCounts: cachedSegmentCounts }
                    : r
                )
              );
              if (wasFinished) {
                setFinishedRouteIds((prev) => new Set(prev).add(clearedRouteId));
              }
              setStatusText('Route restored.');
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    }
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
        // Prefer deleting a selected POI over clearing the active route —
        // matches the "click-to-select, Delete to remove" desktop editor
        // convention. Falls through to route clear if nothing is selected.
        if (selectedPoiId) {
          deletePoiWithUndo(selectedPoiId);
          setStatusText('Marker removed.');
          return;
        }
        clearActiveRoute();
        return;
      }
      if (e.key === 'Escape') {
        setPendingPoiType(null);
        setKeepPoiTypeArmed(false);
        setSelectedPoiId(null);
        return;
      }
      if (e.key === '?') {
        setShortcutsOpen(true);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, undoLastWaypoint, clearActiveRoute, selectedPoiId]);

  const activeDistance = activeRoute ? totalDistanceMiles(activeRoute.routeCoords) : 0;

  // ── Scout review handlers ──────────────────────────────────────────────
  // Accept: strip the scout-specific fields and move the POI into the
  // event's regular pois array. Reject: drop it. Both mutations flow
  // through the existing autosave path — no new endpoint.
  const handleAcceptScoutedPoi = useCallback((poi: ScoutedPoiRecord) => {
    const { scouted_at: _sa, scouted_via_token: _svt, ...cleanPoi } = poi;
    void _sa; void _svt;
    setPois((prev) => [...prev, cleanPoi as RoutePoi]);
    setScoutedPois((prev) => prev.filter((p) => p.id !== poi.id));
    logEvent('scout_poi_accepted', eventId, { type: poi.type });
  }, [eventId]);

  const handleRejectScoutedPoi = useCallback((poi: ScoutedPoiRecord) => {
    setScoutedPois((prev) => prev.filter((p) => p.id !== poi.id));
    logEvent('scout_poi_rejected', eventId, { type: poi.type });
  }, [eventId]);

  const handleScoutedFlyTo = useCallback((coord: [number, number]) => {
    // Offset the target leftward so the POI lands in the visible map
    // area instead of being covered by the review panel on the right.
    mapRef.current?.flyTo({
      center: coord,
      zoom: 16,
      duration: 800,
      offset: [-176, 0],
    });
  }, []);

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
    return (
      <MobileEditorGate
        onBack={() => navigate('/dashboard')}
        editorUrl={window.location.href}
        userEmail={user?.email ?? undefined}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <EditorTour active={tourActive} onEnd={() => setTourActive(false)} />
      <KeyboardShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <UpgradeModal
        open={upgradeModalTrigger !== null}
        onClose={() => setUpgradeModalTrigger(null)}
        trigger={upgradeModalTrigger ?? 'routes'}
        eventId={eventId}
        onBeforeRedirect={() => handleSave({ silent: true })}
      />
      {eventId && user && (
        <ScoutLinkDialog
          open={scoutLinkDialogOpen}
          onOpenChange={setScoutLinkDialogOpen}
          eventId={eventId}
          userId={user.id}
        />
      )}
      <ScoutReviewPanel
        open={scoutReviewPanelOpen}
        onOpenChange={setScoutReviewPanelOpen}
        scoutedPois={scoutedPois}
        onAccept={handleAcceptScoutedPoi}
        onReject={handleRejectScoutedPoi}
        onFlyTo={handleScoutedFlyTo}
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
        retryCountdown={retryCountdown}
        onBack={() => navigate('/dashboard')}
        onUndo={undoLastWaypoint}
        onClearRoute={clearActiveRoute}
        onLocationSelect={(center) => {
          mapRef.current?.flyTo({ center, zoom: 14, duration: 1500 });
        }}
        onHelp={() => setTourActive(true)}
        onScoutLink={() => setScoutLinkDialogOpen(true)}
        onPublish={handlePublish}
        onFinishRoute={handleFinishRoute}
        canFinishRoute={canFinishRoute}
        isPublishing={isPublishing}
        isPublished={eventStatus === 'published'}
        canPublish={canPublish}
        pendingScoutedCount={scoutedPois.length}
        publicUrl={eventSlug ? `${window.location.origin}/event/${eventSlug}` : undefined}
        eventId={eventId}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      <ScoutReviewBanner
        count={scoutedPois.length}
        onReview={() => setScoutReviewPanelOpen(true)}
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
              keepPoiTypeArmed={keepPoiTypeArmed}
              setKeepPoiTypeArmed={setKeepPoiTypeArmed}
              pois={pois}
              setPois={setPois}
              selectedBasemap={selectedBasemap}
              setSelectedBasemap={setSelectedBasemap}
              poiSnapToRoute={poiSnapToRoute}
              setPoiSnapToRoute={setPoiSnapToRoute}
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
              hasFinishedRoute={finishedRouteIds.size > 0}
              isPublished={eventStatus === 'published'}
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

          <MapBottomSheet
            routes={routes}
            pois={pois}
            hiddenRouteIds={hiddenRouteIdsForLegend}
            onToggleRoute={toggleRouteVisible}
            highlightedPoiType={highlightedPoiType}
            onHighlightPoiType={setHighlightedPoiType}
            activeRoute={activeRoute}
            mapboxToken={mapboxToken}
            routeColor={activeRoute?.color ?? '#2563eb'}
            onHoverPoint={handleElevationHover}
            eventDate={eventDate || null}
            weatherCoord={
              activeRoute?.routeCoords?.[0]
                ? [activeRoute.routeCoords[0][0], activeRoute.routeCoords[0][1]]
                : null
            }
            eventName={eventName}
            viewMode="editor"
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
