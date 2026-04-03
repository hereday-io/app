import { useState, useRef, useMemo } from 'react';
import { Pencil, Plus, Trash2, Eye, EyeOff, Layers, GripVertical } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { totalDistanceMiles, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone, POI_TYPES } from '@/lib/pois';

import basemapStreets from '@/assets/basemap-streets.jpg';
import basemapOutdoors from '@/assets/basemap-outdoors.jpg';
import basemapLight from '@/assets/basemap-light.jpg';
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
  // Route management
  routes: EventRoute[];
  activeRouteId: string;
  setActiveRouteId: (id: string) => void;
  setRoutes: React.Dispatch<React.SetStateAction<EventRoute[]>>;
  onAddRoute: () => void;
  onDeleteRoute: (id: string) => void;
  // Snap
  snapToRoads: boolean;
  setSnapToRoads: (v: boolean) => void;
  // POI
  pendingPoiType: PoiType | null;
  setPendingPoiType: (t: PoiType | null) => void;
  pois: RoutePoi[];
  setPois: React.Dispatch<React.SetStateAction<RoutePoi[]>>;
  // Basemap
  selectedBasemap: string;
  setSelectedBasemap: (id: string) => void;
  // POI snap
  poiSnapToRoute: boolean;
  setPoiSnapToRoute: (v: boolean) => void;
  // Highlight
  highlightedPoiType: PoiType | null;
  setHighlightedPoiType: (t: PoiType | null) => void;
}

type FlyoutType = 'routes' | 'poi' | 'basemap' | null;

