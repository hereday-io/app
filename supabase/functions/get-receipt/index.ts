// /get-receipt — returns the Stripe-hosted receipt URL for a single
// charge the caller owns. Accepts either:
//   - POST { charge_id }
//   - GET  ?charge_id=ch_xxx
//
// We re-check ownership by matching the Charge's customer against the
// caller's stripe_customer_id. A stray charge_id for another customer
// returns 404 rather than leaking the receipt.

import { authenticate, corsHeaders, getStripe, json } from "../_shared/billing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  let chargeId: string | null = null;
  if (req.method === "GET") {
    chargeId = new URL(req.url).searchParams.get("charge_id");
  } else {
    try {
      const body = await req.json();
      chargeId = typeof body?.charge_id === "string" ? body.charge_id : null;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
  }
  if (!chargeId) return json({ error: "charge_id is required" }, 400);

  if (!auth.profile.stripe_customer_id) {
    return json({ error: "No Stripe customer on file" }, 404);
  }

  const stripe = getStripe();
  const charge = await stripe.charges.retrieve(chargeId);
  if (charge.customer !== auth.profile.stripe_customer_id) {
    return json({ error: "Charge not found" }, 404);
  }

  if (!charge.receipt_url) {
    return json({ error: "Receipt not yet available" }, 404);
  }
  return json({ url: charge.receipt_url });
});
