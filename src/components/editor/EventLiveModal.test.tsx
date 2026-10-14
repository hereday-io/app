import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EventLiveModal from './EventLiveModal';

// The QR block draws to a canvas via the qrcode package; nothing here is
// about the QR itself.
vi.mock('@/components/editor/ShareQrCode', () => ({ default: () => null }));

const renderModal = (isPro: boolean) => {
  const onOpenOpsCenter = vi.fn();
  const onUnlockPro = vi.fn();
  render(
    <EventLiveModal
      open
      onClose={() => {}}
      publicUrl="https://hereday.io/event/test-5k"
      eventName="Test 5K"
      eventId="evt-1"
      isPro={isPro}
      onOpenOpsCenter={onOpenOpsCenter}
      onUnlockPro={onUnlockPro}
    />,
  );
  return { onOpenOpsCenter, onUnlockPro };
};

describe('EventLiveModal', () => {
  it('leads with the share link', () => {
    renderModal(false);
    expect(screen.getByText('Your event is live')).toBeTruthy();
    expect(screen.getByText('https://hereday.io/event/test-5k')).toBeTruthy();
    expect(screen.getByRole('link', { name: /preview public page/i })).toBeTruthy();
  });

  it('offers Pro as one quiet line on a Free event, never the locked Ops Center', () => {
    const { onUnlockPro } = renderModal(false);
    expect(screen.queryByRole('button', { name: /ops center/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /unlock pro for this event/i }));
    expect(onUnlockPro).toHaveBeenCalledOnce();
  });

  it('sends a Pro event to the Ops Center and shows no upsell', () => {
    const { onOpenOpsCenter } = renderModal(true);
    expect(screen.queryByRole('button', { name: /unlock pro/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /open ops center/i }));
    expect(onOpenOpsCenter).toHaveBeenCalledOnce();
  });
});
