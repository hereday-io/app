import { supabase } from '@/integrations/supabase/client';

/**
 * Every CRM call goes through here. The crm_* functions aren't in the
 * generated Supabase types, so this is the single place that casts
 * through `never` — and it turns PostgREST errors into CrmError with the
 * SQLSTATE the migrations raise, so callers can branch on `code`.
 */

export type CrmErrorCode =
  | '42501' // not authorized
  | 'P0002' // not found
  | '22023' // bad input
  | '23514' // a CHECK failed (e.g. email without a source URL)
  | '23505' // unique violation
  | 'CR001' // held by someone else
  | 'CR002' // do not contact
  | 'CR003' // changed since you opened it
  | 'CR004' // duplicate deal
  | string;

export class CrmError extends Error {
  code: CrmErrorCode;
  constructor(message: string, code: CrmErrorCode) {
    super(message);
    this.name = 'CrmError';
    this.code = code;
  }
}

/**
 * Errors a retry can't fix. React Query should give up on these at once.
 * PGRST202 is PostgREST's "no such function": the migration isn't applied.
 */
export const NON_RETRYABLE: readonly string[] = [
  '42501', 'P0002', '22023', '23514', '23505', 'CR001', 'CR002', 'CR003', 'CR004', 'PGRST202',
];

const friendly = (code: string, message: string): string => {
  if (code === '23514') {
    if (/email_sourced/.test(message)) return 'An email needs the URL where you found it.';
    if (/phone_sourced/.test(message)) return 'A phone number needs the URL where you found it.';
    if (/email_check|crm_contacts_email_check/.test(message)) return "That email address doesn't look right.";
    return "One of those values isn't allowed.";
  }
  if (code === '23505' && /crm_contacts_email_uidx/.test(message)) {
    return 'Another contact already uses that email.';
  }
  if (code === '42501' && message === 'Not authorized') {
    return "You don't have access to that.";
  }
  return message;
};

export async function crmRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) {
    const code = error.code ?? '';
    throw new CrmError(friendly(code, error.message), code);
  }
  return data as unknown as T;
}

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : 'Something went wrong.';
