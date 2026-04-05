import { useEffect, useState } from 'react';
import { fetchEventWeather, daysUntilEvent } from '@/lib/weather';

interface EventWeatherBadgeProps {
  eventDate: string;
  lat: number;
  lon: number;
}

const EventWeatherBadge = ({ eventDate, lat, lon }: EventWeatherBadgeProps) => {
  const [display, setDisplay] = useState<string | null>(null);

  useEffect(() => {
    const days = daysUntilEvent(eventDate);
    if (days < 0 || days > 16) return;

    fetchEventWeather(lat, lon, eventDate).then((result) => {
      if (!result || result.hours.length === 0) return;
      const temps = result.hours.map((h) => h.tempF);
      const lo = Math.min(...temps);
      const hi = Math.max(...temps);
      // Pick the most common emoji for the day
      const midday = result.hours.find((h) => h.hour >= 11 && h.hour <= 13) ?? result.hours[0];
      setDisplay(`${midday.emoji} ${lo}°–${hi}°`);
    });
  }, [eventDate, lat, lon]);

  if (!display) return null;

  return (
    <span className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap">
      {display}
    </span>
  );
};

export default EventWeatherBadge;
