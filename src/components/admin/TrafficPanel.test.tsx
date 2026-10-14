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
    render(<TrafficPanel days={30} signups={4} />);
    expect(screen.getByText(/Not connected yet/)).toBeInTheDocument();
    expect(screen.getByText('POSTHOG_PERSONAL_API_KEY')).toBeInTheDocument();
  });

  it("surfaces PostHog's error and the function's hint", () => {
    setHook(
      { configured: true, error: 'Invalid personal API key', hint: 'needs the Query Read scope' },
      'Invalid personal API key',
    );
    render(<TrafficPanel days={30} signups={4} />);
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
    render(<TrafficPanel days={30} signups={0} />);
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
    render(<TrafficPanel days={30} signups={5} />);
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
});
