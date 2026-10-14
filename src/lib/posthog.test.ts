import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ph = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: ph }));

// posthogEnabled is read from the env at import time, so each test
// imports a fresh copy of the module under the key it wants.
const load = async (key: string) => {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', key);
  return import('./posthog');
};

beforeEach(() => {
  Object.values(ph).forEach((fn) => fn.mockReset());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('initPostHog', () => {
  it('turns on exception autocapture', async () => {
    const { initPostHog } = await load('phc_test');
    initPostHog();
    expect(ph.init).toHaveBeenCalledWith('phc_test', expect.objectContaining({ capture_exceptions: true }));
  });
});

describe('reportError', () => {
  it('sends an Error as an exception with its context and the HTTP status of a function error', async () => {
    const { reportError } = await load('phc_test');
    const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: { status: 500 } });
    reportError(err, { area: 'billing', action: 'create_checkout', hereday_event_id: 'evt-1' });
    expect(ph.captureException).toHaveBeenCalledWith(err, {
      area: 'billing', action: 'create_checkout', hereday_event_id: 'evt-1', http_status: 500,
    });
  });

  it('wraps a plain Supabase error object, keeping its message and code', async () => {
    const { reportError } = await load('phc_test');
    reportError({ message: 'permission denied', code: '42501' }, { area: 'billing', action: 'load_events' });
    const [sent, props] = ph.captureException.mock.calls[0];
    expect(sent).toBeInstanceOf(Error);
    expect(sent.message).toBe('permission denied');
    expect(props).toMatchObject({ area: 'billing', action: 'load_events', error_code: '42501' });
  });

  it('only logs when PostHog is not configured', async () => {
    const { reportError } = await load('');
    reportError(new Error('boom'), { area: 'billing', action: 'load_events' });
    expect(ph.captureException).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[billing] load_events failed', expect.any(Error));
  });

  it('never throws, even if PostHog does', async () => {
    const { reportError } = await load('phc_test');
    ph.captureException.mockImplementation(() => { throw new Error('posthog down'); });
    expect(() => reportError(new Error('boom'), { area: 'billing', action: 'x' })).not.toThrow();
  });
});
