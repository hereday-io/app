// Stripe webhook — source of truth for flipping events.paid_at.
//
// Stripe dashboard → Developers → Webhooks → Add endpoint
//   URL:    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//   Events: checkout.session.completed,
//           checkout.session.async_payment_succeeded,
//           checkout.session.async_payment_failed,
//           charge.refunded
//   Secret: copy the signing secret into STRIPE_WEBHOOK_SECRET on the
//           Supabase project (Edge Functions → Secrets).
//
// This endpoint does NOT require a Supabase JWT — Stripe sends its
// own signed requests. That gate is flipped in supabase/config.toml
// (`verify_jwt = false`). Signature verification via the stripe SDK
// is what keeps the endpoint from being a public DB mutator.
//
// Event handling:
//   - checkout.session.completed  → mark event paid, log a
//                                   `purchase_completed` product event,
//                                   stamp charge metadata so /billing can
//                                   display event name + applied promo.
//                                   Also covers a 100%-off promotion code
//                                   (no_payment_required: no charge).
//   - checkout.session.async_payment_succeeded
//                                 → same handler, for a delayed payment
//                                   method that settled after checkout.
//   - checkout.session.async_payment_failed
//                                 → log only; nothing was granted.
//   - charge.refunded            → revoke Pro on the matched event and
//                                   log `purchase_refunded`.
//
// Idempotency:
//   Stripe delivers at-least-once. paid_at is set via COALESCE so a
//   replay doesn't bump the timestamp; refund revocation is a simple
//   NULL which is also safely repeatable.
//
//   On top of that, `stripe_webhook_events` is a two-phase ledger: a
//   delivery claims the event id (processed_at) before dispatching and
//   stamps completed_at only once the handler returns. A duplicate is a
//   replay only if completed_at is set — an outstanding claim older than
//   STALE_CLAIM_MS is fair game, so a failed delivery gets retried
//   instead of being mistaken for one that already succeeded.
//
// Failure policy:
//   Transient errors must throw, so the handler 500s, the claim stays
//   open, and Stripe redelivers. Returning early on a DB error would
//   acknowledge work that never happened and Stripe would never retry.
//   Reserve early returns for permanent conditions (event not found,
//   session not yet paid). Revenue logging is the one exception — see
//   logRevenueEvent.

import Stripe from "npm:stripe@17.3.1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getStripe } from "../_shared/billing.ts";
import { getServiceClient } from "../_shared/db.ts";
import { publicCors } from "../_shared/http.ts";
import { reportError } from "../_shared/report.ts";

