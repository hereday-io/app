// Owners can't make their own event Pro (20261019120000). Before it, the
// owner UPDATE policy covered the whole row, so a signed-in director could
// PATCH /events?id=eq.<own> with paid_at=now() and skip checkout. Now the
// billing columns only change through the service role (stripe-webhook)
// or SECURITY DEFINER code (comp grants, admin transfer), and every other
// owner edit still works. The same migration fixes the comp stamp on new
// events, which never fired for a non-admin owner (it read comp_grants
// through admin-only RLS). Fixtures only; touches no real database.
//
//   npm run test:db
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, testKit, REPO_ROOT } from './pglite.mjs';

const MIGRATION = '20261019120000_events_lock_billing_columns.sql';
const migrationPath = join(REPO_ROOT, 'supabase', 'migrations', MIGRATION);

const { db, results } = await createDb(REPO_ROOT, { stopBefore: MIGRATION });
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  for (const r of failed) console.log('MIGRATION FAIL', r.f, r.err);
  process.exit(1);
}
const { ok, as, asPostgres, expectError, mkUser, done } = testKit(db);

const ME = await mkUser('director@example.org', 'email');
const ADMIN = await mkUser('admin@example.org', 'email');
const COMPED = await mkUser('comped@example.org', 'email');
await db.query(`UPDATE public.profiles SET is_admin = true WHERE user_id = $1`, [ADMIN]);

let n = 0;
const insertEvent = (owner, extraCols = '', extraVals = '') => db.query(
  `INSERT INTO public.events (user_id, name, slug, city, event_date, start_time, status${extraCols})
   VALUES ($1, 'Turkey Trot', $2, 'Lincolnwood', DATE '2026-11-22', TIME '08:00', 'draft'${extraVals})
   RETURNING id, paid_at, plan, comp_grant_id`, [owner, `turkey-trot-${++n}`]);
const row = async (id) => (await db.query(
  `SELECT paid_at, plan, comp_grant_id, stripe_session_id, stripe_payment_id, name
     FROM public.events WHERE id = $1`, [id])).rows[0];

console.log('\nBefore: the gap');
await as(ME);
const BEFORE = (await insertEvent(ME)).rows[0].id;
await db.query(`UPDATE public.events SET paid_at = now(), plan = 'pro' WHERE id = $1`, [BEFORE]);
await asPostgres();
ok((await row(BEFORE)).paid_at !== null, 'an owner can mark their own event Pro (the bug)');
await db.query(`UPDATE public.events SET paid_at = NULL, plan = 'free' WHERE id = $1`, [BEFORE]);
{
  const EARLY = await mkUser('early@example.org', 'email');
  await db.query(`INSERT INTO public.comp_grants (user_id, granted_by, grant_reason)
                  VALUES ($1, $2, 'early pilot')`, [EARLY, ADMIN]);
  await as(EARLY);
  const r = (await insertEvent(EARLY)).rows[0];
  ok(r.paid_at === null, "a comped owner's new event isn't stamped Pro (the second bug)", r);
  await asPostgres();
}

if (!existsSync(migrationPath)) {
  ok(false, `migration ${MIGRATION} exists`);
  done();
}
const migrationSql = readFileSync(migrationPath, 'utf8');
try {
  await db.exec(migrationSql);
  await db.exec(migrationSql); // re-pasting it in the SQL editor must be harmless
} catch (e) {
  console.log('MIGRATION FAIL', MIGRATION, e.message);
  process.exit(1);
}

