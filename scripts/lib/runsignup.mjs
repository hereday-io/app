/**
 * RunSignup's public race search (no key needed for GET /rest/races),
 * boiled down to in-person races inside a date window. Used by
 * scripts/lead-sources.mjs for /lead-discover.
 *
 * The feed is noisy: virtual "races", season-long challenges, and series
 * whose events span months. A race is kept only for its in-person
 * events that start inside the window; its race_date is the first one.
 */

export const API = 'https://api.runsignup.com/rest/races';
const PER_PAGE = 100;

/** "12/19/2026 10:00" or "12/19/2026" → "2026-12-19". */
export function rsuDay(value) {
  const m = String(value ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

const VIRTUAL = /\bvirtual\b/i;

/** One API race → a screenable lead, or null if nothing in-person falls in the window. */
export function toLead(race, { from, to }) {
  if (race.is_private_race === 'T' || race.is_draft_race === 'T' || VIRTUAL.test(race.name)) return null;
  const events = (race.events ?? [])
    .map((e) => ({ ...e, day: rsuDay(e.start_time) }))
    .filter((e) => e.event_type !== 'virtual_race' && !VIRTUAL.test(e.name) && e.day && e.day >= from && e.day <= to)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!events.length) return null;
  const day = events[0].day;
  const sameDay = events.filter((e) => e.day === day);
  return {
    race_name: race.name.trim(),
    race_date: day,
    town: race.address?.city ?? null,
    zipcode: race.address?.zipcode ?? null,
    url: race.url,
    external_url: race.external_race_url || null,
    distances: [...new Set(sameDay.map((e) => e.distance || e.name).filter(Boolean))],
    event_types: [...new Set(sameDay.map((e) => e.event_type))],
    registration_open: race.is_registration_open === 'T',
    runsignup_race_id: race.race_id,
    source: 'runsignup',
  };
}

/** Every in-person race within `radius` miles of `zip`, in the window. */
export async function fetchRaces({ zip, radius, from, to }, fetchImpl = fetch) {
  const leads = [];
  for (let page = 1; page <= 50; page++) {
    const q = new URLSearchParams({
      format: 'json', zipcode: zip, radius: String(radius), start_date: from, end_date: to,
      events: 'T', results_per_page: String(PER_PAGE), page: String(page), sort: 'date ASC',
    });
    const res = await fetchImpl(`${API}?${q}`);
    if (!res.ok) throw new Error(`RunSignup answered ${res.status} for page ${page}.`);
    const body = await res.json();
    if (body.error) throw new Error(`RunSignup: ${JSON.stringify(body.error)}`);
    const races = (body.races ?? []).map((x) => x.race);
    for (const r of races) {
      const lead = toLead(r, { from, to });
      if (lead) leads.push(lead);
    }
    if (races.length < PER_PAGE) break;
  }
  return leads.sort((a, b) => a.race_date.localeCompare(b.race_date) || a.race_name.localeCompare(b.race_name));
}
