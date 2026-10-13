/**
 * The ideal customer profile for /lead-discover, in one place. Everything
 * that decides whether a race is a lead, and which tier it is, reads from
 * here: the RunSignup pull (scripts/lead-sources.mjs), the candidate
 * checks (scripts/lib/discovery.mjs) and the playbook
 * (.claude/commands/lead-discover.md), which points at this file instead
 * of restating the rules.
 *
 * The profile (decided 2026-10-13):
 *   Anywhere in the US.
 *   Tier 1: a community host, 200–800 finishers last year, no public course map.
 *   Tier 2: same host and size, but they already publish a map.
 *   Anything else is not imported.
 */

/** Hosts we sell to: volunteer-run community organisations. Values are crm_accounts.org_type. */
export const RIGHT_HOSTS = [
  'park_district', 'municipal', 'school', 'school_booster', 'school_foundation',
  'church', 'service_club', 'running_club', 'charity', 'chamber',
];

/** Last year's finishers, all distances together. */
export const MIN_FINISHERS = 200;
export const MAX_FINISHERS = 800;

/** Race date 8–14 weeks out: registration opens 2–3 months ahead, which is when they think about the map. */
export const WINDOW_WEEKS = { min: 8, max: 14 };

/**
 * map_type values that mean "no usable public map". A text description of
 * the route counts as no map: we can build one, they can't share one.
 * `unknown` is neither: research has to settle it before import.
 */
export const NO_MAP_TYPES = ['none', 'description'];

/** 1, 2, or null (not a lead / not decidable yet). */
export function computeTier({ org, est_participants: n, map_type: mapType } = {}) {
  if (!RIGHT_HOSTS.includes(org?.type)) return null;
  if (!Number.isFinite(n) || n < MIN_FINISHERS || n > MAX_FINISHERS) return null;
  if (!mapType || mapType === 'unknown') return null;
  return NO_MAP_TYPES.includes(mapType) ? 1 : 2;
}

/**
 * Name tells for races run by management companies and multi-city series.
 * These get dropped before anything spends a request on them.
 */
const STATE_NAMES =
  'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|' +
  'Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|' +
  'Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|' +
  'North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|' +
  'South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|[A-Z]{2}';

export const SERIES_PATTERNS = [
  // "… 5K/10K/13.1 CHICAGO/EVANSTON" at the end of the name (but not "5K RUN/WALK")
  /\b(?!RUN\b|WALK\b)[A-Z]{3,}\/(?!RUN\b|WALK\b)[A-Z]{3,}(?:\s[A-Z]+)?\s*$/,
  /\s[-–—]\s*Greater\s+\w+/i,                          // "Candy Cane Course - Greater Chicago"
  /^Run\s+[A-Z][a-z]+\s+Race Series$/,                 // "Run Houston Race Series"
  new RegExp(`^(?:${STATE_NAMES})\\s+Runs(?:\\s+Race Series)?$`), // "Iowa Runs", "MN Runs", "Missouri Runs Race Series"
];

export const looksLikeSeries = (name) => SERIES_PATTERNS.some((re) => re.test(String(name ?? '')));

/**
 * A name with its city/brand suffix stripped, for spotting one organiser
 * running the same race in many places ("Candy Cane Course - Milwaukee",
 * "Candy Cane Course - Greater Chicago").
 */
export const seriesKey = (name) =>
  String(name ?? '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .split(/\s[-–—|]\s|,|\(/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * A name that carries its place: "Candy Cane Course - Orlando",
 * "Holiday 5K, 10K, & 13.1M at Gadsden, AL (50)". Travelling series name
 * every stop this way; an independent "Ugly Sweater 5K" doesn't.
 */
export const hasPlaceSuffix = (name) =>
  /\s[-–—]\s*\S/.test(String(name ?? '')) || /\sat\s+[A-Z][\w .'-]*,\s*[A-Z]{2}\b/.test(String(name ?? ''));

/** The same race, place-suffixed, in this many different towns means a travelling series. */
export const SERIES_MIN_TOWNS = 3;

/**
 * The leads that belong to a travelling series: a name pattern, or the
 * same seriesKey with a place suffix in SERIES_MIN_TOWNS+ towns.
 */
export function seriesLeads(leads) {
  const towns = new Map();
  for (const l of leads) {
    if (!hasPlaceSuffix(l.race_name)) continue;
    const k = seriesKey(l.race_name);
    if (!towns.has(k)) towns.set(k, new Set());
    towns.get(k).add(`${l.town}|${l.state}`);
  }
  return new Set(leads.filter((l) =>
    looksLikeSeries(l.race_name) ||
    (hasPlaceSuffix(l.race_name) && (towns.get(seriesKey(l.race_name))?.size ?? 0) >= SERIES_MIN_TOWNS)));
}

/** US states plus DC, in the order the weekly rotation walks them. */
export const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

/** How many weeks it takes to size-check every state once. */
export const ROTATION_WEEKS = 4;

/** This week's states: every ROTATION_WEEKS-th state from `slot`, so each week spans the map. */
export const rotationStates = (slot) => STATES.filter((_, i) => i % ROTATION_WEEKS === ((slot % ROTATION_WEEKS) + ROTATION_WEEKS) % ROTATION_WEEKS);
