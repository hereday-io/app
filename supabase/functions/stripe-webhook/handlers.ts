// Stripe webhook event handlers: what each verified event does to the
// database. index.ts owns the request (signature verification, the
// replay ledger, the HTTP status) and hands every claimed event to
// dispatchEvent.
//
// Kept apart from index.ts so it can run under Node as well as Deno:
// no Deno globals, and only type imports from URL / npm: specifiers
// (both are erased at runtime). The Stripe client and the service-role
// Supabase client are passed in, so handlers.test.ts drives these
// functions with fakes and fixture events. If you add a runtime import
// here, the tests stop loading — inject it instead.

import type Stripe from "npm:stripe@17.3.1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** The Stripe calls the handlers make. A real Stripe client satisfies it. */
export interface StripeApi {
  paymentIntents: Pick<Stripe["paymentIntents"], "retrieve">;
  charges: Pick<Stripe["charges"], "update">;
  checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "retrieve"> };
  promotionCodes: Pick<Stripe["promotionCodes"], "retrieve">;
}

/** The service-role Supabase client (getServiceClient()); only from() is used. */
export type ServiceClient = Pick<SupabaseClient, "from">;

/**
 * Run the handler for one verified, claimed event. Throws on a
 * transient failure so index.ts answers 500 and Stripe redelivers;
 * resolves when the delivery should be acknowledged.
 */
export async function dispatchEvent(
  stripe: StripeApi,
  service: ServiceClient,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    // A delayed payment method completes checkout 'unpaid' and settles
    // later; this event carries the same session, now 'paid'. It has its
    // own event id, so the ledger runs it, and the paid_at UPDATE keeps
    // it from logging a second sale if both ever arrive reading 'paid'.
    // falls through
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutCompleted(stripe, service, event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.async_payment_failed":
      handleAsyncPaymentFailed(event.data.object as Stripe.Checkout.Session);
      break;
    case "charge.refunded":
      await handleChargeRefunded(service, event.data.object as Stripe.Charge);
      break;
    default:
      // Stripe retries any 4xx/5xx. Return 200 for events we don't
      // explicitly handle so they don't keep retrying forever.
      console.log(`[stripe-webhook] ignoring ${event.type}`);
  }
}

export async function handleCheckoutCompleted(
  stripe: StripeApi,
  service: ServiceClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const eventId = meta.hereday_event_id;
  if (!eventId) {
    console.warn("[stripe-webhook] checkout.session.completed without hereday_event_id", session.id);
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
    }
  }
}

export function handleAsyncPaymentFailed(session: Stripe.Checkout.Session): void {
  // Nothing to undo. Pro is granted only on 'paid' or
  // 'no_payment_required', and a session whose delayed payment failed
  // read 'unpaid' when it completed, so it never got Pro. Log it so "I
  // paid but my map is still free" has a trail in the function logs.
  const meta = (session.metadata ?? {}) as Record<string, string>;
  console.warn(
    `[stripe-webhook] async payment failed for session ${session.id} (event ${meta.hereday_event_id ?? "unknown"})`,
  );
}

export async function handleChargeRefunded(
  service: ServiceClient,
  charge: Stripe.Charge,
): Promise<void> {
  // Only fully-refunded charges revoke Pro. Partials don't happen in
  // Hereday's $49 flat model but guard anyway.
  const fullyRefunded = charge.refunded && charge.amount_refunded >= charge.amount;
  if (!fullyRefunded) {
    console.log(`[stripe-webhook] partial refund on ${charge.id}, not revoking`);
    return;
  }

  const meta = (charge.metadata ?? {}) as Record<string, string>;
  const eventId = meta.hereday_event_id;

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
  stripe: StripeApi,
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
  service: ServiceClient,
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
