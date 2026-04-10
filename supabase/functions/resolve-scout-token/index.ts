// Mobile POI Scout — token resolution endpoint.
//
// Anon-accessible. Takes { token } and returns sanitized event data so
// the mobile scout page can render routes + existing POIs as context
// without exposing the full events row (owner identity, billing state,
// plan, etc.).
//
// This works on DRAFT events by design — walking the course before
// publishing is the primary use case. That's why we can't just read
// through the `public_events` view; it only exposes published events.
// Service role is used to bypass RLS after token validation has proven
// authority.
//
// Deployed at:
//   https://<project-ref>.supabase.co/functions/v1/resolve-scout-token

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface TokenRow {
  token: string;
  event_id: string;
  purpose: string;
  revoked_at: string | null;
}

interface EventRow {
  id: string;
  name: string;
  city: string | null;
  routes: unknown;
  pois: unknown;
  status: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Server misconfigured" }, 500);
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const token = body?.token;
  if (typeof token !== "string" || token.length < 16 || token.length > 64) {
    return json({ error: "Invalid token" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1. Validate token
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("poi_volunteer_tokens")
    .select("token, event_id, purpose, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenErr) {
    console.error("[resolve-scout-token] token lookup failed", tokenErr);
    return json({ error: "Token lookup failed" }, 500);
  }

  const row = tokenRow as TokenRow | null;
  if (!row) return json({ error: "Invalid or expired link" }, 404);
  if (row.revoked_at) return json({ error: "This scout link has been revoked" }, 403);
  if (row.purpose !== "scout") return json({ error: "Token is not a scout token" }, 403);

  // 2. Load the event (service role — bypasses RLS because token is the auth)
  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, name, city, routes, pois, status")
    .eq("id", row.event_id)
    .maybeSingle();

  if (eventErr || !eventRow) {
    console.error("[resolve-scout-token] event lookup failed", eventErr);
    return json({ error: "Event not found" }, 404);
  }

  const event = eventRow as EventRow;

  return json({
    eventId: event.id,
    name: event.name,
    city: event.city,
    routes: Array.isArray(event.routes) ? event.routes : [],
    pois: Array.isArray(event.pois) ? event.pois : [],
    status: event.status,
  });
});
