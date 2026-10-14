/**
 * Event URL slugs. New events get the plain name ("lincolnwood-turkey-trot");
 * the database trigger events_unique_slug (20261014170000) appends -2, -3…
 * when another event already has it, since RLS stops the browser from
 * seeing other organizers' slugs. Kept free of the Supabase client so it
 * can be unit-tested without .env.
 */

/** Lowercase a-z, 0-9 and single hyphens, no leading/trailing hyphen.
 *  Matches the trigger's normalization. */
export const normalizeSlug = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

export const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;

/**
 * Fallback for a create that still hits 23505: two creates racing for the
 * same name, or the trigger not yet applied. A short random tail keeps the
 * retry from colliding again.
 */
export const withRandomTail = (slug: string): string =>
  `${slug}-${Math.random().toString(36).slice(2, 6)}`;
