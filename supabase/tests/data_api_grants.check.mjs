// Supabase's 2026-10-30 Data API change (changelog 45329): new tables and
// sequences in public get no default grants for anon, authenticated or
// service_role. Proves the harness replays that switch at the right
// version, so a migration missing its GRANTs fails here, not in prod, and
// that every table in the real chain is reachable by service_role, which
// all edge functions use. Fixtures only; touches no real database.
//
//   npm run test:db
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, testKit, REPO_ROOT } from './pglite.mjs';

// ── 1. The switch, on a copy of the chain plus two fixture migrations ──
const root = mkdtempSync(join(tmpdir(), 'hereday-grants-'));
const migDir = join(root, 'supabase', 'migrations');
cpSync(join(REPO_ROOT, 'supabase', 'migrations'), migDir, { recursive: true });
writeFileSync(join(migDir, '20261030120000_fixture_bare.sql'), `
CREATE TABLE public.zz_bare (id BIGSERIAL PRIMARY KEY, note TEXT);
ALTER TABLE public.zz_bare ENABLE ROW LEVEL SECURITY;
`);
// The convention from supabase/README.md, as a new feature would write it.
writeFileSync(join(migDir, '20261030130000_fixture_granted.sql'), `
CREATE TABLE public.zz_granted (id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL, note TEXT);
ALTER TABLE public.zz_granted ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rows" ON public.zz_granted
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zz_granted TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zz_granted TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.zz_granted_id_seq TO authenticated, service_role;
`);

let built;
try {
  built = await createDb(root);
} finally {
  rmSync(root, { recursive: true, force: true });
}
const { db } = built;
const { ok, as, asPostgres, expectError, mkUser, done } = testKit(db);
const priv = async (role, obj, kind = 'table') => (await db.query(
  kind === 'table'
    ? `SELECT has_table_privilege($1, $2, 'SELECT') AS p`
    : `SELECT has_sequence_privilege($1, $2, 'USAGE') AS p`, [role, obj])).rows[0].p;
const asRole = async (role) => { await asPostgres(); await db.exec(`SET ROLE ${role}`); };

console.log('Before the cutoff: old defaults stand');
ok(await priv('authenticated', 'public.events'), 'authenticated keeps SELECT on events');
ok(await priv('service_role', 'public.events'), 'service_role keeps SELECT on events');
ok(!(await priv('anon', 'public.events')), 'anon still has nothing on events (20261014150000)');

console.log('After the cutoff, no GRANTs: unreachable by every API role');
for (const role of ['anon', 'authenticated', 'service_role']) {
  ok(!(await priv(role, 'public.zz_bare')), `${role} has no SELECT on zz_bare`);
  ok(!(await priv(role, 'public.zz_bare_id_seq', 'sequence')), `${role} has no USAGE on zz_bare_id_seq`);
}
await asRole('service_role');
await expectError(() => db.query(`SELECT * FROM public.zz_bare`), '42501',
  'service_role SELECT on zz_bare → permission denied');
await asPostgres();

console.log('After the cutoff, with the convention GRANTs: works as before');
const ME = await mkUser('director@example.org', 'email');
await as(ME);
const ins = await db.query(`INSERT INTO public.zz_granted (user_id, note) VALUES ($1, 'mine') RETURNING id`, [ME]);
ok(ins.rows.length === 1, 'authenticated INSERT (bigserial id) succeeds');
ok((await db.query(`SELECT * FROM public.zz_granted`)).rows.length === 1, 'authenticated SELECT sees own row');
await asRole('service_role');
ok((await db.query(`SELECT * FROM public.zz_granted`)).rows.length === 1, 'service_role SELECT succeeds');
ok(!(await priv('anon', 'public.zz_granted')), 'anon gets nothing it was not granted');
await asPostgres();
await db.close();

// ── 2. The real chain: service_role reaches every table and sequence ──
console.log('Real migrations: service_role can reach everything in public');
const real = (await createDb()).db;
const missing = (await real.query(`
  SELECT c.relname, c.relkind FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
    AND NOT CASE WHEN c.relkind = 'S'
      THEN has_sequence_privilege('service_role', c.oid, 'USAGE')
      ELSE has_table_privilege('service_role', c.oid, 'SELECT') END
  ORDER BY 1`)).rows;
ok(missing.length === 0, 'every public table, view and sequence grants service_role',
  missing.map((r) => `${r.relname} (${r.relkind})`));
await real.close();

done();
