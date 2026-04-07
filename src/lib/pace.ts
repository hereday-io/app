/** Convert m/s to min:sec /mi string. Returns null if speed isn't usable. */
export function formatPace(speed: number | null): string | null {
  if (speed == null || speed <= 0 || speed > 12.5) return null;
  const minPerMile = 26.8224 / speed;
  if (minPerMile > 30) return null;
  const mins = Math.floor(minPerMile);
  const secs = Math.round((minPerMile - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')} /mi`;
}
