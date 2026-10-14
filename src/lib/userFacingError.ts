// User-facing error copy.
//
// Every failure that reaches a person goes through here so organizers,
// volunteers and spectators never see raw Supabase / PostgREST / SDK
// strings ("JWT expired", "Edge Function returned a non-2xx status code").
// The raw error is always logged to the console for debugging; the
// returned copy follows the templates in the 2026-10-13 UX copy review
// (§2.1 and §3A).
//
// Usage:
//   toast(errorToast(err, { action: 'save your changes' }));
//   setError(userFacingError(err, { action: 'sign in', flow: 'signin' }).description);
//
// Deliberately free of the Supabase client so it can be imported (and
// tested) anywhere; invokeFunction() lives in edgeFunctions.ts.

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

export type ErrorKind =
  | 'network'     // couldn't reach the server
  | 'session'     // signed out / JWT expired
  | 'access'      // RLS / ownership — the row is no longer theirs
  | 'link'        // volunteer or scout link is expired, revoked, or points at a deleted event
  | 'rate_limit'
  | 'auth'        // a known auth outcome (wrong password, unconfirmed email, …)
  | 'unknown';

export interface FriendlyError {
  kind: ErrorKind;
  title: string;
  description: string;
}

export interface FriendlyErrorOptions {
  /**
   * What the person was trying to do, as a lower-case verb phrase that
   * completes "Couldn't …" — e.g. 'save your changes', 'publish', 'sign in'.
   */
  action: string;
  /** Auth screens get the auth-specific map in §2.1. */
  flow?: 'signin' | 'signup' | 'forgot' | 'reset' | 'oauth';
  /** Used by "Confirm your email first. We sent a link to {email}." */
  email?: string;
  /** Anything involving money always says so. */
  money?: boolean;
  /** Console label for the raw error. Defaults to the action. */
  logLabel?: string;
}

// ── Edge functions ────────────────────────────────────────────────────

/**
 * An edge-function failure with the server's JSON body already read.
 * `serverMessage` is the function's own `{ error }` string when it sent
 * one — useful for logs and matching, not for showing to people.
 */
export class EdgeFunctionError extends Error {
  readonly fn: string;
  readonly status: number | null;
  readonly serverMessage: string | null;
  readonly transport: 'http' | 'fetch' | 'relay' | 'body';

  constructor(opts: {
    fn: string;
    status: number | null;
    serverMessage: string | null;
    transport: EdgeFunctionError['transport'];
    sdkMessage?: string;
  }) {
    super(opts.serverMessage || opts.sdkMessage || `${opts.fn} failed`);
    this.name = 'EdgeFunctionError';
    this.fn = opts.fn;
    this.status = opts.status;
    this.serverMessage = opts.serverMessage;
    this.transport = opts.transport;
  }
}

/**
 * Turns the `error` from `supabase.functions.invoke` into an
 * EdgeFunctionError, reading the JSON body from FunctionsHttpError.context
 * (a fetch Response) so callers see what the function actually said
 * instead of the SDK's "Edge Function returned a non-2xx status code".
 */
export async function readFunctionError(fn: string, error: unknown): Promise<EdgeFunctionError> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response | undefined;
    const status = typeof res?.status === 'number' ? res.status : null;
    let serverMessage: string | null = null;
    try {
      // clone() so a caller that also reads the body doesn't hit "body used".
      const body = await (res?.clone ? res.clone() : res)?.json();
      if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        serverMessage = (body as { error: string }).error;
      }
    } catch {
      /* non-JSON body — fall back to the status code */
    }
    return new EdgeFunctionError({ fn, status, serverMessage, transport: 'http', sdkMessage: error.message });
  }
  if (error instanceof FunctionsRelayError) {
    return new EdgeFunctionError({ fn, status: null, serverMessage: null, transport: 'relay', sdkMessage: error.message });
  }
  // FunctionsFetchError and anything unexpected: the request never landed.
  return new EdgeFunctionError({
    fn,
    status: null,
    serverMessage: null,
    transport: 'fetch',
    sdkMessage: error instanceof Error ? error.message : String(error),
  });
}

// ── Classification ────────────────────────────────────────────────────

interface Facts {
  message: string;
  code: string | null;
  status: number | null;
  name: string;
  isAuth: boolean;
  isNetwork: boolean;
  edge: EdgeFunctionError | null;
}

function factsOf(err: unknown): Facts {
  const e = (err ?? {}) as Record<string, unknown>;
  const edge = err instanceof EdgeFunctionError ? err : null;
  const message = String(edge?.serverMessage ?? e.message ?? (typeof err === 'string' ? err : '') ?? '');
  const name = typeof e.name === 'string' ? e.name : '';
  const status = edge ? edge.status : typeof e.status === 'number' ? e.status : null;
  const code = typeof e.code === 'string' ? e.code : null;
  const isAuth = e.__isAuthError === true || /^Auth[A-Z]/.test(name);
  const isNetwork =
    err instanceof FunctionsFetchError ||
    (edge?.transport === 'fetch') ||
    name === 'AuthRetryableFetchError' ||
    (err instanceof TypeError && /fetch|network|load failed/i.test(message)) ||
    /failed to fetch|networkerror|network request failed|load failed/i.test(message) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false);
  return { message, code, status, name, isAuth, isNetwork, edge };
}

/** §3A copy for a volunteer/scout link that is missing, expired or revoked. */
export const LINK_GONE: FriendlyError = {
  kind: 'link',
  title: 'This link no longer works',
  description: 'The organizer may have turned it off or sent a new one. Ask your race organizer for a fresh link.',
};

