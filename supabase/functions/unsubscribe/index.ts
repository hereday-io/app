// Unsubscribe handler — no auth required (CAN-SPAM / GDPR).
//
// Two call shapes:
//   GET /unsubscribe/:token           → browser flow (email link click).
//                                       Responds with a JSON status so the
//                                       frontend /unsubscribe/:token page
//                                       can render a confirmation view.
//                                       Also supported via query string
//                                       (?token=...) in case some email
//                                       clients strip trailing path segs.
//   POST /unsubscribe                 → RFC 8058 one-click form (gmail
//                                       "unsubscribe" button). Body is
//                                       form-urlencoded or JSON with
//                                       `token`. Always returns 200 on
//                                       success so mail providers trust
//                                       it.
//
// Side effects:
//   - Subscriber: update event_subscribers.unsubscribed_at = now()
//   - Volunteer: append emailUnsubscribedAt to the matching roster entry
//     inside events.volunteer_roster (JSONB mutation).

import { corsHeaders, getServiceClient, json } from "../_shared/billing.ts";
import { verifyUnsubscribeToken } from "../_shared/unsubscribeToken.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Extract token from path `/unsubscribe/<token>`, query `?token=`, or body
  const url = new URL(req.url);
  const pathSegs = url.pathname.split("/").filter(Boolean);
  let token = pathSegs.length > 1 ? decodeURIComponent(pathSegs[pathSegs.length - 1]) : null;
  if (!token) token = url.searchParams.get("token");
  if (!token && req.method === "POST") {
    try {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const b = await req.json();
        token = (b as { token?: string }).token ?? null;
      } else {
        const formText = await req.text();
        const params = new URLSearchParams(formText);
        token = params.get("token");
      }
    } catch {
      // fall through to missing-token response
    }
  }

  if (!token || token === "unsubscribe") {
    return json({ error: "Missing token" }, 400);
  }

  const payload = await verifyUnsubscribeToken(token);
  if (!payload) {
    return json({ error: "Invalid or expired unsubscribe link" }, 400);
  }

  const service = getServiceClient();

  // Look up the event name for the confirmation message
  const { data: eventRow } = await service
    .from("events")
    .select("id, name, volunteer_roster")
    .eq("id", payload.e)
    .maybeSingle();
  if (!eventRow) {
    return json({ error: "Event no longer exists" }, 404);
  }

  if (payload.a === "s") {
    // Subscriber unsubscribe. Look up first so we can detect a missing
    // row and preserve the original timestamp if already unsubscribed.
    const subId = Number(payload.i);
    if (!Number.isFinite(subId)) return json({ error: "Malformed token" }, 400);

    const { data: current, error: selectErr } = await service
      .from("event_subscribers")
      .select("id, unsubscribed_at")
      .eq("id", subId)
      .eq("event_id", payload.e)
      .maybeSingle();

    if (selectErr) {
      console.error("[unsubscribe] subscriber lookup failed", { subId, eventId: payload.e, selectErr });
      return json({ error: "Unsubscribe failed" }, 500);
    }
    if (!current) {
      console.warn("[unsubscribe] subscriber not found", { subId, eventId: payload.e });
      return json({ error: "Subscriber not found" }, 404);
    }

    if (!current.unsubscribed_at) {
      const { data: updated, error: updateErr } = await service
        .from("event_subscribers")
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq("id", subId)
        .eq("event_id", payload.e)
        .select("id");

      if (updateErr) {
        console.error("[unsubscribe] subscriber update failed", updateErr);
        return json({ error: "Unsubscribe failed" }, 500);
      }
      if (!updated || updated.length === 0) {
        console.error("[unsubscribe] subscriber update affected 0 rows", { subId, eventId: payload.e });
        return json({ error: "Unsubscribe failed" }, 500);
      }
      console.log("[unsubscribe] subscriber unsubscribed", { subId, eventId: payload.e });
    } else {
      console.log("[unsubscribe] subscriber already unsubscribed", { subId, eventId: payload.e });
    }

    return json({ status: "unsubscribed", audience: "subscriber", eventName: eventRow.name });
  }

  if (payload.a === "v") {
    // Volunteer unsubscribe — JSONB mutation. We read-modify-write the
    // whole roster. Concurrent roster edits from the organizer could
    // race; acceptable trade-off given volunteer rosters are typically
    // updated minutes-apart, not per-second.
    type RosterEntry = {
      id: string;
      email?: string;
      emailUnsubscribedAt?: string;
      [key: string]: unknown;
    };
    const roster = (eventRow.volunteer_roster ?? []) as unknown as RosterEntry[];
    const updated = Array.isArray(roster)
      ? roster.map((e) =>
          e.id === payload.i
            ? { ...e, emailUnsubscribedAt: e.emailUnsubscribedAt ?? new Date().toISOString() }
            : e,
        )
      : [];

    const { error: updateErr } = await service
      .from("events")
      .update({ volunteer_roster: updated as unknown as object } as never)
      .eq("id", payload.e);
    if (updateErr) {
      console.error("[unsubscribe] volunteer update failed", updateErr);
      return json({ error: "Unsubscribe failed" }, 500);
    }
    return json({ status: "unsubscribed", audience: "volunteer", eventName: eventRow.name });
  }

  return json({ error: "Unknown audience" }, 400);
});