// How long an unfinished ledger claim is respected before another
// delivery may take it over. Above the edge-function wall clock (150s
// free, 400s paid), so this can never reclaim an event that is still
// being worked. A Stripe retry landing inside the window gets a 409 and
// is deferred to the next retry, not lost, since Stripe redelivers for
// up to 3 days.
const STALE_CLAIM_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: publicCors });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: publicCors });
  }

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    reportError("stripe-webhook", new Error("STRIPE_WEBHOOK_SECRET not configured"), {
      severity: "critical",
      stage: "config",
    });
    return new Response("Server misconfigured", { status: 500, headers: publicCors });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400, headers: publicCors });
  }

  // IMPORTANT: read raw body — signature is computed over the exact
  // bytes Stripe sent, so any re-serialize breaks the HMAC.
  const rawBody = await req.text();

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", err);
    // Usually a stray request, but a wrong or rotated secret fails every
    // real delivery the same way, so it's reported rather than dropped.
    reportError("stripe-webhook", err, { severity: "error", stage: "signature" });
    return new Response("Invalid signature", { status: 400, headers: publicCors });
  }

  // H-1 (2026-05-01): replay guard. The success-path COALESCE keeps
  // checkout.session.completed idempotent, but charge.refunded has no
  // similar guard. A duplicate refund delivery could cause a second
  // refund_at write. Short-circuit duplicates via a processed-events
  // ledger.
  //
  // Two-phase (2026-07-27): claim here, stamp completed_at only after the
  // handler succeeds. The original shape inserted the row and treated any
  // 23505 as "already processed", which made the guard swallow its own
  // retries — a handler failure returned 500, Stripe redelivered, the
  // redelivery collided with the claim row the failed attempt left behind,
  // and got acknowledged as a replay. Every transient failure dropped the
  // event permanently.
  const replayService = getServiceClient();
  const claimedAt = new Date().toISOString();
  const { error: replayErr } = await replayService
    .from("stripe_webhook_events")
    .insert({ event_id: event.id, event_type: event.type, processed_at: claimedAt });
  if (replayErr) {
    if ((replayErr as { code?: string }).code !== "23505") {
      console.error("[stripe-webhook] replay-ledger insert failed", replayErr);
      reportError("stripe-webhook", replayErr, { severity: "critical", stage: "ledger_claim", ...deliveryContext(event) });
      return new Response("Ledger error", { status: 500, headers: publicCors });
    }

    // A row already exists: the event is either genuinely done, or was
    // claimed by a delivery that never finished. Reclaim only an
    // outstanding claim that has gone stale. One conditional UPDATE, so
    // concurrent deliveries can't both win — under READ COMMITTED the
    // loser re-evaluates the predicate after the row lock and matches
    // nothing, because the winner just bumped processed_at.
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const { data: reclaimed, error: reclaimErr } = await replayService
      .from("stripe_webhook_events")
      .update({ processed_at: claimedAt })
      .eq("event_id", event.id)
      .is("completed_at", null)
      .lt("processed_at", staleBefore)
      .select("event_id");
    if (reclaimErr) {
      console.error("[stripe-webhook] replay-ledger reclaim failed", reclaimErr);
      reportError("stripe-webhook", reclaimErr, { severity: "critical", stage: "ledger_reclaim", ...deliveryContext(event) });
      return new Response("Ledger error", { status: 500, headers: publicCors });
    }
    if (!reclaimed?.length) {
      // Either the event is done, or another delivery holds a claim that
      // isn't stale yet. Only the first is a replay. The second must not
      // be acknowledged: that claim may belong to a delivery that already
      // failed, and a 200 here would end Stripe's retries with the work
      // never done. Answer 409 and let Stripe come back later, by which
      // time the claim has either completed or gone stale.
      const { data: existing, error: lookupErr } = await replayService
        .from("stripe_webhook_events")
        .select("completed_at")
        .eq("event_id", event.id)
        .maybeSingle();
      if (lookupErr) {
        console.error("[stripe-webhook] replay-ledger lookup failed", lookupErr);
        reportError("stripe-webhook", lookupErr, { severity: "critical", stage: "ledger_lookup", ...deliveryContext(event) });
        return new Response("Ledger error", { status: 500, headers: publicCors });
      }
      if (!existing?.completed_at) {
        console.log(`[stripe-webhook] ${event.id} (${event.type}) claimed by another delivery; deferring`);
        return new Response("Claim in progress", { status: 409, headers: publicCors });
      }
      console.log(`[stripe-webhook] replay ${event.id} (${event.type}) skipped`);
      return new Response(JSON.stringify({ received: true, replay: true }), {
        status: 200,
        headers: { ...publicCors, "Content-Type": "application/json" },
      });
    }
    console.log(`[stripe-webhook] reclaimed stale claim on ${event.id} (${event.type})`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      // A delayed payment method completes checkout 'unpaid' and settles
      // later; this event carries the same session, now 'paid'. It has its
      // own event id, so the ledger runs it, and the paid_at UPDATE keeps
      // it from logging a second sale if both ever arrive reading 'paid'.
      // falls through
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.async_payment_failed":
        handleAsyncPaymentFailed(event.data.object as Stripe.Checkout.Session);
        break;
      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      default:
        // Stripe retries any 4xx/5xx. Return 200 for events we don't
        // explicitly handle so they don't keep retrying forever.
        console.log(`[stripe-webhook] ignoring ${event.type}`);
    }
  } catch (err) {
    // Claim stays outstanding on purpose. Retries inside STALE_CLAIM_MS
    // get a 409; the first one after it reclaims and runs the handler.
    console.error(`[stripe-webhook] handler failed for ${event.type}`, err);
    reportError("stripe-webhook", err, { severity: "critical", stage: "handler", ...deliveryContext(event) });
    return new Response("Handler failed", { status: 500, headers: publicCors });
  }

  // Close the claim. Only now does this event read as a replay to any
  // future delivery.
  const { error: completeErr } = await replayService
    .from("stripe_webhook_events")
    .update({ completed_at: new Date().toISOString() })
    .eq("event_id", event.id);
  if (completeErr) {
    // The work is already done; failing to stamp only means a later
    // redelivery could re-run the handler. Both handlers are idempotent,
    // revenue rows included (each is logged only when its UPDATE actually
    // changed paid_at), so acknowledge anyway — a 500 here would make
    // Stripe retry work we have completed.
    console.error("[stripe-webhook] ledger completion stamp failed", completeErr);
    reportError("stripe-webhook", completeErr, { severity: "warning", stage: "ledger_complete", ...deliveryContext(event) });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { ...publicCors, "Content-Type": "application/json" },
  });
});

