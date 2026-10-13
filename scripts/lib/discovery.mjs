/**
 * Weekly lead discovery (/lead-discover): turns the candidate races the
 * skill researched into crm_import rows, and screens them against what
 * the CRM already has. Pure functions; scripts/crm.mjs does the I/O.
 *
 * A candidate is what the skill writes to outreach/discovery/<date>.json:
 *
 *   {
 *     "race_name": "Woodstock Reindeer Run",
 *     "race_date": "2027-01-09",
 *     "date_source": "https://…the race's own page…",   // date_verified needs this
 *     "date_verified": true,
 *     "town": "Woodstock",
 *     "tier": 1,                                         // must equal computeTier() in icp.mjs
 *     "distances": ["5K", "1 mile"],
 *     "est_participants": 350,                           // last year's finishers, all distances
 *     "participants_source": "https://…2026 results…",   // required
 *     "org": { "name": "Woodstock Rotary", "type": "service_club", "description": null },
 *     "contact": { "full_name": "…", "role": "Race director",
 *                  "email": "…", "email_source": "https://…",
 *                  "phone": "…", "phone_source": "https://…",
 *                  "form_url": null },                   // a contact form, when that's all there is
 *     "course_map_url": null, "map_type": "none",
 *     "fit_flags": [],
 *     "found_via": ["https://runsignup.com/…"],
 *     "why": "Rotary-run 5K, ~350 finishers, no published map."
 *   }
 *
 * The rules mirror the CRM's CHECKs (20261012121000_crm_schema.sql) and
 * the ICP in ./icp.mjs, so a bad row is caught here instead of aborting
 * the whole crm_import batch.
 */

import { MAX_FINISHERS, MIN_FINISHERS, NO_MAP_TYPES, RIGHT_HOSTS, WINDOW_WEEKS, computeTier } from './icp.mjs';

export const ORG_TYPES = [
  'park_district', 'municipal', 'school_booster', 'school_foundation', 'school', 'church',
  'service_club', 'running_club', 'charity', 'chamber', 'business', 'race_mgmt_company', 'other',
];
export const MAP_TYPES = [
  'image', 'pdf', 'gpx', 'strava', 'mapmyrun', 'rungo', 'google_my_maps', 'embedded', 'description', 'none', 'unknown',
];
export const FIT_FLAGS = ['large_field', 'race_mgmt_company', 'has_published_map', 'outside_radius', 'no_named_contact', 'other'];

/** Flags that put a race outside the ICP: these get rejected, not imported. */
const OUT_OF_ICP = ['large_field', 'race_mgmt_company', 'outside_radius'];

/**
 * Prior-year outcomes that mean "don't pitch this race again". Not has_map:
 * a race that already publishes a map is a tier 2 lead now, and next year's
 * edition gets the rebuilt-map pitch.
 */
export const DONT_RECONTACT = ['not_interested', 'not_a_fit', 'do_not_contact', 'removed'];

