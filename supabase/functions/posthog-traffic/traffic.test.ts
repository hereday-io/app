// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { clampDays, errorHint, shapeTraffic, trafficQueries } from './traffic';

describe('clampDays', () => {
  it('defaults junk to 30 and caps at a year', () => {
    expect(clampDays(undefined)).toBe(30);
    expect(clampDays('abc')).toBe(30);
    expect(clampDays(0)).toBe(30);
    expect(clampDays(7)).toBe(7);
    expect(clampDays(7.9)).toBe(7);
    expect(clampDays(10_000)).toBe(365);
  });
});

describe('trafficQueries', () => {
  const q = trafficQueries(30);

  it('scopes every query to production pageviews outside /admin', () => {
    for (const sql of Object.values(q)) {
      expect(sql).toContain(`event = '$pageview'`);
      expect(sql).toContain(`properties.$host IN ('hereday.io', 'www.hereday.io')`);
      expect(sql).toContain(`NOT startsWith(coalesce(properties.$pathname, ''), '/admin')`);
    }
  });

  it('reads two windows for totals and one for everything else', () => {
    expect(q.totals).toContain('INTERVAL 60 DAY');
    expect(q.totals).toContain('INTERVAL 30 DAY AS current');
    for (const sql of [q.by_day, q.top_pages, q.top_referrers]) {
      expect(sql).toContain('timestamp >= now() - INTERVAL 30 DAY');
      expect(sql).not.toContain('INTERVAL 60 DAY');
    }
  });

  it('buckets days in UTC', () => {
    expect(q.by_day).toContain("toDate(toTimeZone(timestamp, 'UTC'))");
  });

  it('drops our own hosts from referrers', () => {
    expect(q.top_referrers).toMatch(/NOT IN \('hereday\.io', 'www\.hereday\.io'\)/);
  });
});

describe('shapeTraffic', () => {
  const empty = { totals: [], by_day: [], top_pages: [], top_referrers: [] };

  it('zeros everything when PostHog has no rows', () => {
    const out = shapeTraffic(empty);
    expect(out.totals).toEqual({ pageviews: 0, visitors: 0, sessions: 0 });
    expect(out.prev_totals).toEqual({ pageviews: 0, visitors: 0, sessions: 0 });
    expect(out.by_day).toEqual([]);
  });

  it('splits the current window from the previous one whatever the boolean encoding', () => {
    for (const [cur, prev] of [[true, false], [1, 0], ['1', '0']]) {
      const out = shapeTraffic({ ...empty, totals: [[prev, 40, 10, 12], [cur, 120, 30, 35]] });
      expect(out.totals).toEqual({ pageviews: 120, visitors: 30, sessions: 35 });
      expect(out.prev_totals).toEqual({ pageviews: 40, visitors: 10, sessions: 12 });
    }
  });

  it('leaves the previous window at zero when only this one has traffic', () => {
    const out = shapeTraffic({ ...empty, totals: [[true, 5, 2, 2]] });
    expect(out.totals.pageviews).toBe(5);
    expect(out.prev_totals).toEqual({ pageviews: 0, visitors: 0, sessions: 0 });
  });

  it('maps positional rows and fills blank paths and referrers', () => {
    const out = shapeTraffic({
      ...empty,
      by_day: [['2026-10-12', '7', '3'], ['2026-10-13T00:00:00Z', 9, 4]],
      top_pages: [['/pro', 12, 8], [null, 4, 4]],
      top_referrers: [['www.google.com', 6, 5], ['', 2, 2]],
    });
    expect(out.by_day).toEqual([
      { day: '2026-10-12', pageviews: 7, visitors: 3 },
      { day: '2026-10-13', pageviews: 9, visitors: 4 },
    ]);
    expect(out.top_pages[1]).toEqual({ path: '/', pageviews: 4, visitors: 4 });
    expect(out.top_referrers[1]).toEqual({ domain: '$direct', sessions: 2, visitors: 2 });
  });
});

describe('errorHint', () => {
  it('names the key scope on an auth failure and the project id on a 404', () => {
    expect(errorHint(403)).toContain('Query Read');
    expect(errorHint(401)).toContain('phx_');
    expect(errorHint(404)).toContain('POSTHOG_PROJECT_ID');
  });
});
