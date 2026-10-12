import type { ImportRow } from './types.ts';
import {
  CHANNELS,
  FIT_FLAGS,
  MAP_TYPES,
  OUTCOMES,
  isOneOf,
  type FitFlag,
  type MapType,
  type OrgType,
  type Outcome,
  type Stage,
} from './vocab.ts';

/**
 * Maps the two legacy trackers onto CRM import rows:
 *   * outreach/leads.csv  — Kevin's file, written by the /outreach-* skills
 *   * the reps' sheet     — outreach/sales-kit/06-lead-tracker.csv layout
 *
 * They disagree in a few places, reconciled here:
 *   * published / paid live in `outcome` in leads.csv and in `status` in
 *     the sheet. Neither is stored: the CRM reads them from Hereday. They
 *     become tracker_claims, which the import checks against app data.
 *   * no_reply (skills) and no_response (sheet) → no_response.
 *   * googlemymaps (leads.csv) and mymaps (sheet) → google_my_maps.
 *   * `excluded` is a fit judgement, not an outcome: closed rows become
 *     not_a_fit; open rows keep their stage and gain fit flags.
 *   * followup_date means "follow-up done" in leads.csv (outreach-log,
 *     outreach-followup) but "follow-up due" in the sheet's field guide.
 *
 * Pure functions, erasable TypeScript only, so the Phase 2 CLI can import
 * this file from Node directly.
 */

/** Values that mean "we looked and found nothing". Same list as scripts/lib/outreach-csv.mjs. */
const PLACEHOLDER = /^(NOT_FOUND|PENDING|TBD|N\/?A|NONE|-+)$/i;

export const real = (value: string | undefined | null): string | null => {
  const s = (value ?? '').trim();
  return s === '' || PLACEHOLDER.test(s) ? null : s;
};

