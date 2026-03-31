import { useState } from 'react';
import { Layers } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { PoiType } from '@/types/mapEditor';
import { poiTone, POI_TYPES } from '@/lib/pois';
import { BASEMAP_OPTIONS } from '@/lib/geo';

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
            {snapToRoads ? 'Snap to roads (on)' : 'Freeform mode'}
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
            <TooltipContent side="right">Add point of interest</TooltipContent>
          </Tooltip>

          {poiOpen && (
            <div className="absolute left-full top-0 ml-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg p-2 w-44">
              <p className="text-xs font-medium text-muted-foreground px-2 py-1">Place a POI</p>
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
                    className={`w-full text-left text-sm px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-secondary text-foreground'
                    }`}
                  >
                    <span>{tone.emoji}</span>
                    {tone.label}
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
            <div className="absolute left-full top-0 ml-2 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg p-2 w-36">
              <p className="text-xs font-medium text-muted-foreground px-2 py-1">Basemap</p>
              {BASEMAP_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => { setSelectedBasemap(opt.id); setBasemapOpen(false); }}
                  className={`w-full text-left text-sm px-2 py-1.5 rounded-md transition-colors ${
                    selectedBasemap === opt.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-secondary text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default MapToolbar;
