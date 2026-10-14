// Edge-function calls that fail with something a person can be shown.
//
// Kept apart from userFacingError.ts because it needs the Supabase client,
// and the error helper should stay importable without one.

import { supabase } from '@/integrations/supabase/client';
import { EdgeFunctionError, readFunctionError } from '@/lib/userFacingError';

/**
 * `supabase.functions.invoke` that throws an EdgeFunctionError carrying the
 * HTTP status and the function's own `{ error }` message, instead of the
 * SDK's "Edge Function returned a non-2xx status code". Also treats a 2xx
 * body of `{ error }` as a failure, which several functions use. Pass the
 * thrown error through userFacingError() for copy.
 */
export async function invokeFunction<T = unknown>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body: body as Record<string, unknown> });
  if (error) throw await readFunctionError(fn, error);
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    throw new EdgeFunctionError({ fn, status: 200, serverMessage: (data as { error: string }).error, transport: 'body' });
  }
  return data as T;
}
