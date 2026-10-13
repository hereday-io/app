// Builds the one-off revenue backfill (supabase/backfills/stripe_revenue_backfill.sql)
// from live Stripe data. It only reads Stripe and writes local files.
// It never touches the database: Kevin runs the output in the SQL editor.
//
//   STRIPE_BACKFILL_KEY=rk_live_… node scripts/stripe-revenue-backfill.mjs --until 2026-10-14T18:30:00Z
//
// Use a restricted key with read access to Charges, Checkout Sessions
// and Promotion codes. Set --until to the time the new stripe-webhook was
// deployed: later sales are logged by the webhook itself. Without it the
// cutoff is now, which is still safe because the SQL skips charges that
// already have a row.
//
// Writes, under supabase/backfills/out/ (gitignored):
//   stripe_revenue_input.json    the normalised charges, for review
//   stripe_revenue_preview.sql   read-only; run first
//   stripe_revenue_apply.sql     the write, wrapped in BEGIN … COMMIT
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const TEMPLATE = join(REPO_ROOT, 'supabase', 'backfills', 'stripe_revenue_backfill.sql');
const OUT_DIR = join(REPO_ROOT, 'supabase', 'backfills', 'out');
const STRIPE_VERSION = '2023-10-16'; // same as _shared/billing.ts

/**
 * Turn the template plus normalised charges into { preview, apply } SQL.
 * Exported for supabase/tests/stripe_revenue_backfill.check.mjs.
 */
export function renderBackfill(input, templatePath = TEMPLATE) {
  const json = JSON.stringify(input);
  if (json.includes('$stripe_input$')) throw new Error('input contains the dollar-quote tag');
  const template = readFileSync(templatePath, 'utf8');
  const section = (name) => {
    const m = template.match(new RegExp(`-- ==== ${name} ====\\r?\\n([\\s\\S]*?)(?=\\r?\\n-- ==== |$)`));
    if (!m) throw new Error(`template has no ${name} section`);
    return m[1].trimEnd();
  };
  const core = section('CORE').replace('__STRIPE_INPUT__', () => json);
  const header = (what) =>
    `-- Generated ${new Date().toISOString()} by scripts/stripe-revenue-backfill.mjs\n` +
    `-- from supabase/backfills/stripe_revenue_backfill.sql (${input.length} charges). ${what}\n\n`;
  return {
    preview: header('Read-only.') + `WITH ${core}\n${section('PREVIEW')}\n`,
    apply: header('Writes product_events; run after the preview.') +
      `BEGIN;\n\nWITH ${core}\n${section('APPLY')}\n\nCOMMIT;\n\n` +
      `-- What is now in the table (runs after COMMIT).\n` +
      `SELECT event_type, count(*) AS backfilled_rows, sum((properties->>'amount_total')::int) AS amount_total,\n` +
      `       min(created_at) AS first_at, max(created_at) AS last_at\n` +
      `  FROM public.product_events WHERE properties->>'backfilled' = 'true'\n GROUP BY event_type;\n`,
  };
}

/** Keep only the metadata keys the SQL reads. */
const heredayMeta = (meta = {}) =>
  Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith('hereday_')));

/**
 * Normalise one Stripe charge (with refunds expanded) and its Checkout
 * Session (with total_details.breakdown expanded, or null) into the
 * shape the SQL template's jsonb_to_recordset expects.
 */
export function normaliseCharge(charge, session, sessionPromoCode) {
  const refundTimes = (charge.refunds?.data ?? [])
    .filter((r) => r.status === 'succeeded')
    .map((r) => r.created);
  return {
    charge_id: charge.id,
    created: charge.created,
    amount: charge.amount,
    currency: charge.currency,
    amount_refunded: charge.amount_refunded,
    refunded_at: refundTimes.length ? Math.max(...refundTimes) : null,
    charge_meta: heredayMeta(charge.metadata),
    session: session
      ? {
          id: session.id,
          amount_total: session.amount_total,
          amount_subtotal: session.amount_subtotal,
          amount_discount: session.total_details?.amount_discount ?? 0,
          currency: session.currency,
          meta: heredayMeta(session.metadata),
          promo_code: sessionPromoCode ?? null,
        }
      : null,
  };
}

