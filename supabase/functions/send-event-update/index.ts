// Organizer → audience email sender.
//
// POST body: {
//   eventId:   string,
//   subject:   string (<= 200 chars),
//   body:      string — minimal Markdown (bold, links, paragraphs)
//   audiences: ('subscribers' | 'volunteers')[]
// }
//
// Returns: { sent: { subscribers, volunteers }, totalRecipients,
//            intendedRecipients, partial } (SendSummary in delivery.ts).
//   totalRecipients is how many people it reached. partial is true when
//   a Resend batch failed after an earlier one went out. If nobody was
//   reached it's a 502 instead.
//
// Guardrails:
//   - Auth: must be the event's owner (via _shared/billing authenticate).
//   - Pro gate: event.paid_at must be non-null.
//   - Rate limit: 1 send per event per 24h total (query email_sends).
//   - Unsubscribed recipients filtered out.
//   - Resend Batch API for delivery, up to 100 per chunk.
//   - Audit row written to email_sends whenever anyone was reached,
//     a partial send included (the row is also the 24h lock).

import { authenticate, corsHeaders, getServiceClient, json } from "../_shared/billing.ts";
import { renderOrganizerEmailHtml, renderOrganizerEmailText } from "../_shared/emailTemplate.ts";
import { reportError } from "../_shared/report.ts";
import { signUnsubscribeToken } from "../_shared/unsubscribeToken.ts";
import { deliverInChunks, summarizeDelivery } from "./delivery.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_ADDRESS = Deno.env.get("EMAIL_FROM_ADDRESS") ?? "Hereday <noreply@hereday.io>";
const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") ?? "https://hereday.io";
const RATE_LIMIT_HOURS = 24;
const BATCH_CHUNK_SIZE = 100;

