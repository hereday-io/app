// POST /detach-payment-method — detaches the caller's default card.
//
// Leaves the Stripe customer in place (history + receipts still live
// there) but removes the payment source. The Billing page will render
// the "Add payment method" affordance on the next load.

import { authenticate, getStripe } from "../_shared/billing.ts";
import { corsHeaders, handler, json } from "../_shared/http.ts";

Deno.serve(handler("detach-payment-method", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, req);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  if (!auth.profile.stripe_customer_id) {
    return json({ ok: true }, 200, req); // nothing to detach
  }

  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(auth.profile.stripe_customer_id);
  if (customer.deleted) return json({ ok: true }, 200, req);

  const defaultPmId = customer.invoice_settings?.default_payment_method as string | null | undefined;
  if (defaultPmId) {
    await stripe.paymentMethods.detach(defaultPmId);
  }

  return json({ ok: true }, 200, req);
}));