const isoDate = (value: string | undefined): string | null => {
  const s = real(value);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const isUrl = (value: string | null): boolean => !!value && /^https?:\/\/\S+$/i.test(value);

const looksLikeEmail = (value: string | null): boolean => !!value && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

const tier = (value: string | undefined): number | null => {
  const n = Number(real(value));
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : null;
};

export const normalizeMapType = (value: string | undefined): MapType | null => {
  const s = real(value)?.toLowerCase().replace(/[\s-]+/g, '_') ?? null;
  if (!s) return null;
  if (s === 'googlemymaps' || s === 'mymaps' || s === 'google_mymaps') return 'google_my_maps';
  if (s === 'map_my_run') return 'mapmyrun';
  return isOneOf(MAP_TYPES, s) ? s : 'unknown';
};

/** Best-effort organization type from leads.csv's free-text org_type. */
export const normalizeOrgType = (text: string | undefined): OrgType | null => {
  const s = (text ?? '').toLowerCase();
  if (!s.trim()) return null;
  if (/^\s*(unknown|unidentified)\b/.test(s)) return 'other';
  if (/race[-\s]?management/.test(s)) return 'race_mgmt_company';
  if (/park district/.test(s)) return 'park_district';
  if (/municipal|village of|city of|town of/.test(s)) return 'municipal';
  if (/booster/.test(s)) return 'school_booster';
  if (/foundation/.test(s)) return /school|education/.test(s) ? 'school_foundation' : 'charity';
  if (/\bschool\b|academy/.test(s)) return 'school';
  if (/parish|church/.test(s)) return 'church';
  if (/kiwanis|lions|rotary|service club/.test(s)) return 'service_club';
  if (/running club|track club|run club/.test(s)) return 'running_club';
  if (/chamber/.test(s)) return 'chamber';
  if (/charity|nonprofit|non-profit|501\(c\)/.test(s)) return 'charity';
  if (/for-profit|business|company/.test(s)) return 'business';
  return 'other';
};

const ORG_SUFFIX = /\b(Inc\.?|LLC|Club|District|Foundation|Association|Church|Parish|Academy|School|Department)\b/;

/**
 * The research agent caps org_type at 60 characters, so long cells end
 * mid-word ("Our Lady of Perpetual Help C"). A name that runs into that
 * cut is not a name.
 */
const TRUNCATED_AT = 59;

const tidyName = (raw: string, sourceTruncated: boolean): string | null => {
  let s = raw.trim();
  if (s.startsWith('"')) {
    const quoted = s.match(/^"([^"]{3,80})"/);
    return quoted ? quoted[1].trim() : null;
  }
  const delimited = s.split(/\s+\(|;|\s+[—–]\s+/);
  let cut = delimited.length > 1;
  s = delimited[0];
  // End at a sentence break, but keep "Inc." / "Co." intact.
  const sentence = s.match(/^(.*?(?:\b(?:Inc|Co|Ltd|St)\.)?)\.\s/);
  if (sentence) {
    s = sentence[1];
    cut = true;
  }
  if (sourceTruncated && !cut) return null;
  s = s.replace(/(?<!\b(?:Inc|Co|Ltd|St))[.,:]+$/, '').trim();
  if (s.length < 3 || s.length > 120) return null;
  if (!/^[A-Z0-9]/.test(s) || /^(No|Unknown|None)\b/.test(s)) return null;
  return s;
};

/**
 * Pulls an organization name out of leads.csv's org_type text, e.g.
 * "School booster club — GCHS Booster Club (Grayslake …)" → "GCHS Booster Club".
 * Returns null rather than guess when nothing name-like is there, or when
 * the name is cut off; the import preview lets Kevin fill it in.
 */
export const extractOrgName = (text: string | undefined): string | null => {
  const s = (text ?? '').trim();
  if (!s) return null;
  const truncated = s.length >= TRUNCATED_AT;

  const afterDash = s.split(/\s+[—–]\s+/)[1];
  if (afterDash) {
    const name = tidyName(afterDash, truncated);
    if (name) return name;
  }

  const second = s.match(/^[^.(—–]{3,80}\.\s+(.+)$/);
  if (second && ORG_SUFFIX.test(second[1].split(/\s+\(/)[0])) {
    const name = tidyName(second[1], truncated);
    if (name) return name;
  }

  // Only a closed parenthetical: "(Parkview Christian Academy" was cut.
  const paren = s.match(/\(([^)]{3,80})\)/);
  if (paren) {
    const name = tidyName(paren[1].split(',')[0], false);
    if (name) return name;
  }
  return null;
};

/** The flagged sentence and a little after it: "FLAG: Probably exclude on SIZE. Their own site …". */
const flagWindow = (notes: string): string => {
  const m = notes.match(/(FLAG|EXCLU)[\s\S]{0,160}/i);
  return m ? m[0] : '';
};

/**
 * Fit concerns. Kept deliberately narrow: research notes say things like
 * "NOT run by a race-management company", so free-text keyword matching
 * across the whole note is wrong more often than right.
 */
const fitFlagsFrom = (notes: string, orgType: OrgType | null, excluded: boolean): FitFlag[] => {
  const flags = new Set<FitFlag>();
  if (orgType === 'race_mgmt_company') flags.add('race_mgmt_company');
  const flag = flagWindow(notes);
  if (flag) {
    if (/\bsize\b|participants|runners/i.test(flag) && !/size is not/i.test(flag)) flags.add('large_field');
    if (/verify a human|no named|no host organi[sz]ation|unidentified/i.test(flag)) flags.add('no_named_contact');
    if (/(?<!not |n't )already publish/i.test(notes)) flags.add('has_published_map');
  }
  if (excluded && flags.size === 0) flags.add('other');
  return FIT_FLAGS.filter((f) => flags.has(f));
};

const outcomeFrom = (value: string | null): { outcome: Outcome | null; claim: 'published' | 'paid' | null } => {
  const s = value?.toLowerCase() ?? null;
  if (!s) return { outcome: null, claim: null };
  if (s === 'published' || s === 'paid') return { outcome: null, claim: s };
  if (s === 'no_reply' || s === 'no_response') return { outcome: 'no_response', claim: null };
  if (s === 'excluded') return { outcome: 'not_a_fit', claim: null };
  return { outcome: isOneOf(OUTCOMES, s) ? s : 'other', claim: null };
};

const contactFrom = (row: Record<string, string>, warnings: string[], dnc: boolean): ImportRow['contact'] => {
  let email = real(row.email);
  let emailSource = real(row.email_source);
  let phone = real(row.phone);
  let phoneSource = real(row.phone_source);
  const name = real(row.director);

  if (email && !looksLikeEmail(email)) {
    warnings.push(`Email "${email}" doesn't look like an address; dropped.`);
    email = null;
  }
  if (email && !isUrl(emailSource)) {
    warnings.push('Email has no source URL; dropped (no source, no contact).');
    email = null;
  }
  if (phone && !isUrl(phoneSource)) {
    warnings.push('Phone has no source URL; dropped (no source, no contact).');
    phone = null;
  }
  if (!email) emailSource = null;
  if (!phone) phoneSource = null;
  if (!email && !phone && !name && !dnc) return null;
  return { full_name: name, email, email_source: emailSource, phone, phone_source: phoneSource, do_not_contact: dnc };
};

const accountFrom = (orgText: string | undefined, warnings: string[]): ImportRow['account'] => {
  const name = extractOrgName(orgText);
  const orgType = normalizeOrgType(orgText);
  if (!real(orgText)) return null;
  // No name: keep the type and description so the preview can ask for
  // one. crm_import skips an account whose name is still blank.
  if (!name) warnings.push('No organization name in org_type; add it in the preview if you know it.');
  return { name: name ?? '', org_type: orgType, org_description: real(orgText) };
};

const base = (row: Record<string, string>, warnings: string[]) => ({
  slug: (row.slug ?? '').trim(),
  race_name: (real(row.race) ?? '').trim(),
  race_date: isoDate(row.date),
  date_verified: /^y(es)?$/i.test((row.date_verified ?? '').trim()),
  town: real(row.town),
  tier: tier(row.tier),
  course_map_url: real(row.course_map_url),
  map_type: normalizeMapType(row.map_type),
  hereday_link: (() => {
    const link = real(row.hereday_link);
    if (link && !/hereday\.io\/event\//i.test(link) && !/^[a-z0-9-]+$/.test(link)) {
      warnings.push(`hereday_link "${link}" isn't a Hereday event link; ignored.`);
      return null;
    }
    return link;
  })(),
  objection: real(row.objection),
  notes: real(row.notes),
  raw: { ...row },
});

const STAGE_FROM_STATUS: Record<string, Stage> = {
  new: 'new',
  claimed: 'new',
  researched: 'researched',
  map_built: 'researched',
  drafted: 'drafted',
  sent: 'sent',
  followed_up: 'followed_up',
  replied: 'replied',
  published: 'replied',
  paid: 'replied',
  closed: 'closed',
  no_contact: 'no_contact',
  do_not_contact: 'closed',
};

const maxStage = (a: Stage, b: Stage): Stage => {
  const order: Stage[] = ['new', 'no_contact', 'researched', 'drafted', 'sent', 'followed_up', 'replied', 'closed'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
};

/**
 * One outreach/leads.csv row. `importerId` owns everything past `new`
 * (Kevin researched or sent those himself); `new` rows go to the pool.
 */
export function mapLeadsCsvRow(row: Record<string, string>, index: number, importerId: string): ImportRow {
  const warnings: string[] = [];
  const b = base(row, warnings);
  const status = (row.status ?? '').trim().toLowerCase();
  let stage = STAGE_FROM_STATUS[status];
  if (!stage) {
    warnings.push(`Unknown status "${row.status}"; imported as new.`);
    stage = 'new';
  }
  if (status === 'map_built' && !b.hereday_link) warnings.push('Status is map_built but there is no hereday_link.');

  const rawOutcome = real(row.outcome);
  const excluded = rawOutcome?.toLowerCase() === 'excluded';
  const { outcome, claim } = outcomeFrom(rawOutcome);
  if (claim) stage = maxStage(stage, 'replied');

  const orgType = normalizeOrgType(row.org_type);
  const sentAt = isoDate(row.sent_date);
  const email = real(row.email);

  return {
    ...b,
    priority: index + 1,
    account: accountFrom(row.org_type, warnings),
    contact: contactFrom(row, warnings, false),
    stage,
    outcome: stage === 'closed' ? outcome : null,
    owner_id: stage === 'new' ? null : importerId,
    owner_name: null,
    claimed_at: null,
    channel: sentAt && email ? 'email' : null,
    sent_at: sentAt,
    // In leads.csv this is the day the follow-up was done.
    followed_up_at: isoDate(row.followup_date),
    next_step: stage === 'no_contact' ? 'Revisit when spring race pages go up' : null,
    next_step_at: null,
    fit_flags: fitFlagsFrom(row.notes ?? '', orgType, excluded),
    gmail_draft_id: real(row.gmail_draft_id),
    tracker_claims: claim ? [claim] : [],
    warnings,
  };
}

/** True for the sheet's instructional row ("EXAMPLE — delete this row"). */
export const isExampleRow = (row: Record<string, string>): boolean =>
  /^example/i.test((row.owner ?? '').trim()) || /^example-/i.test((row.slug ?? '').trim());

/**
 * One row of the reps' sheet. Owner names are resolved to staff ids by
 * the caller (resolveOwner), since only the UI knows who the staff are.
 */
export function mapSheetRow(row: Record<string, string>, ownerId: string | null): ImportRow {
  const warnings: string[] = [];
  const b = base(row, warnings);
  const status = (row.status ?? '').trim().toLowerCase();
  let stage = STAGE_FROM_STATUS[status];
  if (!stage) {
    warnings.push(`Unknown status "${row.status}"; imported as new.`);
    stage = 'new';
  }

  const dnc = /^y(es)?$/i.test((row.do_not_contact ?? '').trim()) || status === 'do_not_contact';
  const statusClaim = status === 'published' || status === 'paid' ? status : null;
  const { outcome, claim } = outcomeFrom(real(row.outcome));
  const claims = [statusClaim, claim].filter((c): c is 'published' | 'paid' => !!c);
  if (claims.length) stage = maxStage(stage, 'replied');

  const ownerName = real(row.owner);
  if (ownerName && !ownerId) warnings.push(`Owner "${ownerName}" isn't a staff member yet; left unclaimed.`);

  // In the sheet, followup_date is when the follow-up is due — unless the
  // row is already past it, in which case it's the best date we have for
  // when it happened.
  const followupDate = isoDate(row.followup_date);
  const followedUp = ['followed_up', 'replied', 'published', 'paid'].includes(status);
  if (followupDate && followedUp) warnings.push('followup_date read as the date the follow-up happened (approximate).');

  const channel = real(row.channel)?.toLowerCase() ?? null;
  const orgType = normalizeOrgType(row.org_type);

  return {
    ...b,
    priority: null,
    account: accountFrom(row.org_type, warnings),
    contact: contactFrom(row, warnings, dnc),
    stage,
    outcome: stage === 'closed' ? (dnc ? 'do_not_contact' : outcome) : null,
    owner_id: ownerId,
    owner_name: ownerName,
    claimed_at: ownerId ? isoDate(row.claimed_date) : null,
    channel: isOneOf(CHANNELS, channel) ? channel : null,
    sent_at: isoDate(row.sent_date),
    followed_up_at: followupDate && followedUp ? followupDate : null,
    next_step: followupDate && !followedUp ? "Follow up once (call if there's a phone)" : null,
    next_step_at: followupDate && !followedUp ? followupDate : null,
    fit_flags: fitFlagsFrom(row.notes ?? '', orgType, false),
    gmail_draft_id: null,
    tracker_claims: claims,
    warnings,
  };
}

/** Matches a sheet owner ("Pat", "pat@hereday.io", "Pat Smith") to a staff member. */
export function resolveOwner(
  name: string | null,
  staff: Array<{ user_id: string; email: string; display_name: string }>,
): string | null {
  const n = name?.trim().toLowerCase();
  if (!n) return null;
  const exact = staff.find(
    (s) => s.email.toLowerCase() === n || s.display_name.toLowerCase() === n || s.email.toLowerCase().split('@')[0] === n,
  );
  if (exact) return exact.user_id;
  const first = n.split(/\s+/)[0];
  const byFirst = staff.filter(
    (s) => s.display_name.toLowerCase().split(/\s+/)[0] === first || s.email.toLowerCase().split('@')[0] === first,
  );
  return byFirst.length === 1 ? byFirst[0].user_id : null;
}

/** Slugs repeated within one file; the import refuses those rows. */
export const duplicateSlugs = (rows: Array<{ slug: string }>): string[] => {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.slug)) dupes.add(r.slug);
    seen.add(r.slug);
  }
  return [...dupes];
};
