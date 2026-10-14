// Stripe webhook ledger (20260727120000) and the webhook's idempotent
// writes, as the exact statements supabase/functions/stripe-webhook
// sends through PostgREST, run as service_role. Fixtures only; touches
// no real database.
//
// PGlite is a single connection, so two deliveries racing for one claim
// can't be run truly concurrently here. The sequential cases pin down
// the predicates; the race itself rests on Postgres re-checking an
// UPDATE's WHERE against the row the winner just wrote.
//
//   npm run test:db
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, testKit, REPO_ROOT } from './pglite.mjs';

const MIGRATION = '20260727120000_stripe_webhook_ledger_two_phase.sql';
const STALE_CLAIM_MS = 10 * 60 * 1000; // keep in step with the webhook

// createDb throws if any migration fails to replay.
const { db } = await createDb();
const { ok, as, asPostgres, expectError, mkUser, done } = testKit(db);

const asService = async () => {
  await asPostgres();
  await db.exec(`SET ROLE service_role`);
};

// The webhook's four ledger statements.
const claim = (id, at = new Date()) => db.query(
  `INSERT INTO public.stripe_webhook_events (event_id, event_type, processed_at) VALUES ($1, 'charge.refunded', $2)`,
  [id, at.toISOString()]);
const reclaim = async (id, now = new Date()) => {
  const r = await db.query(
    `UPDATE public.stripe_webhook_events SET processed_at = $2
      WHERE event_id = $1 AND completed_at IS NULL AND processed_at < $3
      RETURNING event_id`,
    [id, now.toISOString(), new Date(now.getTime() - STALE_CLAIM_MS).toISOString()]);
  return r.rows.length;
};
const lookup = async (id) => (await db.query(
  `SELECT completed_at FROM public.stripe_webhook_events WHERE event_id = $1`, [id])).rows[0];
const complete = (id) => db.query(
  `UPDATE public.stripe_webhook_events SET completed_at = now() WHERE event_id = $1`, [id]);

// What the webhook answers a delivery, given the statements above.
const deliver = async (id, now = new Date()) => {
  try {
    await claim(id, now);
    return 'run';
  } catch (e) {
    if (e.code !== '23505') throw e;
  }
  if (await reclaim(id, now)) return 'run (reclaimed)';
  return (await lookup(id))?.completed_at ? '200 replay' : '409 deferred';
};

// Backfill: rows the old insert-then-dispatch flow left behind. A
// second database stopped just before the migration, which is then run
// the way it will be in the SQL editor.
console.log('\nMigration on a ledger that already has rows');
{
  const { db: old, results: before } = await createDb(REPO_ROOT, { stopBefore: MIGRATION });
  ok(before.every((r) => r.ok), 'earlier migrations apply');
  await old.query(
    `INSERT INTO public.stripe_webhook_events (event_id, event_type, processed_at)
     VALUES ('evt_old', 'checkout.session.completed', now() - interval '30 days')`);
  const sql = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', MIGRATION), 'utf8');
  await old.exec(`BEGIN;\n${sql}\nCOMMIT;`);
  const { rows } = await old.query(
    `SELECT completed_at = processed_at AS same FROM public.stripe_webhook_events WHERE event_id = 'evt_old'`);
  ok(rows[0]?.same === true, 'existing rows are backfilled as completed at their processed_at');
  await old.exec(`BEGIN;\n${sql}\nCOMMIT;`);
  ok(true, 'migration can be re-run without error');
  await old.close();
}

