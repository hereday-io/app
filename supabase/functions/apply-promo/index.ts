// POST /apply-promo — validate a promo code against Stripe and store
// it on the caller's profile so subsequent checkouts auto-apply it.
//
// Body: { code }
// Returns: { valid: true, percent_off, expires_at }
//       or { valid: false, error }
//
// Lookup order:
//   1. Try as a Promotion Code (the customer-facing string coupon
//      like EARLYBIRD25) — stripe.promotionCodes.list({ code }).
//   2. If that misses, try as a Coupon id directly.
// Only *active* + *not-expired* codes are accepted.

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
    percentOff = pc.coupon.percent_off ?? null;
    expiresAt = pc.expires_at ? new Date(pc.expires_at * 1000).toISOString() : null;
  }

  if (!couponId) {
    return json({ valid: false, error: "That code isn't valid or has expired." });
  }

  const service = getServiceClient();
  const { error: updateErr } = await service
    .from("profiles")
    .update({
      active_promo_code: couponId,
      active_promo_percent_off: percentOff,
      active_promo_expires_at: expiresAt,
    })
    .eq("user_id", auth.userId);
  if (updateErr) {
    console.error("[apply-promo] persist failed", updateErr);
    return json({ valid: false, error: "Could not save code. Try again." }, 500);
  }

  return json({
    valid: true,
    code: codeInput,
    percent_off: percentOff,
    expires_at: expiresAt,
  });
});
