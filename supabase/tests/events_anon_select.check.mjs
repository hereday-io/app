// Anon can't read public.events directly (20261014140000): the leaking
// SELECT policy is gone, the public page still reads public_events, the
// public Subscribe and live-tracking flows that used to look inside
// events still work, and owners keep full access to their own rows.
// Fixtures only; touches no real database.
//
//   npm run test:db
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, testKit, REPO_ROOT } from './pglite.mjs';

const MIGRATION = '20261014140000_events_close_anon_select.sql';
const migrationSql = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', MIGRATION), 'utf8');

// The policy prod actually has (pg_policies, 2026-10-13). The migration
// chain dropped its own copy in 20260501120000, so recreate it here to
// test against prod's state rather than the chain's.
const PROD_LEAK_POLICY = 'Public can view published events';

const { db, results } = await createDb(REPO_ROOT, { stopBefore: MIGRATION });
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  for (const r of failed) console.log('MIGRATION FAIL', r.f, r.err);
  process.exit(1);
}
const { ok, as, asPostgres, expectError, mkUser, done } = testKit(db);

const asAnon = async () => {
  await asPostgres();
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'anon' })]);
  await db.exec(`SET ROLE anon`);
};

await db.exec(`CREATE POLICY "${PROD_LEAK_POLICY}" ON public.events FOR SELECT
  TO anon, authenticated USING (status = 'published')`);

const ME = await mkUser('director@example.org', 'email');
const OTHER = await mkUser('other@example.org', 'email');
const VISITOR = await mkUser('visitor@example.org', 'email');
const mkEvent = async (owner, slug, status, extra = '') => (await db.query(
  `INSERT INTO public.events (user_id, name, slug, city, event_date, start_time, status, registration_url${extra ? ', paid_at, tracking_start, tracking_end' : ''})
   VALUES ($1, 'Turkey Trot', $2, 'Lincolnwood', DATE '2026-11-22', TIME '08:00', $3,
           'https://runsignup.com/Race/IL/Lincolnwood/TurkeyTrot'${extra})
   RETURNING id`, [owner, slug, status])).rows[0].id;
const MINE = await mkEvent(ME, 'turkey-trot', 'published',
  `, now(), now() - interval '1 hour', now() + interval '1 hour'`);
const CLOSED = await mkEvent(OTHER, 'closed-trot', 'published',
  `, now(), now() - interval '2 days', now() - interval '1 day'`);
const DRAFT = await mkEvent(ME, 'draft-trot', 'draft');

console.log('\nBefore: prod state leaks');
await asAnon();
ok((await db.query(`SELECT user_id FROM public.events`)).rows.length === 2,
  'anon reads published rows from the base table (the bug)');
await as(VISITOR);
ok((await db.query(`SELECT user_id FROM public.events`)).rows.length === 2,
  "a signed-in non-owner reads other directors' published rows too");

await asPostgres();
try {
  await db.exec(migrationSql);
} catch (e) {
  console.log('MIGRATION FAIL', MIGRATION, e.message);
  process.exit(1);
}
// Re-pasting it in the editor must be harmless.
await db.exec(migrationSql);

console.log('\nPolicies');
{
  const { rows } = await db.query(
    `SELECT policyname, cmd, qual FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'events' ORDER BY policyname`);
  ok(rows.every((r) => r.cmd !== 'SELECT' || /auth\.uid\(\)/.test(r.qual)),
    'every SELECT policy on events is scoped to auth.uid()', rows);
  ok(rows.length === 4, 'owner insert/select/update/delete policies all still there', rows.map((r) => r.policyname));
  const fns = (await db.query(
    `SELECT proname, prosecdef FROM pg_proc
      WHERE proname IN ('event_is_published', 'event_tracking_open') ORDER BY proname`)).rows;
  ok(fns.length === 2 && fns.every((f) => f.prosecdef), 'helpers are SECURITY DEFINER', fns);
  const grants = (await db.query(
    `SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'events' AND grantee IN ('anon', 'authenticated')`)).rows;
  ok(!grants.some((g) => g.grantee === 'anon'), 'anon holds no privileges on events', grants);
  ok(['SELECT', 'INSERT', 'UPDATE', 'DELETE'].every((p) =>
    grants.some((g) => g.grantee === 'authenticated' && g.privilege_type === p)),
  'authenticated keeps select/insert/update/delete');
  const opts = (await db.query(
    `SELECT reloptions FROM pg_class WHERE oid = 'public.public_events'::regclass`)).rows[0].reloptions;
  ok(JSON.stringify(opts) === JSON.stringify(['security_invoker=false']), 'public_events keeps definer rights', opts);
}

