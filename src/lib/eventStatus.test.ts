import { describe, it, expect } from 'vitest';
import {
  isReadyToPublish,
  isApproachingMarkerLimit,
  markersUntilLimit,
  isPro,
} from './eventStatus';

const baseEvent = { status: 'draft', route_count: 0, poi_count: 0, paid_at: null };

describe('isReadyToPublish', () => {
  it('returns true for a draft with at least one route and one marker', () => {
    expect(isReadyToPublish({ ...baseEvent, route_count: 1, poi_count: 1 })).toBe(true);
  });

  it('returns false for a draft with no markers', () => {
    expect(isReadyToPublish({ ...baseEvent, route_count: 1, poi_count: 0 })).toBe(false);
  });

  it('returns false for a draft with no routes', () => {
    expect(isReadyToPublish({ ...baseEvent, route_count: 0, poi_count: 5 })).toBe(false);
  });

  it('returns false for a published event even when complete', () => {
    expect(isReadyToPublish({ ...baseEvent, status: 'published', route_count: 1, poi_count: 1 })).toBe(false);
  });
});

describe('isApproachingMarkerLimit', () => {
  it('returns true when a free published event hits 22 markers', () => {
    expect(isApproachingMarkerLimit({ ...baseEvent, status: 'published', poi_count: 22 })).toBe(true);
  });

  it('returns false at 21 markers (one below the threshold)', () => {
    expect(isApproachingMarkerLimit({ ...baseEvent, status: 'published', poi_count: 21 })).toBe(false);
  });

  it('returns false for Pro events regardless of marker count', () => {
    expect(
      isApproachingMarkerLimit({ ...baseEvent, status: 'published', poi_count: 28, paid_at: '2026-01-01' }),
    ).toBe(false);
  });

  it('returns false for drafts even if they are over the threshold', () => {
    expect(isApproachingMarkerLimit({ ...baseEvent, status: 'draft', poi_count: 25 })).toBe(false);
  });
});

describe('markersUntilLimit', () => {
  it('reports markers remaining below the limit', () => {
    expect(markersUntilLimit({ poi_count: 22 })).toBe(8);
  });

  it('clamps to zero when over the limit', () => {
    expect(markersUntilLimit({ poi_count: 35 })).toBe(0);
  });
});

describe('isPro', () => {
  it('treats paid_at presence as Pro', () => {
    expect(isPro({ paid_at: '2026-01-01' })).toBe(true);
    expect(isPro({ paid_at: null })).toBe(false);
  });
});
