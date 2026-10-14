import { describe, it, expect } from 'vitest';
import { windowCoverage } from './metrics';

const now = new Date('2026-10-14T21:00:00Z');

describe('windowCoverage', () => {
  it('treats a missing start as full coverage', () => {
    expect(windowCoverage(null, 30, now)).toEqual({
      partial: false,
      prevPartial: false,
      startDay: null,
      coveredDays: 31,
    });
  });

  it('flags a source that started today as covering one day of both windows', () => {
    const c = windowCoverage('2026-10-14T19:52:42.812Z', 30, now);
    expect(c).toEqual({ partial: true, prevPartial: true, startDay: '2026-10-14', coveredDays: 1 });
  });

  it('counts covered days inclusively from the start day', () => {
    expect(windowCoverage('2026-10-10T08:00:00Z', 30, now).coveredDays).toBe(5);
  });

  it('covers this window but only part of the prior one', () => {
    // 7d window starts Oct 7 21:00; prior starts Sep 30 21:00.
    const c = windowCoverage('2026-10-03T12:00:00Z', 7, now);
    expect(c.partial).toBe(false);
    expect(c.prevPartial).toBe(true);
    expect(c.startDay).toBeNull();
    expect(c.coveredDays).toBe(8);
  });

  it('allows a day of slack at the start of the prior window', () => {
    expect(windowCoverage('2026-10-01T10:00:00Z', 7, now).prevPartial).toBe(false);
  });
});
