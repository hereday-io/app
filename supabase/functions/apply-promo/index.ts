// POST /apply-promo — validate a promo code against Stripe and store
// it on the caller's profile so subsequent checkouts auto-apply it.
//
// Body: { code }
// Returns: { valid: true, code, percent_off, expires_at }
//       or { valid: false, error }
//
// Lookup: the code must be a Stripe Promotion Code (the customer-facing
// string like EARLYBIRD25) — stripe.promotionCodes.list({ code }). Raw
// coupon ids are not accepted (H-3, below). Only *active* + *not-expired*
// codes are accepted.
//
// Stores the promotion code's own id (active_promotion_code_id) and the
// code as typed (active_promo_code). First-time-only codes are checked
// against the caller's Stripe payment history before they're saved.
// create-checkout applies the promotion code, so Stripe enforces its
// expiry, redemption limit and customer restrictions again at payment
// time.

import { authenticate, corsHeaders, getServiceClient, getStripe, json } from "../_shared/billing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ valid: false, error: "Invalid JSON body" }, 400);
  }

  const codeInput = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!codeInput) {
    return json({ valid: false, error: "Code is required" }, 400);
  }

  const stripe = getStripe();

  // 1) Try as a promotion code (preferred — that's what customers
  // actually type). Stripe returns the associated coupon nested.
  let couponId: string | null = null;
  let promotionCodeId: string | null = null;
  let percentOff: number | null = null;
  let expiresAt: string | null = null;

  // H-3 fix (2026-05-01): only accept promotion codes that resolve via
  // promotionCodes.list. The previous coupon-ID fallback let a user
  // submit any internal coupon ID (e.g., FRIENDS_FAMILY_100) and have
  // it applied to their checkouts at the discounted rate. Customer-
  // facing codes should ONLY come through the promotion-code surface;
  // operator coupons are not supposed to be discoverable.
  const pcList = await stripe.promotionCodes.list({ code: codeInput, active: true, limit: 1 });
  const pc = pcList.data[0];
  if (pc && pc.coupon && pc.coupon.valid) {
    couponId = pc.coupon.id;
    promotionCodeId = pc.id;
    percentOff = pc.coupon.percent_off ?? null;
    expiresAt = pc.expires_at ? new Date(pc.expires_at * 1000).toISOString() : null;
  }

  if (!couponId || !pc) {
    return json({ valid: false, error: "That code isn't valid or has expired." });
  }

  // First-time-only codes: Stripe only enforces this when checkout opens,
  // and checkout then quietly falls back to full price. Check it here
  // instead, with the same test Stripe uses (has this Stripe customer
  // ever paid successfully, refunds included), so the customer hears
  // "no" on /billing rather than discovering it at $49.
  if (pc.restrictions?.first_time_transaction && auth.profile.stripe_customer_id) {
    const charges = await stripe.charges.list({ customer: auth.profile.stripe_customer_id, limit: 100 });
    if (charges.data.some((c) => c.status === "succeeded")) {
      return json({
        valid: false,
        error: "That code is for your first Pro event, and this account has already paid for one.",
      });
    }
  }

  const service = getServiceClient();
  const { error: updateErr } = await service
    .from("profiles")
    .update({
      // The code as the customer typed it (FIRSTMAP), not the coupon
      // behind it: /billing shows it, and create-checkout copies it into
      // session and charge metadata as hereday_promo_code, which is how a
      // purchase records which code (or which rep's code) it came from.
      // Stripe applies the discount by active_promotion_code_id.
      active_promo_code: pc.code,
      active_promo_percent_off: percentOff,
      active_promo_expires_at: expiresAt,
      active_promotion_code_id: promotionCodeId,
    })
    .eq("user_id", auth.userId);
  if (updateErr) {
    console.error("[apply-promo] persist failed", updateErr);
    return json({ valid: false, error: "Could not save code. Try again." }, 500);
  }

  return json({
    valid: true,
    code: pc.code,
    percent_off: percentOff,
    expires_at: expiresAt,
  });
});
