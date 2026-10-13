/**
 * Turn a Supabase `{ data, error }` result into a plain value or a throw.
 *
 * Supabase never rejects on query errors (RLS denials, constraint
 * violations, 5xx); it resolves with `error` set and `data` null. Code
 * that only reads `data` then treats a failure as "no rows", which is how
 * a failed fetch ends up rendering the empty state. Wrapping the awaited
 * result makes the failure impossible to ignore:
 *
 *   const rows = unwrap(await supabase.from('events').select('*'));
 *
 * The thrown value is always an `Error` (PostgrestError already is one;
 * anything else is wrapped) so callers can read `.message` in a catch.
 */
export function unwrap<T>(result: { data: T; error: unknown }): T {
  const { error } = result;
  if (error) {
    if (error instanceof Error) throw error;
    const message = (error as { message?: unknown }).message;
    throw Object.assign(new Error(typeof message === 'string' ? message : 'Request failed'), error);
  }
  return result.data;
}
