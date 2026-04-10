// Mobile POI Scout — submission endpoint.
//
// Anon-accessible. Takes { token, poi } and appends the POI to
// events.scouted_pois after validating the token + payload. Uses the
// service-role client since the anon user doesn't own the event.
//
// Rate limit: Phase 1 caps submissions at 50 POIs per token per hour
// (counted from the scouted_at timestamps already in the array — no
// separate rate limit table). Good enough until Phase 2.
//
// Deployed at:
//   https://<project-ref>.supabase.co/functions/v1/submit-scouted-poi

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Must stay in sync with src/lib/pois.ts POI_TYPES.
const VALID_POI_TYPES = new Set([
  "start",
  "finish",
  "aid-station",
  "water",
  "medical",
  "sponsor",
  "registration",
  "parking",
  "restroom",
  "custom",
]);

const MAX_TITLE_LEN = 100;
const MAX_DESCRIPTION_LEN = 500;
const RATE_LIMIT_PER_HOUR = 50;

interface TokenRow {
  token: string;
  event_id: string;
  purpose: string;
  revoked_at: string | null;
}

interface EventRow {
  id: string;
  scouted_pois: unknown;
}

interface IncomingPoi {
  type: string;
  title: string;
  description?: string;
  coordinates: [number, number];
}

interface ScoutedPoi {
  id: string;
  type: string;
  title: string;
  description: string;
  coordinates: [number, number];
  scouted_at: string;
  scouted_via_token: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validatePoi(raw: unknown): { ok: true; poi: IncomingPoi } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Missing poi object" };
  const p = raw as Record<string, unknown>;

  if (typeof p.type !== "string" || !VALID_POI_TYPES.has(p.type)) {
    return { ok: false, error: "Invalid poi type" };
  }
  if (typeof p.title !== "string" || p.title.trim().length === 0) {
    return { ok: false, error: "Title is required" };
  }
  if (p.title.length > MAX_TITLE_LEN) {
    return { ok: false, error: `Title too long (max ${MAX_TITLE_LEN})` };
  }
  if (p.description !== undefined && p.description !== null) {
    if (typeof p.description !== "string") {
      return { ok: false, error: "Description must be a string" };
    }
    if (p.description.length > MAX_DESCRIPTION_LEN) {
      return { ok: false, error: `Description too long (max ${MAX_DESCRIPTION_LEN})` };
    }
  }
  if (!Array.isArray(p.coordinates) || p.coordinates.length !== 2) {
    return { ok: false, error: "Coordinates must be [lng, lat]" };
  }
  const [lng, lat] = p.coordinates as unknown[];
  if (typeof lng !== "number" || typeof lat !== "number") {
    return { ok: false, error: "Coordinates must be numbers" };
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return { ok: false, error: "Coordinates out of range" };
  }

  return {
    ok: true,
    poi: {
      type: p.type,
      title: p.title.trim(),
      description: typeof p.description === "string" ? p.description.trim() : "",
      coordinates: [lng, lat],
    },
  };
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

  let body: { token?: string; poi?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const token = body?.token;
  if (typeof token !== "string" || token.length < 16 || token.length > 64) {
    return json({ error: "Invalid token" }, 400);
  }

  const validation = validatePoi(body?.poi);
  if (!validation.ok) return json({ error: validation.error }, 400);

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1. Validate token
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("poi_volunteer_tokens")
    .select("token, event_id, purpose, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenErr) {
    console.error("[submit-scouted-poi] token lookup failed", tokenErr);
    return json({ error: "Token lookup failed" }, 500);
  }

  const row = tokenRow as TokenRow | null;
  if (!row) return json({ error: "Invalid or expired link" }, 404);
  if (row.revoked_at) return json({ error: "This scout link has been revoked" }, 403);
  if (row.purpose !== "scout") return json({ error: "Token is not a scout token" }, 403);

  // 2. Read current scouted_pois
  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, scouted_pois")
    .eq("id", row.event_id)
    .maybeSingle();

  if (eventErr || !eventRow) {
    console.error("[submit-scouted-poi] event lookup failed", eventErr);
    return json({ error: "Event not found" }, 404);
  }

  const current = Array.isArray((eventRow as EventRow).scouted_pois)
    ? ((eventRow as EventRow).scouted_pois as ScoutedPoi[])
    : [];

  // 3. Rate limit — count how many POIs this token submitted in the last hour
  const tokenPrefix = token.slice(0, 8);
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentFromThisToken = current.filter(
    (p) =>
      p?.scouted_via_token === tokenPrefix &&
      typeof p?.scouted_at === "string" &&
      Date.parse(p.scouted_at) > oneHourAgo,
  ).length;

  if (recentFromThisToken >= RATE_LIMIT_PER_HOUR) {
    return json(
      { error: `Rate limit exceeded: max ${RATE_LIMIT_PER_HOUR} POIs per hour per scout link` },
      429,
    );
  }

  // 4. Build the scouted POI record
  const newPoi: ScoutedPoi = {
    id: crypto.randomUUID(),
    type: validation.poi.type,
    title: validation.poi.title,
    description: validation.poi.description ?? "",
    coordinates: validation.poi.coordinates,
    scouted_at: new Date().toISOString(),
    scouted_via_token: tokenPrefix,
  };

  const next = [...current, newPoi];

  // 5. Persist
  const { error: updateErr } = await supabase
    .from("events")
    .update({ scouted_pois: next })
    .eq("id", row.event_id);

  if (updateErr) {
    console.error("[submit-scouted-poi] update failed", updateErr);
    return json({ error: "Failed to save POI" }, 500);
  }

  return json({ ok: true, poi: newPoi });
});
