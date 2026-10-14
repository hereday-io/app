// Delivery for send-event-update: sends the rendered emails in
// Resend-batch-sized chunks and works out what actually went out.
// index.ts owns the request (auth, rate limit, rendering, the audit
// row); this file owns "how many people got it".
//
// Kept apart from index.ts so it runs under Node as well as Deno
// (delivery.test.ts): no Deno globals and no runtime imports. The HTTP
// call to Resend is passed in as sendChunk.

/** What one Resend batch call came back with. */
export type ChunkResult =
  | { ok: true; id: string | null }
  | { ok: false; status: number | null; detail: string };

export interface DeliveryResult {
  /**
   * How many items went out. Delivery stops at the first failed chunk,
   * so these are always items[0..sent) and the rest never went out.
   */
  sent: number;
  /** Resend's id for the first email of the first accepted chunk. */
  firstId: string | null;
  /** Why delivery stopped early; null when every chunk went out. */
  failure: { status: number | null; detail: string } | null;
}

/**
 * Send `items` in chunks of `chunkSize`, one sendChunk call each, and
 * stop at the first chunk that fails. A sendChunk that throws (the
 * fetch itself failed) counts as a failed chunk, not as a failed
 * request: earlier chunks already went out and must still be counted.
 *
 * Why stop rather than skip ahead: the failures we expect (Resend rate
 * limit or quota, an outage, a rejected key) fail every later chunk
 * too, and a contiguous unsent tail is something support can resend.
 */
export async function deliverInChunks<T>(
  items: T[],
  chunkSize: number,
  sendChunk: (chunk: T[]) => Promise<ChunkResult>,
): Promise<DeliveryResult> {
  let sent = 0;
  let firstId: string | null = null;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    let result: ChunkResult;
    try {
      result = await sendChunk(chunk);
    } catch (err) {
      result = { ok: false, status: null, detail: err instanceof Error ? err.message : String(err) };
    }
    if (!result.ok) {
      return { sent, firstId, failure: { status: result.status, detail: result.detail } };
    }
    firstId ??= result.id;
    sent += chunk.length;
  }
  return { sent, firstId, failure: null };
}

/** The 200 response body. Exported for SendUpdateDialog's type. */
export interface SendSummary {
  /** Who it reached, by audience. */
  sent: { subscribers: number; volunteers: number };
  /** How many people it reached. Kept under this name for older clients. */
  totalRecipients: number;
  /** How many people it was meant to reach. */
  intendedRecipients: number;
  /** True when some intended recipients didn't get it. */
  partial: boolean;
}

/** Summarize a delivery that reached at least one person. */
export function summarizeDelivery(
  recipients: ReadonlyArray<{ audience: "s" | "v" }>,
  delivery: Pick<DeliveryResult, "sent">,
): SendSummary {
  const reached = recipients.slice(0, delivery.sent);
  return {
    sent: {
      subscribers: reached.filter((r) => r.audience === "s").length,
      volunteers: reached.filter((r) => r.audience === "v").length,
    },
    totalRecipients: delivery.sent,
    intendedRecipients: recipients.length,
    partial: delivery.sent < recipients.length,
  };
}