console.log('\nLedger: claim, complete, reclaim');
await asService();
{
  const t0 = new Date();
  ok(await deliver('evt_a', t0) === 'run', 'first delivery claims and runs');
  ok((await lookup('evt_a')).completed_at === null, 'claim is outstanding until completed');
  ok(await deliver('evt_a', t0) === '409 deferred', 'duplicate while claim is fresh is deferred, not acknowledged');

  // Handler failed: no completion. A retry inside the window still defers.
  const t1 = new Date(t0.getTime() + STALE_CLAIM_MS - 1000);
  ok(await deliver('evt_a', t1) === '409 deferred', 'retry inside the stale window is deferred');

  // A retry past the window takes the claim over.
  const t2 = new Date(t0.getTime() + STALE_CLAIM_MS + 1000);
  ok(await deliver('evt_a', t2) === 'run (reclaimed)', 'retry past the stale window reclaims');
  ok(await reclaim('evt_a', t2) === 0, 'a second reclaimer at the same moment loses (processed_at was bumped)');
  ok(await deliver('evt_a', t2) === '409 deferred', 'and is deferred');

  await complete('evt_a');
  ok(await deliver('evt_a', t2) === '200 replay', 'once completed, a duplicate is a replay');
  const far = new Date(t0.getTime() + 7 * 24 * 3600 * 1000);
  ok(await reclaim('evt_a', far) === 0, 'a completed claim is never reclaimed, however old');
}

console.log('\nLedger: access');
{
  await asService();
  const r = await db.query(
    `SELECT has_table_privilege('service_role', 'public.stripe_webhook_events', 'INSERT')
        AND has_table_privilege('service_role', 'public.stripe_webhook_events', 'UPDATE')
        AND has_table_privilege('service_role', 'public.stripe_webhook_events', 'SELECT') AS ok`);
  ok(r.rows[0].ok, 'service_role can insert, update and select');
  const U = await (async () => { await asPostgres(); return mkUser('someone@example.com', 'email'); })();
  await as(U);
  await expectError(() => db.query(`SELECT * FROM public.stripe_webhook_events`), '42501', 'signed-in users cannot read the ledger');
}

console.log('\nEvents: paid_at and refund writes are idempotent');
await asPostgres();
const BUYER = await mkUser('director@example.org', 'email');
const { rows: [{ id: EVENT }] } = await db.query(
  `INSERT INTO public.events (user_id, name, status, slug) VALUES ($1, 'Glenview Gobbler', 'draft', 'glenview-gobbler-zz') RETURNING id`,
  [BUYER]);
await asService();
{
  const markPaid = () => db.query(
    `UPDATE public.events SET paid_at = now(), plan = 'pro', stripe_session_id = 'cs_1', stripe_payment_id = 'ch_1'
      WHERE id = $1 AND paid_at IS NULL RETURNING id`, [EVENT]);
  ok((await markPaid()).rows.length === 1, 'first checkout flips paid_at (and passes the pro-gates trigger)');
  const { rows: [{ paid_at: first }] } = await db.query(`SELECT paid_at FROM public.events WHERE id = $1`, [EVENT]);
  ok((await markPaid()).rows.length === 0, 'a re-run flips nothing, so logs no second purchase_completed');
  const { rows: [{ paid_at: again }] } = await db.query(`SELECT paid_at FROM public.events WHERE id = $1`, [EVENT]);
  ok(+first === +again, 'paid_at keeps its original timestamp');

  const revokeById = () => db.query(
    `UPDATE public.events SET paid_at = NULL, plan = 'free'
      WHERE paid_at IS NOT NULL AND id = $1 RETURNING id, user_id`, [EVENT]);
  const revokeByCharge = () => db.query(
    `UPDATE public.events SET paid_at = NULL, plan = 'free'
      WHERE paid_at IS NOT NULL AND stripe_payment_id = 'ch_1' RETURNING id, user_id`);
  const r1 = await revokeById();
  ok(r1.rows.length === 1 && r1.rows[0].user_id === BUYER, 'refund revokes Pro and returns the row to log');
  ok((await revokeById()).rows.length === 0, 'a re-run revokes nothing, so logs no second purchase_refunded');
  ok((await revokeByCharge()).rows.length === 0, 'same through the stripe_payment_id fallback');
  const { rows: [ev] } = await db.query(`SELECT paid_at, plan FROM public.events WHERE id = $1`, [EVENT]);
  ok(ev.paid_at === null && ev.plan === 'free', 'event ends free');
}

