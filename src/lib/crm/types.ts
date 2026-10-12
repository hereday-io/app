import type { Channel, EffectiveStage, FitFlag, MapType, OrgType, Outcome, Stage } from './vocab.ts';

/**
 * Shapes returned by the crm_* RPCs (they return jsonb, so the generated
 * Supabase types only say `Json`). Fields marked "owner/admin" are
 * absent, not null, when the caller can't see the deal's details.
 */

export type StaffRole = 'admin' | 'sales';

export interface StaffMember {
  user_id: string;
  email: string;
  display_name: string;
  role: StaffRole;
}

export interface Deal {
  id: string;
  slug: string;
  race_name: string;
  race_date: string | null;
  date_verified: boolean;
  town: string | null;
  tier: number | null;
  priority: number | null;
  source: 'leads_csv' | 'sales_sheet' | 'manual' | 'inbound' | 'renewal';
  stage: Stage;
  effective_stage: EffectiveStage;
  stage_changed_at: string;
  outcome: Outcome | null;
  closed_at: string | null;
  owner_id: string | null;
  owner_name: string | null;
  claimed_at: string | null;
  claim_open: boolean;
  claim_expires_at: string | null;
  is_mine: boolean;
  can_view_details: boolean;
  channel: Channel | null;
  sent_at: string | null;
  followed_up_at: string | null;
  next_step_at: string | null;
  is_due: boolean;
  is_dnc: boolean;
  fit_flags: FitFlag[];
  map_type: MapType | null;
  course_map_url: string | null;
  hereday_link: string | null;
  account_id: string | null;
  account_name: string | null;
  org_type: OrgType | null;
  has_email: boolean;
  has_phone: boolean;
  previous_deal_id: string | null;
  created_at: string;
  updated_at: string;
  // App facts
  map_built: boolean;
  map_published: boolean;
  customer_owns_event: boolean;
  customer_published: boolean;
  signed_up_at: string | null;
  paid_at: string | null;
  comped: boolean;
  refunded: boolean;
  handed_off_at: string | null;
  last_activity_at: string | null;
  handoff_requested_at: string | null;
  handoff_pending: boolean;
  // Owner/admin only
  contact_id?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  next_step?: string | null;
  objection?: string | null;
  notes?: string | null;
  gmail_draft_id?: string | null;
  gmail_draft_mailbox?: string | null;
  gmail_thread_id?: string | null;
}

export interface DealAccount {
  id: string;
  name: string;
  org_type: OrgType | null;
  org_description: string | null;
  town: string | null;
  website: string | null;
  do_not_contact: boolean;
  dnc_at: string | null;
  notes?: string | null;
  dnc_reason?: string | null;
}

export interface DealContact {
  id: string;
  has_email: boolean;
  has_phone: boolean;
  do_not_contact: boolean;
  dnc_at: string | null;
  signed_up_at: string | null;
  other_deal_count: number;
  // Owner/admin only
  full_name?: string | null;
  role_title?: string | null;
  email?: string | null;
  email_source?: string | null;
  phone?: string | null;
  phone_source?: string | null;
  notes?: string | null;
  dnc_reason?: string | null;
  user_id?: string | null;
}

export interface DealEvent {
  event_id: string;
  name: string;
  slug: string | null;
  status: 'draft' | 'published';
  event_date: string | null;
  created_at: string;
  owner_is_staff: boolean;
  owner_email: string | null;
  is_paid: boolean;
  is_comped: boolean;
  is_refunded: boolean;
  paid_at: string | null;
  first_published_at: string | null;
  last_transferred_at: string | null;
  link_source: string;
  linked_at: string;
}

export interface TimelineItem {
  id: string;
  source: 'crm' | 'app';
  type: string;
  occurred_at: string;
  body: string | null;
  quote: string | null;
  meta: Record<string, unknown>;
  actor_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface DealAllowed {
  view_details: boolean;
  edit: boolean;
  claim: boolean;
  release: boolean;
  assign: boolean;
  mark_dnc: boolean;
  link_event: boolean;
  unlink_event: boolean;
  void: boolean;
}

export interface DealDetail {
  deal: Deal;
  account: DealAccount | null;
  contact: DealContact | null;
  events: DealEvent[];
  timeline: TimelineItem[];
  allowed: DealAllowed;
}

export interface SignupEvent {
  event_id: string;
  name: string;
  slug: string | null;
  status: 'draft' | 'published';
  event_date: string | null;
  city: string | null;
  created_at: string;
  is_paid: boolean;
  is_comped: boolean;
  disposition: 'linked' | 'dismissed' | null;
  dismiss_reason: string | null;
  deal_slug: string | null;
  deal_race_name: string | null;
}

export interface SignupSuggestion {
  deal_id: string;
  slug: string;
  race_name: string;
  reason: 'contact' | 'transfer' | 'name';
}

export interface Signup {
  user_id: string;
  email: string;
  display_name: string | null;
  organization_name: string | null;
  signed_up_at: string;
  utm_source: string | null;
  first_referrer: string | null;
  events: SignupEvent[];
  suggestions: SignupSuggestion[];
}

export type SignupScope = 'untriaged' | 'all' | 'staff_maps';

/** One normalized row for crm_import (built by leadImport.ts). */
export interface ImportRow {
  slug: string;
  race_name: string;
  race_date: string | null;
  date_verified: boolean;
  town: string | null;
  tier: number | null;
  priority: number | null;
  account: { name: string; org_type: OrgType | null; org_description: string | null } | null;
  contact: {
    full_name: string | null;
    email: string | null;
    email_source: string | null;
    phone: string | null;
    phone_source: string | null;
    do_not_contact: boolean;
  } | null;
  stage: Stage;
  outcome: Outcome | null;
  owner_id: string | null;
  /** The sheet's owner name, kept so the UI can map it to a staff member. */
  owner_name: string | null;
  claimed_at: string | null;
  channel: Channel | null;
  sent_at: string | null;
  followed_up_at: string | null;
  next_step: string | null;
  next_step_at: string | null;
  objection: string | null;
  fit_flags: FitFlag[];
  course_map_url: string | null;
  map_type: MapType | null;
  hereday_link: string | null;
  gmail_draft_id: string | null;
  notes: string | null;
  tracker_claims: Array<'published' | 'paid'>;
  raw: Record<string, string>;
  /** Client-side mapping notes, shown in the dry-run preview. */
  warnings: string[];
}

export type ImportSource = 'leads_csv' | 'sales_sheet';
export type ImportMode = 'insert_only' | 'fill_blanks';

export interface ImportRowResult {
  slug: string;
  action: 'created' | 'exists' | 'filled' | 'conflict' | 'error';
  deal_id?: string;
  stage?: Stage;
  outcome?: Outcome | null;
  event_link?: string | null;
  conflict_with?: string;
  conflict_owner?: string;
  error?: string;
  warnings: string[];
}

export interface ImportReport {
  dry_run: boolean;
  source: ImportSource;
  mode: ImportMode;
  counts: Partial<Record<ImportRowResult['action'], number>>;
  rows: ImportRowResult[];
}
