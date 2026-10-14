import posthog from 'posthog-js';

/**
 * PostHog bootstrap. Entirely inert unless VITE_POSTHOG_KEY is set, so
 * local dev and preview builds send nothing by default.
 *
 * PostHog is the exploration layer (traffic, funnels, session replay,
 * UTM attribution); Supabase `product_events` stays the source of truth
 * for anything that joins to real rows. `logEvent()` mirrors every
 * product event into both.
 */

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

export const posthogEnabled = Boolean(key);

export function initPostHog(): void {
  if (!key) return;
  posthog.init(key, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com',
    // SPA: capture a $pageview on every History API navigation, not just
    // the initial load.
    capture_pageview: 'history_change',
    capture_pageleave: true,
    // Default is 'localStorage+cookie'. Cookies would contradict the
    // privacy policy's "no third-party tracking cookies" promise, and we
    // already keep the Supabase session in localStorage — so stay
    // consistent and cookieless. Costs us nothing: identity still
    // survives across sessions on the same browser.
    persistence: 'localStorage',
    // Uncaught errors and unhandled promise rejections go to PostHog
    // Error Tracking as `$exception` events. Errors React catches in an
    // error boundary never reach window.onerror in production, so
    // AppErrorBoundary reports those itself through reportError().
    capture_exceptions: true,
  });
}

/** Tie the anonymous browsing history to the Supabase user. */
export function identifyUser(userId: string, email?: string | null): void {
  if (!posthogEnabled) return;
  posthog.identify(userId, email ? { email } : undefined);
}

/** Detach on sign-out so a shared browser doesn't pollute the profile. */
export function resetIdentity(): void {
  if (!posthogEnabled) return;
  posthog.reset();
}

export function captureEvent(eventType: string, properties: Record<string, unknown>): void {
  if (!posthogEnabled) return;
  posthog.capture(eventType, properties);
}

/**
 * Report a handled failure that would otherwise end in a toast or a
 * console line nobody reads: a `$exception` in PostHog Error Tracking,
 * tagged so an alert can filter on it (`area = 'billing'` is the one
 * that matters). Also logs to the console, so callers don't need both.
 *
 * Never throws, and is a no-op for PostHog without VITE_POSTHOG_KEY.
 */
export function reportError(
  error: unknown,
  context: { area: string; action: string } & Record<string, unknown>,
): void {
  console.error(`[${context.area}] ${context.action} failed`, error);
  if (!posthogEnabled) return;
  try {
    const err = error instanceof Error ? error : new Error(errorMessage(error));
    posthog.captureException(err, { ...context, ...errorDetails(error) });
  } catch {
    // Reporting must never break the flow it is reporting on.
  }
}

function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(error);
}

// Supabase errors carry the useful part outside `message`: a Postgres
// error code on PostgrestError, the HTTP status on a FunctionsHttpError
// (whose message is only "Edge Function returned a non-2xx status code").
function errorDetails(error: unknown): Record<string, unknown> {
  const e = error as { code?: unknown; context?: { status?: unknown } } | null;
  const details: Record<string, unknown> = {};
  if (typeof e?.code === 'string') details.error_code = e.code;
  if (typeof e?.context?.status === 'number') details.http_status = e.context.status;
  return details;
}
