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
// Event handling (handlers.ts; this file is the request, the ledger and
// the dispatch call):
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
//   logRevenueEvent in handlers.ts.

import Stripe from "npm:stripe@17.3.1";
import { getStripe } from "../_shared/billing.ts";
import { getServiceClient } from "../_shared/db.ts";
import { publicCors } from "../_shared/http.ts";
import { dispatchEvent } from "./handlers.ts";

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
    await dispatchEvent(stripe, replayService, event);
  } catch (err) {
    // Claim stays outstanding on purpose. Retries inside STALE_CLAIM_MS
    // get a 409; the first one after it reclaims and runs the handler.
    console.error(`[stripe-webhook] handler failed for ${event.type}`, err);
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
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { ...publicCors, "Content-Type": "application/json" },
  });
});
