// Stripe Checkout session creator — one-time $49 per-event unlock.
//
// Body: { eventId, returnUrl }
//   - eventId: the event being unlocked (must belong to the caller)
//   - returnUrl: where to bounce back after success/cancel
//
// Discounts come only from the caller's profile: the Stripe promotion
// code that apply-promo validated and stored on /billing. Anything else
// a client sends is ignored. (Until 20261013 a `discountCode` in the
// body was forwarded to Stripe as a raw coupon id, which let anyone apply
// an internal coupon and skip apply-promo's promotion-code-only check.)
//
// Stripe re-validates the promotion code when the session is created —
// active, not expired, under its redemption limit, allowed for this
// customer. If it refuses, the stale code is cleared and the session is
// created without it, with the promotion-code box shown, so a dead code
// never blocks a payment.
//
// On success the redirect lands on returnUrl?paid=1&event=<id>. The
// Stripe webhook (separate function) is the source of truth for
// flipping events.paid_at.

import { authenticate, clearActivePromo, corsHeaders, ensureStripeCustomer, getStripe, getServiceClient, json } from "../_shared/billing.ts";

const PRICE_ID = Deno.env.get("STRIPE_PRICE_ID"); // $49 one-time price

const isInvalidRequest = (err: unknown) =>
  (err as { type?: string }).type === "StripeInvalidRequestError";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, req);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  let body: { eventId?: string; returnUrl?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, req);
  }

  if (typeof body.eventId !== "string" || body.eventId.length === 0) {
    return json({ error: "eventId is required" }, 400, req);
  }
  if (typeof body.returnUrl !== "string" || !/^https?:\/\//.test(body.returnUrl)) {
    return json({ error: "returnUrl must be an absolute http(s) url" }, 400, req);
  }

  const service = getServiceClient();
  const { data: event, error: eventErr } = await service
    .from("events")
    .select("id, user_id, name")
    .eq("id", body.eventId)
    .maybeSingle();
  if (eventErr || !event) return json({ error: "Event not found" }, 404, req);
  if (event.user_id !== auth.userId) return json({ error: "Not your event" }, 403, req);

  if (!PRICE_ID) {
    return json({ error: "STRIPE_PRICE_ID not configured" }, 500, req);
  }

  const customerId = await ensureStripeCustomer({
    userId: auth.userId,
    email: auth.email,
    existingCustomerId: auth.profile.stripe_customer_id,
  });

  const stripe = getStripe();

  // A profile that has a coupon id but no promotion code id predates
  // 20261013120000. There's no promotion code to re-check it against,
  // so it's dropped; the customer can re-enter the code on /billing or
  // at checkout.
  let promotionCodeId = auth.profile.active_promotion_code_id ?? null;
  if (!promotionCodeId && auth.profile.active_promo_code) {
    await clearActivePromo(auth.userId);
  }

  // Append status params with & or ? depending on whether returnUrl
  // already has a query string (e.g. /editor?id=<id>).
  const sep = body.returnUrl.includes("?") ? "&" : "?";
  const createSession = (promoId: string | null) =>
    stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${body.returnUrl}${sep}paid=1&event=${encodeURIComponent(event.id)}`,
      cancel_url: `${body.returnUrl}${sep}canceled=1&event=${encodeURIComponent(event.id)}`,
      // Let them type a code at checkout when none is pre-applied.
      // Stripe allows one or the other, not both.
      allow_promotion_codes: !promoId,
      ...(promoId ? { discounts: [{ promotion_code: promoId }] } : {}),
      metadata: {
        hereday_event_id: event.id,
        hereday_user_id: auth.userId,
        ...(promoId && auth.profile.active_promo_code ? { hereday_promo_code: auth.profile.active_promo_code } : {}),
        ...(promoId ? { hereday_promotion_code_id: promoId } : {}),
      },
    });

  let session: Awaited<ReturnType<typeof createSession>>;
  try {
    session = await createSession(promotionCodeId);
  } catch (err) {
    if (!promotionCodeId || !isInvalidRequest(err)) throw err;
    console.warn(`[create-checkout] promotion code ${promotionCodeId} refused by Stripe; clearing it`, (err as Error).message);
    await clearActivePromo(auth.userId);
    promotionCodeId = null;
    session = await createSession(null);
  }

  return json({ url: session.url, sessionId: session.id }, 200, req);
});
