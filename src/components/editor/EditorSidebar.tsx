import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Eye, EyeOff, MapPinned } from 'lucide-react';
import type { EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { totalDistanceMiles } from '@/lib/geo';
import { poiTone, POI_TYPES } from '@/lib/pois';
import { BASEMAP_OPTIONS } from '@/lib/geo';

interface EditorSidebarProps {
  eventName: string;
  setEventName: (v: string) => void;
  eventDate: string;
  setEventDate: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  routes: EventRoute[];
  activeRouteId: string;
  setActiveRouteId: (id: string) => void;
  setRoutes: React.Dispatch<React.SetStateAction<EventRoute[]>>;
  onAddRoute: () => void;
  onDeleteRoute: (id: string) => void;
  pois: RoutePoi[];
  setPois: React.Dispatch<React.SetStateAction<RoutePoi[]>>;
  pendingPoiType: PoiType | null;
  setPendingPoiType: (t: PoiType | null) => void;
  snapToRoads: boolean;
  setSnapToRoads: (v: boolean) => void;
  activeDistance: number;
  selectedBasemap: string;
  setSelectedBasemap: (id: string) => void;
}

const EditorSidebar = ({
  eventName, setEventName,
  eventDate, setEventDate,
  city, setCity,
  routes, activeRouteId, setActiveRouteId, setRoutes,
  onAddRoute, onDeleteRoute,
  pois, setPois,
  pendingPoiType, setPendingPoiType,
  snapToRoads, setSnapToRoads,
  activeDistance,
  selectedBasemap, setSelectedBasemap,
}: EditorSidebarProps) => {
  return (
    <ScrollArea className="w-[380px] shrink-0 border-r border-border bg-card">
      <div className="p-4 space-y-5">
        {/* Event Details */}
        <section className="space-y-3">
          <h2 className="font-display font-bold text-sm">Event Details</h2>
          <div className="space-y-2">
            <Label className="text-xs">Event name</Label>
            <Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="Spring Marathon" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="San Francisco" />
            </div>
          </div>
        </section>

        {/* Routes */}
        <section className="space-y-3" data-tour="sidebar-routes">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-sm">Routes</h2>
            <Button variant="ghost" size="sm" onClick={onAddRoute} className="h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>
          <div className="space-y-1.5">
            {routes.map((route) => {
              const dist = totalDistanceMiles(route.routeCoords);
              const isActive = route.id === activeRouteId;
              return (
                <div
                  key={route.id}
                  onClick={() => setActiveRouteId(route.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                    isActive ? 'bg-primary/10 border border-primary/20' : 'hover:bg-secondary'
                  }`}
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: route.color }} />
                  <input
                    value={route.name}
                    onChange={(e) =>
                      setRoutes((prev) =>
                        prev.map((r) => (r.id === route.id ? { ...r, name: e.target.value } : r))
                      )
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent flex-1 text-sm font-medium outline-none min-w-0"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">{dist.toFixed(2)} mi</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRoutes((prev) =>
                        prev.map((r) => (r.id === route.id ? { ...r, visible: !r.visible } : r))
                      );
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {route.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  {routes.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRoute(route.id);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Route color picker for active route */}
          <div className="flex items-center gap-2">
            <Label className="text-xs">Color</Label>
            <input
              type="color"
              value={routes.find((r) => r.id === activeRouteId)?.color ?? '#2563eb'}
              onChange={(e) =>
                setRoutes((prev) =>
                  prev.map((r) => (r.id === activeRouteId ? { ...r, color: e.target.value } : r))
                )
              }
              className="w-7 h-7 rounded border border-border cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">{activeDistance.toFixed(2)} mi active</span>
          </div>
        </section>

        {/* Snap toggle */}
        <section className="space-y-2" data-tour="snap-toggle">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSnapToRoads(!snapToRoads)}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                snapToRoads
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary text-secondary-foreground border-border'
              }`}
            >
              {snapToRoads ? '🛤️ Snap to roads' : '📐 Freeform'}
            </button>
          </div>
        </section>

        {/* POIs */}
        <section className="space-y-3">
          <h2 className="font-display font-bold text-sm">Points of Interest</h2>
          <div className="flex flex-wrap gap-1.5">
            {POI_TYPES.map((type) => {
              const tone = poiTone(type);
              const isActive = pendingPoiType === type;
              return (
                <button
                  key={type}
                  onClick={() => setPendingPoiType(isActive ? null : type)}
                  className={`text-xs px-2.5 py-1.5 rounded-full border font-medium transition-colors flex items-center gap-1 ${
                    isActive
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-secondary text-secondary-foreground border-border hover:bg-accent'
                  }`}
                >
                  {tone.emoji} {tone.label}
                </button>
              );
            })}
          </div>

          {pois.length > 0 && (
            <div className="space-y-1.5">
              {pois.map((poi) => {
                const tone = poiTone(poi.type);
                return (
                  <div key={poi.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-sm">
                    <span>{tone.emoji}</span>
                    <input
                      value={poi.title}
                      onChange={(e) =>
                        setPois((prev) =>
                          prev.map((p) => (p.id === poi.id ? { ...p, title: e.target.value } : p))
                        )
                      }
                      className="bg-transparent flex-1 text-sm outline-none min-w-0"
                    />
                    <button
                      onClick={() => setPois((prev) => prev.filter((p) => p.id !== poi.id))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Basemap */}
        <section className="space-y-2">
          <h2 className="font-display font-bold text-sm">Basemap</h2>
          <div className="flex flex-wrap gap-1.5">
            {BASEMAP_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSelectedBasemap(opt.id)}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                  selectedBasemap === opt.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary text-secondary-foreground border-border hover:bg-accent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
};

export default EditorSidebar;
