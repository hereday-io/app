// Stripe webhook — source of truth for flipping events.paid_at.
//
// Stripe dashboard → Developers → Webhooks → Add endpoint
//   URL:    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//   Events: checkout.session.completed, charge.refunded
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
//   - charge.refunded             → revoke Pro on the matched event and
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
import { getServiceClient, getStripe } from "../_shared/billing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// How long an unfinished ledger claim is respected before another
// delivery may take it over. Comfortably above the edge-function wall
// clock, so this can never reclaim an event that is still being worked;
// a Stripe retry landing inside the window is deferred to the next
// retry, not lost, since Stripe redelivers for up to 3 days.
const STALE_CLAIM_MS = 5 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400, headers: corsHeaders });
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
    return new Response("Invalid signature", { status: 400, headers: corsHeaders });
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
      return new Response("Ledger error", { status: 500, headers: corsHeaders });
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
      return new Response("Ledger error", { status: 500, headers: corsHeaders });
    }
    if (!reclaimed?.length) {
      // Completed already, or claimed by a delivery still in flight.
      // Nothing to do either way: if that in-flight one fails, its claim
      // goes stale and Stripe's next retry reclaims it.
      console.log(`[stripe-webhook] replay ${event.id} (${event.type}) skipped`);
      return new Response(JSON.stringify({ received: true, replay: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[stripe-webhook] reclaimed stale claim on ${event.id} (${event.type})`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
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
    // Claim stays outstanding on purpose — after STALE_CLAIM_MS a Stripe
    // retry reclaims it and runs the handler again.
    console.error(`[stripe-webhook] handler failed for ${event.type}`, err);
    return new Response("Handler failed", { status: 500, headers: corsHeaders });
  }

  // Close the claim. Only now does this event read as a replay to any
  // future delivery.
  const { error: completeErr } = await replayService
    .from("stripe_webhook_events")
    .update({ completed_at: new Date().toISOString() })
    .eq("event_id", event.id);
  if (completeErr) {
    // The work is already done; failing to stamp only means a later
    // redelivery could re-run the handler. Both handlers are idempotent
    // (paid_at is additionally guarded by .is("paid_at", null), refund
    // revocation is a plain NULL write), so acknowledge anyway — a 500
    // here would make Stripe retry work we have completed.
    console.error("[stripe-webhook] ledger completion stamp failed", completeErr);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    return;
  }

  if (session.payment_status !== "paid") {
    // Stripe sometimes fires this before the payment actually settles
    // (e.g. async payment methods). Skip — charge.updated will follow.
    console.log(`[stripe-webhook] session ${session.id} not paid yet (${session.payment_status})`);
    return;
  }

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

  // Flip paid_at idempotently. COALESCE keeps the original timestamp
  // if a replay arrives after the event was already marked paid.
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

  if (!eventRow.paid_at) {
    const { error: updateErr } = await service
      .from("events")
      .update({
        paid_at: new Date().toISOString(),
        plan: "pro",
        stripe_session_id: session.id,
        stripe_payment_id: chargeId,
      })
      .eq("id", eventId)
      .is("paid_at", null); // extra belt-and-suspenders against replay
    if (updateErr) {
      // Also catches exceptions raised by the enforce_pro_gates trigger,
      // which fires BEFORE UPDATE on events. Throw rather than return: a
      // silent 200 here is the worst outcome, since the payment is lost
      // *and* Stripe shows the delivery as successful.
      throw new Error(`event update failed for ${eventId}: ${updateErr.message}`);
    }

    // Inside the !paid_at branch on purpose: the replay ledger already
    // stops duplicate deliveries of the same Stripe event, and this
    // additionally stops a *different* event id landing a second
    // conversion row on an event that was already paid.
    await logRevenueEvent(service, {
      eventType: "purchase_completed",
      // create-checkout stamps the buyer into session metadata and
      // rejects anyone who isn't the event owner, so these agree; the
      // fallback just covers sessions created before that stamp existed.
      userId: meta.hereday_user_id ?? eventRow.user_id ?? null,
      eventId,
      properties: {
        amount_total: session.amount_total,
        amount_subtotal: amountSubtotal || null,
        amount_discount: amountDiscount || null,
        currency: session.currency,
        percent_off: percentOff,
        promo_code: meta.hereday_promo_code ?? null,
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
          ...(meta.hereday_promo_code ? { hereday_promo_code: meta.hereday_promo_code } : {}),
          ...(percentOff !== null ? { hereday_promo_percent_off: String(percentOff) } : {}),
        },
      });
    } catch (err) {
      // Non-fatal — the charge still exists, we just won't have a
      // pretty event name in the receipts list until backfilled.
      console.error("[stripe-webhook] charge metadata stamp failed", err);
    }
  }
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
  // can log the refund without a second lookup.
  const update = service.from("events").update({ paid_at: null, plan: "free" });
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

  // Negative counterpart to purchase_completed, so revenue-by-source
  // nets out instead of overstating. Amount stays positive — the
  // subtraction belongs in the query, not the data.
  for (const row of revoked ?? []) {
    await logRevenueEvent(service, {
      eventType: "purchase_refunded",
      userId: meta.hereday_user_id ?? row.user_id ?? null,
      eventId: row.id,
      properties: {
        amount_refunded: charge.amount_refunded,
        currency: charge.currency,
        stripe_charge_id: charge.id,
        promo_code: meta.hereday_promo_code ?? null,
      },
    });
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
    if (error) console.error(`[stripe-webhook] ${args.eventType} log failed`, error);
  } catch (err) {
    console.error(`[stripe-webhook] ${args.eventType} log threw`, err);
  }
}