async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const eventId = meta.hereday_event_id;
  if (!eventId) {
    console.warn("[stripe-webhook] checkout.session.completed without hereday_event_id", session.id);
    // Acknowledged, so Stripe won't retry: if this session was paid, the
    // money arrived with no event to unlock and only this report says so.
    reportError("stripe-webhook", new Error("checkout session without hereday_event_id"), {
      severity: "critical",
      stage: "missing_event_id",
      stripe_session_id: session.id,
      payment_status: session.payment_status,
      userId: meta.hereday_user_id ?? null,
    });
    return;
  }

  // 'paid' is the usual case. 'no_payment_required' is a promotion code
  // that took the total to zero: the customer finished checkout and gets
  // Pro, but Stripe creates no PaymentIntent and no charge. 'unpaid' is a
  // delayed method (bank debit, voucher) that hasn't settled; Pro waits
  // for checkout.session.async_payment_succeeded, which re-enters here
  // reading 'paid'. Returning acknowledges this delivery, which is right:
  // nothing is owed until that later event arrives.
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    console.log(`[stripe-webhook] session ${session.id} not paid yet (${session.payment_status}); waiting for async_payment_succeeded`);
    return;
  }

  // Null for a no_payment_required session, so chargeId stays null and
  // stripe_payment_id is written NULL: there is no charge to point at,
  // refund or stamp. stripe_session_id still records the purchase.
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  // Fetch the payment intent to get the actual charge id. Charges are
  // what carry the receipt URL and what list-charges reads from.
  let chargeId: string | null = null;
  if (paymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    chargeId = (pi.latest_charge as string | null) ?? null;
  }

  const service = getServiceClient();

  // Flip paid_at idempotently: the UPDATE below only matches while
  // paid_at is still NULL, so a replay keeps the original timestamp.
  const { data: eventRow, error: fetchErr } = await service
    .from("events")
    .select("id, name, paid_at, user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (fetchErr) {
    // Transient. Throw so this becomes a retriable 500 and the ledger
    // claim stays open — returning here would acknowledge a payment we
    // never recorded, and Stripe would never redeliver it.
    throw new Error(`event lookup failed for ${eventId}: ${fetchErr.message}`);
  }
  if (!eventRow) {
    // Permanent: the event is gone. Retrying for three days won't bring
    // it back, so let the delivery complete.
    console.error("[stripe-webhook] event not found", eventId);
    // Paid with nothing to unlock, and acknowledged: a refund or a manual
    // grant is the only fix, so this must reach a person.
    reportError("stripe-webhook", new Error("paid checkout for an event that no longer exists"), {
      severity: "critical",
      stage: "event_not_found",
      hereday_event_id: eventId,
      stripe_session_id: session.id,
      userId: meta.hereday_user_id ?? null,
    });
    return;
  }

  // Discount math is shared by the product event and the charge stamp
  // below, so derive it once. percent_off comes from the session totals
  // rather than the coupon so it reflects what was actually applied.
  const amountDiscount = session.total_details?.amount_discount ?? 0;
  const amountSubtotal = session.amount_subtotal ?? 0;
  const percentOff = amountDiscount > 0 && amountSubtotal > 0
    ? Math.round((amountDiscount / amountSubtotal) * 100)
    : null;
  const promoCode = await resolvePromoCode(stripe, session, meta, amountDiscount);

  if (!eventRow.paid_at) {
    const { data: flipped, error: updateErr } = await service
      .from("events")
      .update({
        paid_at: new Date().toISOString(),
        plan: "pro",
        stripe_session_id: session.id,
        stripe_payment_id: chargeId,
      })
      .eq("id", eventId)
      .is("paid_at", null) // extra belt-and-suspenders against replay
      .select("id");
    if (updateErr) {
      // Also catches exceptions raised by the enforce_pro_gates trigger,
      // which fires BEFORE UPDATE on events. Throw rather than return: a
      // silent 200 here is the worst outcome, since the payment is lost
      // *and* Stripe shows the delivery as successful.
      throw new Error(`event update failed for ${eventId}: ${updateErr.message}`);
    }

    // Only when this UPDATE is the one that flipped paid_at. The read
    // above can be stale: two deliveries working the same event at once
    // (a slow one and the retry that reclaimed its claim) can both see
    // paid_at NULL, but only one UPDATE matches a row, so only one
    // conversion row is written.
    if (flipped?.length) await logRevenueEvent(service, {
      eventType: "purchase_completed",
      // create-checkout stamps the buyer into session metadata and
      // rejects anyone who isn't the event owner, so these agree; the
      // fallback just covers sessions created before that stamp existed.
      userId: meta.hereday_user_id ?? eventRow.user_id ?? null,
      eventId,
      properties: {
        // 0 for a 100%-off code: a conversion with no revenue.
        amount_total: session.amount_total,
        amount_subtotal: amountSubtotal || null,
        amount_discount: amountDiscount || null,
        currency: session.currency,
        percent_off: percentOff,
        promo_code: promoCode,
        stripe_session_id: session.id,
        stripe_charge_id: chargeId,
      },
    });
  }

  // Stamp the Charge with human-readable metadata so the Billing
  // page's Purchase history table can render event name + promo.
  // percent_off (derived above) lets list-charges show "25% off applied"
  // + the strikethrough original price without a second Stripe
  // round-trip.
  if (chargeId) {
    try {
      await stripe.charges.update(chargeId, {
        metadata: {
          hereday_event_id: eventId,
          hereday_event_name: `${eventRow.name} — Pro unlock`,
          ...(meta.hereday_user_id ? { hereday_user_id: meta.hereday_user_id } : {}),
          ...(promoCode ? { hereday_promo_code: promoCode } : {}),
          ...(percentOff !== null ? { hereday_promo_percent_off: String(percentOff) } : {}),
        },
      });
    } catch (err) {
      // Non-fatal — the charge still exists, we just won't have a
      // pretty event name in the receipts list until backfilled.
      console.error("[stripe-webhook] charge metadata stamp failed", err);
      reportError("stripe-webhook", err, {
        severity: "warning",
        stage: "charge_metadata",
        hereday_event_id: eventId,
        stripe_charge_id: chargeId,
        userId: meta.hereday_user_id ?? null,
      });
    }
  }
}

