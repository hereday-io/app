// Tracking session ping endpoint.
//
// Anon-accessible. Takes { sessionId, sessionSecret, lng, lat, isActive? }
// and updates the row in tracking_sessions. The secret is validated
// server-side against the value stored on the row at session-create time.
// Uses the service-role client to write — anon callers no longer have
// direct UPDATE rights on tracking_sessions (see migration
// 20260501120000_security_hardening_pre_launch.sql, item C-3).
//
// Why an edge function instead of an RLS-only fix:
//   The session UUID is exposed to spectators via the SELECT policy on
//   tracking_sessions, so any "secret = id" or "secret in row, check via
//   header" approach leaks the secret too. Routing writes through this
//   function lets us keep the secret column out of anon SELECT entirely
//   (column-level GRANT) while still validating ownership of writes.
//
// Deployed at:
//   https://<project-ref>.supabase.co/functions/v1/update-tracking-ping

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOWED_ORIGINS = [
  "https://hereday.io",
  "https://www.hereday.io",
  "http://localhost:8080",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/.*\.vercel\.app$/.test(origin))
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

interface PingBody {
  sessionId?: string;
  sessionSecret?: string;
  lng?: number;
  lat?: number;
  isActive?: boolean;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, origin);
  }

  let body: PingBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const { sessionId, sessionSecret, lng, lat, isActive } = body;

  if (!sessionId || typeof sessionId !== "string") {
    return json({ error: "sessionId required" }, 400, origin);
  }
  if (!sessionSecret || typeof sessionSecret !== "string") {
    return json({ error: "sessionSecret required" }, 400, origin);
  }
  // lng/lat optional (e.g., a stop ping with isActive=false may have no
  // fresh position). When provided they must be finite numbers in range.
  if (lng !== undefined) {
    if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return json({ error: "lng must be a number in [-180, 180]" }, 400, origin);
    }
  }
  if (lat !== undefined) {
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return json({ error: "lat must be a number in [-90, 90]" }, 400, origin);
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Validate the secret against the row. Using maybeSingle so a bogus
  // sessionId returns 404 rather than throwing.
  const { data: row, error: lookupErr } = await supabase
    .from("tracking_sessions")
    .select("id, session_secret")
    .eq("id", sessionId)
    .maybeSingle();

  if (lookupErr) {
    console.error("[update-tracking-ping] lookup failed", lookupErr);
    return json({ error: "Server error" }, 500, origin);
  }
  if (!row) {
    return json({ error: "Session not found" }, 404, origin);
  }
  if (row.session_secret !== sessionSecret) {
    return json({ error: "Invalid session secret" }, 401, origin);
  }

  // Build the update payload. Only update fields that were provided.
  const update: Record<string, unknown> = {
    last_ping_at: new Date().toISOString(),
  };
  if (lng !== undefined) update.last_lng = lng;
  if (lat !== undefined) update.last_lat = lat;
  if (typeof isActive === "boolean") update.is_active = isActive;

  const { error: updateErr } = await supabase
    .from("tracking_sessions")
    .update(update)
    .eq("id", sessionId);

  if (updateErr) {
    console.error("[update-tracking-ping] update failed", updateErr);
    return json({ error: "Update failed" }, 500, origin);
  }

  return json({ ok: true }, 200, origin);
});