console.log('\nOwner updates');
await as(ME);
for (const [col, val] of [
  ['paid_at', 'now()'],
  ['plan', `'pro'`],
  ['stripe_session_id', `'cs_test_fake'`],
  ['stripe_payment_id', `'pi_test_fake'`],
]) {
  await expectError(
    () => db.query(`UPDATE public.events SET ${col} = ${val} WHERE id = $1`, [BEFORE]),
    '42501', `owner can't set ${col}`);
}
{
  await asPostgres();
  const grant = (await db.query(
    `INSERT INTO public.comp_grants (user_id, granted_by, grant_reason)
     VALUES ($1, $2, 'someone else''s grant') RETURNING id`, [COMPED, ADMIN])).rows[0].id;
  await as(ME);
  await expectError(
    () => db.query(`UPDATE public.events SET comp_grant_id = $2 WHERE id = $1`, [BEFORE, grant]),
    '42501', "owner can't attach a comp grant");
}
await db.query(`UPDATE public.events SET name = 'Turkey Trot 5K' WHERE id = $1`, [BEFORE]);
ok((await row(BEFORE)).name === 'Turkey Trot 5K', 'owner can still edit the event');
await db.query(
  `UPDATE public.events SET name = 'Turkey Trot', paid_at = NULL, plan = 'free', comp_grant_id = NULL,
          stripe_session_id = NULL, stripe_payment_id = NULL WHERE id = $1`, [BEFORE]);
ok(true, 'a full-row save that leaves billing columns unchanged still works');
await asPostgres();
ok((await row(BEFORE)).paid_at === null, 'event is still free');

console.log('\nOwner inserts');
await as(ME);
await expectError(() => insertEvent(ME, ', paid_at', ', now()'), '42501', "can't create an event already Pro");
await expectError(() => insertEvent(ME, ', plan', `, 'pro'`), '42501', "can't create an event with plan 'pro'");
await expectError(() => insertEvent(ME, ', stripe_payment_id', `, 'pi_test_fake'`), '42501',
  "can't create an event with a payment id");
{
  const r = (await insertEvent(ME)).rows[0];
  ok(r.paid_at === null && r.plan === 'free', 'a plain new event is created free', r);
  const explicit = (await insertEvent(ME, ', plan', `, 'free'`)).rows[0];
  ok(explicit.plan === 'free', "plan 'free' sent explicitly is fine");
}

console.log('\nStripe webhook (service role)');
await asPostgres();
await db.exec(`SET ROLE service_role`);
await db.query(
  `UPDATE public.events SET paid_at = now(), plan = 'pro', stripe_session_id = 'cs_live',
          stripe_payment_id = 'pi_live' WHERE id = $1`, [BEFORE]);
await asPostgres();
ok((await row(BEFORE)).stripe_payment_id === 'pi_live', 'service role can mark an event paid');
await as(ME);
await expectError(() => db.query(`UPDATE public.events SET paid_at = NULL WHERE id = $1`, [BEFORE]),
  '42501', "owner can't clear paid_at either");
await db.query(`UPDATE public.events SET name = 'Paid Trot' WHERE id = $1`, [BEFORE]);
await asPostgres();
const paid = await row(BEFORE);
ok(paid.name === 'Paid Trot' && paid.paid_at !== null, 'owner can still edit a paid event', paid);

console.log('\nComp grants (SECURITY DEFINER triggers)');
await as(COMPED);
const EXISTING = (await insertEvent(COMPED)).rows[0].id;
await as(ADMIN);
const GRANT = (await db.query(
  `INSERT INTO public.comp_grants (user_id, granted_by, grant_reason)
   VALUES ($1, $2, 'partner pilot') RETURNING id`, [COMPED, ADMIN])).rows[0].id;
await asPostgres();
{
  const r = await row(EXISTING);
  ok(r.paid_at !== null && r.comp_grant_id === GRANT, 'granting a comp stamps existing events', r);
}
await as(COMPED);
{
  const r = (await insertEvent(COMPED)).rows[0];
  ok(r.paid_at !== null && r.comp_grant_id === GRANT && r.plan === 'pro',
    'a comped user\'s new event is stamped Pro', r);
}
await as(ADMIN);
await db.query(
  `UPDATE public.comp_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'pilot over'
    WHERE id = $1`, [GRANT, ADMIN]);
await asPostgres();
{
  const r = await row(EXISTING);
  ok(r.paid_at === null && r.comp_grant_id === null, 'revoking the comp clears it again', r);
}

console.log('\nFree-plan gates still apply');
await as(ME);
{
  const id = (await insertEvent(ME)).rows[0].id;
  await expectError(() => db.query(`UPDATE public.events SET branding_style = 'bold' WHERE id = $1`, [id]),
    'P0001', 'free event still refuses Pro branding');
}

done();
