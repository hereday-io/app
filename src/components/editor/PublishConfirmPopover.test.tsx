import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PublishConfirmPopover, { type PublishResult } from './PublishConfirmPopover';
import { normalizeSlug, isUniqueViolation } from '@/lib/slug';

const setup = (result: PublishResult = 'ok') => {
  const onConfirm = vi.fn().mockResolvedValue(result);
  render(
    <PublishConfirmPopover slug="lincolnwood-turkey-trot" canPublish isPublishing={false} onConfirm={onConfirm} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
  return { onConfirm, input: screen.getByRole('textbox') as HTMLInputElement };
};

describe('normalizeSlug', () => {
  it('matches the database trigger', () => {
    expect(normalizeSlug("  Henry's Thanksgiving Day Hustle 5K! ")).toBe('henry-s-thanksgiving-day-hustle-5k');
    expect(normalizeSlug('--Spring__5K--')).toBe('spring-5k');
    expect(normalizeSlug('!!!')).toBe('');
  });

  it('spots a unique violation', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '42501' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('PublishConfirmPopover', () => {
  it('shows the current link and publishes it unchanged', async () => {
    const { onConfirm, input } = setup();
    expect(input.value).toBe('lincolnwood-turkey-trot');
    fireEvent.click(screen.getAllByRole('button', { name: /^publish$/i }).at(-1)!);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('lincolnwood-turkey-trot'));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('normalizes an edited link before publishing', async () => {
    const { onConfirm, input } = setup();
    fireEvent.change(input, { target: { value: 'Lincolnwood Trot 2026' } });
    expect(screen.getByText('lincolnwood-trot-2026')).toBeTruthy();
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('lincolnwood-trot-2026'));
  });

  it('stays open and says so when the link is taken', async () => {
    const { input } = setup('slug-taken');
    fireEvent.change(input, { target: { value: 'chicago-marathon' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/that link is taken/i);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('refuses an empty link without calling publish', async () => {
    const { onConfirm, input } = setup();
    fireEvent.change(input, { target: { value: '!!!' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one letter or number/i);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
