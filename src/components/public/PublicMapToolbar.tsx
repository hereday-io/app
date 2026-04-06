import { useState } from 'react';
import { Layers } from 'lucide-react';
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

interface PublicMapToolbarProps {
  selectedBasemap: string;
  onBasemapChange: (id: string) => void;
  /** Override positioning — e.g. "top-[60px]" when a floating header is present */
  className?: string;
}

const PublicMapToolbar = ({
  selectedBasemap, onBasemapChange,
  className = 'top-4',
}: PublicMapToolbarProps) => {
  const [open, setOpen] = useState(false);

  const btnStyle = open
    ? 'w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-primary/20 flex items-center justify-center transition-all active:scale-95'
    : 'w-10 h-10 rounded-full bg-card/80 backdrop-blur-xl text-foreground shadow-lg ring-1 ring-black/[0.06] flex items-center justify-center hover:bg-card/95 transition-all active:scale-95';

  return (
    <div className={`absolute left-3 z-10 flex flex-col gap-2 ${className}`}>
      <div className="relative">
        <button onClick={() => setOpen((v) => !v)} className={btnStyle} aria-label="Basemap">
          <Layers className="h-4 w-4" />
        </button>

        {open && (
          <div className="absolute left-full top-0 ml-2.5 bg-card/80 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06] overflow-hidden p-2 w-44">
            <p className="text-xs font-semibold text-foreground tracking-wide uppercase px-2 py-1.5 mb-1">
              Basemap
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {BASEMAP_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => { onBasemapChange(opt.id); setOpen(false); }}
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
  );
};

export default PublicMapToolbar;
