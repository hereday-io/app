import { useState, useRef, useEffect } from 'react';
import { Layers, Eye, EyeOff, MapPin, Route, Search } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { EventRoute, RoutePoi, PoiType } from '@/types/mapEditor';
import { totalDistanceMiles, BASEMAP_OPTIONS } from '@/lib/geo';
import { poiTone } from '@/lib/pois';

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

interface PublicMapToolbarProps {
  routes: EventRoute[];
  hiddenRouteIds: Set<string>;
  onToggleRoute: (id: string) => void;
  selectedBasemap: string;
  onBasemapChange: (id: string) => void;
  pois: RoutePoi[];
  highlightedPoiType: PoiType | null;
  onHighlightPoiType: (type: PoiType | null) => void;
  /** Limit which POI types to show in the summary */
  poiTypeFilter?: PoiType[];
  /** Called when a user selects a POI from search to fly to it */
  onFlyToPoi?: (poi: RoutePoi) => void;
}

type FlyoutType = 'routes' | 'poi' | 'basemap' | 'search' | null;

const PublicMapToolbar = ({
  routes, hiddenRouteIds, onToggleRoute,
  selectedBasemap, onBasemapChange,
  pois, highlightedPoiType, onHighlightPoiType,
  poiTypeFilter, onFlyToPoi,
}: PublicMapToolbarProps) => {
  const [openFlyout, setOpenFlyout] = useState<FlyoutType>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toggle = (f: FlyoutType) => {
    setOpenFlyout(prev => {
      const next = prev === f ? null : f;
      if (next !== 'search') setSearchQuery('');
      return next;
    });
  };

  useEffect(() => {
    if (openFlyout === 'search') searchInputRef.current?.focus();
  }, [openFlyout]);

  const filteredPois = poiTypeFilter
    ? pois.filter(p => poiTypeFilter.includes(p.type))
    : pois;

  // Exclude auto start/finish from summary
  const manualPois = filteredPois.filter(p => !p.id.startsWith('auto-start-') && !p.id.startsWith('auto-finish-'));

  const grouped = manualPois.reduce<Record<string, number>>((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + 1;
    return acc;
  }, {});
  const poiTypes = Object.keys(grouped) as PoiType[];

  const btnBase = 'w-10 h-10 rounded-lg border shadow-lg flex items-center justify-center transition-colors';
  const btnDefault = `${btnBase} bg-card/95 backdrop-blur text-foreground border-border hover:bg-secondary`;
  const btnActive = `${btnBase} bg-primary text-primary-foreground border-primary`;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        {/* Routes */}
        <div className="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => toggle('routes')} className={openFlyout === 'routes' ? btnActive : btnDefault}>
                <Route className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Routes</TooltipContent>
          </Tooltip>

          {openFlyout === 'routes' && (
            <div className="absolute left-full top-0 ml-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg w-64 overflow-hidden">
              <div className="px-3 py-2 border-b border-border">
                <span className="text-xs font-semibold text-foreground">Routes</span>
              </div>
              <div className="p-1.5 space-y-1 max-h-72 overflow-y-auto">
                {routes.map(route => {
                  const dist = totalDistanceMiles(route.routeCoords);
                  const hidden = hiddenRouteIds.has(route.id);
                  return (
                    <div
                      key={route.id}
                      className={`flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${
                        hidden ? 'opacity-50' : 'hover:bg-secondary'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: route.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{route.name}</p>
                        {dist > 0 && <p className="text-[10px] text-muted-foreground">{dist.toFixed(1)} mi</p>}
                      </div>
                      <button
                        onClick={() => onToggleRoute(route.id)}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* POI summary */}
        {poiTypes.length > 0 && (
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => toggle('poi')} className={openFlyout === 'poi' || highlightedPoiType ? btnActive : btnDefault}>
                  <MapPin className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Points of Interest</TooltipContent>
            </Tooltip>

            {openFlyout === 'poi' && (
              <div className="absolute left-full top-0 ml-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg w-56 overflow-hidden">
                <div className="px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold text-foreground">Points of Interest ({manualPois.length})</span>
                </div>
                <div className="p-1.5 space-y-0.5">
                  {poiTypes.map(type => {
                    const tone = poiTone(type);
                    const isHighlighted = highlightedPoiType === type;
                    return (
                      <button
                        key={type}
                        onClick={() => onHighlightPoiType(isHighlighted ? null : type)}
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
              </div>
            )}
          </div>
        )}

        {/* Basemap */}
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
                {BASEMAP_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => { onBasemapChange(opt.id); setOpenFlyout(null); }}
                    className={`rounded-lg overflow-hidden border-2 transition-colors ${
                      selectedBasemap === opt.id
                        ? 'border-primary ring-1 ring-primary/30'
                        : 'border-transparent hover:border-border'
                    }`}
                  >
                    <img src={BASEMAP_THUMBS[opt.id]} alt={opt.label} className="w-full h-14 object-cover" loading="lazy" />
                    <span className={`block text-[10px] py-0.5 text-center ${
                      selectedBasemap === opt.id ? 'text-primary font-semibold' : 'text-foreground'
                    }`}>{opt.label}</span>
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

export default PublicMapToolbar;
