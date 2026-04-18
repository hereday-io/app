// GET /get-payment-method — returns the default PaymentMethod on the
// caller's Stripe customer record. The Billing page renders one card
// max (brand + last4 + exp) since Hereday only stores a single default.

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

  if (!auth.profile.stripe_customer_id) {
    return json({ paymentMethod: null });
  }

  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(auth.profile.stripe_customer_id);
  if (customer.deleted) return json({ paymentMethod: null });

  const defaultPmId = (customer.invoice_settings?.default_payment_method
    ?? customer.default_source) as string | null;
  if (!defaultPmId) return json({ paymentMethod: null });

  const pm = await stripe.paymentMethods.retrieve(defaultPmId);
  if (pm.type !== "card" || !pm.card) return json({ paymentMethod: null });

  return json({
    paymentMethod: {
      id: pm.id,
      brand: pm.card.brand,
      last4: pm.card.last4,
      exp_month: pm.card.exp_month,
      exp_year: pm.card.exp_year,
    },
  });
});
