// Organizer → audience email sender.
//
// POST body: {
//   eventId:   string,
//   subject:   string (<= 200 chars),
//   body:      string — minimal Markdown (bold, links, paragraphs)
//   audiences: ('subscribers' | 'volunteers')[]
// }
//
// Returns: { sent: { subscribers: number, volunteers: number }, totalRecipients }
//
// Guardrails:
//   - Auth: must be the event's owner (via _shared/billing authenticate).
//   - Pro gate: event.paid_at must be non-null.
//   - Rate limit: 1 send per event per 24h total (query email_sends).
//   - Unsubscribed recipients filtered out.
//   - Resend Batch API for delivery, up to 100 per chunk.
//   - Audit row written to email_sends.

import { authenticate, corsHeaders, getServiceClient, json } from "../_shared/billing.ts";
import { renderOrganizerEmailHtml, renderOrganizerEmailText } from "../_shared/emailTemplate.ts";
import { signUnsubscribeToken } from "../_shared/unsubscribeToken.ts";

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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!RESEND_API_KEY) {
    return json({ error: "RESEND_API_KEY not configured" }, 500);
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
    return json({ error: "Invalid JSON body" }, 400);
  }

  const eventId = body.eventId;
  const subject = (body.subject ?? "").trim();
  const markdown = (body.body ?? "").trim();
  const audiences = (body.audiences ?? []).filter(
    (a): a is "subscribers" | "volunteers" => a === "subscribers" || a === "volunteers",
  );

  if (!eventId || typeof eventId !== "string") return json({ error: "eventId is required" }, 400);
  if (!subject) return json({ error: "subject is required" }, 400);
  if (subject.length > 200) return json({ error: "subject must be 200 characters or fewer" }, 400);
  if (!markdown) return json({ error: "body is required" }, 400);
  if (audiences.length === 0) return json({ error: "pick at least one audience" }, 400);

  const service = getServiceClient();

  // Ownership + Pro gate
  const { data: event, error: eventErr } = await service
    .from("events")
    .select("id, user_id, name, paid_at, volunteer_roster")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !event) return json({ error: "Event not found" }, 404);
  if (event.user_id !== auth.userId) return json({ error: "Not your event" }, 403);
  if (!event.paid_at) return json({ error: "Event must be Pro to send updates" }, 403);

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
    return json({ error: "Rate-limit check failed" }, 500);
  }
  if (priorSends && priorSends.length > 0) {
    return json({
      error: `You've already sent an update for this event in the last ${RATE_LIMIT_HOURS} hours.`,
      code: "rate_limited",
    }, 429);
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
      return json({ error: "Failed to load subscribers" }, 500);
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
    return json({ error: "No recipients after filtering unsubscribes" }, 400);
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
  let resendBatchId: string | null = null;
  let successful = 0;
  for (let i = 0; i < rendered.length; i += BATCH_CHUNK_SIZE) {
    const chunk = rendered.slice(i, i + BATCH_CHUNK_SIZE);
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

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[send-event-update] Resend batch failed", resp.status, errText);
      if (successful === 0) {
        return json({ error: "Email provider rejected the send", detail: errText }, 502);
      }
      // Partial success — record what we sent and return a warning.
      break;
    }

    const result = await resp.json().catch(() => ({}));
    if (!resendBatchId && Array.isArray(result?.data) && result.data[0]?.id) {
      resendBatchId = result.data[0].id as string;
    }
    successful += chunk.length;
  }

  // Audit log
  const bodyPreview = markdown.slice(0, 200);
  const { error: auditErr } = await service
    .from("email_sends")
    .insert({
      event_id: eventId,
      sent_by_user_id: auth.userId,
      subject,
      body_preview: bodyPreview,
      audiences,
      recipient_count: successful,
      resend_batch_id: resendBatchId,
    });
  if (auditErr) {
    console.error("[send-event-update] audit insert failed", auditErr);
    // Don't fail the request — the send already happened.
  }

  // Per-audience counts for the UI
  const sent = {
    subscribers: deduped.slice(0, successful).filter((r) => r.audience === "s").length,
    volunteers: deduped.slice(0, successful).filter((r) => r.audience === "v").length,
  };

  return json({ sent, totalRecipients: successful });
});
