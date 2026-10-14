// One-off revenue backfill (supabase/backfills/stripe_revenue_backfill.sql),
// rendered by scripts/stripe-revenue-backfill.mjs from fixture charges
// shaped like its Stripe output. Runs the preview and the apply the way
// Kevin will in the SQL editor. Fixtures only; touches no real database.
//
//   npm run test:db
import { createDb, testKit } from './pglite.mjs';
import { collectCharges, normaliseCharge, renderBackfill, stripeClient } from '../../scripts/stripe-revenue-backfill.mjs';

// createDb throws if any migration fails to replay.
const { db } = await createDb();
const { ok, mkUser, done } = testKit(db);
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (o) => Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b)));

// ── Fixtures ─────────────────────────────────────────────────────────
const A = await mkUser('alpha@example.org', 'email');   // has attribution
const B = await mkUser('bravo@example.org', 'email');   // has none
const C = await mkUser('charlie@example.org', 'email'); // took over an event by transfer
await db.query(
  `UPDATE public.profiles SET first_referrer = 'https://www.google.com/', first_landing_page = '/pricing',
          utm_source = 'google', utm_medium = 'cpc' WHERE user_id = $1`, [A]);

const mkEvent = async (owner, name, chargeId = null) => (await db.query(
  `INSERT INTO public.events (user_id, name, status, slug, stripe_payment_id)
   VALUES ($1, $2, 'draft', $3, $4) RETURNING id`,
  [owner, name, name.toLowerCase().replace(/\W+/g, '-'), chargeId])).rows[0].id;
const E1 = await mkEvent(A, 'Alpha Classic');
const E2 = await mkEvent(B, 'Bravo Bash', 'ch_2');      // matched only by stripe_payment_id
const E4 = await mkEvent(B, 'Already Logged');
const E5 = await mkEvent(A, 'Refunded Run');
const E6 = await mkEvent(B, 'Partial Pace');
const E8 = await mkEvent(B, 'Ghost Buyer');
const E9 = await mkEvent(B, 'Bad Meta', 'ch_9');
const E10 = await mkEvent(C, 'Transferred Trot');       // bought by A, now owned by C
const DELETED = '00000000-0000-4000-8000-00000000dead';
const GONE_USER = '00000000-0000-4000-8000-00000000beef';

const T = 1767225600; // 2026-01-01T00:00:00Z
const iso = (s) => new Date(s * 1000).toISOString();
const charge = (id, created, extra = {}) => ({
  id, created, amount: 4900, currency: 'usd', amount_refunded: 0, metadata: {}, refunds: { data: [] }, ...extra,
});
const session = (id, meta, { total = 4900, subtotal = 4900, discount = 0 } = {}) => ({
  id, amount_total: total, amount_subtotal: subtotal, currency: 'usd',
  total_details: { amount_discount: discount }, metadata: meta,
});

