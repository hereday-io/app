// Clean event slugs (20261014170000): new events get the plain name slug,
// "-2", "-3"… only when another event (anyone's, despite RLS) already has
// it, and organizer-chosen slug edits still fail loudly on a collision.
// Fixtures only; touches no real database.
//
//   npm run test:db
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, testKit, REPO_ROOT } from './pglite.mjs';

const MIGRATION = '20261014170000_events_clean_slugs.sql';

const { db, results } = await createDb(REPO_ROOT);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  for (const r of failed) console.log('MIGRATION FAIL', r.f, r.err);
  process.exit(1);
}
// Running it twice must be harmless (someone re-pastes it in the editor).
await db.exec(readFileSync(join(REPO_ROOT, 'supabase', 'migrations', MIGRATION), 'utf8'));
const { ok, as, asPostgres, expectError, mkUser, done } = testKit(db);

await asPostgres();
const ME = await mkUser('director@example.org', 'email');
const OTHER = await mkUser('other@example.org', 'email');
const create = async (owner, name, slug) => {
  await as(owner);
  const { rows } = await db.query(
    `INSERT INTO public.events (user_id, name, slug) VALUES ($1, $2, $3) RETURNING id, slug`,
    [owner, name, slug]);
  return rows[0];
};

console.log('\nNew events');
{
  const a = await create(ME, 'Lincolnwood Turkey Trot', 'lincolnwood-turkey-trot');
  ok(a.slug === 'lincolnwood-turkey-trot', 'first one keeps the clean slug', a.slug);
  // OTHER can't see ME's event under RLS, but the trigger can.
  const b = await create(OTHER, 'Lincolnwood Turkey Trot', 'lincolnwood-turkey-trot');
  ok(b.slug === 'lincolnwood-turkey-trot-2', "someone else's collision gets -2", b.slug);
  const c = await create(ME, 'Lincolnwood Turkey Trot', 'lincolnwood-turkey-trot');
  ok(c.slug === 'lincolnwood-turkey-trot-3', 'next one gets -3', c.slug);
  const d = await create(ME, "Henry's Thanksgiving Day Hustle 5K!", null);
  ok(d.slug === 'henry-s-thanksgiving-day-hustle-5k', 'derived from the name when no slug is sent', d.slug);
  const e = await create(ME, 'Spring 5K', '  --Spring__5K--  ');
  ok(e.slug === 'spring-5k', 'requested slug is normalized', e.slug);
  const f = await create(ME, '!!!', null);
  ok(f.slug === 'event', 'a name with no letters or digits still gets a slug', f.slug);
  const g = await create(ME, 'x'.repeat(200), null);
  ok(g.slug.length === 80, 'long names are capped at 80 chars', g.slug.length);
}

console.log('\nOrganizer edits stay strict');
{
  const mine = await create(ME, 'Dropbox 5K', 'dropbox-5k');
  await create(OTHER, 'Chicago Marathon', 'chicago-marathon');
  await as(ME);
  await expectError(
    () => db.query(`UPDATE public.events SET slug = 'chicago-marathon' WHERE id = $1`, [mine.id]),
    '23505', 'changing to a taken slug raises 23505 (no silent -2)');
  const r = await db.query(`UPDATE public.events SET name = 'Dropbox 5K 2026' WHERE id = $1 RETURNING slug`, [mine.id]);
  ok(r.rows[0].slug === 'dropbox-5k', 'renaming an event never changes its URL', r.rows[0].slug);
}

console.log('\nLocked down');
await asPostgres();
{
  const { rows } = await db.query(
    `SELECT has_function_privilege('anon', 'public.events_unique_slug()', 'EXECUTE') AS anon,
            has_function_privilege('authenticated', 'public.events_unique_slug()', 'EXECUTE') AS authed`);
  ok(!rows[0].anon && !rows[0].authed, 'trigger function is not callable by clients', rows[0]);
}

done();
