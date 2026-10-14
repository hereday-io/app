import { describe, it, expect } from 'vitest';
import {
  formatEventDay,
  formatStartTime,
  normalizeRegistrationUrl,
  safeRegistrationHref,
} from './eventDetails';
import { climbSummary, isFlat, elevationDomain, MIN_CHART_SPAN_FT } from './elevation';

describe('formatEventDay', () => {
  it('formats a calendar day without shifting it across time zones', () => {
    expect(formatEventDay('2026-11-22')).toBe('Sun, Nov 22');
  });
  it('returns empty for missing or garbage input', () => {
    expect(formatEventDay(null)).toBe('');
    expect(formatEventDay('not-a-date')).toBe('');
  });
});

describe('formatStartTime', () => {
  it('formats a Postgres TIME', () => {
    expect(formatStartTime('08:00:00')).toBe('8:00 AM');
    expect(formatStartTime('07:30')).toBe('7:30 AM');
    expect(formatStartTime('12:05:00')).toBe('12:05 PM');
    expect(formatStartTime('00:15:00')).toBe('12:15 AM');
    expect(formatStartTime('18:45:00')).toBe('6:45 PM');
  });
  it('returns empty for missing input', () => {
    expect(formatStartTime(null)).toBe('');
    expect(formatStartTime('')).toBe('');
  });
});

describe('normalizeRegistrationUrl', () => {
  it('treats blank as clearing the link', () => {
    expect(normalizeRegistrationUrl('   ')).toEqual({ ok: true, value: null });
  });
  it('keeps http(s) links as typed', () => {
    expect(normalizeRegistrationUrl(' https://runsignup.com/Race/IL/Lincolnwood ')).toEqual({
      ok: true, value: 'https://runsignup.com/Race/IL/Lincolnwood',
    });
  });
  it('adds https:// to a bare domain', () => {
    expect(normalizeRegistrationUrl('runsignup.com/MyRace')).toEqual({ ok: true, value: 'https://runsignup.com/MyRace' });
  });
  it('rejects non-web schemes and non-URLs', () => {
    expect(normalizeRegistrationUrl('javascript:alert(1)').ok).toBe(false);
    expect(normalizeRegistrationUrl('mailto:rd@example.org').ok).toBe(false);
    expect(normalizeRegistrationUrl('sign up at the park').ok).toBe(false);
    expect(normalizeRegistrationUrl('localhost').ok).toBe(false);
  });
});

describe('safeRegistrationHref', () => {
  it('passes http(s) through and drops anything else', () => {
    expect(safeRegistrationHref('https://example.org/reg')).toBe('https://example.org/reg');
    expect(safeRegistrationHref('javascript:alert(1)')).toBeNull();
    expect(safeRegistrationHref('nonsense')).toBeNull();
    expect(safeRegistrationHref(null)).toBeNull();
  });
});

describe('climbSummary', () => {
  it('calls a course with under 10 ft of climb and descent flat', () => {
    expect(climbSummary({ gain: 0, loss: 0 })).toBe('Flat');
    expect(climbSummary({ gain: 9, loss: 7 })).toBe('Flat');
    expect(isFlat({ gain: 9, loss: 7 })).toBe(true);
  });
  it('shows gain once it is real', () => {
    expect(climbSummary({ gain: 10, loss: 0 })).toBe('+10 ft');
    expect(climbSummary({ gain: 240, loss: 230 })).toBe('+240 ft');
  });
  it('shows descent for a net-downhill course instead of calling it flat', () => {
    expect(climbSummary({ gain: 4, loss: 180 })).toBe('−180 ft');
    expect(isFlat({ gain: 4, loss: 180 })).toBe(false);
  });
});

describe('elevationDomain', () => {
  const pts = (...e: number[]) => e.map((elevation) => ({ elevation }));
  it('gives a near-flat course the minimum span, centered on its range', () => {
    const [lo, hi] = elevationDomain(pts(600, 603, 606));
    expect(hi - lo).toBeGreaterThanOrEqual(MIN_CHART_SPAN_FT);
    expect(lo).toBeLessThan(600);
    expect(hi).toBeGreaterThan(606);
    expect((lo + hi) / 2).toBeCloseTo(603, 0);
  });
  it('uses the real range for a hilly course', () => {
    expect(elevationDomain(pts(500, 720, 610))).toEqual([500, 720]);
  });
  it('handles an empty profile', () => {
    expect(elevationDomain([])).toEqual([0, MIN_CHART_SPAN_FT]);
  });
});