const input = [
  // Code applied on /billing: in session metadata. Stripe's own metadata keys are dropped.
  normaliseCharge(
    charge('ch_1', T + 100, { metadata: { hereday_event_id: E1, other_tool: 'x' } }),
    session('cs_1', { hereday_event_id: E1, hereday_user_id: A, hereday_promo_code: 'FIRSTMAP' },
      { total: 3675, discount: 1225 }), null),
  // No metadata, no Checkout Session: only events.stripe_payment_id ties it to an event.
  normaliseCharge(charge('ch_2', T + 200), null, null),
  // The event was deleted after the sale.
  normaliseCharge(charge('ch_3', T + 300), session('cs_3', { hereday_event_id: DELETED, hereday_user_id: A }), null),
  // The new webhook already logged this one.
  normaliseCharge(charge('ch_4', T + 400), session('cs_4', { hereday_event_id: E4, hereday_user_id: B }), null),
  // Code typed on Stripe's page, then fully refunded (in two parts).
  normaliseCharge(
    charge('ch_5', T + 500, { amount: 4410, amount_refunded: 4410, refunds: { data: [
      { status: 'succeeded', created: T + 900 }, { status: 'succeeded', created: T + 950 },
      { status: 'failed', created: T + 999 }] } }),
    session('cs_5', { hereday_event_id: E5, hereday_user_id: A }, { total: 4410, discount: 490 }), 'WELCOME10'),
  // Partial refund: the purchase is logged, the refund is not.
  normaliseCharge(
    charge('ch_6', T + 600, { amount_refunded: 1000, refunds: { data: [{ status: 'succeeded', created: T + 700 }] } }),
    session('cs_6', { hereday_event_id: E6, hereday_user_id: B }), null),
  // Not a Hereday sale at all.
  normaliseCharge(charge('ch_7', T + 700), null, null),
  // Buyer's account deleted since.
  normaliseCharge(charge('ch_8', T + 800), session('cs_8', { hereday_event_id: E8, hereday_user_id: GONE_USER }), null),
  // Garbage in metadata must not break the uuid casts.
  normaliseCharge(charge('ch_9', T + 900, { metadata: { hereday_event_id: 'not-a-uuid', hereday_user_id: '' } }), null, null),
  // Event moved to C by an admin transfer; the buyer was A.
  normaliseCharge(charge('ch_10', T + 1000), session('cs_10', { hereday_event_id: E10, hereday_user_id: A }), null),
];
input.push({ ...input[0] }); // a duplicate charge in the input

await db.query(
  `INSERT INTO public.product_events (event_type, user_id, event_id, properties, created_at)
   VALUES ('purchase_completed', $1, $2, '{"amount_total": 4900, "currency": "usd", "stripe_charge_id": "ch_4"}', now()),
          ('page_view', NULL, NULL, '{"path": "/"}', now())`, [B, E4]);

const { preview, apply } = renderBackfill(input);
const countRevenue = async () => (await db.query(
  `SELECT count(*)::int AS n FROM public.product_events WHERE event_type IN ('purchase_completed', 'purchase_refunded')`)).rows[0].n;

// ── Preview ──────────────────────────────────────────────────────────
console.log('\nPreview');
await db.exec('BEGIN READ ONLY');
const { rows: plan } = await db.query(preview);
await db.exec('ROLLBACK');
ok(true, 'runs inside a READ ONLY transaction');
const action = (chargeId, type = 'purchase_completed') =>
  plan.find((r) => r.charge_id === chargeId && r.event_type === type)?.action;
ok(plan.length === 12, 'one row per charge, plus one per refunded charge; the duplicate charge collapses', plan.length);
ok(action('ch_1') === 'insert', 'metadata-matched sale is inserted');
ok(action('ch_2') === 'insert', 'sale matched by events.stripe_payment_id is inserted');
ok(action('ch_3') === 'insert' && plan.find((r) => r.charge_id === 'ch_3').event_exists === false,
  'sale for a deleted event is inserted and flagged event_exists = false');
ok(action('ch_4') === 'skip: already logged', 'sale the webhook already logged is skipped');
ok(action('ch_5') === 'insert' && action('ch_5', 'purchase_refunded') === 'insert', 'full refund logs purchase and refund');
ok(action('ch_6') === 'insert' && action('ch_6', 'purchase_refunded') === 'skip: partial refund', 'partial refund is skipped');
ok(action('ch_7') === 'skip: no matching event', 'non-Hereday charge is skipped');
ok(action('ch_9') === 'insert' && plan.find((r) => r.charge_id === 'ch_9').event_id === E9,
  'malformed metadata falls back to stripe_payment_id');
ok(plan[0].action === 'insert' && plan.at(-1).action !== 'insert', 'inserts sort first');
ok(await countRevenue() === 1, 'preview wrote nothing');

// ── Apply ────────────────────────────────────────────────────────────
console.log('\nApply');
const out = await db.exec(apply);
const summary = out.at(-1).rows;
ok(Number(summary.find((r) => r.event_type === 'purchase_completed')?.backfilled_rows) === 8,
  'final SELECT reports 8 backfilled purchases', summary);
