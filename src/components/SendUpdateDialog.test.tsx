import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import SendUpdateDialog from './SendUpdateDialog';

const invoke = vi.fn();
const toast = vi.fn();

// A PostgREST query stub: every builder method chains, and awaiting it
// (or calling maybeSingle) resolves to `result`.
const query = (result: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve(result);
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'event_subscribers') return query({ count: 120, error: null });
      if (table === 'events') {
        const roster = Array.from({ length: 22 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, email: `v${i}@example.com` }));
        return query({ data: { volunteer_roster: roster }, error: null });
      }
      return query({ data: [], error: null }); // email_sends: no history
    },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/analytics', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/posthog', () => ({ reportError: vi.fn() }));

const send = async () => {
  const onOpenChange = vi.fn();
  render(<SendUpdateDialog open onOpenChange={onOpenChange} eventId="evt-1" eventName="Crystal Lake 5K" />);
  // Counts load before "Review & send" is enabled.
  await screen.findByText('120');
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Course change' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'The start moved.' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Review & send/ })[0]);
  fireEvent.click(screen.getByRole('button', { name: /Send now/ }));
  await waitFor(() => expect(toast).toHaveBeenCalled());
  return { onOpenChange, shown: toast.mock.calls[0][0] };
};

beforeEach(() => {
  invoke.mockReset();
  toast.mockReset();
});

describe('SendUpdateDialog send result', () => {
  it('reports a full send', async () => {
    invoke.mockResolvedValue({
      data: { sent: { subscribers: 120, volunteers: 22 }, totalRecipients: 142, intendedRecipients: 142, partial: false },
      error: null,
    });
    const { shown, onOpenChange } = await send();
    expect(shown).toMatchObject({ title: 'Update sent', description: 'Sent to 142 people.' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('says how many people a partial send missed, and keeps the message up', async () => {
    invoke.mockResolvedValue({
      data: { sent: { subscribers: 100, volunteers: 0 }, totalRecipients: 100, intendedRecipients: 142, partial: true },
      error: null,
    });
    const { shown } = await send();
    expect(shown.description).toBe(
      "Sent to 100 of 142 people. The other 42 didn't go out. Contact support at hello@hereday.io before trying again.",
    );
    expect(shown.variant).toBe('destructive');
    expect(shown.duration).toBe(Infinity);
  });

  it('still reports success from a function without partial (before it is redeployed)', async () => {
    invoke.mockResolvedValue({ data: { sent: { subscribers: 120, volunteers: 22 }, totalRecipients: 142 }, error: null });
    const { shown } = await send();
    expect(shown).toMatchObject({ title: 'Update sent', description: 'Sent to 142 people.' });
  });

  it('says nobody received it when the function errors', async () => {
    const res = new Response(JSON.stringify({ error: 'Email provider rejected the send' }), { status: 502 });
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(res) });
    const { shown } = await send();
    expect(shown).toMatchObject({ title: "Your update wasn't sent", description: 'Nobody received it. Try again in a minute.' });
  });

  it("doesn't claim nobody received it when the connection dropped", async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) });
    const { shown } = await send();
    expect(shown.title).toBe("We couldn't confirm your update went out");
    expect(shown.description).not.toMatch(/Nobody received/);
  });
});