export function stripeClient(key) {
  const get = async (path, params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      for (const one of [].concat(v)) qs.append(k, String(one));
    }
    const res = await fetch(`https://api.stripe.com/v1/${path}?${qs}`, {
      headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_VERSION },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Stripe ${path}: ${res.status} ${body.error?.message ?? ''}`);
    return body;
  };
  const listAll = async (path, params) => {
    const out = [];
    let starting_after;
    for (;;) {
      const page = await get(path, { ...params, limit: 100, ...(starting_after ? { starting_after } : {}) });
      out.push(...page.data);
      if (!page.has_more) return out;
      starting_after = page.data.at(-1).id;
    }
  };
  return { get, listAll };
}

async function main() {
  const args = process.argv.slice(2);
  const untilArg = args[args.indexOf('--until') + 1];
  const until = args.includes('--until') ? new Date(untilArg) : new Date();
  if (Number.isNaN(+until)) throw new Error(`bad --until: ${untilArg}`);

  const key = process.env.STRIPE_BACKFILL_KEY;
  if (!key) throw new Error('set STRIPE_BACKFILL_KEY to a read-only restricted live key (rk_live_…)');
  if (!/_live_/.test(key) && !args.includes('--allow-test')) {
    throw new Error('STRIPE_BACKFILL_KEY is not a live key; pass --allow-test to run against test mode anyway');
  }

  setDefaultResultOrder('ipv4first'); // Node on this machine can stall on IPv6
  const input = await collectCharges(stripeClient(key), { until, livemode: /_live_/.test(key) });

  const noEvent = input.filter((c) => !c.session?.meta.hereday_event_id && !c.charge_meta.hereday_event_id);
  const refunded = input.filter((c) => c.amount_refunded > 0);
  console.log(`${input.filter((c) => c.session).length} have a Checkout Session; ` +
    `${refunded.length} refunded; ${noEvent.length} carry no hereday_event_id ` +
    `(the SQL tries events.stripe_payment_id for those)`);

  const { preview, apply } = renderBackfill(input);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'stripe_revenue_input.json'), JSON.stringify(input, null, 2));
  writeFileSync(join(OUT_DIR, 'stripe_revenue_preview.sql'), preview);
  writeFileSync(join(OUT_DIR, 'stripe_revenue_apply.sql'), apply);
  console.log(`wrote stripe_revenue_{input.json,preview.sql,apply.sql} to ${OUT_DIR}`);
}

/**
 * Read every succeeded charge created before `until`, with its Checkout
 * Session and the promotion code typed on Stripe's page, and normalise
 * them. `stripe` is { get, listAll }; the check passes a fake.
 */
export async function collectCharges(stripe, { until, livemode }) {
  const charges = (await stripe.listAll('charges', {
    'created[lt]': Math.floor(+until / 1000),
    'expand[]': 'data.refunds',
  })).filter((c) => c.status === 'succeeded' && c.paid && c.livemode === livemode);
  console.log(`${charges.length} succeeded charges before ${until.toISOString()}`);

  const promoCodes = new Map();
  const promoCode = async (id) => {
    if (!promoCodes.has(id)) promoCodes.set(id, (await stripe.get(`promotion_codes/${id}`)).code);
    return promoCodes.get(id);
  };

  const input = [];
  for (const charge of charges) {
    let session = null;
    let sessionPromo = null;
    if (charge.payment_intent) {
      const { data } = await stripe.get('checkout/sessions', {
        payment_intent: charge.payment_intent,
        'expand[]': 'data.total_details.breakdown',
      });
      session = data[0] ?? null;
      if (data.length > 1) console.warn(`  ${charge.id}: ${data.length} sessions for one payment intent; using ${session.id}`);
      // Mirrors resolvePromoCode in the webhook: only look when there was
      // a discount, and only when /billing didn't already name the code.
      if (session && !session.metadata?.hereday_promo_code && (session.total_details?.amount_discount ?? 0) > 0) {
        const promo = session.total_details?.breakdown?.discounts
          ?.map((d) => d.discount.promotion_code)
          .find((p) => p);
        if (promo) sessionPromo = typeof promo === 'string' ? await promoCode(promo) : promo.code;
      }
    }
    input.push(normaliseCharge(charge, session, sessionPromo));
  }
  return input;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