function handleAsyncPaymentFailed(session: Stripe.Checkout.Session): void {
  // Nothing to undo. Pro is granted only on 'paid' or
  // 'no_payment_required', and a session whose delayed payment failed
  // read 'unpaid' when it completed, so it never got Pro. Log it so "I
  // paid but my map is still free" has a trail in the function logs.
  const meta = (session.metadata ?? {}) as Record<string, string>;
  console.warn(
    `[stripe-webhook] async payment failed for session ${session.id} (event ${meta.hereday_event_id ?? "unknown"})`,
  );
  // Not our error, but a customer who thinks they paid is about to ask.
  reportError("stripe-webhook", new Error("async payment failed"), {
    severity: "warning",
    stage: "async_payment_failed",
    hereday_event_id: meta.hereday_event_id ?? null,
    stripe_session_id: session.id,
    userId: meta.hereday_user_id ?? null,
  });
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  // Only fully-refunded charges revoke Pro. Partials don't happen in
  // Hereday's $49 flat model but guard anyway.
  const fullyRefunded = charge.refunded && charge.amount_refunded >= charge.amount;
  if (!fullyRefunded) {
    console.log(`[stripe-webhook] partial refund on ${charge.id}, not revoking`);
    return;
  }

  const meta = (charge.metadata ?? {}) as Record<string, string>;
  const eventId = meta.hereday_event_id;

  const service = getServiceClient();

  // Prefer the event id from charge metadata; fall back to the
  // stripe_payment_id column if the charge was stamped before we
  // started writing metadata. select() returns the revoked rows so we
  // can log the refund without a second lookup. Matching only rows that
  // are still paid keeps that log idempotent: a re-run (completion stamp
  // failed, or a reclaim racing a slow delivery) revokes nothing and so
  // logs nothing, where a bare NULL write would return the row again.
  const update = service.from("events")
    .update({ paid_at: null, plan: "free" })
    .not("paid_at", "is", null);
  const query = eventId
    ? update.eq("id", eventId).select("id, user_id")
    : update.eq("stripe_payment_id", charge.id).select("id, user_id");

  const { data: revoked, error } = await query;
  if (error) {
    // Same reasoning as the paid_at write: a swallowed error here means
    // a refunded customer silently keeps Pro, with Stripe reporting the
    // delivery as fine. Throw so the retry can fix it.
    throw new Error(`refund revoke failed for charge ${charge.id}: ${error.message}`);
  }

  if (!revoked?.length) {
    console.log(`[stripe-webhook] refund on ${charge.id}: no paid event to revoke`);
  }

  // Negative counterpart to purchase_completed, so revenue-by-source
  // nets out instead of overstating. Amounts stay positive — the
  // subtraction belongs in the query, not the data. amount_total is the
  // refunded charge's total, the key crm_get_deal passes to the deal
  // timeline; sum amount_refunded, not amount_total, when netting.
  for (const row of revoked ?? []) {
    await logRevenueEvent(service, {
      eventType: "purchase_refunded",
      userId: meta.hereday_user_id ?? row.user_id ?? null,
      eventId: row.id,
      properties: {
        amount_total: charge.amount,
        amount_refunded: charge.amount_refunded,
        currency: charge.currency,
        stripe_charge_id: charge.id,
        promo_code: meta.hereday_promo_code ?? null,
      },
    });
  }
}

