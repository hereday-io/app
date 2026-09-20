// Admin gate for edge functions. Same privilege model as the SQL side:
// the caller's JWT identifies them, profiles.is_admin authorises them.
//
// Deliberately a service-role read of profiles rather than an RLS read —
// an is_admin lookup must not depend on a policy that a future migration
// could loosen.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json } from "./http.ts";

export async function requireAdmin(req: Request): Promise<
  | { ok: true; userId: string; email: string | null }
  | { ok: false; response: Response }
> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false, response: json({ error: "Missing Authorization header" }, 401, req) };
  }

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, response: json({ error: "Invalid session" }, 401, req) };
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("is_admin")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (profileErr) {
    console.error("[adminAuth] profile lookup failed", profileErr);
    return { ok: false, response: json({ error: "Profile lookup failed" }, 500, req) };
  }
  if (!profile?.is_admin) {
    // Same body for "not an admin" and "no profile row" — no probing.
    return { ok: false, response: json({ error: "Not authorized" }, 403, req) };
  }

  return { ok: true, userId: userData.user.id, email: userData.user.email ?? null };
}