ok(Number(summary.find((r) => r.event_type === 'purchase_refunded')?.backfilled_rows) === 1, 'and 1 refund');
ok(await countRevenue() === 10, '9 new rows next to the existing one');

const row = async (chargeId, type = 'purchase_completed') => (await db.query(
  `SELECT user_id, event_id, created_at, properties FROM public.product_events
    WHERE event_type = $1 AND properties->>'stripe_charge_id' = $2`, [type, chargeId])).rows;

{
  const [r] = await row('ch_1');
  ok(same(r.properties, {
    amount_total: 3675, amount_subtotal: 4900, amount_discount: 1225, currency: 'usd', percent_off: 25,
    promo_code: 'FIRSTMAP', stripe_session_id: 'cs_1', stripe_charge_id: 'ch_1', backfilled: true,
    first_referrer: 'https://www.google.com/', first_landing_page: '/pricing', utm_source: 'google', utm_medium: 'cpc',
  }), 'purchase properties match the webhook, with attribution and no null keys', r.properties);
  ok(r.user_id === A && r.event_id === E1, 'buyer and event set');
  ok(r.created_at.toISOString() === iso(T + 100), 'created_at is the charge time');
}
{
  const [r] = await row('ch_2');
  ok(same(r.properties, { amount_total: 4900, currency: 'usd', stripe_charge_id: 'ch_2', backfilled: true }),
    'session-less sale: amount from the charge, no subtotal/discount/promo keys', r.properties);
  ok(r.user_id === B && r.event_id === E2, 'buyer falls back to the event owner');
}
{
  const [r] = await row('ch_3');
  ok(r.event_id === DELETED && r.user_id === A, 'deleted event keeps its id');
}
{
  const p = await row('ch_5');
  const [ref] = await row('ch_5', 'purchase_refunded');
  ok(p[0].properties.promo_code === 'WELCOME10' && p[0].properties.percent_off === 10,
    'code typed on Stripe\'s page is recorded, percent_off derived from the totals');
  ok(same(ref.properties, {
    amount_total: 4410, amount_refunded: 4410, currency: 'usd', stripe_charge_id: 'ch_5', promo_code: 'WELCOME10',
    backfilled: true, first_referrer: 'https://www.google.com/', first_landing_page: '/pricing',
    utm_source: 'google', utm_medium: 'cpc',
  }), 'refund properties match the webhook', ref.properties);
  ok(ref.created_at.toISOString() === iso(T + 950), 'refund created_at is the last succeeded refund');
  ok(ref.event_id === E5 && ref.user_id === A, 'refund tied to the same event and buyer');
}
{
  const [r] = await row('ch_8');
  ok(r.user_id === null && r.event_id === E8, 'buyer no longer in auth.users is written as NULL');
  ok(!('utm_source' in r.properties), 'and carries no attribution');
}
{
  const [r] = await row('ch_10');
  ok(r.user_id === A && r.properties.utm_source === 'google', 'transferred event: buyer and attribution from metadata, not the new owner');
}
ok((await row('ch_4')).length === 1 && !(await row('ch_4'))[0].properties.backfilled, 'existing webhook row untouched, not duplicated');

// The CRM timeline reads amount_total off both kinds.
{
  const { rows } = await db.query(
    `SELECT event_type FROM public.product_events
      WHERE event_type IN ('purchase_completed', 'purchase_refunded') AND properties->'amount_total' IS NULL`);
  ok(rows.length === 0, 'every revenue row has amount_total for crm_get_deal');
}

// ── Re-run and guard ─────────────────────────────────────────────────
console.log('\nIdempotency');
await db.exec(apply);
ok(await countRevenue() === 10, 'a second run inserts nothing');
{
  const { rows } = await db.query(preview);
  ok(rows.every((r) => r.action !== 'insert'), 'and the preview then shows no inserts');
}

