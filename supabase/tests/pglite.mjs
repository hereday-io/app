// Builds a Supabase-shaped Postgres in PGlite (real Postgres, in-process,
// no Docker) and applies every file in supabase/migrations in order.
//
// Why: there is no staging database. Local dev points at prod and every
// migration lands on live data, so this is the only place a migration
// can be run end to end before it ships. It stubs what Supabase provides
// (auth schema, roles, default grants) and patches columns prod has that
// the migration files never created.
//
//   node supabase/tests/pglite.mjs   → lists each migration as ok / FAIL
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SUPABASE_PRELUDE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255),
  email_confirmed_at TIMESTAMPTZ,
  raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_sign_in_at TIMESTAMPTZ
);
CREATE TABLE auth.identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT
);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'role'
$$;
CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT, allowed_mime_types TEXT[]);
CREATE TABLE storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT, owner UUID);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
CREATE FUNCTION public.gen_random_bytes(n INT) RETURNS BYTEA LANGUAGE sql VOLATILE AS $$
  SELECT decode(string_agg(lpad(to_hex((random() * 255)::int), 2, '0'), ''), 'hex') FROM generate_series(1, n)
$$;
CREATE SCHEMA extensions;
CREATE SCHEMA cron;
CREATE FUNCTION cron.schedule(a TEXT, b TEXT, c TEXT) RETURNS BIGINT LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION cron.unschedule(a TEXT) RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT true $$;
CREATE ROLE supabase_realtime_admin NOLOGIN;
CREATE PUBLICATION supabase_realtime;
`;

// Columns and tables prod has that the migration files never created
// (the history diverged; never `supabase db push`). Applied just before
// the first migration that depends on them.
export const DRIFT_PATCH = `
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS stripe_payment_id TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS tracking_start TIMESTAMPTZ;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS tracking_end TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT, processed_at TIMESTAMPTZ DEFAULT now());
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
`;

export async function createDb(repoRoot = REPO_ROOT, { stopBefore } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_PRELUDE);
  const dir = join(repoRoot, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const results = [];
  for (const f of files) {
    if (stopBefore && f >= stopBefore) break;
    if (f.startsWith('20260406120000')) await db.exec(DRIFT_PATCH);
    const sql = readFileSync(join(dir, f), 'utf8');
    try {
      await db.exec(sql);
      results.push({ f, ok: true });
    } catch (e) {
      results.push({ f, ok: false, err: e.message });
    }
  }
  return { db, results };
}

/**
 * Assertions and identity switching for check scripts. `as(userId)` runs
 * the next statements the way PostgREST would for that signed-in user:
 * JWT claims set, role authenticated, RLS and grants in force.
 */
export function testKit(db) {
  let pass = 0;
  let fail = 0;
  const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log('  ok  ', label); }
    else { fail++; console.log('  FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
  };
  const asPostgres = async () => {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false);`);
  };
  const as = async (userId) => {
    await asPostgres();
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await db.exec(`SET ROLE authenticated`);
  };
  const rpc = async (name, args = {}) => {
    const keys = Object.keys(args);
    const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`;
    const res = await db.query(sql, keys.map((k) => args[k]));
    return res.rows[0].r;
  };
  const expectError = async (fn, code, label) => {
    try {
      await fn();
      ok(false, label, 'no error');
    } catch (e) {
      ok(e.code === code, label, { code: e.code, message: e.message });
    }
  };
  const mkUser = async (email, provider) => {
    const { rows } = await db.query(
      `INSERT INTO auth.users (email, email_confirmed_at, raw_app_meta_data)
       VALUES ($1, now(), jsonb_build_object('provider', $2::text)) RETURNING id`, [email, provider]);
    if (provider === 'google') {
      await db.query(`INSERT INTO auth.identities (user_id, provider) VALUES ($1, 'google')`, [rows[0].id]);
    }
    return rows[0].id;
  };
  const done = () => {
    console.log(`
${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  };
  return { ok, as, asPostgres, rpc, expectError, mkUser, done };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { results } = await createDb();
  for (const r of results) console.log(r.ok ? 'ok  ' : 'FAIL', r.f, r.err ?? '');
}
