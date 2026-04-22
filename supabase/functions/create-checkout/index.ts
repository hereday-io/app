// Stripe Checkout session creator — one-time $49 per-event unlock.
//
// Body: { eventId, returnUrl, discountCode? }
//   - eventId: the event being unlocked (must belong to the caller)
//   - returnUrl: where to bounce back after success/cancel
//   - discountCode: optional Stripe Coupon id to apply at checkout;
//     when present, forwarded as discounts: [{ coupon }]. The caller
//     pulls this from profiles.active_promo_code set on /billing.
//
// On success the redirect lands on returnUrl?paid=1&event=<id>. The
// Stripe webhook (separate function) is the source of truth for
// flipping events.paid_at.

import { authenticate, corsHeaders, ensureStripeCustomer, getStripe, getServiceClient, json } from "../_shared/billing.ts";

const PRICE_ID = Deno.env.get("STRIPE_PRICE_ID"); // $49 one-time price

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  let body: { eventId?: string; returnUrl?: string; discountCode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body.eventId !== "string" || body.eventId.length === 0) {
    return json({ error: "eventId is required" }, 400);
  }
  if (typeof body.returnUrl !== "string" || !/^https?:\/\//.test(body.returnUrl)) {
    return json({ error: "returnUrl must be an absolute http(s) url" }, 400);
  }

  const service = getServiceClient();
  const { data: event, error: eventErr } = await service
    .from("events")
    .select("id, user_id, name")
    .eq("id", body.eventId)
    .maybeSingle();
  if (eventErr || !event) return json({ error: "Event not found" }, 404);
  if (event.user_id !== auth.userId) return json({ error: "Not your event" }, 403);

  if (!PRICE_ID) {
    return json({ error: "STRIPE_PRICE_ID not configured" }, 500);
  }

  const customerId = await ensureStripeCustomer({
    userId: auth.userId,
    email: auth.email,
    existingCustomerId: auth.profile.stripe_customer_id,
  });

  const stripe = getStripe();

  // discountCode wins over the stored active_promo_code — the caller
  // is explicit about wanting this session to use it. Fall back to the
  // profile's stored code so subsequent unlocks still auto-apply.
  const couponId = body.discountCode?.trim() || auth.profile.active_promo_code || null;

  // Append status params with & or ? depending on whether returnUrl
  // already has a query string (e.g. /editor?id=<id>).
  const sep = body.returnUrl.includes("?") ? "&" : "?";
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    success_url: `${body.returnUrl}${sep}paid=1&event=${encodeURIComponent(event.id)}`,
    cancel_url: `${body.returnUrl}${sep}canceled=1&event=${encodeURIComponent(event.id)}`,
    allow_promotion_codes: !couponId, // let users enter a code at checkout if none is pre-applied
    ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
    metadata: {
      hereday_event_id: event.id,
      hereday_user_id: auth.userId,
      ...(couponId ? { hereday_promo_code: couponId } : {}),
    },
  });

  return json({ url: session.url, sessionId: session.id });
});
