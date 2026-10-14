// Service-role Supabase client, shared by every edge function.
//
// Kept apart from billing.ts so functions that never touch Stripe don't
// import the Stripe SDK just to reach the database. billing.ts
// re-exports getServiceClient for its existing importers.
//
// Service role bypasses RLS: only call it after the function has
// established who the caller is (JWT, signed token, Stripe signature).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