const URL_RE = /^https?:\/\/\S+$/i;
const isUrl = (v) => typeof v === 'string' && URL_RE.test(v.trim());
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** crm_internal.race_key: lowercase letters and digits only. */
export const raceKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** crm_internal.slugify, same as crm_create_deal: "<race> <year>", 60 chars. */
export function slugFor(raceName, raceDate) {
  const year = /^\d{4}/.test(raceDate ?? '') ? ` ${raceDate.slice(0, 4)}` : '';
  const slug = `${raceName}${year}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'deal';
}

const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The ICP's date window: races 8–14 weeks out (registration opens 2–3 months ahead). */
export function discoveryWindow(today, { minWeeks = WINDOW_WEEKS.min, maxWeeks = WINDOW_WEEKS.max } = {}) {
  return { from: addDays(today, minWeeks * 7), to: addDays(today, maxWeeks * 7) };
}

/** Every reason this candidate can't be imported. Empty means it's good. */
export function validateCandidate(c, { window } = {}) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['Not an object.'];

  const race = str(c.race_name);
  if (!race) errors.push('race_name is missing.');
  else if (race.length > 200) errors.push('race_name is over 200 characters.');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.race_date ?? '') || Number.isNaN(Date.parse(c.race_date))) {
    errors.push('race_date must be YYYY-MM-DD.');
  } else if (window && (c.race_date < window.from || c.race_date > window.to)) {
    errors.push(`race_date ${c.race_date} is outside the window ${window.from}..${window.to}.`);
  }
  if (c.date_verified === true && !isUrl(c.date_source)) {
    errors.push('date_verified needs date_source: the race page the date was read from.');
  }

  if (!str(c.org?.name)) errors.push('org.name is missing (who hosts the race?).');
  if (c.org?.type == null) errors.push(`org.type is missing: the host has to be one of ${RIGHT_HOSTS.join(', ')}.`);
  else if (!ORG_TYPES.includes(c.org.type)) errors.push(`org.type "${c.org.type}" is not one of ${ORG_TYPES.join(', ')}.`);
  else if (c.org.type === 'race_mgmt_company') errors.push('Run by a race-management company: outside the ICP.');
  else if (!RIGHT_HOSTS.includes(c.org.type)) errors.push(`A ${c.org.type} host is outside the ICP (wants ${RIGHT_HOSTS.join(', ')}).`);

  const flags = c.fit_flags ?? [];
  if (!Array.isArray(flags)) errors.push('fit_flags must be an array.');
  else {
    const bad = flags.filter((f) => !FIT_FLAGS.includes(f));
    if (bad.length) errors.push(`Unknown fit_flags: ${bad.join(', ')}.`);
    const out = flags.filter((f) => OUT_OF_ICP.includes(f));
    if (out.length) errors.push(`Outside the ICP (${out.join(', ')}): reject it instead.`);
  }
  if (!Number.isFinite(c.est_participants)) {
    errors.push("est_participants is missing: last year's finisher count decides the tier.");
  } else if (c.est_participants < MIN_FINISHERS || c.est_participants > MAX_FINISHERS) {
    errors.push(`${c.est_participants} finishers is outside ${MIN_FINISHERS}–${MAX_FINISHERS}: outside the ICP.`);
  }
  if (Number.isFinite(c.est_participants) && !isUrl(c.participants_source)) {
    errors.push("participants_source must be the URL of last year's results.");
  }

  if (c.map_type == null || c.map_type === 'unknown') errors.push('map_type is missing or unknown: find out whether they publish a map.');
  else if (!MAP_TYPES.includes(c.map_type)) errors.push(`map_type "${c.map_type}" is not one of ${MAP_TYPES.join(', ')}.`);
  if (c.course_map_url != null && !isUrl(c.course_map_url)) errors.push('course_map_url must be a URL.');
  if (MAP_TYPES.includes(c.map_type) && c.map_type !== 'unknown') {
    const hasMap = !NO_MAP_TYPES.includes(c.map_type);
    if (Array.isArray(flags) && hasMap !== flags.includes('has_published_map')) {
      errors.push(hasMap
        ? `map_type ${c.map_type} is a published map: add the has_published_map fit flag.`
        : `map_type ${c.map_type} is not a published map: drop the has_published_map fit flag.`);
    }
    if (hasMap && !isUrl(c.course_map_url)) errors.push('A published map needs course_map_url.');
  }

  const tier = computeTier(c);
  if (c.tier !== 1 && c.tier !== 2) errors.push('tier must be 1 or 2 (tier 3 is legacy, for old Chicagoland deals).');
  else if (tier !== null && c.tier !== tier) errors.push(`tier is ${c.tier} but the ICP makes it tier ${tier} (icp.mjs computeTier).`);

  const ct = c.contact ?? {};
  const email = str(ct.email);
  const phone = str(ct.phone);
  const form = str(ct.form_url);
  if (!email && !phone && !form) errors.push('No contact: needs an email, a phone or a contact form, each with its source URL.');
  if (form && !isUrl(form)) errors.push('form_url must be the URL of the contact form.');
  if (email && !isUrl(ct.email_source)) errors.push('email_source must be the URL where the email was found.');
  if (phone && !isUrl(ct.phone_source)) errors.push('phone_source must be the URL where the phone was found.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`"${email}" doesn't look like an email.`);

  const via = Array.isArray(c.found_via) ? c.found_via : [];
  if (!via.length || !via.every(isUrl)) errors.push('found_via needs at least one URL, and only URLs.');

  return errors;
}