console.log('\nGuard');
await db.query(
  `INSERT INTO public.product_events (event_type, user_id, event_id, properties)
   VALUES ('purchase_completed', $1, $2, '{"amount_total": 3675, "stripe_charge_id": "ch_1"}')`, [A, E1]);
{
  let err;
  try { await db.exec(apply); } catch (e) { err = e; }
  await db.exec('ROLLBACK');
  ok(/would duplicate purchase_completed for charge ch_1/.test(err?.message ?? ''),
    'a duplicate next to a backfilled row aborts the run', err?.message);
}
await db.exec(`DELETE FROM public.product_events WHERE properties = '{"amount_total": 3675, "stripe_charge_id": "ch_1"}'`);
{
  // A new charge arriving alongside the duplicate must not have been written.
  const more = renderBackfill([...input,
    normaliseCharge(charge('ch_11', T + 1100), session('cs_11', { hereday_event_id: E1, hereday_user_id: A }), null)]);
  await db.query(
    `INSERT INTO public.product_events (event_type, user_id, event_id, properties)
     VALUES ('purchase_completed', $1, $2, '{"stripe_charge_id": "ch_1"}')`, [A, E1]);
  try { await db.exec(more.apply); } catch { /* expected */ }
  await db.exec('ROLLBACK');
  ok((await row('ch_11')).length === 0, 'an aborted run leaves none of its rows behind');
}

// ── Reading Stripe ───────────────────────────────────────────────────
// The script's HTTP client and collection step against a fake fetch.
console.log('\nReading Stripe (fake fetch)');
{
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, q: u.searchParams, auth: init.headers.Authorization });
    const reply = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname === '/v1/charges') {
      const base = { amount: 4900, currency: 'usd', amount_refunded: 0, metadata: {}, refunds: { data: [] },
        status: 'succeeded', paid: true, livemode: true };
      return u.searchParams.get('starting_after')
        ? reply({ has_more: false, data: [
            { ...base, id: 'ch_p2', created: T, payment_intent: 'pi_p2' },
            { ...base, id: 'ch_test', created: T, livemode: false },
            { ...base, id: 'ch_failed', created: T, status: 'failed', paid: false }] })
        : reply({ has_more: true, data: [{ ...base, id: 'ch_p1', created: T, payment_intent: 'pi_p1' }] });
    }
    if (u.pathname === '/v1/checkout/sessions') {
      const pi = u.searchParams.get('payment_intent');
      return reply({ data: [{
        id: `cs_${pi}`, amount_total: 4410, amount_subtotal: 4900, currency: 'usd',
        metadata: { hereday_event_id: E1, hereday_user_id: A },
        total_details: { amount_discount: 490, breakdown: { discounts: [{ discount: { promotion_code: 'promo_1' } }] } },
      }] });
    }
    if (u.pathname === '/v1/promotion_codes/promo_1') return reply({ code: 'WELCOME10' });
    return { ok: false, status: 404, json: async () => ({ error: { message: `unexpected ${u.pathname}` } }) };
  };
  try {
    const got = await collectCharges(stripeClient('rk_live_fake'), { until: new Date((T + 10) * 1000), livemode: true });
    ok(got.map((c) => c.charge_id).join() === 'ch_p1,ch_p2', 'follows pagination; drops test-mode and failed charges');
    ok(got.every((c) => c.session?.promo_code === 'WELCOME10' && c.session.amount_discount === 490),
      'session and the typed promotion code are attached');
    const chargeCall = calls.find((c) => c.path === '/v1/charges');
    ok(chargeCall.q.get('created[lt]') === String(T + 10) && chargeCall.q.get('expand[]') === 'data.refunds'
      && chargeCall.auth === 'Bearer rk_live_fake', 'charges are listed before the cutoff with refunds expanded');
    ok(calls.filter((c) => c.path.startsWith('/v1/promotion_codes')).length === 1, 'promotion codes are looked up once');
  } finally {
    globalThis.fetch = realFetch;
  }
}

done();
