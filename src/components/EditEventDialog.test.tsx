import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditEventDialog from './EditEventDialog';

const update = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => {
        update(payload);
        return { eq: () => ({ select: () => Promise.resolve({ data: [{ id: 'e1' }], error: null }) }) };
      },
    }),
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const event = {
  id: 'e1',
  name: 'Lincolnwood Turkey Trot',
  city: 'Lincolnwood',
  event_date: '2026-11-22',
  start_time: '08:00:00',
  registration_url: null,
  status: 'published',
  slug: 'lincolnwood-turkey-trot',
};

const renderDialog = (overrides = {}) => {
  const onUpdated = vi.fn();
  render(
    <EditEventDialog open onOpenChange={vi.fn()} event={{ ...event, ...overrides }} onUpdated={onUpdated} />,
  );
  return { onUpdated, input: screen.getByLabelText(/registration link/i) as HTMLInputElement };
};

describe('EditEventDialog registration link', () => {
  beforeEach(() => update.mockClear());

  it('prefills the stored link', () => {
    const { input } = renderDialog({ registration_url: 'https://runsignup.com/Race/1' });
    expect(input.value).toBe('https://runsignup.com/Race/1');
  });

  it('adds https:// to a bare domain on blur and saves it', async () => {
    const { input, onUpdated } = renderDialog();
    fireEvent.change(input, { target: { value: 'runsignup.com/TurkeyTrot' } });
    fireEvent.blur(input);
    expect(input.value).toBe('https://runsignup.com/TurkeyTrot');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toMatchObject({ registration_url: 'https://runsignup.com/TurkeyTrot' });
  });

  it('saves null when the field is cleared', async () => {
    const { input, onUpdated } = renderDialog({ registration_url: 'https://runsignup.com/Race/1' });
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toMatchObject({ registration_url: null });
  });

  it('refuses a non-web link and says why, without saving', async () => {
    const { input } = renderDialog();
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/starts with https:\/\//i)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(update).not.toHaveBeenCalled();
  });
});
