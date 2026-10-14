import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Supabase resolves (never rejects) with `{ data: null, error }` on failure.
 * These pages used to read only `data`, so a failed load rendered the
 * "No events yet" empty state and a failed publish silently refetched. This
 * file drives the real page components against a scripted client to pin the
 * error paths down — they sit behind auth, so nothing else exercises them.
 */

type Result = { data: unknown; error: { message: string } | null };
type Op = { table: string; action: string };

// Per-test responder: decides what each awaited query resolves to.
let respond: (op: Op) => Result = () => ({ data: [], error: null });
const ops: Op[] = [];
const toast = vi.fn();

vi.mock('@/integrations/supabase/client', () => {
  const builder = (table: string) => {
    let action = 'select';
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'is']) b[m] = self;
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      b[m] = () => { action = m; return b; };
    }
    const settle = () => {
      const op = { table, action };
      ops.push(op);
      return Promise.resolve(respond(op));
    };
    b.single = settle;
    b.maybeSingle = settle;
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => settle().then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
    },
  };
});

// One stable object: pages key useCallback/useEffect on `user`, so a fresh
// object per render would refetch in a loop. Mutable so a test can make
// the email unconfirmed.
const authUser = vi.hoisted(() => ({
  id: 'user-1',
  email: 't@example.invalid',
  email_confirmed_at: '2026-10-01T00:00:00Z' as string | null,
}));
vi.mock('@/hooks/useAuth', () => {
  const auth = { user: authUser, loading: false, signOut: () => {} };
  return { useAuth: () => auth };
});
vi.mock('@/hooks/useStaffRole', () => ({ useStaffRole: () => ({ role: null, loading: false }) }));
vi.mock('@/hooks/use-toast', () => {
  const api = { toast: (...args: unknown[]) => toast(...args) };
  return { useToast: () => api, toast: api.toast };
});
vi.mock('@/lib/analytics', () => ({ logEvent: vi.fn(), identifyUser: vi.fn(), resetUser: vi.fn() }));

const draftEvent = {
  id: 'evt-1',
  name: 'Test 5K',
  city: null,
  event_date: null,
  status: 'draft',
  slug: 'test-5k',
  route_count: 1,
  poi_count: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  // One drawable route, so the dashboard's publish guard lets it through.
  routes: [{ waypoints: [[-97.74, 30.27], [-97.73, 30.28]] }],
  paid_at: null,
};

const eventSelects = () => ops.filter((o) => o.table === 'events' && o.action === 'select').length;
const eventUpdates = () => ops.filter((o) => o.table === 'events' && o.action === 'update').length;

beforeEach(() => {
  ops.length = 0;
  toast.mockReset();
  authUser.email_confirmed_at = '2026-10-01T00:00:00Z';
  respond = () => ({ data: [], error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Dashboard', () => {
  const renderDashboard = async () => {
    const { default: Dashboard } = await import('./Dashboard');
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
  };

  it('shows an error state, not the empty state, when events fail to load', async () => {
    respond = ({ table }) =>
      table === 'events'
        ? { data: null, error: { message: 'connection reset' } }
        : { data: null, error: null };
    await renderDashboard();
    expect(await screen.findByText("Couldn't load your events")).toBeTruthy();
    // Friendly copy, never the raw PostgREST message.
    expect(screen.getByText(/Check your connection and try again/)).toBeTruthy();
    expect(screen.queryByText(/connection reset/)).toBeNull();
    expect(screen.queryByText('No events yet')).toBeNull();
  });

  it('toasts and keeps the event a draft when publishing fails', async () => {
    respond = ({ table, action }) => {
      if (table === 'events' && action === 'update') return { data: null, error: { message: 'permission denied' } };
      if (table === 'events') return { data: [draftEvent], error: null };
      return { data: null, error: null };
    };
    await renderDashboard();
    const [publish] = await screen.findAllByRole('button', { name: /^Publish$/ });
    fireEvent.click(publish);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "Couldn't publish", variant: 'destructive' });
    expect(JSON.stringify(toast.mock.calls[0][0])).not.toMatch(/permission denied/);
    // No refetch, so nothing on screen claims the event went live.
    expect(eventSelects()).toBe(1);
    expect(screen.getAllByRole('button', { name: /^Publish$/ }).length).toBeGreaterThan(0);
  });

  it('blocks publishing until the email is confirmed, like the editor', async () => {
    authUser.email_confirmed_at = null;
    respond = ({ table }) => (table === 'events' ? { data: [draftEvent], error: null } : { data: null, error: null });
    await renderDashboard();
    const [publish] = await screen.findAllByRole('button', { name: /^Publish$/ });
    fireEvent.click(publish);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'Verify your email to publish' });
    expect(eventUpdates()).toBe(0);
  });

  it('blocks publishing an event with no drawn route, like the editor', async () => {
    respond = ({ table }) =>
      table === 'events' ? { data: [{ ...draftEvent, routes: [] }], error: null } : { data: null, error: null };
    await renderDashboard();
    const [publish] = await screen.findAllByRole('button', { name: /^Publish$/ });
    fireEvent.click(publish);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'Draw a route first' });
    expect(eventUpdates()).toBe(0);
  });

  it('treats an update that matched no row as a failure', async () => {
    respond = ({ table, action }) => {
      if (table === 'events' && action === 'update') return { data: [], error: null };
      if (table === 'events') return { data: [draftEvent], error: null };
      return { data: null, error: null };
    };
    await renderDashboard();
    const [publish] = await screen.findAllByRole('button', { name: /^Publish$/ });
    fireEvent.click(publish);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: "Can't publish: you no longer have access to this event",
      variant: 'destructive',
    });
    expect(eventSelects()).toBe(1);
  });

  it('confirms and refetches after a successful publish', async () => {
    respond = ({ table, action }) => {
      if (table === 'events' && action === 'update') return { data: [{ id: 'evt-1' }], error: null };
      if (table === 'events') return { data: [draftEvent], error: null };
      return { data: null, error: null };
    };
    await renderDashboard();
    const [publish] = await screen.findAllByRole('button', { name: /^Publish$/ });
    fireEvent.click(publish);
    await waitFor(() => expect(eventSelects()).toBe(2));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test 5K is published' }));
  });

  it('labels a past published event "Unpublish" and asks before unpublishing', async () => {
    // Past + published: not "live", but still published — the menu used to
    // say "Publish" here and then unpublish it.
    const pastPublished = { ...draftEvent, status: 'published', event_date: '2020-01-01' };
    respond = ({ table, action }) => {
      if (table === 'events' && action === 'update') return { data: [{ id: 'evt-1' }], error: null };
      if (table === 'events') return { data: [pastPublished], error: null };
      return { data: null, error: null };
    };
    await renderDashboard();
    const [more] = await screen.findAllByRole('button', { name: 'More actions' });
    fireEvent.keyDown(more, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Unpublish/ }));
    expect(await screen.findByText('Unpublish Test 5K?')).toBeTruthy();
    expect(eventUpdates()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(eventUpdates()).toBe(1));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test 5K is unpublished' })),
    );
  });
});

describe('Billing', () => {
  it('shows an error state, not "No events yet", when events fail to load', async () => {
    respond = ({ table }) =>
      table === 'events'
        ? { data: null, error: { message: 'connection reset' } }
        : { data: null, error: null };
    const { default: Billing } = await import('./Billing');
    render(<MemoryRouter><Billing /></MemoryRouter>);
    expect(await screen.findByText("Couldn't load your events")).toBeTruthy();
    expect(screen.queryByText(/No events yet/)).toBeNull();
  });
});
