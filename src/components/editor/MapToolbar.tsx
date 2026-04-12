import { useState } from 'react';
import { Layers } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { PoiType } from '@/types/mapEditor';
import { poiTone, POI_TYPES } from '@/lib/pois';
import { BASEMAP_OPTIONS } from '@/lib/geo';

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

interface MapToolbarProps {
  snapToRoads: boolean;
  setSnapToRoads: (v: boolean) => void;
  pendingPoiType: PoiType | null;
  setPendingPoiType: (t: PoiType | null) => void;
  selectedBasemap: string;
  setSelectedBasemap: (id: string) => void;
}

const MapToolbar = ({ snapToRoads, setSnapToRoads, pendingPoiType, setPendingPoiType, selectedBasemap, setSelectedBasemap }: MapToolbarProps) => {
  const [poiOpen, setPoiOpen] = useState(false);
  const [basemapOpen, setBasemapOpen] = useState(false);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2" data-tour="snap-toggle">
        {/* Snap toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSnapToRoads(!snapToRoads)}
              className={`w-10 h-10 rounded-lg border shadow-lg flex items-center justify-center text-base transition-colors ${
                snapToRoads
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card/95 backdrop-blur text-foreground border-border hover:bg-secondary'
              }`}
            >
              {snapToRoads ? '🛤️' : '📐'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {snapToRoads ? 'Following roads (click to go off-road)' : 'Off-road mode (click to follow roads)'}
          </TooltipContent>
        </Tooltip>

        {/* POI dropdown */}
        <div className="relative" data-tour="poi-section">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { setPoiOpen((v) => !v); setBasemapOpen(false); }}
                className={`w-10 h-10 rounded-lg border shadow-lg flex items-center justify-center text-base transition-colors ${
                  pendingPoiType
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card/95 backdrop-blur text-foreground border-border hover:bg-secondary'
                }`}
              >
                {pendingPoiType ? poiTone(pendingPoiType).emoji : '📍'}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Drop a marker</TooltipContent>
          </Tooltip>

          {poiOpen && (
            <div className="absolute left-full top-0 ml-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg p-1.5 w-56">
              <p className="text-xs font-medium text-muted-foreground px-2.5 py-1.5">Drop a marker</p>
              {POI_TYPES.map((type) => {
                const tone = poiTone(type);
                const isActive = pendingPoiType === type;
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setPendingPoiType(isActive ? null : type);
                      setPoiOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-md flex items-center gap-2.5 transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-secondary text-foreground'
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
          )}
        </div>

        {/* Basemap picker */}
        <div className="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { setBasemapOpen((v) => !v); setPoiOpen(false); }}
                className="w-10 h-10 rounded-lg border shadow-lg flex items-center justify-center transition-colors bg-card/95 backdrop-blur text-foreground border-border hover:bg-secondary"
              >
                <Layers className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Basemap</TooltipContent>
          </Tooltip>

          {basemapOpen && (
            <div className="absolute left-full top-0 ml-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg p-2 w-44">
              <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">Basemap</p>
              <div className="grid grid-cols-2 gap-1.5">
                {BASEMAP_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { setSelectedBasemap(opt.id); setBasemapOpen(false); }}
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

export default MapToolbar;
