// @vitest-environment node
//
// Runs under vitest, not Deno: report.ts only touches Deno.env, fetch
// and EdgeRuntime, all stubbed here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildErrorEvent, reportError } from './report';

let env: Record<string, string | undefined>;
const fetchMock = vi.fn();
const waitUntil = vi.fn();

beforeEach(() => {
  env = { SUPABASE_URL: 'https://abcdefghij.supabase.co' };
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EdgeRuntime', { waitUntil });
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  waitUntil.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildErrorEvent', () => {
  it('builds a server_error tied to the customer, with the context as properties', () => {
    const err = Object.assign(new Error('event update failed'), { code: '23514' });
    const body = buildErrorEvent('stripe-webhook', err, {
      severity: 'critical', stage: 'handler', userId: 'user-1', stripe_event_id: 'evt_1',
    }, { key: 'phc_test', supabaseUrl: 'https://abcdefghij.supabase.co' });
    expect(body).toMatchObject({
      api_key: 'phc_test',
      event: 'server_error',
      distinct_id: 'user-1',
      properties: {
        function: 'stripe-webhook',
        severity: 'critical',
        stage: 'handler',
        message: 'event update failed',
        error_name: 'Error',
        error_code: '23514',
        hereday_user_id: 'user-1',
        stripe_event_id: 'evt_1',
        environment: 'abcdefghij',
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
    expect((body.properties as { stack: string }).stack).toContain('event update failed');
  });

  it('falls back to a per-function id and reads plain error objects', () => {
    const body = buildErrorEvent('create-checkout', { message: 'permission denied' }, {},
      { key: 'phc_test', supabaseUrl: 'http://127.0.0.1:54321' });
    expect(body.distinct_id).toBe('edge:create-checkout');
    expect(body.properties).toMatchObject({ message: 'permission denied', severity: 'error', environment: 'local' });
  });
});

describe('reportError', () => {
  it('does nothing without POSTHOG_KEY', async () => {
    await reportError('stripe-webhook', new Error('boom'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the capture API and keeps the request alive past the response', async () => {
    env.POSTHOG_KEY = 'phc_test';
    env.POSTHOG_HOST = 'https://eu.i.posthog.com/';
    await reportError('stripe-webhook', new Error('boom'), { severity: 'critical' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://eu.i.posthog.com/capture/');
    expect(JSON.parse(init.body)).toMatchObject({ event: 'server_error', properties: { severity: 'critical' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it('defaults to the US host', async () => {
    env.POSTHOG_KEY = 'phc_test';
    await reportError('create-checkout', new Error('boom'));
    expect(fetchMock.mock.calls[0][0]).toBe('https://us.i.posthog.com/capture/');
  });

  it('never rejects when PostHog is down', async () => {
    env.POSTHOG_KEY = 'phc_test';
    fetchMock.mockRejectedValue(new TypeError('network down'));
    await expect(reportError('stripe-webhook', new Error('boom'))).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[report] PostHog capture failed', expect.any(TypeError));
  });

  it('never throws, even if reading the environment does', () => {
    vi.stubGlobal('Deno', { env: { get: () => { throw new Error('no env access'); } } });
    expect(() => reportError('stripe-webhook', new Error('boom'))).not.toThrow();
  });
});