/**
 * The customer-facing promotion code (e.g. FIRSTMAP) behind this
 * session's discount, or null.
 *
 * Codes applied on /billing arrive in metadata as hereday_promo_code.
 * When none was pre-applied, create-checkout sets allow_promotion_codes
 * and the customer may type one on Stripe's page instead; metadata
 * doesn't know about that, so ask Stripe which promotion code the
 * discount came from. Best-effort: this only labels the sale, so a
 * Stripe error returns null rather than failing the payment.
 */
async function resolvePromoCode(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  amountDiscount: number,
): Promise<string | null> {
  if (meta.hereday_promo_code) return meta.hereday_promo_code;
  if (amountDiscount <= 0) return null;
  try {
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["total_details.breakdown"],
    });
    const promo = full.total_details?.breakdown?.discounts
      .map((d) => d.discount.promotion_code)
      .find((p) => p !== null && p !== undefined);
    if (!promo) return null;
    if (typeof promo !== "string") return promo.code;
    return (await stripe.promotionCodes.retrieve(promo)).code;
  } catch (err) {
    console.warn("[stripe-webhook] promotion code lookup failed", session.id, err);
    return null;
  }
}

/**
 * Write a revenue event into `product_events`, with the buyer's
 * first-touch attribution denormalised onto the row.
 *
 * Attribution is captured in the browser and claimed onto `profiles` at
 * signup (src/lib/attribution.ts); the webhook has no browser context,
 * so we read it back from the profile rather than trying to plumb UTMs
 * through Stripe. Copying the values onto the row — instead of leaving
 * it to a join — keeps revenue-by-source a single-table query and
 * freezes attribution as it stood at purchase time.
 *
 * Best-effort by design: this must never throw. A failure here would
 * otherwise 500 the webhook and make Stripe retry a payment we have
 * already recorded.
 */
