import { useEffect, useRef, useState } from 'react';
import { Droplets, Wind, X } from 'lucide-react';
import { fetchEventWeather, daysUntilEvent, type WeatherResult } from '@/lib/weather';

interface EditorWeatherWidgetProps {
  eventDate: string;
  lat: number | null;
  lon: number | null;
}

function formatHour(hour: number): string {
  if (hour === 0)  return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

const EditorWeatherWidget = ({ eventDate, lat, lon }: EditorWeatherWidgetProps) => {
  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const days = daysUntilEvent(eventDate);
  const hasCoords = lat !== null && lon !== null;
  const tooFarOut = days > 16;
  const isPast = days < 0;

  useEffect(() => {
    if (!hasCoords || tooFarOut || isPast) return;
    fetchEventWeather(lat!, lon!, eventDate).then(setWeather);
  }, [eventDate, lat, lon, hasCoords, tooFarOut, isPast]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (isPast || !hasCoords) return null;

  // Summary pill — what shows in the header
  const summaryLabel = (() => {
    if (tooFarOut) {
      const availableIn = days - 16;
      return `⏳ Forecast in ${availableIn}d`;
    }
    if (!weather) return null;
    const temps = weather.hours.map((h) => h.tempF);
    const lo = Math.min(...temps);
    const hi = Math.max(...temps);
    const midday = weather.hours.find((h) => h.hour >= 11 && h.hour <= 13) ?? weather.hours[0];
    return `${midday?.emoji ?? '🌡️'} ${lo}°–${hi}°`;
  })();

  if (!summaryLabel) return null;

  return (
    <div className="relative hidden md:block" ref={ref}>
      <button
        onClick={() => !tooFarOut && setOpen((v) => !v)}
        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md transition-colors
          ${tooFarOut
            ? 'text-muted-foreground cursor-default'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer'
          }`}
        title={tooFarOut ? `Hourly forecast available ${days - 16} days before the event` : 'Race day forecast'}
      >
        {summaryLabel}
      </button>

      {open && weather && (
        <div className="absolute left-0 top-full mt-2 w-80 rounded-2xl bg-card/95 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.15)] ring-1 ring-black/[0.06] z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
            <span className="text-xs font-semibold text-foreground">Race Day Forecast</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}
              </span>
              <button onClick={() => setOpen(false)} aria-label="Close forecast" className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Hourly scroll */}
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex gap-0.5 px-2 py-2 min-w-max">
              {weather.hours.map((h) => (
                <div
                  key={h.hour}
                  className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg hover:bg-secondary/60 transition-colors min-w-[52px]"
                >
                  <span className="text-[10px] text-muted-foreground font-medium">{formatHour(h.hour)}</span>
                  <span className="text-lg leading-none">{h.emoji}</span>
                  <span className="text-xs font-bold text-foreground">{h.tempF}°</span>
                  <div className="flex items-center gap-0.5 text-[10px] text-blue-500">
                    <Droplets className="h-2 w-2" />
                    <span>{h.precipPct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Summary bar */}
          {weather.hours.length > 0 && (() => {
            const temps = weather.hours.map((h) => h.tempF);
            const maxPrecip = Math.max(...weather.hours.map((h) => h.precipPct));
            const avgWind = Math.round(weather.hours.reduce((s, h) => s + h.windMph, 0) / weather.hours.length);
            return (
              <div className="flex items-center justify-around border-t border-border/60 px-4 py-2 bg-secondary/30">
                <span className="text-[10px] text-muted-foreground">🌡️ {Math.min(...temps)}°–{Math.max(...temps)}°F</span>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Droplets className="h-2.5 w-2.5 text-blue-400" />
                  <span>Up to {maxPrecip}%</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Wind className="h-2.5 w-2.5" />
                  <span>~{avgWind} mph</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default EditorWeatherWidget;
