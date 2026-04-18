// POST /remove-promo — clear the caller's active promo code.
//
// No Stripe round-trip; the promotion/coupon itself is not consumed
// until an actual checkout uses it. This just detaches it from the
// profile so new checkouts stop auto-applying it.

import { authenticate, corsHeaders, getServiceClient, json } from "../_shared/billing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  const service = getServiceClient();
  const { error } = await service
    .from("profiles")
    .update({
      active_promo_code: null,
      active_promo_percent_off: null,
      active_promo_expires_at: null,
    })
    .eq("user_id", auth.userId);
  if (error) {
    console.error("[remove-promo] update failed", error);
    return json({ error: "Could not remove code" }, 500);
  }

  return json({ ok: true });
});