interface VolunteerEntry {
  id: string;
  name: string;
  email?: string;
  assignedPoiIds?: string[];
  createdAt?: string;
  emailUnsubscribedAt?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, req);

  if (!RESEND_API_KEY) {
    return json({ error: "RESEND_API_KEY not configured" }, 500, req);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  let body: {
    eventId?: string;
    subject?: string;
    body?: string;
    audiences?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, req);
  }

  const eventId = body.eventId;
  const subject = (body.subject ?? "").trim();
  const markdown = (body.body ?? "").trim();
  const audiences = (body.audiences ?? []).filter(
    (a): a is "subscribers" | "volunteers" => a === "subscribers" || a === "volunteers",
  );

  if (!eventId || typeof eventId !== "string") return json({ error: "eventId is required" }, 400, req);
  if (!subject) return json({ error: "subject is required" }, 400, req);
  if (subject.length > 200) return json({ error: "subject must be 200 characters or fewer" }, 400, req);
  if (!markdown) return json({ error: "body is required" }, 400, req);
  if (audiences.length === 0) return json({ error: "pick at least one audience" }, 400, req);

  const service = getServiceClient();

  // Ownership + Pro gate
  const { data: event, error: eventErr } = await service
    .from("events")
    .select("id, user_id, name, paid_at, volunteer_roster")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !event) return json({ error: "Event not found" }, 404, req);
  if (event.user_id !== auth.userId) return json({ error: "Not your event" }, 403, req);
  if (!event.paid_at) return json({ error: "Event must be Pro to send updates" }, 403, req);

  // 24h rate limit — count prior sends on this event within the window
  const windowStart = new Date(Date.now() - RATE_LIMIT_HOURS * 3600 * 1000).toISOString();
  const { data: priorSends, error: rateErr } = await service
    .from("email_sends")
    .select("sent_at")
    .eq("event_id", eventId)
    .gte("sent_at", windowStart)
    .limit(1);
  if (rateErr) {
    console.error("[send-event-update] rate-limit lookup failed", rateErr);
    return json({ error: "Rate-limit check failed" }, 500, req);
  }
  if (priorSends && priorSends.length > 0) {
    return json({
      error: `You've already sent an update for this event in the last ${RATE_LIMIT_HOURS} hours.`,
      code: "rate_limited",
    }, 429, req);
  }

  // Build recipient list from selected audiences
  const recipients: Array<{
    email: string;
    audience: "s" | "v";
    id: string; // subscriber.id (stringified bigserial) or volunteer.id (uuid)
    name?: string;
  }> = [];

  if (audiences.includes("subscribers")) {
    const { data: subs, error: subsErr } = await service
      .from("event_subscribers")
      .select("id, email, unsubscribed_at")
      .eq("event_id", eventId)
      .is("unsubscribed_at", null);
    if (subsErr) {
      console.error("[send-event-update] subscriber fetch failed", subsErr);
      return json({ error: "Failed to load subscribers" }, 500, req);
    }
    for (const s of subs ?? []) {
      recipients.push({ email: s.email, audience: "s", id: String(s.id) });
    }
  }

  if (audiences.includes("volunteers")) {
    const roster = (event.volunteer_roster ?? []) as unknown as VolunteerEntry[];
    for (const v of Array.isArray(roster) ? roster : []) {
      const email = (v.email ?? "").trim();
      if (!email) continue;
      if (v.emailUnsubscribedAt) continue;
      recipients.push({ email, audience: "v", id: v.id, name: v.name });
    }
  }

  // Dedupe by (email, audience). Someone who's both a subscriber AND on
  // the volunteer roster will get two emails — fine, they opted in via
  // both paths and the contexts are distinct.
  const seen = new Set<string>();
  const deduped = recipients.filter((r) => {
    const key = `${r.audience}:${r.email.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length === 0) {
    return json({ error: "No recipients after filtering unsubscribes" }, 400, req);
  }

  // Organizer display name + reply-to email
  const { data: organizerProfile } = await service
    .from("profiles")
    .select("display_name")
    .eq("user_id", auth.userId)
    .maybeSingle();
  const organizerName = (organizerProfile as { display_name?: string | null } | null)?.display_name ?? null;
  const replyTo = auth.email;

  // Sign unsubscribe tokens and render per-recipient HTML
  const rendered: Array<{ to: string; html: string; text: string }> = [];
  for (const r of deduped) {
    const token = await signUnsubscribeToken({ a: r.audience, e: eventId, i: r.id });
    const unsubscribeUrl = `${PUBLIC_BASE_URL}/unsubscribe/${token}`;
    const templateInput = {
      eventName: event.name,
      subject,
      bodyMarkdown: markdown,
      unsubscribeUrl,
      organizerName,
    };
    rendered.push({
      to: r.email,
      html: renderOrganizerEmailHtml(templateInput),
      text: renderOrganizerEmailText(templateInput),
    });
  }

  // Send in chunks via Resend Batch API. One HTTP call per chunk.
  const delivery = await deliverInChunks(rendered, BATCH_CHUNK_SIZE, async (chunk) => {
    const payload = chunk.map((r) => ({
      from: FROM_ADDRESS,
      to: [r.to],
      reply_to: replyTo ?? undefined,
      subject,
      html: r.html,
      text: r.text,
      headers: {
        // RFC 8058 one-click + RFC 2369 mailto form. Helps Gmail recognize
        // the unsubscribe link in the inbox UI.
        "List-Unsubscribe": `<${chunk[0] ? `${PUBLIC_BASE_URL}/unsubscribe` : PUBLIC_BASE_URL}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }));

    const resp = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return { ok: false, status: resp.status, detail: await resp.text() };

    const result = await resp.json().catch(() => ({}));
    const id = Array.isArray(result?.data) && result.data[0]?.id ? result.data[0].id as string : null;
    return { ok: true, id };
  });

  if (delivery.failure) {
    console.error("[send-event-update] Resend batch failed", delivery.failure.status, delivery.failure.detail);
  }
  if (delivery.sent === 0) {
    // Nobody got it: no audit row, so no 24h lock, and the organizer can
    // try again.
    return json({ error: "Email provider rejected the send", detail: delivery.failure?.detail }, 502, req);
  }

  const summary = summarizeDelivery(deduped, delivery);
  if (summary.partial) {
    // The organizer is told to contact support, so support needs to know
    // who's missing. Addresses go to the function log only, never to
    // PostHog.
    const unsent = deduped.slice(delivery.sent).map((r) => `${r.audience}:${r.email}`);
    console.error("[send-event-update] partial send", {
      eventId, sent: summary.totalRecipients, intended: summary.intendedRecipients, unsent,
    });
    reportError("send-event-update", new Error("partial send: some recipients didn't get the update"), {
      severity: "error",
      stage: "resend_batch",
      userId: auth.userId,
      hereday_event_id: eventId,
      sent: summary.totalRecipients,
      intended: summary.intendedRecipients,
      resend_status: delivery.failure?.status ?? null,
      resend_detail: delivery.failure?.detail.slice(0, 500) ?? null,
    });
  }

  // Audit log. This row is also the 24h lock, and a partial send takes it
  // too: there's no per-recipient record, so a retry would re-send to
  // everyone, including the people who already got it. The organizer is
  // told to contact support instead.
  const bodyPreview = markdown.slice(0, 200);
  const { error: auditErr } = await service
    .from("email_sends")
    .insert({
      event_id: eventId,
      sent_by_user_id: auth.userId,
      subject,
      body_preview: bodyPreview,
      audiences,
      recipient_count: delivery.sent,
      resend_batch_id: delivery.firstId,
    });
  if (auditErr) {
    console.error("[send-event-update] audit insert failed", auditErr);
    // Don't fail the request — the send already happened. But without the
    // row there's no 24h lock and no history entry, so say so.
    reportError("send-event-update", auditErr, {
      severity: "error",
      stage: "audit_insert",
      userId: auth.userId,
      hereday_event_id: eventId,
      sent: delivery.sent,
    });
  }

  return json(summary, 200, req);
});
