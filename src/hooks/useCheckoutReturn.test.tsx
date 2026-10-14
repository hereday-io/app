import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import {
  useCheckoutReturn,
  CHECKOUT_POLL_INTERVAL_MS,
  CHECKOUT_POLL_TIMEOUT_MS,
  type CheckoutProRow,
} from './useCheckoutReturn';

// Each poll resolves to the next scripted row; the last one repeats.
const rows = vi.hoisted(() => ({ queue: [] as Array<CheckoutProRow | null>, reads: [] as string[] }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: () => {
            rows.reads.push(`${table}:${id}`);
            const data = rows.queue.length > 1 ? rows.queue.shift()! : rows.queue[0];
            return Promise.resolve({ data, error: null });
          },
        }),
      }),
    }),
  },
}));

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog', () => ({ reportError }));

function Page({ onPro }: { onPro?: (eventId: string, row: CheckoutProRow) => void }) {
  useCheckoutReturn(onPro);
  return <Toaster />;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useCheckoutReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rows.queue = [];
    rows.reads = [];
    reportError.mockReset();
  });

  afterEach(() => {
    // Toast state is module-global; don't let a sticky toast leak into the next test.
    const { result } = renderHook(() => useToast());
    act(() => result.current.dismiss());
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('shows activating, then confirms once the webhook sets paid_at', async () => {
    window.history.replaceState({ idx: 3 }, '', '/editor?id=evt-1&paid=1&event=evt-1');
    rows.queue = [{ paid_at: null }, { paid_at: null }, { paid_at: '2026-10-13T12:00:00Z' }];
    const onPro = vi.fn();
    render(<Page onPro={onPro} />);

    await advance(0);
    expect(screen.getByText('Pro is activating…')).toBeInTheDocument();
    expect(onPro).not.toHaveBeenCalled();

    await advance(CHECKOUT_POLL_INTERVAL_MS * 2);
    expect(screen.getByText('Upgrade complete')).toBeInTheDocument();
    expect(screen.queryByText('Pro is activating…')).not.toBeInTheDocument();
    expect(onPro).toHaveBeenCalledWith('evt-1', { paid_at: '2026-10-13T12:00:00Z' });
    expect(rows.reads).toEqual(['events:evt-1', 'events:evt-1', 'events:evt-1']);
    expect(reportError).not.toHaveBeenCalled();

    // Checkout params gone, the editor's own id and the router's state kept.
    expect(`${window.location.pathname}${window.location.search}`).toBe('/editor?id=evt-1');
    expect(window.history.state).toEqual({ idx: 3 });

    // Polling stopped.
    await advance(CHECKOUT_POLL_TIMEOUT_MS);
    expect(rows.reads).toHaveLength(3);
  });

  it('reassures and reports when Pro never arrives', async () => {
    window.history.replaceState(null, '', '/dashboard/events/evt-2?paid=1&event=evt-2');
    rows.queue = [{ paid_at: null }];
    const onPro = vi.fn();
    render(<Page onPro={onPro} />);

    await advance(CHECKOUT_POLL_TIMEOUT_MS - CHECKOUT_POLL_INTERVAL_MS * 2);
    expect(screen.getByText('Pro is activating…')).toBeInTheDocument();
    expect(reportError).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?paid=1&event=evt-2');

    await advance(CHECKOUT_POLL_INTERVAL_MS * 2);
    expect(screen.getByText('Your payment went through')).toBeInTheDocument();
    expect(screen.getByText(/hello@hereday\.io/)).toBeInTheDocument();
    expect(screen.queryByText('Pro is activating…')).not.toBeInTheDocument();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(new Error('paid return but not Pro'), {
      area: 'billing',
      action: 'checkout_return_not_pro',
      hereday_event_id: 'evt-2',
    });
    expect(onPro).not.toHaveBeenCalled();
    expect(`${window.location.pathname}${window.location.search}`).toBe('/dashboard/events/evt-2');

    // Gave up after ~30s of polling, and stays given up.
    const reads = rows.reads.length;
    expect(reads).toBe(CHECKOUT_POLL_TIMEOUT_MS / CHECKOUT_POLL_INTERVAL_MS + 1);
    await advance(CHECKOUT_POLL_TIMEOUT_MS);
    expect(rows.reads).toHaveLength(reads);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('handles a canceled checkout quietly', async () => {
    window.history.replaceState(null, '', '/dashboard?canceled=1&event=evt-3');
    const onPro = vi.fn();
    render(<Page onPro={onPro} />);

    await advance(CHECKOUT_POLL_TIMEOUT_MS);
    expect(rows.reads).toEqual([]);
    expect(screen.queryByText('Pro is activating…')).not.toBeInTheDocument();
    expect(screen.queryByText('Your payment went through')).not.toBeInTheDocument();
    expect(reportError).not.toHaveBeenCalled();
    expect(onPro).not.toHaveBeenCalled();
    expect(`${window.location.pathname}${window.location.search}`).toBe('/dashboard');
  });

  it('does nothing on an ordinary visit', async () => {
    window.history.replaceState(null, '', '/editor?id=evt-4');
    render(<Page />);

    await advance(CHECKOUT_POLL_TIMEOUT_MS);
    expect(rows.reads).toEqual([]);
    expect(`${window.location.pathname}${window.location.search}`).toBe('/editor?id=evt-4');
  });

  it('stops polling without reporting when the page unmounts first', async () => {
    window.history.replaceState(null, '', '/billing?paid=1&event=evt-5');
    rows.queue = [{ paid_at: null }];
    const { unmount } = render(<Page />);

    await advance(CHECKOUT_POLL_INTERVAL_MS);
    unmount();
    const reads = rows.reads.length;
    await advance(CHECKOUT_POLL_TIMEOUT_MS);
    expect(rows.reads).toHaveLength(reads);
    expect(reportError).not.toHaveBeenCalled();
  });
});
