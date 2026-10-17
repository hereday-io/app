// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  AI_ASSISTANTS,
  aiSourceExpr,
  clampDays,
  errorHint,
  internalUsersFilter,
  shapeTraffic,
  trafficQueries,
} from './traffic';
import { AI_ASSISTANTS as APP_AI_ASSISTANTS } from '../../../src/lib/aiReferrals';

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
    expect(q.totals).toContain('min(timestamp) AS first_seen');
    expect(q.totals).toContain('INTERVAL 60 DAY');
    expect(q.totals).toContain('INTERVAL 30 DAY AS current');
    for (const sql of [q.by_day, q.top_pages, q.top_referrers, q.ai_referrals]) {
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

  it('adds no person filter when there are no staff accounts', () => {
    for (const sql of Object.values(q)) expect(sql).not.toContain('person_distinct_ids');
  });

  it('leaves staff out of every query', () => {
    const id = '605e52b3-8b9f-49e1-b4d5-8dc92829e555';
    for (const sql of Object.values(trafficQueries(30, [id]))) {
      expect(sql).toContain(
        `person_id NOT IN (SELECT person_id FROM person_distinct_ids WHERE distinct_id IN ('${id}'))`,
      );
    }
  });
});

describe('internalUsersFilter', () => {
  const a = '605e52b3-8b9f-49e1-b4d5-8dc92829e555';
  const b = '9c3e6812-e084-4629-94ae-03b38e03e772';

  it('is empty with no ids, since IN () would not parse', () => {
    expect(internalUsersFilter([])).toBe('');
  });

  it('lists every id once, lowercased', () => {
    expect(internalUsersFilter([a, b, a.toUpperCase()])).toBe(
      `person_id NOT IN (SELECT person_id FROM person_distinct_ids WHERE distinct_id IN ('${a}', '${b}'))`,
    );
  });

  it('drops anything that is not a UUID instead of quoting it', () => {
    const out = internalUsersFilter([a, "x') OR 1=1 --", `${b}'`, '', 'null']);
    expect(out).toContain(`'${a}'`);
    expect(out).not.toContain(b);
    expect(out).not.toContain('OR 1=1');
    expect(internalUsersFilter(["') OR 1=1 --"])).toBe('');
  });
});

describe('shapeTraffic', () => {
  const empty = { totals: [], by_day: [], top_pages: [], top_referrers: [], ai_referrals: [] };

  it('zeros everything when PostHog has no rows', () => {
    const out = shapeTraffic(empty);
    expect(out.totals).toEqual({ pageviews: 0, visitors: 0, sessions: 0 });
    expect(out.prev_totals).toEqual({ pageviews: 0, visitors: 0, sessions: 0 });
    expect(out.by_day).toEqual([]);
    expect(out.first_seen).toBeNull();
  });

  it('splits the current window from the previous one whatever the boolean encoding', () => {
    for (const [cur, prev] of [[true, false], [1, 0], ['1', '0']]) {
      const out = shapeTraffic({ ...empty, totals: [[prev, 40, 10, 12], [cur, 120, 30, 35]] });
      expect(out.totals).toEqual({ pageviews: 120, visitors: 30, sessions: 35 });
      expect(out.prev_totals).toEqual({ pageviews: 40, visitors: 10, sessions: 12 });
    }
  });

  it('takes the earliest first_seen across both windows', () => {
    const out = shapeTraffic({
      ...empty,
      totals: [
        [true, 9, 3, 3, '2026-10-14T19:52:42.812000Z'],
        [false, 4, 2, 2, '2026-09-20T08:00:00Z'],
      ],
    });
    expect(out.first_seen).toBe('2026-09-20T08:00:00.000Z');
  });

  it('ignores an unparseable first_seen', () => {
    expect(shapeTraffic({ ...empty, totals: [[true, 1, 1, 1, 'nope']] }).first_seen).toBeNull();
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

  it('groups AI referrals by assistant, busiest first, landings busiest first', () => {
    const out = shapeTraffic({
      ...empty,
      ai_referrals: [
        ['Perplexity', '/', 2],
        ['ChatGPT', '/faq', 3],
        ['ChatGPT', '', '4'],
        ['', '/pro', 9],
      ],
    });
    expect(out.ai_referrals).toEqual([
      {
        source: 'ChatGPT',
        sessions: 7,
        landings: [
          { path: '/', sessions: 4 },
          { path: '/faq', sessions: 3 },
        ],
      },
      { source: 'Perplexity', sessions: 2, landings: [{ path: '/', sessions: 2 }] },
    ]);
  });
});

describe('AI assistants', () => {
  it('matches the app copy in src/lib/aiReferrals.ts', () => {
    expect(AI_ASSISTANTS).toEqual(APP_AI_ASSISTANTS);
  });

  it('checks both the referrer and utm_source, and returns blank otherwise', () => {
    const expr = aiSourceExpr();
    expect(expr).toMatch(/^multiIf\(/);
    expect(expr).toMatch(/, ''\)$/);
    expect(expr).toContain("endsWith(lower(coalesce(properties.$referring_domain, '')), '.chatgpt.com')");
    expect(expr).toContain("lower(coalesce(properties.utm_source, '')) = 'chatgpt.com'");
  });

  it("reads the source off each session's first pageview", () => {
    const q = trafficQueries(30);
    expect(q.ai_referrals).toContain('argMin(multiIf(');
    expect(q.ai_referrals).toContain("WHERE source != ''");
  });
});

describe('errorHint', () => {
  it('names the key scope on an auth failure and the project id on a 404', () => {
    expect(errorHint(403)).toContain('Query Read');
    expect(errorHint(401)).toContain('phx_');
    expect(errorHint(404)).toContain('POSTHOG_PROJECT_ID');
  });
});
