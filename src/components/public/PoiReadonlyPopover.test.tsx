import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RoutePoi } from '@/types/mapEditor';
import PoiReadonlyPopover from './PoiReadonlyPopover';

vi.mock('@/lib/analytics', () => ({ logEvent: vi.fn() }));

const poi = (title: string): RoutePoi =>
  ({ id: 'p1', type: 'water', title, coordinates: [-87.7, 42.0] } as unknown as RoutePoi);

const renderPopover = (title: string) =>
  render(<PoiReadonlyPopover poi={poi(title)} eventId="evt-1" onClose={() => {}} />);

describe('PoiReadonlyPopover header', () => {
  it('says the type once when the marker has no title of its own', () => {
    renderPopover('');
    expect(screen.getByRole('dialog', { name: 'Water Station' })).toBeTruthy();
    expect(screen.getAllByText(/water station/i)).toHaveLength(1);
  });

  it('treats a title that just repeats the type as no title', () => {
    renderPopover('water station');
    expect(screen.getAllByText(/water station/i)).toHaveLength(1);
  });

  it('shows the type as an eyebrow above a real title', () => {
    renderPopover('Mile 3 table');
    expect(screen.getByRole('dialog', { name: 'Water Station: Mile 3 table' })).toBeTruthy();
    expect(screen.getByText('Water Station')).toBeTruthy();
    expect(screen.getByText('Mile 3 table')).toBeTruthy();
  });
});
