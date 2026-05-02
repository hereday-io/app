// POST /open-billing-portal — creates a Stripe Billing Portal session
// and returns its URL. The Billing page opens it in a new tab for
// card updates.
//
// Body: { returnUrl } — where the portal should bounce the user back to.

import { authenticate, corsHeaders, ensureStripeCustomer, getStripe, json } from "../_shared/billing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  let body: { returnUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — fall back to a safe default below
  }

  const returnUrl = body.returnUrl && /^https?:\/\//.test(body.returnUrl)
    ? body.returnUrl
    : `${Deno.env.get("SUPABASE_URL") ?? ""}/billing`;

  const customerId = await ensureStripeCustomer({
    userId: auth.userId,
    email: auth.email,
    existingCustomerId: auth.profile.stripe_customer_id,
  });

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return json({ url: session.url });
});