console.log('\nAnon');
await asAnon();
{
  await expectError(() => db.query(`SELECT id FROM public.events`), '42501',
    'base table refuses anon outright (no grant)');
  await expectError(() => db.query(`UPDATE public.events SET name = 'x'`), '42501',
    'and refuses anon writes');
  const { rows } = await db.query(
    `SELECT slug, start_time, registration_url FROM public.public_events ORDER BY slug`);
  const mine = rows.find((r) => r.slug === 'turkey-trot');
  ok(!!mine, 'public_events still returns the published event');
  ok(mine?.start_time === '08:00:00', 'start_time visible', mine);
  ok(mine?.registration_url === 'https://runsignup.com/Race/IL/Lincolnwood/TurkeyTrot', 'registration_url visible', mine);
  ok(!rows.some((r) => r.slug === 'draft-trot'), 'drafts still hidden from public_events');

  await db.query(`INSERT INTO public.event_subscribers (event_id, email, source) VALUES ($1, 'fan@example.org', 'runner')`, [MINE]);
  ok(true, 'can subscribe to a published event');
  await expectError(
    () => db.query(`INSERT INTO public.event_subscribers (event_id, email) VALUES ($1, 'fan@example.org')`, [DRAFT]),
    '42501', "can't subscribe to a draft");

  const t = await db.query(
    `INSERT INTO public.tracking_sessions (event_id, runner_name, session_secret)
     VALUES ($1, 'Kim', 'secret') RETURNING id`, [MINE]);
  ok(t.rows.length === 1, 'can start tracking inside the window (insert … returning id)');
  await expectError(
    () => db.query(`INSERT INTO public.tracking_sessions (event_id, runner_name, session_secret)
                    VALUES ($1, 'Kim', 'secret')`, [CLOSED]),
    '42501', "can't start tracking after the window closed");
  const spect = await db.query(`SELECT id, runner_name FROM public.tracking_sessions WHERE event_id = $1`, [MINE]);
  ok(spect.rows.length === 1, 'spectators read tracking sessions for a published event');

  const leak = await db.query(`SELECT public.event_is_published($1) AS a, public.event_is_published($2) AS b`, [MINE, DRAFT]);
  ok(leak.rows[0].a === true && leak.rows[0].b === false, 'helper answers yes/no only');
}

console.log('\nSigned-in visitor (not the owner)');
await as(VISITOR);
{
  ok((await db.query(`SELECT * FROM public.events`)).rows.length === 0, "sees none of other people's events");
  ok((await db.query(`SELECT 1 FROM public.public_events WHERE slug = 'turkey-trot'`)).rows.length === 1,
    'still reads public_events');
  await db.query(`INSERT INTO public.event_subscribers (event_id, email) VALUES ($1, 'visitor@example.org')`, [MINE]);
  ok(true, 'can subscribe');
}

console.log('\nOwner');
await as(ME);
{
  const { rows } = await db.query(`SELECT slug, user_id, paid_at FROM public.events ORDER BY slug`);
  ok(JSON.stringify(rows.map((r) => r.slug)) === JSON.stringify(['draft-trot', 'turkey-trot']),
    'reads own events, drafts included, nobody else\'s', rows.map((r) => r.slug));
  const u = await db.query(`UPDATE public.events SET name = 'Turkey Trot 5K' WHERE id = $1`, [MINE]);
  ok(u.affectedRows === 1, 'updates own event');
  const x = await db.query(`UPDATE public.events SET name = 'hijack' WHERE id = $1`, [CLOSED]);
  ok(x.affectedRows === 0, "can't update someone else's");
  const subs = await db.query(`SELECT email FROM public.event_subscribers WHERE event_id = $1`, [MINE]);
  ok(subs.rows.length === 2, 'reads own subscriber list');
}

done();
