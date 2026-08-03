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