async function logRevenueEvent(
  service: SupabaseClient,
  args: {
    eventType: "purchase_completed" | "purchase_refunded";
    userId: string | null;
    eventId: string;
    properties: Record<string, unknown>;
  },
): Promise<void> {
  try {
    let attribution: Record<string, unknown> = {};
    if (args.userId) {
      const { data: profile, error } = await service
        .from("profiles")
        .select(
          "first_referrer, first_landing_page, utm_source, utm_medium, utm_campaign, utm_term, utm_content",
        )
        .eq("user_id", args.userId)
        .maybeSingle();
      if (error) {
        // Log the conversion anyway — an unattributed sale still beats
        // a missing one.
        console.warn("[stripe-webhook] attribution lookup failed", error.message);
      } else if (profile) {
        attribution = profile;
      }
    }

    // Drop nulls so rows stay compact, matching attributionProperties()
    // on the client: an absent key means "never captured".
    const properties = Object.fromEntries(
      Object.entries({ ...args.properties, ...attribution })
        .filter(([, value]) => value !== null && value !== undefined),
    );

    const { error } = await service.from("product_events").insert({
      event_type: args.eventType,
      user_id: args.userId,
      event_id: args.eventId,
      properties,
    });
    if (error) {
      console.error(`[stripe-webhook] ${args.eventType} log failed`, error);
      reportRevenueLogFailure(error, args);
    }
  } catch (err) {
    console.error(`[stripe-webhook] ${args.eventType} log threw`, err);
    reportRevenueLogFailure(err, args);
  }
}

// Pro was granted or revoked; only the revenue row is missing, which
// under-counts sales in product_events until someone backfills it.
function reportRevenueLogFailure(
  err: unknown,
  args: { eventType: string; userId: string | null; eventId: string },
): void {
  reportError("stripe-webhook", err, {
    severity: "warning",
    stage: "revenue_log",
    revenue_event_type: args.eventType,
    hereday_event_id: args.eventId,
    userId: args.userId,
  });
}

/**
 * What a delivery was about, for error reports. Read-only: checkout
 * sessions and charges both carry the hereday_* metadata create-checkout
 * and the charge stamp write.
 */
function deliveryContext(event: Stripe.Event) {
  const object = event.data.object as { id?: string; metadata?: Record<string, string> | null };
  const meta = object.metadata ?? {};
  return {
    stripe_event_id: event.id,
    stripe_event_type: event.type,
    stripe_object_id: object.id ?? null,
    hereday_event_id: meta.hereday_event_id ?? null,
    userId: meta.hereday_user_id ?? null,
  };
}
