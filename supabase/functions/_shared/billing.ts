// Shared billing helpers. Every function under supabase/functions/*
// that talks to Stripe goes through these — the auth dance, the
// Stripe client, and the CORS headers are identical across them.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "npm:stripe@17.3.1";

// Allowlist of origins that may invoke billing endpoints. Anything else
// gets the canonical production origin in the ACAO header — browsers will
// reject the response, blocking third-party sites from issuing XHR with
// stolen tokens. Vercel preview deployments are matched by suffix.
const ALLOWED_ORIGINS = [
  "https://hereday.io",
  "https://www.hereday.io",
  "http://localhost:8080",
  "http://localhost:5173",
];

function pickAllowedOrigin(origin: string | null): string {
  if (!origin) return ALLOWED_ORIGINS[0];
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

export function corsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get("origin") ?? null;
  return {
    "Access-Control-Allow-Origin": pickAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function getStripe(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

/** Verify the caller's JWT and return the authed user + profile row. */
export async function authenticate(req: Request): Promise<
  | { ok: true; userId: string; email: string | null; profile: ProfileRow }
  | { ok: false; response: Response }
> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false, response: json({ error: "Missing Authorization header" }, 401) };
  }
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, response: json({ error: "Invalid session" }, 401) };
  }
  const service = getServiceClient();
  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("user_id, stripe_customer_id, active_promo_code, active_promo_expires_at, active_promo_percent_off")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (profileErr) {
    console.error("[billing] profile lookup failed", profileErr);
    return { ok: false, response: json({ error: "Profile lookup failed" }, 500) };
  }
  return {
    ok: true,
    userId: userData.user.id,
    email: userData.user.email ?? null,
    profile: (profile ?? { user_id: userData.user.id, stripe_customer_id: null }) as ProfileRow,
  };
}

/**
 * Ensure a Stripe customer exists for the authed user. Self-heals if the
 * stored customer ID is stale — e.g. after a test↔live mode swap, after
 * a manual deletion in the Stripe Dashboard, or any other drift between
 * the profiles row and Stripe's records. In that case we silently create
 * a new customer in the current mode and persist it over the old ID.
 */
export async function ensureStripeCustomer(params: {
  userId: string;
  email: string | null;
  existingCustomerId: string | null;
}): Promise<string> {
  const stripe = getStripe();

  if (params.existingCustomerId) {
    try {
      // retrieve() throws with code "resource_missing" if the customer
      // doesn't exist in the current mode. Stripe also marks deleted
      // customers with a `deleted: true` flag rather than 404'ing, so
      // handle both cases.
      const existing = await stripe.customers.retrieve(params.existingCustomerId);
      if (!(existing as { deleted?: boolean }).deleted) {
        return params.existingCustomerId;
      }
    } catch (err) {
      const code = (err as { code?: string; statusCode?: number }).code;
      const status = (err as { code?: string; statusCode?: number }).statusCode;
      if (code !== "resource_missing" && status !== 404) {
        // Unexpected error — surface it rather than silently creating
        // a duplicate customer.
        throw err;
      }
      console.warn(
        `[billing] stored stripe_customer_id ${params.existingCustomerId} not found in current mode — creating a fresh one`,
      );
    }
  }

  const customer = await stripe.customers.create({
    email: params.email ?? undefined,
    metadata: { hereday_user_id: params.userId },
  });
  const service = getServiceClient();
  const { error } = await service
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("user_id", params.userId);
  if (error) console.error("[billing] failed to persist stripe_customer_id", error);
  return customer.id;
}

export interface ProfileRow {
  user_id: string;
  stripe_customer_id: string | null;
  active_promo_code?: string | null;
  active_promo_expires_at?: string | null;
  active_promo_percent_off?: number | null;
}