/** One crm_import row (the ImportRow shape in src/lib/crm/types.ts). No owner: it lands Unclaimed. */
export function toImportRow(c, { discoveredOn }) {
  const ct = c.contact ?? {};
  const email = str(ct.email);
  const phone = str(ct.phone);
  const distances = Array.isArray(c.distances) ? c.distances.filter(str) : [];
  const notes = [
    str(c.why),
    `Found by weekly discovery on ${discoveredOn}.`,
    str(ct.full_name) || str(ct.role) ? `Contact: ${[str(ct.full_name), str(ct.role)].filter(Boolean).join(', ')}.` : null,
    isUrl(ct.form_url) ? `Contact form: ${ct.form_url.trim()}` : null,
    distances.length ? `Distances: ${distances.join(', ')}.` : null,
    Number.isFinite(c.est_participants)
      ? `${c.est_participants} finishers last year${isUrl(c.participants_source) ? ` (${c.participants_source.trim()})` : ''}.`
      : null,
  ].filter(Boolean).join('\n');

  const raw = {
    discovered_on: discoveredOn,
    found_via: c.found_via.map((u) => u.trim()).join(' '),
    ...(isUrl(c.date_source) ? { date_source: c.date_source.trim() } : {}),
    ...(Number.isFinite(c.est_participants) ? { est_participants: String(c.est_participants) } : {}),
    ...(isUrl(c.participants_source) ? { participants_source: c.participants_source.trim() } : {}),
    ...(distances.length ? { distances: distances.join(', ') } : {}),
    ...(str(ct.role) ? { contact_role: str(ct.role) } : {}),
    ...(isUrl(ct.form_url) ? { contact_form: ct.form_url.trim() } : {}),
  };

  return {
    slug: slugFor(str(c.race_name), c.race_date),
    race_name: str(c.race_name),
    race_date: c.race_date,
    date_verified: c.date_verified === true,
    town: str(c.town),
    tier: c.tier,
    priority: null,
    account: { name: str(c.org.name), org_type: c.org.type ?? null, org_description: str(c.org.description) },
    contact: {
      full_name: str(ct.full_name),
      email,
      email_source: email ? ct.email_source.trim() : null,
      phone,
      phone_source: phone ? ct.phone_source.trim() : null,
      do_not_contact: false,
    },
    stage: 'new',
    outcome: null,
    owner_id: null,
    owner_name: null,
    claimed_at: null,
    channel: email ? 'email' : phone ? 'phone' : 'form',
    sent_at: null,
    followed_up_at: null,
    next_step: null,
    next_step_at: null,
    objection: null,
    fit_flags: c.fit_flags ?? [],
    course_map_url: str(c.course_map_url),
    map_type: c.map_type ?? null,
    hereday_link: null,
    gmail_draft_id: null,
    notes,
    tracker_claims: [],
    raw,
    warnings: [],
  };
}

const yearOf = (day) => (/^\d{4}/.test(day ?? '') ? Number(day.slice(0, 4)) : null);

/**
 * Why this race shouldn't be researched or imported, or null if it's new.
 * `deals` is crm_list_deals(include_closed); `rejected` is
 * outreach/discovery/rejected.json. Same race_key rules as crm_import:
 * a missing date on either side matches any year.
 */
export function screenRace({ race_name, race_date }, { deals = [], rejected = [] }) {
  const key = raceKey(race_name);
  if (!key) return 'No race name.';
  const year = yearOf(race_date);
  const sameYear = (otherDate) => year === null || yearOf(otherDate) === null || yearOf(otherDate) === year;

  const known = deals.find((d) => raceKey(d.race_name) === key && sameYear(d.race_date));
  if (known) return `Already in the CRM as ${known.slug} (${known.effective_stage ?? known.stage}).`;

  const burned = deals.find(
    (d) => raceKey(d.race_name) === key && d.stage === 'closed' && DONT_RECONTACT.includes(d.outcome),
  );
  if (burned) return `An earlier edition (${burned.slug}) closed as ${burned.outcome}.`;
  const dnc = deals.find((d) => raceKey(d.race_name) === key && d.is_dnc);
  if (dnc) return `Do not contact (${dnc.slug}).`;

  const r = rejected.find((x) => raceKey(x.race_key ?? x.race_name) === key && (x.year == null || year === null || x.year === year));
  if (r) return `Rejected on ${r.on ?? '?'}: ${r.reason}`;
  return null;
}

/**
 * Work order for a batch of import rows: tier 1 before tier 2, then races
 * with more distances (more routes to draw, a likelier Pro sale). Priority
 * numbers continue after `basePriority` (the CRM's current max), so
 * `crm.mjs next --claim` hands tier 1 out first.
 */
export function prioritise(rows, basePriority = 0) {
  const distances = (r) => (r.raw?.distances ? r.raw.distances.split(',').length : 0);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.tier ?? 9) - (b.r.tier ?? 9) || distances(b.r) - distances(a.r) || a.i - b.i)
    .map(({ r }, rank) => ({ ...r, priority: basePriority + rank + 1 }));
}