// A 100%-off promotion code completes checkout with payment_status
// 'no_payment_required' and no charge, so the webhook writes paid_at with
// stripe_payment_id NULL. That is the shape comp grants use (paid_at, no
// charge id), so the comp triggers must leave it alone in both directions.
console.log('\nEvents: a $0 checkout (no charge) unlocks, and comp grants leave it alone');
await asPostgres();
const FREE_BUYER = await mkUser('partner@example.org', 'email');
const ADMIN = await mkUser('admin@example.org', 'email');
const { rows: [{ id: FREE_EVENT }] } = await db.query(
  `INSERT INTO public.events (user_id, name, status, slug) VALUES ($1, 'Partner 5K', 'draft', 'partner-5k-zz') RETURNING id`,
  [FREE_BUYER]);
await asService();
{
  const markPaidFree = () => db.query(
    `UPDATE public.events SET paid_at = now(), plan = 'pro', stripe_session_id = 'cs_free', stripe_payment_id = NULL
      WHERE id = $1 AND paid_at IS NULL RETURNING id`, [FREE_EVENT]);
  ok((await markPaidFree()).rows.length === 1, '$0 checkout flips paid_at with no charge id (and passes the pro-gates trigger)');
  ok((await markPaidFree()).rows.length === 0, 'a re-run flips nothing, so logs no second purchase_completed');

  await asPostgres();
  const { rows: [{ id: GRANT }] } = await db.query(
    `INSERT INTO public.comp_grants (user_id, granted_by, grant_reason) VALUES ($1, $2, 'test grant') RETURNING id`,
    [FREE_BUYER, ADMIN]);
  let { rows: [ev] } = await db.query(
    `SELECT paid_at, plan, comp_grant_id, stripe_session_id FROM public.events WHERE id = $1`, [FREE_EVENT]);
  ok(ev.paid_at !== null && ev.comp_grant_id === null, 'a later comp grant does not adopt the $0 unlock');
  await db.query(
    `UPDATE public.comp_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'test revoke' WHERE id = $1`,
    [GRANT, ADMIN]);
  ({ rows: [ev] } = await db.query(
    `SELECT paid_at, plan, stripe_session_id FROM public.events WHERE id = $1`, [FREE_EVENT]));
  ok(ev.paid_at !== null && ev.plan === 'pro' && ev.stripe_session_id === 'cs_free',
    'revoking that grant leaves the $0 unlock Pro');

  // Documented, not asserted as desirable: with no charge id the CRM's
  // event_facts reads a $0 unlock as comped rather than paid.
  const { rows: [facts] } = await db.query(
    `SELECT is_paid, is_comped FROM crm_internal.event_facts WHERE event_id = $1`, [FREE_EVENT]);
  ok(facts.is_comped === true && facts.is_paid === false, 'CRM reads a $0 unlock as comped (no revenue)');
  await asService();
}

console.log('\nproduct_events: the webhook can write revenue rows');
{
  const r = await db.query(
    `INSERT INTO public.product_events (event_type, user_id, event_id, properties)
     VALUES ('purchase_completed', $1, $2, '{"amount_total": 3675, "currency": "usd", "promo_code": "FIRSTMAP"}'),
            ('purchase_refunded',  $1, $2, '{"amount_total": 3675, "amount_refunded": 3675, "currency": "usd"}'),
            ('purchase_completed', $3, $4, '{"amount_total": 0, "amount_discount": 4900, "percent_off": 100, "currency": "usd", "promo_code": "PARTNER100"}')
     RETURNING id`,
    [BUYER, EVENT, FREE_BUYER, FREE_EVENT]);
  ok(r.rows.length === 3, 'service_role inserts purchase_completed (paid and $0) and purchase_refunded');
}

done();
