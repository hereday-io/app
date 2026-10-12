/**
 * The CRM's controlled vocabulary, mirroring the CHECK constraints in
 * supabase/migrations/20261012121000_crm_schema.sql. One list per column,
 * plus human labels. Plain data with erasable-only TypeScript, so the
 * Phase 2 CLI can import it straight from Node.
 */

export const STAGES = [
  'new',
  'researched',
  'drafted',
  'sent',
  'followed_up',
  'replied',
  'closed',
  'no_contact',
] as const;
export type Stage = (typeof STAGES)[number];

/** Stored stage plus the three derived from app data. */
export const EFFECTIVE_STAGES = [...STAGES, 'signed_up', 'published', 'paid'] as const;
export type EffectiveStage = (typeof EFFECTIVE_STAGES)[number];

export const STAGE_LABELS: Record<EffectiveStage, string> = {
  new: 'New',
  researched: 'Researched',
  drafted: 'Drafted',
  sent: 'Sent',
  followed_up: 'Followed up',
  replied: 'Replied',
  closed: 'Closed',
  no_contact: 'No contact',
  signed_up: 'Signed up',
  published: 'Published',
  paid: 'Paid',
};

export const OUTCOMES = [
  'no_response',
  'not_interested',
  'has_map',
  'timing',
  'not_a_fit',
  'bad_contact',
  'removed',
  'adopted',
  'do_not_contact',
  'other',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  no_response: 'No response',
  not_interested: 'Not interested',
  has_map: 'Already has a map',
  timing: 'Bad timing',
  not_a_fit: 'Not a fit',
  bad_contact: 'Bad contact / bounced',
  removed: 'Removed',
  adopted: 'Adopted',
  do_not_contact: 'Do not contact',
  other: 'Other',
};

export const MAP_TYPES = [
  'image',
  'pdf',
  'gpx',
  'strava',
  'mapmyrun',
  'rungo',
  'google_my_maps',
  'embedded',
  'description',
  'none',
  'unknown',
] as const;
export type MapType = (typeof MAP_TYPES)[number];

export const MAP_TYPE_LABELS: Record<MapType, string> = {
  image: 'Image',
  pdf: 'PDF',
  gpx: 'GPX',
  strava: 'Strava',
  mapmyrun: 'MapMyRun',
  rungo: 'RunGo',
  google_my_maps: 'Google My Maps',
  embedded: 'Embedded map',
  description: 'Text description',
  none: 'None',
  unknown: 'Unknown',
};

export const ORG_TYPES = [
  'park_district',
  'municipal',
  'school_booster',
  'school_foundation',
  'school',
  'church',
  'service_club',
  'running_club',
  'charity',
  'chamber',
  'business',
  'race_mgmt_company',
  'other',
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  park_district: 'Park district',
  municipal: 'Municipal',
  school_booster: 'School booster',
  school_foundation: 'School foundation',
  school: 'School',
  church: 'Church',
  service_club: 'Service club',
  running_club: 'Running club',
  charity: 'Charity',
  chamber: 'Chamber of commerce',
  business: 'Business',
  race_mgmt_company: 'Race-management company',
  other: 'Other',
};

export const FIT_FLAGS = [
  'large_field',
  'race_mgmt_company',
  'has_published_map',
  'outside_radius',
  'no_named_contact',
  'other',
] as const;
export type FitFlag = (typeof FIT_FLAGS)[number];

export const FIT_FLAG_LABELS: Record<FitFlag, string> = {
  large_field: 'Large field',
  race_mgmt_company: 'Race-management company',
  has_published_map: 'Already publishes a map',
  outside_radius: 'Outside radius',
  no_named_contact: 'No named contact',
  other: 'Other concern',
};

export const CHANNELS = ['email', 'phone', 'form'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Activity types a person can log (the rest are written by the system). */
export const LOGGABLE_ACTIVITIES = [
  'note',
  'email_sent',
  'followup_sent',
  'call',
  'voicemail',
  'form_submitted',
  'reply',
  'objection',
  'research',
  'backlink_asked',
  'backlink_live',
] as const;
export type LoggableActivity = (typeof LOGGABLE_ACTIVITIES)[number];

export const ACTIVITY_LABELS: Record<string, string> = {
  note: 'Note',
  email_sent: 'Email sent',
  followup_sent: 'Follow-up sent',
  call: 'Call',
  voicemail: 'Voicemail',
  form_submitted: 'Contact form',
  reply: 'Reply',
  objection: 'Objection',
  stage_change: 'Stage changed',
  claim: 'Claimed',
  release: 'Released',
  assign: 'Assigned',
  dnc: 'Do not contact',
  event_linked: 'Map linked',
  event_unlinked: 'Map unlinked',
  research: 'Research',
  import: 'Imported',
  handoff_requested: 'Handoff requested',
  backlink_asked: 'Backlink asked',
  backlink_live: 'Backlink live',
  app_event_created: 'Map created',
  app_event_published: 'Map published',
  app_transferred: 'Map handed off',
  app_purchase: 'Paid',
  app_refund: 'Refunded',
  app_signed_up: 'Signed up to Hereday',
};

/** Activities that count as reaching out; blocked on do-not-contact. */
export const OUTBOUND_ACTIVITIES: readonly string[] = [
  'email_sent',
  'followup_sent',
  'call',
  'voicemail',
  'form_submitted',
];

export const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);
