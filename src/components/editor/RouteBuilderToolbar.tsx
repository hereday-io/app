import { useState, useRef } from 'react';
import {
  Plus, Trash2, Eye, EyeOff, GripVertical, Crown,
  PenLine, CheckCircle2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { PAYWALL_LIMITS } from '@/hooks/usePaywall';
import type { EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { totalDistanceMiles, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone, poisByCategory, POI_CATEGORIES, POI_CATEGORY_ORDER } from '@/lib/pois';
import BrandingPanel from '@/components/editor/BrandingPanel';

import basemapStreets  from '@/assets/basemap-streets.jpg';
import basemapOutdoors from '@/assets/basemap-outdoors.jpg';
import basemapLight    from '@/assets/basemap-light.jpg';
import basemapSatellite from '@/assets/basemap-satellite.jpg';

const BASEMAP_THUMBS: Record<string, string> = {
  streets: basemapStreets,
  outdoors: basemapOutdoors,
  light: basemapLight,
  satellite: basemapSatellite,
};

function reorder<T>(list: T[], from: number, to: number): T[] {
  const result = [...list];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

interface RouteBuilderToolbarProps {
  routes: EventRoute[];
  activeRouteId: string;
  setActiveRouteId: (id: string) => void;
  setRoutes: React.Dispatch<React.SetStateAction<EventRoute[]>>;
  onAddRoute: () => void;
  onDeleteRoute: (id: string) => void;
  pendingPoiType: PoiType | null;
  setPendingPoiType: (t: PoiType | null) => void;
  keepPoiTypeArmed: boolean;
  setKeepPoiTypeArmed: (v: boolean) => void;
  pois: RoutePoi[];
  setPois: React.Dispatch<React.SetStateAction<RoutePoi[]>>;
  selectedBasemap: string;
  setSelectedBasemap: (id: string) => void;
  poiSnapToRoute: boolean;
  setPoiSnapToRoute: (v: boolean) => void;
  isPaid: boolean;
  finishedRouteIds: Set<string>;
  onResumeRoute: (id: string) => void;
  // Branding
  logoUrl: string | null;
  brandingStyle: 'none' | 'corner' | 'banner' | 'both';
  onLogoChange: (url: string | null) => void;
  onBrandingStyleChange: (style: 'none' | 'corner' | 'banner' | 'both') => void;
  eventId: string;
  userId: string;
}

// ── Collapsible section wrapper ───────────────────────────────────────────────
const Section = ({
  title, children, defaultOpen = true, 'data-tour': dataTour,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  'data-tour'?: string;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border" data-tour={dataTour}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:bg-secondary/50 transition-colors"
      >
        {title}
        {open
          ? <ChevronDown className="h-3.5 w-3.5" />
          : <ChevronRight className="h-3.5 w-3.5" />
        }
      </button>
      {open && children}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const RouteBuilderToolbar = ({
  routes, activeRouteId, setActiveRouteId, setRoutes,
  onAddRoute, onDeleteRoute,
  pendingPoiType, setPendingPoiType,
  keepPoiTypeArmed, setKeepPoiTypeArmed,
  pois, setPois,
  selectedBasemap, setSelectedBasemap,
  poiSnapToRoute, setPoiSnapToRoute,
  isPaid,
  finishedRouteIds, onResumeRoute,
  logoUrl, brandingStyle, onLogoChange, onBrandingStyleChange,
  eventId, userId,
}: RouteBuilderToolbarProps) => {
  const dragIdx   = useRef<number | null>(null);
  const dragGroup = useRef<'routes' | 'pois' | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragStart = (group: 'routes' | 'pois', idx: number) => {
    dragIdx.current   = idx;
    dragGroup.current = group;
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = (group: 'routes' | 'pois', idx: number) => {
    if (dragIdx.current === null || dragGroup.current !== group) return;
    if (dragIdx.current !== idx) {
      if (group === 'routes') setRoutes((prev) => reorder(prev, dragIdx.current!, idx));
      else setPois((prev) => reorder(prev, dragIdx.current!, idx));
    }
    dragIdx.current = null;
    setDragOverIdx(null);
    dragGroup.current = null;
  };
  const handleDragEnd = () => {
    dragIdx.current = null;
    setDragOverIdx(null);
    dragGroup.current = null;
  };

  return (
    <div className="h-full flex flex-col bg-card border-r border-border overflow-hidden" data-tour="snap-toggle">

      {/* ── Scrollable body ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Routes ────────────────────────────────────────────────────── */}
        <Section title="Routes" defaultOpen data-tour="sidebar-routes">

          {/* Route list */}
          <div className="px-1.5 pb-2 space-y-0.5">
            {routes.map((route, idx) => {
              const dist     = totalDistanceMiles(route.routeCoords);
              const isActive   = route.id === activeRouteId;
              const isFinished = finishedRouteIds.has(route.id);
              const isDragOver = dragGroup.current === 'routes' && dragOverIdx === idx;

              return (
                <div
                  key={route.id}
                  draggable
                  onDragStart={() => handleDragStart('routes', idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop('routes', idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => setActiveRouteId(route.id)}
                  className={`flex items-center gap-2 px-2.5 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    isActive ? 'bg-primary/10 border border-primary/20' : 'hover:bg-secondary'
                  } ${isDragOver ? 'border-t-2 border-t-primary' : ''}`}
                >
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />

                  <input
                    type="color"
                    value={route.color}
                    onChange={(e) =>
                      setRoutes((prev) =>
                        prev.map((r) => (r.id === route.id ? { ...r, color: e.target.value } : r))
                      )
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="w-5 h-5 rounded border-0 cursor-pointer p-0 shrink-0"
                  />

                  <div className="flex-1 min-w-0">
                    <input
                      value={route.name}
                      onChange={(e) =>
                        setRoutes((prev) =>
                          prev.map((r) => (r.id === route.id ? { ...r, name: e.target.value } : r))
                        )
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="bg-transparent w-full text-sm font-medium outline-none text-foreground"
                    />
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">{dist.toFixed(2)} mi</span>
                      {isFinished && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onResumeRoute(route.id); }}
                          className="text-[11px] text-primary hover:underline font-medium"
                        >
                          · Resume
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Status indicator */}
                  <div className="shrink-0">
                    {isFinished
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      : isActive
                        ? <PenLine className="h-3.5 w-3.5 text-primary" />
                        : null
                    }
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRoutes((prev) =>
                        prev.map((r) => (r.id === route.id ? { ...r, visible: !r.visible } : r))
                      );
                    }}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {route.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>

                  {routes.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteRoute(route.id); }}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add route */}
          <div className="px-3 pb-3">
            <button
              onClick={onAddRoute}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title={!isPaid && routes.length >= PAYWALL_LIMITS.routes ? 'Free plan: 3 routes. Upgrade for more' : 'Add route'}
            >
              {!isPaid && routes.length >= PAYWALL_LIMITS.routes
                ? <Crown className="h-3.5 w-3.5 text-amber-500" />
                : <Plus className="h-3.5 w-3.5" />
              }
              Add route
            </button>
          </div>
        </Section>

        {/* ── Places ────────────────────────────────────────────────────── */}
        <Section title="Places" defaultOpen={!!pendingPoiType} data-tour="poi-section">

          {/* Snap to route toggle */}
          <div className="px-3 pb-2">
            <button
              onClick={() => setPoiSnapToRoute(!poiSnapToRoute)}
              className={`flex items-center gap-2 w-full text-xs px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                poiSnapToRoute
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              <span className="text-sm">{poiSnapToRoute ? '🧲' : '📌'}</span>
              {poiSnapToRoute ? 'Snap to nearest route' : 'Place anywhere'}
            </button>
          </div>

          {/* Grouped POI picker — one entry per type, organized into
              category sections. Shift-click to keep the type armed for
              batch placement; Esc (handled in RouteEditor) disarms. */}
          <div className="px-1.5 pb-2">
            {POI_CATEGORY_ORDER.map((cat) => {
              const types = poisByCategory()[cat];
              if (types.length === 0) return null;
              return (
                <div key={cat} className="mb-1.5 last:mb-0">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                    {POI_CATEGORIES[cat].label}
                  </p>
                  <div className="space-y-0.5">
                    {types.map((type) => {
                      const tone     = poiTone(type);
                      const isActive = pendingPoiType === type;
                      return (
                        <button
                          key={type}
                          title={`${tone.description}${'\n'}Shift-click to place multiple`}
                          onClick={(e) => {
                            if (isActive) {
                              setPendingPoiType(null);
                              setKeepPoiTypeArmed(false);
                              return;
                            }
                            setKeepPoiTypeArmed(e.shiftKey);
                            setPendingPoiType(type);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center gap-2.5 text-sm transition-colors ${
                            isActive ? 'bg-primary/10 text-primary' : 'hover:bg-secondary text-foreground'
                          }`}
                        >
                          <span className="text-base shrink-0">{tone.emoji}</span>
                          <span className={`leading-tight truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
                            {tone.label}
                          </span>
                          {isActive && keepPoiTypeArmed && (
                            <span className="ml-auto text-[9px] uppercase tracking-wider font-semibold text-primary/80">
                              batch
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

        </Section>

        {/* ── Branding ──────────────────────────────────────────────────── */}
        <Section title="Branding" defaultOpen={false}>
          <BrandingPanel
            logoUrl={logoUrl}
            brandingStyle={brandingStyle}
            onLogoChange={onLogoChange}
            onStyleChange={onBrandingStyleChange}
            isPaid={isPaid}
            eventId={eventId}
            userId={userId}
          />
        </Section>

        {/* ── Basemap ───────────────────────────────────────────────────── */}
        <Section title="Basemap" defaultOpen={false}>
          <div className="px-3 pb-3">
            <div className="grid grid-cols-2 gap-1.5">
              {BASEMAP_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setSelectedBasemap(opt.id)}
                  className={`rounded-lg overflow-hidden border-2 transition-colors ${
                    selectedBasemap === opt.id
                      ? 'border-primary ring-1 ring-primary/30'
                      : 'border-transparent hover:border-border'
                  }`}
                >
                  <img
                    src={BASEMAP_THUMBS[opt.id]}
                    alt={opt.label}
                    className="w-full h-12 object-cover"
                    loading="lazy"
                  />
                  <span className={`block text-[10px] py-0.5 text-center ${
                    selectedBasemap === opt.id ? 'text-primary font-semibold' : 'text-foreground'
                  }`}>
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Section>

      </div>
    </div>
  );
};

export default RouteBuilderToolbar;
