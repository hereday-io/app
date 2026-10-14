// Paid-but-not-Pro reconciliation (billing_reconcile_prod_checks.sql),
// run verbatim against fixtures: one row of each kind it must report and
// each look-alike it must not. Fixtures only; touches no real database.
//
//   npm run test:db
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, testKit, REPO_ROOT } from './pglite.mjs';

const SQL = readFileSync(join(REPO_ROOT, 'supabase', 'tests', 'billing_reconcile_prod_checks.sql'), 'utf8');

// createDb throws if any migration fails to replay.
const { db } = await createDb();
const { ok, mkUser, done } = testKit(db);

const reconcile = async () => JSON.parse((await db.query(SQL)).rows[0].billing_reconcile);

console.log('\nNothing to report on a clean database');
{
  const r = await reconcile();
  ok(r.ok === true, 'ok is true');
  ok(r.stale_claims.length === 0 && r.stripe_paid_not_pro.length === 0 && r.purchases_not_pro.length === 0,
    'every list is empty');
}

// ── Fixtures ─────────────────────────────────────────────────────────
const BUYER = await mkUser('director@example.org', 'email');
const mkEvent = async (name, { session = null, paid = false } = {}) => {
  const { rows: [{ id }] } = await db.query(
    `INSERT INTO public.events (user_id, name, status, slug) VALUES ($1, $2, 'draft', $3) RETURNING id`,
    [BUYER, name, name.toLowerCase().replace(/\W+/g, '-')]);
  if (session) {
    await db.query(
      `UPDATE public.events SET stripe_session_id = $2, paid_at = CASE WHEN $3 THEN now() END,
              plan = CASE WHEN $3 THEN 'pro' ELSE 'free' END
        WHERE id = $1`, [id, session, paid]);
  }
  return id;
};
const logPurchase = (type, eventId, minutesAgo, session = null) => db.query(
  `INSERT INTO public.product_events (event_type, user_id, event_id, properties, created_at)
   VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5))`,
  [type, BUYER, eventId, session ? { stripe_session_id: session } : {}, minutesAgo]);
const claim = (id, minutesAgo, completed) => db.query(
  `INSERT INTO public.stripe_webhook_events (event_id, event_type, processed_at, completed_at)
   VALUES ($1, 'checkout.session.completed', now() - make_interval(mins => $2),
           CASE WHEN $3 THEN now() - make_interval(mins => $2) END)`,
  [id, minutesAgo, completed]);

const HEALTHY = await mkEvent('Healthy Half', { session: 'cs_ok', paid: true });
const LOST = await mkEvent('Lost Pro Loop', { session: 'cs_lost' });
const REFUNDED = await mkEvent('Refunded Run', { session: 'cs_ref' });
const REBOUGHT = await mkEvent('Rebought Relay', { session: 'cs_re2' });
await mkEvent('Free Fun Run');
const DELETED = '00000000-0000-4000-8000-00000000dead';

await logPurchase('purchase_completed', HEALTHY, 60, 'cs_ok');
await logPurchase('purchase_completed', LOST, 60, 'cs_lost');
await logPurchase('purchase_completed', REFUNDED, 120, 'cs_ref');
await logPurchase('purchase_refunded', REFUNDED, 90);
// Bought, refunded, bought again, then lost Pro: only the second sale
// is unexplained.
await logPurchase('purchase_completed', REBOUGHT, 300, 'cs_re1');
await logPurchase('purchase_refunded', REBOUGHT, 240);
await logPurchase('purchase_completed', REBOUGHT, 60, 'cs_re2');
await logPurchase('purchase_completed', DELETED, 60, 'cs_gone');

await claim('evt_done', 120, true);
await claim('evt_inflight', 5, false);
await claim('evt_stuck', 120, false);

console.log('\nReports what is owed, and only that');
{
  const r = await reconcile();
  ok(r.ok === false, 'ok is false');

  ok(r.stale_claims.length === 1 && r.stale_claims[0].event_id === 'evt_stuck',
    'stale_claims: the 2-hour-old open claim, not the completed one or the 5-minute-old one in flight',
    r.stale_claims);
  ok(r.stale_claims[0]?.hours_open >= 1.9, 'stale_claims: says how long it has been open', r.stale_claims[0]);

  const paidIds = r.stripe_paid_not_pro.map((x) => x.event_id).sort();
  ok(JSON.stringify(paidIds) === JSON.stringify([LOST].sort()),
    'stripe_paid_not_pro: the checkout event without Pro; not the paid one, the refunded ones, or the free one',
    r.stripe_paid_not_pro);

  const sessions = r.purchases_not_pro.map((x) => x.stripe_session_id).sort();
  ok(JSON.stringify(sessions) === JSON.stringify(['cs_gone', 'cs_lost', 'cs_re2']),
    'purchases_not_pro: the lost sale, the re-purchase after a refund, and the deleted event', r.purchases_not_pro);
  ok(r.purchases_not_pro.find((x) => x.stripe_session_id === 'cs_gone')?.event_missing === true,
    'purchases_not_pro: flags the sale whose event no longer exists');
}

console.log('\nClears once the event is Pro again and the claim completes');
{
  await db.query(`UPDATE public.events SET paid_at = now(), plan = 'pro' WHERE id = ANY($1)`, [[LOST, REBOUGHT]]);
  await db.query(`UPDATE public.stripe_webhook_events SET completed_at = now() WHERE event_id = 'evt_stuck'`);
  await db.query(`DELETE FROM public.product_events WHERE event_id = $1`, [DELETED]);
  const r = await reconcile();
  ok(r.ok === true, 'ok is true again', r);
}

done();
