import { useState, useRef } from 'react';
import { Plus, Trash2, Eye, EyeOff, Layers, ChevronDown, ChevronRight, X, GripVertical } from 'lucide-react';
import type { EventRoute, RoutePoi } from '@/types/mapEditor';
import { totalDistanceMiles } from '@/lib/geo';
import { poiTone } from '@/lib/pois';

interface LayersPanelProps {
  routes: EventRoute[];
  activeRouteId: string;
  setActiveRouteId: (id: string) => void;
  setRoutes: React.Dispatch<React.SetStateAction<EventRoute[]>>;
  onAddRoute: () => void;
  onDeleteRoute: (id: string) => void;
  pois: RoutePoi[];
  setPois: React.Dispatch<React.SetStateAction<RoutePoi[]>>;
  activeDistance: number;
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const result = [...list];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

const LayersPanel = ({
  routes, activeRouteId, setActiveRouteId, setRoutes,
  onAddRoute, onDeleteRoute,
  pois, setPois,
  activeDistance,
  selectedBasemap, setSelectedBasemap,
}: LayersPanelProps) => {
  const [open, setOpen] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(true);
  const [poisOpen, setPoisOpen] = useState(true);
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [dragGroup, setDragGroup] = useState<'routes' | 'pois' | null>(null);

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
    const from = dragIdx.current;
    if (from !== idx) {
      if (group === 'routes') {
        setRoutes((prev) => reorder(prev, from, idx));
      } else {
        setPois((prev) => reorder(prev, from, idx));
      }
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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-4 right-14 z-10 w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg flex items-center justify-center hover:bg-secondary transition-colors"
        title="Layers"
      >
        <Layers className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="absolute top-4 right-14 z-10 w-72 max-h-[calc(100%-6rem)] overflow-y-auto rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg" data-tour="sidebar-routes">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Layers</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-2 space-y-1">
        {/* Routes section */}
        <div>
          <button
            onClick={() => setRoutesOpen((v) => !v)}
            className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <span>Routes</span>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onAddRoute(); }}
                className="hover:text-foreground"
                title="Add route"
              >
                <Plus className="h-3 w-3" />
              </button>
              {routesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </div>
          </button>

          {routesOpen && (
            <div className="space-y-0.5">
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
                    className={`flex items-center gap-1.5 px-1 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
                      isActive ? 'bg-primary/10 border border-primary/20' : 'hover:bg-secondary'
                    } ${isDragOver ? 'border-t-2 border-t-primary' : ''}`}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
                    <input
                      type="color"
                      value={route.color}
                      onChange={(e) =>
                        setRoutes((prev) =>
                          prev.map((r) => (r.id === route.id ? { ...r, color: e.target.value } : r))
                        )
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded-sm border-0 cursor-pointer p-0"
                    />
                    <input
                      value={route.name}
                      onChange={(e) =>
                        setRoutes((prev) =>
                          prev.map((r) => (r.id === route.id ? { ...r, name: e.target.value } : r))
                        )
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="bg-transparent flex-1 text-xs font-medium outline-none min-w-0"
                    />
                    <span className="text-[10px] text-muted-foreground shrink-0">{dist.toFixed(2)} mi</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRoutes((prev) =>
                          prev.map((r) => (r.id === route.id ? { ...r, visible: !r.visible } : r))
                        );
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {route.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    </button>
                    {routes.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteRoute(route.id);
                        }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* POIs section */}
        {pois.length > 0 && (
          <div>
            <button
              onClick={() => setPoisOpen((v) => !v)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <span>Points of Interest ({pois.length})</span>
              {poisOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>

            {poisOpen && (
              <div className="space-y-0.5">
                {pois.map((poi, idx) => {
                  const tone = poiTone(poi.type);
                  const isDragOver = dragGroup === 'pois' && dragOverIdx === idx;
                  return (
                    <div
                      key={poi.id}
                      draggable
                      onDragStart={() => handleDragStart('pois', idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={() => handleDrop('pois', idx)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-1.5 px-1 py-1.5 rounded-md text-xs hover:bg-secondary ${
                        isDragOver ? 'border-t-2 border-t-primary' : ''
                      }`}
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
                      <span className="text-sm">{tone.emoji}</span>
                      <input
                        value={poi.title}
                        onChange={(e) =>
                          setPois((prev) =>
                            prev.map((p) => (p.id === poi.id ? { ...p, title: e.target.value } : p))
                          )
                        }
                        className="bg-transparent flex-1 text-xs outline-none min-w-0"
                      />
                      <button
                        onClick={() => setPois((prev) => prev.filter((p) => p.id !== poi.id))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Basemap */}
        <div className="pt-1 border-t border-border mt-1">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Basemap</p>
          <div className="flex flex-wrap gap-1 px-2 pb-1">
            {BASEMAP_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSelectedBasemap(opt.id)}
                className={`text-[10px] px-2 py-1 rounded-full border font-medium transition-colors ${
                  selectedBasemap === opt.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary text-secondary-foreground border-border hover:bg-accent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LayersPanel;
