import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import type { Coord, EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { totalDistanceMiles, getSnappedRoute, getMileMarkers, ROUTE_COLORS, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone, POI_TYPES } from '@/lib/pois';
import EditorTopBar from '@/components/editor/EditorTopBar';
import RouteBuilderToolbar from '@/components/editor/RouteBuilderToolbar';
import ElevationProfile from '@/components/editor/ElevationProfile';
import EditorWelcomeModal from '@/components/editor/EditorWelcomeModal';
import EditorTour from '@/components/editor/EditorTour';
import KeyboardShortcutsOverlay from '@/components/editor/KeyboardShortcutsOverlay';

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
  const elevMarkerRef = useRef<mapboxgl.Marker | null>(null);


  const [eventName, setEventName] = useState('Untitled Event');
  const [eventDate, setEventDate] = useState('');
  const [city, setCity] = useState('');
  const [routes, setRoutes] = useState<EventRoute[]>([makeRoute('5K Route', ROUTE_COLORS[0])]);
  const [activeRouteId, setActiveRouteId] = useState('');
  const [pois, setPois] = useState<RoutePoi[]>([]);
  const [pendingPoiType, setPendingPoiType] = useState<PoiType | null>(null);
  const [snapToRoads, setSnapToRoads] = useState(true);
  const [isSnapping, setIsSnapping] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [statusText, setStatusText] = useState('Click on the map to start building your route.');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBasemap, setSelectedBasemap] = useState('light');
  // sidebarOpen removed - using floating panels now
  const [mapboxToken, setMapboxToken] = useState(MAPBOX_TOKEN_FALLBACK);
  const [tourActive, setTourActive] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [eventStatus, setEventStatus] = useState('draft');
  const [eventSlug, setEventSlug] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [finishedRouteIds, setFinishedRouteIds] = useState<Set<string>>(new Set());
  const [highlightedPoiType, setHighlightedPoiType] = useState<PoiType | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brandingStyle, setBrandingStyle] = useState<'none' | 'corner' | 'banner' | 'both'>('none');
  const [isPaid, setIsPaid] = useState(false);
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
      const el = document.createElement('div');
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.borderRadius = '50%';
      el.style.border = '2.5px solid white';
      el.style.backgroundColor = activeRoute?.color ?? '#2563eb';
      el.style.boxShadow = '0 0 6px rgba(0,0,0,0.4)';
      el.style.pointerEvents = 'none';
      elevMarkerRef.current = new mapboxgl.Marker({ element: el })
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

        // Collect all route coordinates for initial map bounds
        const allCoords = loadedRoutes.flatMap((r) => r.routeCoords ?? []);
        initialBoundsRef.current = { coords: allCoords, city: data.city ?? '' };

        setEventStatus(data.status ?? 'draft');
        setEventSlug(data.slug ?? null);
        setLogoUrl(data.logo_url ?? null);
        setBrandingStyle((data.branding_style as 'none' | 'corner' | 'banner' | 'both') ?? 'none');
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
    map.once('load', () => setMapReady(true));

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
      setMapReady(false);
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

      if (!activeRouteId || finishedRouteIds.has(activeRouteId)) return;

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
        
        popupContent.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div style="width:40px;height:40px;border-radius:50%;background:${tone.dot}15;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;border:2px solid ${tone.dot}30;">${tone.emoji}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">${tone.label} Marker</div>
              <input data-field="title" value="${escTitle}" placeholder="${tone.label}" style="width:100%;padding:0;border:none;font-size:15px;font-weight:700;color:#1e293b;outline:none;background:transparent;font-family:inherit;" />
            </div>
          </div>
          <div style="border-top:1px solid #f1f5f9;padding-top:12px;">
            <label style="font-size:11px;font-weight:600;color:#64748b;display:block;margin-bottom:4px;">Description</label>
            <textarea data-field="description" placeholder="Add notes about this marker location…" rows="2" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;resize:none;outline:none;box-sizing:border-box;font-family:inherit;color:#334155;">${escDesc}</textarea>
          </div>
          <div style="margin-top:10px;">
            <label style="font-size:11px;font-weight:600;color:#64748b;display:flex;align-items:center;gap:4px;margin-bottom:4px;">📷 Photo</label>
            <div data-photo-area style="position:relative;">
              <img data-photo-preview src="${existingImage}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:6px;display:${existingImage ? 'block' : 'none'};" />
              <div style="display:flex;gap:6px;">
                <label style="flex:1;padding:8px;border:1px dashed #cbd5e1;border-radius:8px;font-size:12px;color:#64748b;cursor:pointer;text-align:center;font-family:inherit;transition:background 0.15s;display:flex;align-items:center;justify-content:center;gap:4px;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                  📎 ${existingImage ? 'Change photo' : 'Attach photo'}
                  <input data-field="photoFile" type="file" accept="image/*" style="display:none;" />
                </label>
                <button data-action="removePhoto" style="padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;color:#ef4444;cursor:pointer;background:none;font-family:inherit;display:${existingImage ? 'block' : 'none'};">✕</button>
              </div>
            </div>
          </div>
          ${hasWebLink ? `
          <div style="margin-top:10px;">
            <label style="font-size:11px;font-weight:600;color:#64748b;display:flex;align-items:center;gap:4px;margin-bottom:4px;">🔗 Web Link</label>
            <input data-field="webLink" value="${escLink}" placeholder="https://example.com" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;outline:none;box-sizing:border-box;font-family:inherit;color:#334155;" />
          </div>
          ` : ''}
          <div style="margin-top:10px;padding:6px 10px;background:#f8fafc;border-radius:8px;font-size:11px;color:#94a3b8;font-family:monospace;">${coordStr}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid #f1f5f9;">
            <button data-action="remove" style="background:none;border:none;color:#ef4444;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;padding:4px 0;font-family:inherit;">🗑 Remove marker</button>
            <button data-action="save" style="padding:6px 18px;background:hsl(var(--primary));color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Done</button>
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
          let pendingImageDataUrl: string | undefined = poi.imageDataUrl;

          fileInput?.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              pendingImageDataUrl = reader.result as string;
              if (photoPreview) {
                photoPreview.src = pendingImageDataUrl;
                photoPreview.style.display = 'block';
              }
              if (removePhotoBtn) removePhotoBtn.style.display = 'block';
            };
            reader.readAsDataURL(file);
          });

          removePhotoBtn?.addEventListener('click', () => {
            pendingImageDataUrl = undefined;
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
              prev.map((p) =>
                p.id === poi.id
                  ? { ...p, title: t, description: d, imageDataUrl: pendingImageDataUrl, imageUrl: undefined, webLink: link || undefined }
                  : p
              )
            );
            popup.remove();
          });

          removeBtn?.addEventListener('click', () => {
            setPois((prev) => prev.filter((p) => p.id !== poi.id));
            popup.remove();
          });
        });

        const marker = new mapboxgl.Marker({ element: el, draggable: true })
          .setLngLat(poi.coordinates)
          .setPopup(popup)
          .addTo(map);
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat();
          setPois((prev) =>
            prev.map((p) =>
              p.id === poi.id
                ? { ...p, coordinates: [lngLat.lng, lngLat.lat] as Coord }
                : p
            )
          );
        });
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
        logo_url: logoUrl,
        branding_style: brandingStyle,
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
  }, [eventId, eventName, city, eventDate, routes, pois, logoUrl, brandingStyle, toast]);
  const handlePublish = useCallback(async () => {
    if (!eventId) return;
    setIsPublishing(true);
    // Save first, then publish
    const newStatus = eventStatus === 'published' ? 'draft' : 'published';
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
      toast({ title: newStatus === 'published' ? 'Event published!' : 'Event unpublished' });
    }
    setIsPublishing(false);
  }, [eventId, eventName, city, eventDate, routes, pois, eventStatus, eventSlug, toast]);

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

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading editor…</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <EditorWelcomeModal onStartTour={() => setTourActive(true)} />
      <EditorTour active={tourActive} onEnd={() => setTourActive(false)} />
      <KeyboardShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <EditorTopBar
        eventName={eventName}
        setEventName={setEventName}
        city={city}
        setCity={setCity}
        eventDate={eventDate}
        setEventDate={setEventDate}
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
        onHelp={() => setTourActive(true)}
        onPublish={handlePublish}
        isPublishing={isPublishing}
        isPublished={eventStatus === 'published'}
        publicUrl={eventSlug ? `${window.location.origin}/event/${eventSlug}` : undefined}
        logoUrl={logoUrl}
        brandingStyle={brandingStyle}
        onLogoChange={(url) => {
          setLogoUrl(url);
          // Auto-save branding to DB
          if (eventId) {
            supabase.from('events').update({ logo_url: url }).eq('id', eventId);
          }
        }}
        onBrandingStyleChange={(style) => {
          setBrandingStyle(style);
          if (eventId) {
            supabase.from('events').update({ branding_style: style }).eq('id', eventId);
          }
        }}
        isPaid={isPaid}
        eventId={eventId || ''}
        userId={user?.id || ''}
      />

      <div className="flex-1 relative" data-tour="map-area">
        <div ref={mapContainerRef} className="w-full h-full" />

        <RouteBuilderToolbar
          routes={routes}
          activeRouteId={activeRouteId}
          setActiveRouteId={setActiveRouteId}
          setRoutes={setRoutes}
          onAddRoute={addRoute}
          onDeleteRoute={deleteRoute}
          snapToRoads={snapToRoads}
          setSnapToRoads={setSnapToRoads}
          pendingPoiType={pendingPoiType}
          setPendingPoiType={setPendingPoiType}
          pois={pois}
          setPois={setPois}
          selectedBasemap={selectedBasemap}
          setSelectedBasemap={setSelectedBasemap}
          highlightedPoiType={highlightedPoiType}
          setHighlightedPoiType={setHighlightedPoiType}
        />

        <ElevationProfile
          route={activeRoute}
          mapboxToken={mapboxToken}
          routeColor={activeRoute?.color ?? '#2563eb'}
          onHoverPoint={handleElevationHover}
        />

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
  );
};

export default RouteEditor;
