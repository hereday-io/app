/**
 * RunSignup's public API (no key needed), boiled down for /lead-discover:
 *
 *   fetchRaces          in-person races inside a date window, for a state,
 *                       a zip + radius, or the whole US
 *   lastYearFinishers   how many finished the previous edition, which is
 *                       how the ICP sizes a race (scripts/lib/icp.mjs)
 *
 * The race feed is noisy: virtual "races", season-long challenges, and
 * series whose events span months. A race is kept only for its in-person
 * events that start inside the window; its race_date is the first one.
 */

export const API = 'https://api.runsignup.com/rest/races';
const RACE_API = 'https://runsignup.com/Rest/race';
const PER_PAGE = 1000;

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
    state: race.address?.state ?? null,
    zipcode: race.address?.zipcode ?? null,
    url: race.url,
    external_url: race.external_race_url || null,
    distances: [...new Set(sameDay.map((e) => e.distance || e.name).filter(Boolean))],
    event_types: [...new Set(sameDay.map((e) => e.event_type))],
    event_ids: sameDay.map((e) => e.event_id).filter(Boolean),
    registration_open: race.is_registration_open === 'T',
    runsignup_race_id: race.race_id,
    source: 'runsignup',
  };
}

async function fetchPage(area, { from, to, page, perPage }, fetchImpl) {
  const q = new URLSearchParams({
    format: 'json', ...area, start_date: from, end_date: to,
    events: 'T', results_per_page: String(perPage), page: String(page), sort: 'date ASC',
  });
  const res = await fetchImpl(`${API}?${q}`);
  if (!res.ok) throw new Error(`RunSignup answered ${res.status} for page ${page}.`);
  const body = await res.json();
  if (body.error) throw new Error(`RunSignup: ${JSON.stringify(body.error)}`);
  return (body.races ?? []).map((x) => x.race);
}

const byDateThenName = (a, b) => a.race_date.localeCompare(b.race_date) || a.race_name.localeCompare(b.race_name);

/**
 * Every in-person race in the window within `radius` miles of `zip`, or
 * in one `state` (two-letter). Pages until a short page.
 */
export async function fetchRaces({ zip, radius, state, from, to, perPage = PER_PAGE }, fetchImpl = fetch) {
  const area = zip ? { zipcode: zip, radius: String(radius) } : { state, country: 'US' };
  const leads = [];
  for (let page = 1; page <= 50; page++) {
    const races = await fetchPage(area, { from, to, page, perPage }, fetchImpl);
    for (const r of races) {
      const lead = toLead(r, { from, to });
      if (lead) leads.push(lead);
    }
    if (races.length < perPage) break;
  }
  return leads.sort(byDateThenName);
}

/**
 * One state's races without an API key. RunSignup serves only the first
 * 1,000 results to anonymous callers, so a full page means the window is
 * split in half and each half fetched on its own.
 */
export async function fetchState({ state, from, to, perPage = PER_PAGE }, fetchImpl = fetch) {
  const races = await fetchPage({ state, country: 'US' }, { from, to, page: 1, perPage }, fetchImpl);
  if (races.length >= perPage && from < to) {
    const mid = new Date((Date.parse(`${from}T12:00:00Z`) + Date.parse(`${to}T12:00:00Z`)) / 2).toISOString().slice(0, 10);
    const next = new Date(Date.parse(`${mid}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const halves = [
      ...(await fetchState({ state, from, to: mid, perPage }, fetchImpl)),
      ...(await fetchState({ state, from: next, to, perPage }, fetchImpl)),
    ];
    // A race whose events straddle the split comes back from both halves.
    const seen = new Set();
    return halves.filter((l) => !seen.has(l.runsignup_race_id) && seen.add(l.runsignup_race_id)).sort(byDateThenName);
  }
  return races.map((r) => toLead(r, { from, to })).filter(Boolean).sort(byDateThenName);
}

const DAY_MS = 86_400_000;
const dayMs = (start) => {
  const d = rsuDay(start);
  return d ? Date.parse(`${d}T12:00:00Z`) : NaN;
};

/**
 * The previous edition of each event: RunSignup links them with
 * previous_year_event_id; when that's missing, the event with the same
 * name 10–14 months earlier.
 */
export function previousEvents(allEvents, eventIds) {
  const byId = new Map(allEvents.map((e) => [String(e.event_id), e]));
  const out = [];
  for (const id of eventIds) {
    const ev = byId.get(String(id));
    if (!ev) continue;
    let prev = ev.previous_year_event_id ? byId.get(String(ev.previous_year_event_id)) ?? { event_id: ev.previous_year_event_id } : null;
    if (!prev) {
      const at = dayMs(ev.start_time);
      prev = allEvents.find((e) => {
        if (e.name?.trim().toLowerCase() !== ev.name?.trim().toLowerCase()) return false;
        const gap = (at - dayMs(e.start_time)) / DAY_MS;
        return gap >= 300 && gap <= 430;
      }) ?? null;
    }
    if (prev) out.push({ event_id: ev.event_id, name: ev.name, prev_event_id: prev.event_id });
  }
  return out;
}

/**
 * Last year's finishers across the race's in-window events, or null when
 * RunSignup has no results for the previous edition (they may be on a
 * timer's site; research can still find them).
 *
 * `cache` is a plain object, persisted by the caller. Keys are
 * "<race_id>:<prev_event_id>"; a past edition's results don't change, so
 * entries never expire. null is cached too: "no results posted".
 */
export async function lastYearFinishers(lead, { fetchImpl = fetch, cache = {} } = {}) {
  const raceId = lead.runsignup_race_id;
  const res = await fetchImpl(`${RACE_API}/${raceId}?format=json&future_events_only=F&most_recent_events_only=F`);
  if (!res.ok) throw new Error(`RunSignup answered ${res.status} for race ${raceId}.`);
  const body = await res.json();
  const prevs = previousEvents(body.race?.events ?? [], lead.event_ids ?? []);

  let total = null;
  const events = [];
  for (const p of prevs) {
    const key = `${raceId}:${p.prev_event_id}`;
    if (!(key in cache)) {
      const r = await fetchImpl(
        `${RACE_API}/${raceId}/results/get-results?format=json&event_id=${p.prev_event_id}&include_total_finishers=T&results_per_page=1`,
      );
      if (!r.ok) throw new Error(`RunSignup answered ${r.status} for results of race ${raceId}.`);
      const sets = (await r.json()).individual_results_sets ?? [];
      const counts = sets.map((s) => Number(s.num_finishers)).filter(Number.isFinite);
      cache[key] = counts.length ? Math.max(...counts) : null;
    }
    const n = cache[key];
    events.push({ name: p.name, prev_event_id: p.prev_event_id, finishers: n });
    if (Number.isFinite(n)) total = (total ?? 0) + n;
  }
  return {
    count: total,
    source_url: total === null ? null : `https://runsignup.com/Race/Results/${raceId}`,
    events,
  };
}

/** Wraps fetch so calls are at least `gapMs` apart: RunSignup is a free API, be polite. */
export function throttled(fetchImpl = fetch, gapMs = 300) {
  let next = 0;
  return async (...args) => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + gapMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return fetchImpl(...args);
  };
}
