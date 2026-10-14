import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UpgradeModal from './UpgradeModal';

const invoke = vi.fn();
const reportError = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock('@/lib/posthog', () => ({ reportError: (...args: unknown[]) => reportError(...args) }));
vi.mock('@/lib/analytics', () => ({ logEvent: vi.fn() }));
vi.mock('@/components/ProWaitlistCapture', () => ({ default: () => null }));

const renderModal = () => render(
  <MemoryRouter>
    <UpgradeModal open onClose={() => {}} trigger="routes" eventId="evt-1" />
  </MemoryRouter>,
);

beforeEach(() => {
  invoke.mockReset();
  reportError.mockReset();
});

describe('UpgradeModal checkout', () => {
  it('tells the customer and reports it when create-checkout fails', async () => {
    const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: { status: 500 } });
    invoke.mockResolvedValue({ data: null, error: err });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Unlock this event/ }));
    expect(await screen.findByText(/Couldn't open checkout/)).toBeTruthy();
    expect(reportError).toHaveBeenCalledWith(err, expect.objectContaining({
      area: 'billing', action: 'create_checkout', hereday_event_id: 'evt-1', trigger: 'routes',
    }));
    // The button is usable again for a retry.
    await waitFor(() => expect(screen.getByRole('button', { name: /Unlock this event/ })).not.toBeDisabled());
  });

  it('reports a response with no checkout url', async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Unlock this event/ }));
    expect(await screen.findByText(/Couldn't open checkout/)).toBeTruthy();
    expect(reportError.mock.calls[0][0].message).toBe('create-checkout returned no url');
  });
});
