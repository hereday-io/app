import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Deal, DealDetail } from '@/lib/crm/types';

/**
 * Does the CRM mount, list deals and open one from the URL — for an admin
 * and for a sales rep? The RPCs are faked; the SQL behind them is tested
 * separately against real Postgres.
 */

const state = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'sales' | null }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-me', email: 'me@hereday.io' }, loading: false, signOut: vi.fn() }),
}));
vi.mock('@/hooks/useStaffRole', () => ({
  useStaffRole: () => ({ role: state.role, loading: false }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

const baseDeal = (over: Partial<Deal>): Deal => ({
  id: 'd-1',
  slug: 'glenview-gobbler',
  race_name: 'Glenview Gobbler',
  race_date: '2026-11-26',
  date_verified: true,
  town: 'Glenview',
  tier: 1,
  priority: 1,
  source: 'leads_csv',
  stage: 'sent',
  effective_stage: 'sent',
  stage_changed_at: '2026-10-01T12:00:00Z',
  outcome: null,
  closed_at: null,
  owner_id: 'u-kevin',
  owner_name: 'Kevin',
  claimed_at: '2026-10-01T12:00:00Z',
  claim_open: false,
  claim_expires_at: null,
  is_mine: false,
  can_view_details: false,
  channel: 'email',
  sent_at: '2026-10-01',
  followed_up_at: null,
  next_step_at: '2026-10-08',
  is_due: true,
  is_dnc: false,
  fit_flags: [],
  map_type: 'image',
  course_map_url: null,
  hereday_link: 'https://hereday.io/event/glenview-gobbler-5k',
  account_id: null,
  account_name: null,
  org_type: null,
  has_email: true,
  has_phone: false,
  previous_deal_id: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
  map_built: true,
  map_published: true,
  customer_owns_event: false,
  customer_published: false,
  signed_up_at: null,
  paid_at: null,
  comped: false,
  refunded: false,
  handed_off_at: null,
  last_activity_at: '2026-10-01T12:00:00Z',
  handoff_requested_at: null,
  handoff_pending: false,
  ...over,
});

const deals: Deal[] = [
  baseDeal({}),
  baseDeal({
    id: 'd-2',
    slug: 'pool-race',
    race_name: 'Pool Race',
    stage: 'new',
    effective_stage: 'new',
    owner_id: null,
    owner_name: null,
    claim_open: true,
    is_due: false,
    next_step_at: null,
    map_built: false,
    map_published: false,
  }),
  baseDeal({
    id: 'd-3',
    slug: 'paid-race',
    race_name: 'Paid Race',
    effective_stage: 'paid',
    owner_id: 'u-me',
    owner_name: 'Me',
    is_mine: true,
    can_view_details: true,
    contact_name: 'Dana',
    contact_email: 'dana@example.org',
    paid_at: '2026-10-05T12:00:00Z',
    is_due: false,
  }),
];

const detailFor = (deal: Deal): DealDetail => ({
  deal,
  account: null,
  contact: { id: 'c-1', has_email: true, has_phone: false, do_not_contact: false, dnc_at: null, signed_up_at: null, other_deal_count: 0 },
  events: [],
  timeline: [],
  allowed: {
    view_details: deal.can_view_details,
    edit: deal.can_view_details,
    claim: deal.claim_open,
    release: deal.can_view_details,
    assign: state.role === 'admin',
    mark_dnc: deal.can_view_details,
    link_event: deal.can_view_details,
    unlink_event: state.role === 'admin',
    void: state.role === 'admin',
  },
});

vi.mock('@/lib/crm/rpc', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm/rpc')>('@/lib/crm/rpc');
  return {
    ...actual,
    crmRpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case 'crm_list_deals':
          return deals;
        case 'crm_list_staff':
          return [{ user_id: 'u-kevin', email: 'k@x.io', display_name: 'Kevin', role: 'admin' }];
        case 'crm_list_signups':
          return [{ user_id: 'u-x', email: 'x@y.z', display_name: null, organization_name: null, signed_up_at: '2026-10-01', utm_source: null, first_referrer: null, events: [], suggestions: [] }];
        case 'crm_get_deal':
          return detailFor(deals.find((d) => d.slug === args.p_slug)!);
        default:
          throw new Error(`unexpected rpc ${name}`);
      }
    }),
  };
});

import AdminCrm from './AdminCrm';

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/crm" element={<AdminCrm />} />
          <Route path="/admin/crm/:slug" element={<AdminCrm />} />
          <Route path="/dashboard" element={<p>dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('AdminCrm', () => {
  beforeEach(() => {
    state.role = 'admin';
  });

  it('lists open deals for an admin, with the signups count', async () => {
    renderAt('/admin/crm');
    expect(await screen.findByText('Glenview Gobbler')).toBeInTheDocument();
    expect(screen.getByText('Pool Race')).toBeInTheDocument();
    expect(screen.getByText('Paid Race')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Signups/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Import/ })).toBeInTheDocument();
  });

  it('filters to follow-ups due', async () => {
    renderAt('/admin/crm');
    await screen.findByText('Glenview Gobbler');
    fireEvent.click(screen.getByRole('button', { name: 'Follow-ups due' }));
    expect(screen.getByText('Glenview Gobbler')).toBeInTheDocument();
    expect(screen.queryByText('Pool Race')).not.toBeInTheDocument();
  });

  it('opens the deal named in the URL', async () => {
    renderAt('/admin/crm/pool-race');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Pool Race')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Claim/ })).toBeInTheDocument();
    expect(within(dialog).getByText(/Claim the deal to see them/)).toBeInTheDocument();
  });

  it("starts a sales rep on their own deals and hides admin tools", async () => {
    state.role = 'sales';
    renderAt('/admin/crm');
    expect(await screen.findByText('Paid Race')).toBeInTheDocument();
    expect(screen.queryByText('Pool Race')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Signups/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Handoffs' })).not.toBeInTheDocument();
  });

  it("shows a rep someone else's deal without its contact details", async () => {
    state.role = 'sales';
    renderAt('/admin/crm/glenview-gobbler');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Kevin owns this deal/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Log activity/ })).not.toBeInTheDocument();
  });

  it('keeps non-staff out', async () => {
    state.role = null;
    renderAt('/admin/crm');
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });
});
