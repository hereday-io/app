// A Moved status needs a location (20261014160000): poi_statuses and
// poi_status_history reject state='moved' without both moved_to
// coordinates, from the owner's direct writes (the Ops Center override
// path) as well as service-role writes. Other states are unaffected.
// Fixtures only; touches no real database.
//
//   npm run test:db
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, testKit, REPO_ROOT } from './pglite.mjs';

const MIGRATION = '20261014160000_poi_status_moved_needs_location.sql';
const migrationSql = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', MIGRATION), 'utf8');

const { db, results } = await createDb(REPO_ROOT, { stopBefore: MIGRATION });
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  for (const r of failed) console.log('MIGRATION FAIL', r.f, r.err);
  process.exit(1);
}
const { ok, as, asPostgres, expectError, mkUser, done } = testKit(db);

const ME = await mkUser('director@example.org', 'email');
const EVENT = (await db.query(
  `INSERT INTO public.events (user_id, name, slug, city, event_date, status)
   VALUES ($1, 'Turkey Trot', 'turkey-trot', 'Lincolnwood', DATE '2026-11-22', 'published')
   RETURNING id`, [ME])).rows[0].id;

// Same shape as the Ops Center override's upsert + history insert.
const upsert = (poi, state, lng = null, lat = null) => db.query(
  `INSERT INTO public.poi_statuses
     (event_id, poi_id, state, note, moved_to_lng, moved_to_lat, updated_by_name, updated_via_token, updated_at)
   VALUES ($1, $2, $3, NULL, $4, $5, 'Organizer', 'organizer', now())
   ON CONFLICT (event_id, poi_id) DO UPDATE SET
     state = EXCLUDED.state, moved_to_lng = EXCLUDED.moved_to_lng,
     moved_to_lat = EXCLUDED.moved_to_lat, updated_at = EXCLUDED.updated_at`,
  [EVENT, poi, state, lng, lat]);
const history = (poi, state, lng = null, lat = null) => db.query(
  `INSERT INTO public.poi_status_history
     (event_id, poi_id, state, note, moved_to_lng, moved_to_lat, updated_by_name, updated_via_token)
   VALUES ($1, $2, $3, NULL, $4, $5, 'Organizer', 'organizer')`,
  [EVENT, poi, state, lng, lat]);

console.log('\nBefore: the bug');
await as(ME);
await upsert('water-1', 'moved');
await history('water-1', 'moved');
ok((await db.query(`SELECT state FROM public.poi_statuses WHERE poi_id = 'water-1'`)).rows[0]?.state === 'moved',
  'owner can save Moved with no location');
await asPostgres();
await db.exec(`DELETE FROM public.poi_status_history; DELETE FROM public.poi_statuses;`);

try {
  await db.exec(migrationSql);
} catch (e) {
  console.log('MIGRATION FAIL', MIGRATION, e.message);
  process.exit(1);
}
// Running it twice must be harmless (someone re-pastes it in the editor).
await db.exec(migrationSql);

console.log('\nAfter: owner writes (Ops Center path)');
await as(ME);
for (const state of ['open', 'low', 'closed']) {
  await upsert('water-1', state);
  await history('water-1', state);
}
ok((await db.query(`SELECT state FROM public.poi_statuses WHERE poi_id = 'water-1'`)).rows[0]?.state === 'closed',
  'open / low / closed still save with no location');
ok((await db.query(`SELECT count(*)::int AS n FROM public.poi_status_history`)).rows[0].n === 3,
  'their history rows still insert');
await expectError(() => upsert('water-1', 'moved'), '23514', 'Moved with no location is rejected');
await expectError(() => upsert('water-1', 'moved', -87.7), '23514', 'Moved with only lng is rejected');
await expectError(() => upsert('water-1', 'moved', null, 42.0), '23514', 'Moved with only lat is rejected');
await expectError(() => history('water-1', 'moved'), '23514', 'history row for Moved with no location is rejected');
ok((await db.query(`SELECT state FROM public.poi_statuses WHERE poi_id = 'water-1'`)).rows[0]?.state === 'closed',
  'a rejected Moved leaves the current status alone');

console.log('\nAfter: volunteer path (service role, as update-poi-status writes)');
await asPostgres();
await upsert('water-2', 'moved', -87.71, 42.0);
await history('water-2', 'moved', -87.71, 42.0);
{
  const row = (await db.query(
    `SELECT state, moved_to_lng, moved_to_lat FROM public.poi_statuses WHERE poi_id = 'water-2'`)).rows[0];
  ok(row?.state === 'moved' && row.moved_to_lng === -87.71 && row.moved_to_lat === 42,
    'Moved with both coordinates saves', row);
}
await upsert('water-2', 'open');
ok((await db.query(`SELECT moved_to_lng FROM public.poi_statuses WHERE poi_id = 'water-2'`)).rows[0]?.moved_to_lng === null,
  'moving back to Open clears the location');
await expectError(() => db.query(
  `UPDATE public.poi_statuses SET state = 'moved' WHERE poi_id = 'water-2'`), '23514',
  'an UPDATE to Moved without coordinates is rejected too');

done();
