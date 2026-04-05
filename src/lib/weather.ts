export interface HourlyWeather {
  time: string;       // ISO datetime
  hour: number;       // 0-23
  tempF: number;
  precipPct: number;
  windMph: number;
  code: number;       // WMO weather code
  label: string;
  emoji: string;
}

export interface WeatherResult {
  hours: HourlyWeather[];
  timezone: string;
}

// WMO weather interpretation codes → emoji + label
function interpretCode(code: number): { emoji: string; label: string } {
  if (code === 0)                          return { emoji: '☀️',  label: 'Clear' };
  if (code === 1)                          return { emoji: '🌤️', label: 'Mostly clear' };
  if (code === 2)                          return { emoji: '⛅',  label: 'Partly cloudy' };
  if (code === 3)                          return { emoji: '☁️',  label: 'Overcast' };
  if (code === 45 || code === 48)          return { emoji: '🌫️', label: 'Foggy' };
  if (code >= 51 && code <= 55)           return { emoji: '🌦️', label: 'Drizzle' };
  if (code >= 61 && code <= 65)           return { emoji: '🌧️', label: 'Rain' };
  if (code >= 71 && code <= 77)           return { emoji: '❄️',  label: 'Snow' };
  if (code >= 80 && code <= 82)           return { emoji: '🌦️', label: 'Showers' };
  if (code >= 85 && code <= 86)           return { emoji: '🌨️', label: 'Snow showers' };
  if (code === 95)                         return { emoji: '⛈️',  label: 'Thunderstorm' };
  if (code === 96 || code === 99)          return { emoji: '⛈️',  label: 'Heavy storm' };
  return { emoji: '🌡️', label: 'Unknown' };
}

export async function fetchEventWeather(
  lat: number,
  lon: number,
  eventDate: string   // YYYY-MM-DD
): Promise<WeatherResult | null> {
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat.toFixed(4));
    url.searchParams.set('longitude', lon.toFixed(4));
    url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weathercode,windspeed_10m');
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('start_date', eventDate);
    url.searchParams.set('end_date', eventDate);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();

    const times: string[]  = data.hourly?.time ?? [];
    const temps: number[]  = data.hourly?.temperature_2m ?? [];
    const precip: number[] = data.hourly?.precipitation_probability ?? [];
    const wind: number[]   = data.hourly?.windspeed_10m ?? [];
    const codes: number[]  = data.hourly?.weathercode ?? [];

    const hours: HourlyWeather[] = times.map((t, i) => {
      const hour = new Date(t).getHours();
      const { emoji, label } = interpretCode(codes[i] ?? 0);
      return {
        time: t,
        hour,
        tempF: Math.round(temps[i] ?? 0),
        precipPct: Math.round(precip[i] ?? 0),
        windMph: Math.round(wind[i] ?? 0),
        code: codes[i] ?? 0,
        label,
        emoji,
      };
    // Show 5am–9pm — covers pre-race through finish line
    }).filter((h) => h.hour >= 5 && h.hour <= 21);

    return { hours, timezone: data.timezone ?? 'UTC' };
  } catch {
    return null;
  }
}

/** Returns the number of days between today and the event date */
export function daysUntilEvent(eventDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const event = new Date(eventDate + 'T00:00:00');
  return Math.round((event.getTime() - today.getTime()) / 86_400_000);
}
