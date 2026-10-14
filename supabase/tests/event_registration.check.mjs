// Registration link + start time on the public page (20261014130000):
// owners can set an http(s) registration_url and nothing else, and
// anon reads start_time / registration_url through public_events
// without the view losing its definer rights or its existing columns.
// Fixtures only; touches no real database.
//
//   npm run test:db
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, testKit, REPO_ROOT } from './pglite.mjs';

const MIGRATION = '20261014130000_event_registration_url.sql';

// The view as prod has it today, checked against the live REST response
// on 2026-10-13. If the migration chain stops producing exactly this, the
// CREATE OR REPLACE below is being tested against the wrong thing.
const PROD_COLUMNS = [
  'id', 'name', 'slug', 'city', 'event_date', 'routes', 'pois', 'route_count', 'poi_count',
  'logo_url', 'branding_style', 'updated_at', 'tracking_start', 'tracking_end',
  'owner_is_paid', 'has_ended',
];
const viewColumns = async () => (await db.query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'public_events' ORDER BY ordinal_position`,
)).rows.map((r) => r.column_name);

const { db, results } = await createDb(REPO_ROOT, { stopBefore: MIGRATION });
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  for (const r of failed) console.log('MIGRATION FAIL', r.f, r.err);
  process.exit(1);
}
const before = await viewColumns();
if (JSON.stringify(before) !== JSON.stringify(PROD_COLUMNS)) {
  console.log('public_events before the migration does not match prod:', before);
  process.exit(1);
}

try {
  await db.exec(readFileSync(join(REPO_ROOT, 'supabase', 'migrations', MIGRATION), 'utf8'));
} catch (e) {
  console.log('MIGRATION FAIL', MIGRATION, e.message);
  process.exit(1);
}
// Running it twice must be harmless (someone re-pastes it in the editor).
await db.exec(readFileSync(join(REPO_ROOT, 'supabase', 'migrations', MIGRATION), 'utf8'));
const { ok, as, asPostgres, expectError, mkUser, done } = testKit(db);

console.log('\nView shape');
{
  const cols = await viewColumns();
  ok(JSON.stringify(cols) === JSON.stringify([...PROD_COLUMNS, 'start_time', 'registration_url']),
    'existing columns unchanged, start_time + registration_url appended', cols);
  const opts = (await db.query(
    `SELECT reloptions FROM pg_class WHERE oid = 'public.public_events'::regclass`)).rows[0].reloptions;
  ok(JSON.stringify(opts) === JSON.stringify(['security_invoker=false']), 'still a definer-rights view', opts);
}

await asPostgres();
const ME = await mkUser('director@example.org', 'email');
const OTHER = await mkUser('other@example.org', 'email');
const mkEvent = async (owner, slug, status) => (await db.query(
  `INSERT INTO public.events (user_id, name, slug, city, event_date, start_time, status)
   VALUES ($1, 'Turkey Trot', $2, 'Lincolnwood', DATE '2026-11-22', TIME '08:00', $3) RETURNING id`,
  [owner, slug, status])).rows[0].id;
const MINE = await mkEvent(ME, 'turkey-trot', 'published');
const THEIRS = await mkEvent(OTHER, 'other-trot', 'published');
const DRAFT = await mkEvent(ME, 'draft-trot', 'draft');

console.log('\nOwner writes');
await as(ME);
{
  const r = await db.query(
    `UPDATE public.events SET registration_url = 'https://runsignup.com/Race/IL/Lincolnwood/TurkeyTrot' WHERE id = $1`, [MINE]);
  ok(r.affectedRows === 1, 'https link saved');
  const h = await db.query(`UPDATE public.events SET registration_url = 'HTTP://example.org/reg' WHERE id = $1`, [DRAFT]);
  ok(h.affectedRows === 1, 'http (any case) accepted');
  const n = await db.query(`UPDATE public.events SET registration_url = NULL WHERE id = $1`, [DRAFT]);
  ok(n.affectedRows === 1, 'cleared back to null');
}
for (const [bad, label] of [
  ['javascript:alert(1)', 'javascript: refused'],
  ['data:text/html,<script>alert(1)</script>', 'data: refused'],
  ['runsignup.com/race', 'scheme-less refused (client adds https://)'],
  ['https://example.org/a b', 'whitespace refused'],
  ['', 'empty string refused (client sends null)'],
  [`https://example.org/${'a'.repeat(2048)}`, 'over 2048 chars refused'],
]) {
  await expectError(
    () => db.query(`UPDATE public.events SET registration_url = $1 WHERE id = $2`, [bad, MINE]),
    '23514', label);
}
{
  const r = await db.query(`UPDATE public.events SET registration_url = 'https://evil.example' WHERE id = $1`, [THEIRS]);
  ok(r.affectedRows === 0, "can't set it on someone else's event (RLS)");
}

console.log('\nAnon reads');
await asPostgres();
await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'anon' })]);
await db.exec(`SET ROLE anon`);
{
  const { rows } = await db.query(
    `SELECT slug, start_time, registration_url FROM public.public_events ORDER BY slug`);
  const mine = rows.find((r) => r.slug === 'turkey-trot');
  ok(mine?.start_time === '08:00:00', 'start_time visible', mine);
  ok(mine?.registration_url === 'https://runsignup.com/Race/IL/Lincolnwood/TurkeyTrot', 'registration_url visible');
  ok(rows.find((r) => r.slug === 'other-trot')?.registration_url === null, 'unset link reads as null');
  ok(!rows.some((r) => r.slug === 'draft-trot'), 'drafts still hidden');
  const base = await db.query(`SELECT registration_url FROM public.events`);
  ok(base.rows.length === 0, 'base table still returns nothing to anon (RLS)');
}

done();
