import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TrafficPanel from './TrafficPanel';
import type { PostHogTrafficData } from '@/hooks/usePostHogTraffic';

const hook = vi.hoisted(() => ({
  state: { data: null as PostHogTrafficData | null, loading: false, error: null as string | null },
}));

vi.mock('@/hooks/usePostHogTraffic', () => ({
  usePostHogTraffic: () => ({ ...hook.state, refresh: vi.fn() }),
}));

function setHook(data: PostHogTrafficData | null, error: string | null = null) {
  hook.state = { data, loading: false, error };
}

const zero = { pageviews: 0, visitors: 0, sessions: 0 };

describe('TrafficPanel', () => {
  beforeEach(() => setHook(null));

  it('shows setup steps when the function has no PostHog secrets', () => {
    setHook({ configured: false, error: 'PostHog query access not configured' });
    render(<TrafficPanel days={30} signups={4} signupsByDay={[]} />);
    expect(screen.getByText(/Not connected yet/)).toBeInTheDocument();
    expect(screen.getByText('POSTHOG_PERSONAL_API_KEY')).toBeInTheDocument();
  });

  it("surfaces PostHog's error and the function's hint", () => {
    setHook(
      { configured: true, error: 'Invalid personal API key', hint: 'needs the Query Read scope' },
      'Invalid personal API key',
    );
    render(<TrafficPanel days={30} signups={4} signupsByDay={[]} />);
    expect(screen.getByText('Invalid personal API key')).toBeInTheDocument();
    expect(screen.getByText('needs the Query Read scope')).toBeInTheDocument();
  });

  it('says the site may not be sending when PostHog has nothing at all', () => {
    setHook({
      configured: true,
      totals: zero,
      prev_totals: zero,
      by_day: [],
      top_pages: [],
      top_referrers: [],
    });
    render(<TrafficPanel days={30} signups={0} signupsByDay={[]} />);
    expect(screen.getByText(/the site may not be\s+sending/)).toBeInTheDocument();
    expect(screen.getByText(/admins and sales reps left out/)).toBeInTheDocument();
  });

  it('renders totals, the signup rate, pages and referrers', () => {
    setHook({
      configured: true,
      app_url: 'https://us.posthog.com/project/1/web',
      totals: { pageviews: 900, visitors: 200, sessions: 300 },
      prev_totals: { pageviews: 450, visitors: 100, sessions: 150 },
      by_day: [{ day: '2026-10-13', pageviews: 30, visitors: 7 }],
      top_pages: [{ path: '/pro', pageviews: 120, visitors: 80 }],
      top_referrers: [
        { domain: '$direct', sessions: 90, visitors: 70 },
        { domain: 'www.google.com', sessions: 40, visitors: 35 },
      ],
    });
    render(<TrafficPanel days={30} signups={5} signupsByDay={[]} />);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('2.5%')).toBeInTheDocument();
    expect(screen.getByText('3.0 pages per session')).toBeInTheDocument();
    expect(screen.getByText('/pro')).toBeInTheDocument();
    expect(screen.getByText('Direct / no referrer')).toBeInTheDocument();
    expect(screen.getByText('www.google.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PostHog/ })).toHaveAttribute(
      'href',
      'https://us.posthog.com/project/1/web',
    );
  });

  const withTraffic = {
    configured: true,
    totals: { pageviews: 900, visitors: 200, sessions: 300 },
    prev_totals: { pageviews: 450, visitors: 100, sessions: 150 },
    by_day: [],
    top_pages: [],
    top_referrers: [],
  };

  it('lists AI assistants with their landing pages and share of sessions', () => {
    setHook({
      ...withTraffic,
      ai_referrals: [
        {
          source: 'ChatGPT',
          sessions: 12,
          landings: [
            { path: '/', sessions: 6 },
            { path: '/faq', sessions: 3 },
            { path: '/pro', sessions: 2 },
            { path: '/getting-started', sessions: 1 },
          ],
        },
        { source: 'Perplexity', sessions: 3, landings: [{ path: '/', sessions: 3 }] },
      ],
    });
    render(<TrafficPanel days={30} signups={5} signupsByDay={[]} />);
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText(/landed on \/ \(6\), \/faq \(3\), \/pro \(2\) \+1 more/)).toBeInTheDocument();
    expect(screen.getByText('Perplexity')).toBeInTheDocument();
    expect(screen.getByText(/5\.0% of all sessions/)).toBeInTheDocument();
  });

  it('says so when no assistant sent anyone', () => {
    setHook({ ...withTraffic, ai_referrals: [] });
    render(<TrafficPanel days={30} signups={5} signupsByDay={[]} />);
    expect(screen.getByText(/No visits from ChatGPT, Claude, Perplexity/)).toBeInTheDocument();
  });

  it('keeps the rest of the panel when only the AI query failed', () => {
    setHook({ ...withTraffic, ai_referrals: [], ai_referrals_error: 'Unknown function argMin' });
    render(<TrafficPanel days={30} signups={5} signupsByDay={[]} />);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText(/refused the AI-referral query: Unknown function argMin/)).toBeInTheDocument();
  });
});

describe('TrafficPanel when PostHog started mid-window', () => {
  it('divides only signups since tracking began, and holds off on deltas', () => {
    const today = new Date().toISOString().slice(0, 10);
    setHook({
      configured: true,
      first_seen: new Date(Date.now() - 60_000).toISOString(),
      totals: { pageviews: 3, visitors: 1, sessions: 1 },
      prev_totals: zero,
      by_day: [{ day: today, pageviews: 3, visitors: 1 }],
      top_pages: [],
      top_referrers: [],
    });
    render(
      <TrafficPanel
        days={30}
        signups={2}
        signupsByDay={[
          { day: '2020-01-01', count: 2 },
          { day: today, count: 0 },
        ]}
      />,
    );
    expect(screen.queryByText('200.0%')).not.toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.getAllByText('no full prior period yet')).toHaveLength(2);
    expect(screen.getByText(/PostHog data starts .*covers 1 day and/)).toBeInTheDocument();
  });
});
