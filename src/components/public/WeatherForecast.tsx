import { useEffect, useState } from 'react';
import { Wind, Droplets, Clock } from 'lucide-react';
import { fetchEventWeather, daysUntilEvent, type WeatherResult } from '@/lib/weather';

interface WeatherForecastProps {
  eventDate: string;         // YYYY-MM-DD
  lat: number | null;
  lon: number | null;
}

function formatHour(hour: number): string {
  if (hour === 0)  return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

const WeatherForecast = ({ eventDate, lat, lon }: WeatherForecastProps) => {
  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const [loading, setLoading] = useState(false);

  const days = daysUntilEvent(eventDate);
  const isPast      = days < 0;
  const tooFarOut   = days > 16;
  const hasLocation = lat !== null && lon !== null;

  useEffect(() => {
    if (isPast || tooFarOut || !hasLocation) return;
    setLoading(true);
    fetchEventWeather(lat!, lon!, eventDate).then((result) => {
      setWeather(result);
      setLoading(false);
    });
  }, [eventDate, lat, lon, isPast, tooFarOut, hasLocation]);

  // Don't render anything for past events
  if (isPast) return null;

  // No location data — silently skip
  if (!hasLocation) return null;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-2">
      <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl overflow-hidden shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <span className="text-base">🌤️</span>
            <span className="text-sm font-semibold text-foreground">Race Day Forecast</span>
          </div>
          {tooFarOut ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Available {days - 16} days before the event
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}
            </span>
          )}
        </div>

        {/* Content */}
        {tooFarOut ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Hourly forecasts are available up to 16 days in advance.
              <br />
              Check back closer to race day for detailed weather.
            </p>
          </div>
        ) : loading ? (
          <div className="flex gap-3 px-4 py-4 overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-16 space-y-2 animate-pulse">
                <div className="h-3 bg-muted rounded w-8 mx-auto" />
                <div className="h-6 bg-muted rounded w-6 mx-auto" />
                <div className="h-4 bg-muted rounded w-10 mx-auto" />
                <div className="h-3 bg-muted rounded w-8 mx-auto" />
              </div>
            ))}
          </div>
        ) : !weather ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">Weather data unavailable.</p>
          </div>
        ) : (
          <>
            {/* Hourly strip */}
            <div className="overflow-x-auto scrollbar-hide">
              <div className="flex gap-1 px-3 py-3 min-w-max">
                {weather.hours.map((h) => (
                  <div
                    key={h.hour}
                    className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-secondary/60 transition-colors min-w-[60px]"
                  >
                    <span className="text-xs text-muted-foreground font-medium">
                      {formatHour(h.hour)}
                    </span>
                    <span className="text-xl leading-none">{h.emoji}</span>
                    <span className="text-sm font-bold text-foreground">{h.tempF}°</span>
                    <div className="flex items-center gap-0.5 text-xs text-blue-500">
                      <Droplets className="h-2.5 w-2.5" />
                      <span>{h.precipPct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary bar */}
            {weather.hours.length > 0 && (() => {
              const temps   = weather.hours.map((h) => h.tempF);
              const maxTemp  = Math.max(...temps);
              const minTemp  = Math.min(...temps);
              const maxPrecip = Math.max(...weather.hours.map((h) => h.precipPct));
              const avgWind  = Math.round(weather.hours.reduce((s, h) => s + h.windMph, 0) / weather.hours.length);
              return (
                <div className="flex items-center justify-around border-t border-border/60 px-4 py-2.5 bg-secondary/30">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>🌡️</span>
                    <span>{minTemp}°–{maxTemp}°F</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Droplets className="h-3 w-3 text-blue-400" />
                    <span>Up to {maxPrecip}% rain</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Wind className="h-3 w-3" />
                    <span>~{avgWind} mph winds</span>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
};

export default WeatherForecast;
