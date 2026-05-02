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
//   - checkout.session.completed  → mark event paid, stamp charge
//                                   metadata so /billing can display
//                                   event name + applied promo.
//   - charge.refunded             → revoke Pro on the matched event.
//
// Idempotency:
//   Stripe delivers at-least-once. paid_at is set via COALESCE so a
//   replay doesn't bump the timestamp; refund revocation is a simple
//   NULL which is also safely repeatable.

import Stripe from "npm:stripe@17.3.1";
import { getServiceClient, getStripe } from "../_shared/billing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  // ledger before dispatching to the handler.
  const replayService = getServiceClient();
  const { error: replayErr } = await replayService
    .from("stripe_webhook_events")
    .insert({ event_id: event.id, event_type: event.type });
  if (replayErr) {
    // Postgres unique-violation → already processed. Acknowledge and
    // skip. Any other error is surfaced as a 500 so Stripe retries.
    if ((replayErr as { code?: string }).code === "23505") {
      console.log(`[stripe-webhook] replay ${event.id} (${event.type}) skipped`);
      return new Response(JSON.stringify({ received: true, replay: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("[stripe-webhook] replay-ledger insert failed", replayErr);
    return new Response("Ledger error", { status: 500, headers: corsHeaders });
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
    console.error(`[stripe-webhook] handler failed for ${event.type}`, err);
    return new Response("Handler failed", { status: 500, headers: corsHeaders });
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
    .select("id, name, paid_at")
    .eq("id", eventId)
    .maybeSingle();
  if (fetchErr || !eventRow) {
    console.error("[stripe-webhook] event lookup failed", eventId, fetchErr);
    return;
  }

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
      console.error("[stripe-webhook] event update failed", updateErr);
      return;
    }
  }

  // Stamp the Charge with human-readable metadata so the Billing
  // page's Purchase history table can render event name + promo.
  // percent_off is derived from the session totals so list-charges can
  // show "25% off applied" + the strikethrough original price without
  // a second Stripe round-trip.
  if (chargeId) {
    const amountDiscount = session.total_details?.amount_discount ?? 0;
    const amountSubtotal = session.amount_subtotal ?? 0;
    const percentOff = amountDiscount > 0 && amountSubtotal > 0
      ? Math.round((amountDiscount / amountSubtotal) * 100)
      : null;

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
  // started writing metadata.
  const query = eventId
    ? service.from("events").update({ paid_at: null, plan: "free" }).eq("id", eventId)
    : service.from("events").update({ paid_at: null, plan: "free" }).eq("stripe_payment_id", charge.id);

  const { error } = await query;
  if (error) {
    console.error("[stripe-webhook] refund revoke failed", error);
  }
}
