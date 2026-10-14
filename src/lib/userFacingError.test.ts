import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import {
  EdgeFunctionError,
  LINK_GONE,
  errorToast,
  readFunctionError,
  userFacingError,
} from './userFacingError';

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

const authError = (code: string, message: string, status = 400) =>
  Object.assign(new Error(message), { __isAuthError: true, name: 'AuthApiError', code, status });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('readFunctionError', () => {
  it('reads the { error } body instead of the SDK message', async () => {
    const err = await readFunctionError('resolve-status-token', httpError(404, { error: 'Invalid or expired link' }));
    expect(err).toBeInstanceOf(EdgeFunctionError);
    expect(err.status).toBe(404);
    expect(err.serverMessage).toBe('Invalid or expired link');
    expect(err.message).not.toMatch(/non-2xx/);
  });

  it('falls back to the status when the body is not JSON', async () => {
    const err = await readFunctionError('x', httpError(500, '<html>oops</html>'));
    expect(err.status).toBe(500);
    expect(err.serverMessage).toBeNull();
  });

  it('marks fetch failures as transport errors', async () => {
    const err = await readFunctionError('x', new FunctionsFetchError(new TypeError('Failed to fetch')));
    expect(err.transport).toBe('fetch');
    expect(userFacingError(err, { action: 'save this report' }).kind).toBe('network');
  });
});

describe('volunteer and scout links (§3A)', () => {
  it.each([
    [404, 'Invalid or expired link'],
    [404, 'Event not found'],
    [403, 'Token is not a status token'],
    [400, 'Invalid token'],
  ])('%i %s → link copy', async (status, message) => {
    const err = await readFunctionError('resolve-status-token', httpError(status, { error: message }));
    const out = userFacingError(err, { action: 'open this volunteer page' });
    expect(out).toEqual(LINK_GONE);
    expect(out.description).not.toMatch(/hereday|token|status code/i);
  });

  it('says the link was turned off when revoked', async () => {
    const err = await readFunctionError('resolve-scout-token', httpError(403, { error: 'This scout link has been revoked' }));
    const out = userFacingError(err, { action: 'open this scout page' });
    expect(out.kind).toBe('link');
    expect(out.description).toMatch(/turned this link off/);
  });

  it('does not treat a server crash as a dead link', async () => {
    const err = await readFunctionError('resolve-status-token', httpError(500, { error: 'Token lookup failed' }));
    const out = userFacingError(err, { action: 'open this volunteer page' });
    expect(out.kind).toBe('unknown');
    expect(out.description).toBe('Try again in a moment.');
  });

  it('maps a 429 to rate-limit copy', async () => {
    const err = await readFunctionError('submit-scouted-poi', httpError(429, { error: 'Rate limit exceeded: max 60 POIs' }));
    expect(userFacingError(err, { action: 'save this marker' }).kind).toBe('rate_limit');
  });
});

describe('auth map (§2.1)', () => {
  it('wrong password', () => {
    const out = userFacingError(authError('invalid_credentials', 'Invalid login credentials'), { action: 'sign in', flow: 'signin' });
    expect(out.description).toBe("That email and password don't match. Try again, or reset your password.");
  });

  it('unconfirmed email names the address', () => {
    const out = userFacingError(authError('email_not_confirmed', 'Email not confirmed'), {
      action: 'sign in', flow: 'signin', email: 'a@b.co',
    });
    expect(out.description).toBe('Confirm your email first. We sent a link to a@b.co.');
  });

  it('already registered', () => {
    const out = userFacingError(authError('user_already_exists', 'User already registered', 422), { action: 'create your account', flow: 'signup' });
    expect(out.description).toBe('An account with this email already exists. Sign in or reset your password.');
  });

  it('email rate limit on forgot-password', () => {
    const out = userFacingError(
      authError('over_email_send_rate_limit', 'For security purposes, you can only request this after 42 seconds.', 429),
      { action: 'send the reset link', flow: 'forgot' },
    );
    expect(out.description).toBe('Hang on a moment. You can request another link in about a minute.');
  });

  it('missing session on reset means the link expired', () => {
    const err = Object.assign(new Error('Auth session missing!'), { __isAuthError: true, name: 'AuthSessionMissingError', status: 400 });
    const out = userFacingError(err, { action: 'update your password', flow: 'reset' });
    expect(out.kind).toBe('session');
    expect(out.description).toBe('This reset link has expired. Request a new one.');
  });

  it('same password', () => {
    const out = userFacingError(authError('same_password', 'New password should be different from the old password.', 422), {
      action: 'update your password', flow: 'reset',
    });
    expect(out.description).toBe("Choose a password you haven't used before.");
  });

  it('oauth failures point to email sign-up', () => {
    const out = userFacingError(authError('unexpected_failure', 'whatever'), { action: 'continue with Google', flow: 'oauth' });
    expect(out.description).toBe("We couldn't reach Google. Try again, or sign up with email.");
  });
});

describe('PostgREST and fallbacks', () => {
  it('expired JWT → signed out', () => {
    const out = userFacingError({ code: 'PGRST301', message: 'JWT expired', details: null, hint: null }, { action: 'save your changes' });
    expect(out).toEqual({ kind: 'session', title: "You've been signed out", description: 'Sign in again to save your changes.' });
  });

  it('RLS denial → lost access', () => {
    const out = userFacingError({ code: '42501', message: 'new row violates row-level security policy' }, { action: 'publish' });
    expect(out.kind).toBe('access');
    expect(out.description).toMatch(/no longer have access/);
  });

  it('network failure → connection copy', () => {
    const out = userFacingError(new TypeError('Failed to fetch'), { action: 'save your changes' });
    expect(out).toEqual({ kind: 'network', title: "Couldn't save your changes", description: 'Check your connection and try again.' });
  });

  it('never leaks the raw message', () => {
    const out = userFacingError({ code: 'XX000', message: 'duplicate key value violates unique constraint "events_pkey"' }, { action: 'create your event' });
    expect(out.title).toBe("Couldn't create your event");
    expect(JSON.stringify(out)).not.toMatch(/constraint|events_pkey/);
  });

  it('money errors say nobody was charged', () => {
    expect(userFacingError(new TypeError('Failed to fetch'), { action: 'open checkout', money: true }).description).toMatch(
      /You haven't been charged\.$/,
    );
  });

  it('errorToast is a destructive toast with no extra props', () => {
    expect(errorToast(new TypeError('Failed to fetch'), { action: 'publish' })).toEqual({
      title: "Couldn't publish",
      description: 'Check your connection and try again.',
      variant: 'destructive',
    });
  });

  it('logs the raw error', () => {
    const raw = new Error('boom');
    userFacingError(raw, { action: 'publish', logLabel: 'test' });
    expect(console.error).toHaveBeenCalledWith('[test]', raw);
  });
});