const LINK_MESSAGES =/invalid or expired link|revoked|not a (status|scout) token|^invalid token$|^event not found$/i;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function classify(f: Facts, opts: FriendlyErrorOptions): FriendlyError {
  const { action } = opts;
  const couldnt = `Couldn't ${action}`;

  // Volunteer / scout links: the person arrived cold from a text message.
  // Point them at a human they already know (§3A).
  if (f.edge && (f.status === 403 || f.status === 404 || f.status === 400) && LINK_MESSAGES.test(f.message)) {
    return /revoked/i.test(f.message)
      ? { ...LINK_GONE, description: 'The organizer turned this link off. Ask your race organizer for a fresh link.' }
      : LINK_GONE;
  }

  if (opts.flow) {
    const auth = classifyAuth(f, opts);
    if (auth) return auth;
  }

  if (f.isNetwork) {
    return { kind: 'network', title: couldnt, description: 'Check your connection and try again.' };
  }

  if (
    f.status === 429 ||
    f.code === 'over_request_rate_limit' ||
    f.code === 'over_email_send_rate_limit' ||
    /rate limit|too many requests/i.test(f.message)
  ) {
    return { kind: 'rate_limit', title: 'Hang on a moment', description: `Too many tries in a row. Wait a minute, then ${action} again.` };
  }

  if (
    f.code === 'PGRST301' ||
    f.code === 'PGRST303' ||
    f.code === 'session_not_found' ||
    f.code === 'session_expired' ||
    f.code === 'refresh_token_not_found' ||
    f.name === 'AuthSessionMissingError' ||
    f.status === 401 ||
    /jwt expired|invalid jwt|auth session missing|not authenticated/i.test(f.message)
  ) {
    return { kind: 'session', title: "You've been signed out", description: `Sign in again to ${action}.` };
  }

  if (f.code === '42501' || /row-level security|permission denied/i.test(f.message) || f.status === 403) {
    return {
      kind: 'access',
      title: couldnt,
      description: 'You no longer have access to this event. It may have been moved to another account. Reload to check.',
    };
  }

  // A server that answered isn't a connection problem.
  return {
    kind: 'unknown',
    title: couldnt,
    description: f.status !== null ? 'Try again in a moment.' : 'Check your connection and try again.',
  };
}

function classifyAuth(f: Facts, opts: FriendlyErrorOptions): FriendlyError | null {
  const title = cap(`couldn't ${opts.action}`);
  const auth = (description: string): FriendlyError => ({ kind: 'auth', title, description });

  if (opts.flow === 'oauth') {
    return auth("We couldn't reach Google. Try again, or sign up with email.");
  }
  if (f.code === 'invalid_credentials' || /invalid login credentials/i.test(f.message)) {
    return auth("That email and password don't match. Try again, or reset your password.");
  }
  if (f.code === 'email_not_confirmed' || /email not confirmed/i.test(f.message)) {
    return auth(
      opts.email
        ? `Confirm your email first. We sent a link to ${opts.email}.`
        : 'Confirm your email first. Check your inbox for the link we sent.',
    );
  }
  if (
    f.code === 'user_already_exists' ||
    f.code === 'email_exists' ||
    /already (been )?registered|already exists/i.test(f.message)
  ) {
    return auth('An account with this email already exists. Sign in or reset your password.');
  }
  if (
    f.code === 'over_email_send_rate_limit' ||
    f.code === 'over_request_rate_limit' ||
    f.status === 429 ||
    /only request this after|rate limit/i.test(f.message)
  ) {
    // Auth screens show the description inline on its own, so it carries
    // the whole sentence.
    return {
      kind: 'rate_limit',
      title: 'Hang on a moment',
      description:
        opts.flow === 'forgot' || opts.flow === 'signup'
          ? 'Hang on a moment. You can request another link in about a minute.'
          : 'Too many tries in a row. Wait a minute, then try again.',
    };
  }
  if (
    opts.flow === 'reset' &&
    (f.name === 'AuthSessionMissingError' ||
      f.code === 'session_not_found' ||
      f.code === 'otp_expired' ||
      f.code === 'flow_state_expired' ||
      /auth session missing|expired/i.test(f.message))
  ) {
    return { kind: 'session', title, description: 'This reset link has expired. Request a new one.' };
  }
  if (f.code === 'same_password' || /should be different/i.test(f.message)) {
    return auth("Choose a password you haven't used before.");
  }
  if (f.code === 'weak_password' || /password should (be|contain)/i.test(f.message)) {
    return auth(`Choose a stronger password: at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (f.code === 'email_address_invalid' || /email address .* is invalid|invalid email/i.test(f.message)) {
    return auth('Check the email address and try again.');
  }
  if (f.code === 'signup_disabled') {
    return auth('New sign-ups are paused right now. Email hello@hereday.io and we’ll get you in.');
  }
  return null;
}

/** One password minimum for every auth screen. */
export const MIN_PASSWORD_LENGTH = 8;

// ── Public API ────────────────────────────────────────────────────────

/**
 * Maps any thrown / returned error to copy a person can act on, and logs
 * the raw error. Never returns the raw message.
 */
export function userFacingError(err: unknown, opts: FriendlyErrorOptions): FriendlyError {
  console.error(`[${opts.logLabel ?? opts.action}]`, err);
  const friendly = classify(factsOf(err), opts);
  if (opts.money) {
    return { ...friendly, description: `${friendly.description} You haven't been charged.` };
  }
  return friendly;
}

/** Shorthand for `toast(errorToast(err, { action }))`. */
export function errorToast(
  err: unknown,
  opts: FriendlyErrorOptions,
): { title: string; description: string; variant: 'destructive' } {
  const { title, description } = userFacingError(err, opts);
  return { title, description, variant: 'destructive' };
}