const RouteBuilderToolbar = ({
  routes, activeRouteId, setActiveRouteId, setRoutes,
  onAddRoute, onDeleteRoute,
  snapToRoads, setSnapToRoads,
  pendingPoiType, setPendingPoiType,
  pois, setPois,
  selectedBasemap, setSelectedBasemap,
  poiSnapToRoute, setPoiSnapToRoute,
  highlightedPoiType, setHighlightedPoiType,
}: RouteBuilderToolbarProps) => {
  const [openFlyout, setOpenFlyout] = useState<FlyoutType>(null);
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [dragGroup, setDragGroup] = useState<'routes' | 'pois' | null>(null);

  const toggle = (flyout: FlyoutType) => setOpenFlyout((prev) => (prev === flyout ? null : flyout));

  const handleDragStart = (group: 'routes' | 'pois', idx: number) => {
    dragIdx.current = idx;
    setDragGroup(group);
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = (group: 'routes' | 'pois', idx: number) => {
    if (dragIdx.current === null || dragGroup !== group) return;
    if (dragIdx.current !== idx) {
      if (group === 'routes') setRoutes((prev) => reorder(prev, dragIdx.current!, idx));
      else setPois((prev) => reorder(prev, dragIdx.current!, idx));
    }
    dragIdx.current = null;
    setDragOverIdx(null);
    setDragGroup(null);
  };
  const handleDragEnd = () => {
    dragIdx.current = null;
    setDragOverIdx(null);
    setDragGroup(null);
  };

  const manualPois = pois.filter((p) => !p.id.startsWith('auto-start-') && !p.id.startsWith('auto-finish-'));

  const btnBase = 'w-10 h-10 rounded-lg border shadow-lg flex items-center justify-center transition-colors';
  const btnDefault = `${btnBase} bg-card/95 backdrop-blur text-foreground border-border hover:bg-secondary`;
  const btnActive = `${btnBase} bg-primary text-primary-foreground border-primary`;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2" data-tour="snap-toggle">
        {/* Routes tool */}
        <div className="relative" data-tour="sidebar-routes">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => toggle('routes')} className={openFlyout === 'routes' ? btnActive : btnDefault}>
                <Pencil className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Routes</TooltipContent>
          </Tooltip>

          {openFlyout === 'routes' && (
            <div className="absolute left-full top-0 ml-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg w-72 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-semibold text-foreground">Routes</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onAddRoute(); }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Add route"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="p-1.5 space-y-1 max-h-80 overflow-y-auto">
                {routes.map((route, idx) => {
                  const dist = totalDistanceMiles(route.routeCoords);
                  const isActive = route.id === activeRouteId;
                  const isDragOver = dragGroup === 'routes' && dragOverIdx === idx;
                  return (
                    <div
                      key={route.id}
                      draggable
                      onDragStart={() => handleDragStart('routes', idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={() => handleDrop('routes', idx)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setActiveRouteId(route.id)}
                      className={`flex items-center gap-2 px-2 py-2.5 rounded-lg cursor-pointer transition-colors ${
                        isActive ? 'bg-primary/10 border border-primary/20' : 'hover:bg-secondary'
                      } ${isDragOver ? 'border-t-2 border-t-primary' : ''}`}
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
                      <input
                        type="color"
                        value={route.color}
                        onChange={(e) =>
                          setRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, color: e.target.value } : r)))
                        }
                        onClick={(e) => e.stopPropagation()}
                        className="w-5 h-5 rounded-sm border-0 cursor-pointer p-0 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <input
                          value={route.name}
                          onChange={(e) =>
                            setRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, name: e.target.value } : r)))
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="bg-transparent w-full text-xs font-medium outline-none"
                        />
                        <p className="text-[10px] text-muted-foreground mt-0.5">{dist.toFixed(2)} mi</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, visible: !r.visible } : r)));
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

              {/* Snap toggle inside routes flyout */}
              <div className="px-3 py-2 border-t border-border">
                <button
                  onClick={() => setSnapToRoads(!snapToRoads)}
                  className={`w-full text-xs px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-2 ${
                    snapToRoads
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-secondary text-muted-foreground'
                  }`}
                >
                  <span>{snapToRoads ? '🛤️' : '📐'}</span>
                  {snapToRoads ? 'Snap to roads' : 'Freeform drawing'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* POI tool */}
        <div className="relative" data-tour="poi-section">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => toggle('poi')}
                className={pendingPoiType || openFlyout === 'poi' ? btnActive : btnDefault}
              >
                {pendingPoiType ? poiTone(pendingPoiType).emoji : '📍'}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Points of interest</TooltipContent>
          </Tooltip>

          {openFlyout === 'poi' && (
            <div className="absolute left-full top-0 ml-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg w-64 overflow-hidden">
              <div className="px-3 py-2 border-b border-border">
                <span className="text-xs font-semibold text-foreground">Place a marker</span>
              </div>
              <div className="p-1.5 space-y-0.5">
                {POI_TYPES.map((type) => {
                  const tone = poiTone(type);
                  const isActive = pendingPoiType === type;
                  return (
                    <button
                      key={type}
                      onClick={() => {
                        setPendingPoiType(isActive ? null : type);
                        setOpenFlyout(null);
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-md flex items-center gap-2.5 transition-colors ${
                        isActive ? 'bg-primary/10 text-primary' : 'hover:bg-secondary text-foreground'
                      }`}
                    >
                      <span className="text-base flex-shrink-0">{tone.emoji}</span>
                      <div className="min-w-0">
                        <p className={`text-sm leading-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>{tone.label}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">{tone.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Placed POIs summary by type */}
              {manualPois.length > 0 && (() => {
                const grouped = manualPois.reduce<Record<string, number>>((acc, p) => {
                  acc[p.type] = (acc[p.type] || 0) + 1;
                  return acc;
                }, {});
                const types = Object.keys(grouped) as PoiType[];
                return (
                  <div className="border-t border-border px-1.5 py-1.5 space-y-0.5">
                    <p className="text-[10px] font-semibold text-muted-foreground px-2 py-1">Placed ({manualPois.length})</p>
                    {types.map((type) => {
                      const tone = poiTone(type);
                      const isHighlighted = highlightedPoiType === type;
                      return (
                        <button
                          key={type}
                          onClick={() => setHighlightedPoiType(isHighlighted ? null : type)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                            isHighlighted ? 'bg-primary/10 text-primary' : 'hover:bg-secondary text-foreground'
                          }`}
                        >
                          <span className="text-sm">{tone.emoji}</span>
                          <span className="flex-1 text-left font-medium">{tone.label}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            isHighlighted ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                          }`}>{grouped[type]}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* POI snap-to-route toggle */}
              <div className="border-t border-border px-3 py-2">
                <button
                  onClick={() => setPoiSnapToRoute(!poiSnapToRoute)}
                  className={`w-full text-xs px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-2 ${
                    poiSnapToRoute
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-secondary text-muted-foreground'
                  }`}
                >
                  <span>{poiSnapToRoute ? '🧲' : '📌'}</span>
                  {poiSnapToRoute ? 'Snap POIs to route' : 'Free placement'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Basemap picker */}
        <div className="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => toggle('basemap')} className={openFlyout === 'basemap' ? btnActive : btnDefault}>
                <Layers className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Basemap</TooltipContent>
          </Tooltip>

          {openFlyout === 'basemap' && (
            <div className="absolute left-full top-0 ml-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg p-2 w-44">
              <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">Basemap</p>
              <div className="grid grid-cols-2 gap-1.5">
                {BASEMAP_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { setSelectedBasemap(opt.id); setOpenFlyout(null); }}
                    className={`rounded-lg overflow-hidden border-2 transition-colors ${
                      selectedBasemap === opt.id
                        ? 'border-primary ring-1 ring-primary/30'
                        : 'border-transparent hover:border-border'
                    }`}
                  >
                    <img
                      src={BASEMAP_THUMBS[opt.id]}
                      alt={opt.label}
                      className="w-full h-14 object-cover"
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
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default RouteBuilderToolbar;
