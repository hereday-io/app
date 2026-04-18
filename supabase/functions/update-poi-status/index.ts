// Live-status POIs — status update endpoint.
//
// Body: { token, poi_id, state, note?, moved_to?, volunteer_name? }
//   - token: status-purpose volunteer token
//   - poi_id: the POI id inside events.pois
//   - state: 'open' | 'low' | 'closed' | 'moved'
//   - note: optional short message (max 200)
//   - moved_to: { lng, lat } — required when state='moved', else ignored
//   - volunteer_name: optional display name, shown in popover + history
//
// Writes:
//   1. Upsert into poi_statuses (current state — drives public map)
//   2. Insert into poi_status_history (append-only timeline)
//
// Both happen via the service-role client. No rate limiting in v1 —
// status update volume is low (a few per POI per race) so a dedicated
// limit table isn't worth the weight yet.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_STATES = new Set(["open", "low", "closed", "moved"]);
const MAX_NOTE_LEN = 200;
const MAX_NAME_LEN = 80;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface TokenRow {
  token: string;
  event_id: string;
  purpose: string;
  revoked_at: string | null;
}

interface IncomingBody {
  token?: string;
  poi_id?: string;
  state?: string;
  note?: string;
  moved_to?: { lng?: number; lat?: number };
  volunteer_name?: string;
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

  let body: IncomingBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const token = body.token;
  if (typeof token !== "string" || token.length < 16 || token.length > 64) {
    return json({ error: "Invalid token" }, 400);
  }
  if (typeof body.poi_id !== "string" || body.poi_id.length === 0 || body.poi_id.length > 128) {
    return json({ error: "poi_id is required" }, 400);
  }
  if (typeof body.state !== "string" || !VALID_STATES.has(body.state)) {
    return json({ error: "state must be open, low, closed, or moved" }, 400);
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LEN) : "";
  const volunteerName = typeof body.volunteer_name === "string"
    ? body.volunteer_name.trim().slice(0, MAX_NAME_LEN)
    : "";

  let movedLng: number | null = null;
  let movedLat: number | null = null;
  if (body.state === "moved" && body.moved_to) {
    const { lng, lat } = body.moved_to;
    if (typeof lng === "number" && typeof lat === "number"
        && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
      movedLng = lng;
      movedLat = lat;
    }
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("poi_volunteer_tokens")
    .select("token, event_id, purpose, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (tokenErr) {
    console.error("[update-poi-status] token lookup failed", tokenErr);
    return json({ error: "Token lookup failed" }, 500);
  }
  const row = tokenRow as TokenRow | null;
  if (!row) return json({ error: "Invalid or expired link" }, 404);
  if (row.revoked_at) return json({ error: "This link has been revoked" }, 403);
  if (row.purpose !== "status") return json({ error: "Token is not a status token" }, 403);

  // Confirm the POI id actually exists on the event. Cheap guard against
  // volunteers (or bots) pushing statuses for non-existent POIs.
  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("pois")
    .eq("id", row.event_id)
    .maybeSingle();
  if (eventErr || !eventRow) {
    console.error("[update-poi-status] event lookup failed", eventErr);
    return json({ error: "Event not found" }, 404);
  }
  const pois = Array.isArray((eventRow as { pois: unknown }).pois)
    ? ((eventRow as { pois: Array<{ id?: string }> }).pois)
    : [];
  if (!pois.some((p) => p?.id === body.poi_id)) {
    return json({ error: "POI not found on this event" }, 404);
  }

  // Extract client IP for history only (never surfaced in UI). Supabase
  // injects x-forwarded-for from the edge. Best-effort: the first entry
  // in the list is the original client IP.
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const clientIp = fwd.split(",")[0]?.trim() || null;

  const nowIso = new Date().toISOString();

  // 1. Upsert current state
  const { error: upsertErr } = await supabase
    .from("poi_statuses")
    .upsert(
      {
        event_id: row.event_id,
        poi_id: body.poi_id,
        state: body.state,
        note: note || null,
        moved_to_lng: movedLng,
        moved_to_lat: movedLat,
        updated_by_name: volunteerName || null,
        updated_via_token: token.slice(0, 8),
        updated_at: nowIso,
      },
      { onConflict: "event_id,poi_id" },
    );
  if (upsertErr) {
    console.error("[update-poi-status] upsert failed", upsertErr);
    return json({ error: "Failed to save status" }, 500);
  }

  // 2. Append to history — non-blocking for the client response but we
  // still await so a failed insert surfaces in logs.
  const { error: historyErr } = await supabase
    .from("poi_status_history")
    .insert({
      event_id: row.event_id,
      poi_id: body.poi_id,
      state: body.state,
      note: note || null,
      moved_to_lng: movedLng,
      moved_to_lat: movedLat,
      updated_by_name: volunteerName || null,
      updated_via_token: token.slice(0, 8),
      updated_ip: clientIp,
    });
  if (historyErr) {
    console.warn("[update-poi-status] history insert failed (non-fatal)", historyErr);
  }

  return json({
    ok: true,
    status: {
      event_id: row.event_id,
      poi_id: body.poi_id,
      state: body.state,
      note: note || null,
      moved_to_lng: movedLng,
      moved_to_lat: movedLat,
      updated_by_name: volunteerName || null,
      updated_at: nowIso,
    },
  });
});
