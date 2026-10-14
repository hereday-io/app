// Tests for send-event-update's delivery accounting: how many people a
// chunked Resend send reached, and what the function tells the organizer.
// Runs under Node via vitest (npm test); sendChunk stands in for the
// Resend batch call.

import { describe, expect, it, vi } from "vitest";
import { type ChunkResult, deliverInChunks, summarizeDelivery } from "./delivery.ts";

const ok = (id: string): ChunkResult => ({ ok: true, id });
const items = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("deliverInChunks", () => {
  it("sends every chunk and keeps the first chunk's id", async () => {
    const sendChunk = vi.fn()
      .mockResolvedValueOnce(ok("first"))
      .mockResolvedValueOnce(ok("second"));
    const result = await deliverInChunks(items(142), 100, sendChunk);
    expect(result).toEqual({ sent: 142, firstId: "first", failure: null });
    expect(sendChunk.mock.calls.map(([chunk]) => chunk.length)).toEqual([100, 42]);
  });

  it("counts only the chunks before a failed one, and stops there", async () => {
    const sendChunk = vi.fn()
      .mockResolvedValueOnce(ok("first"))
      .mockResolvedValueOnce({ ok: false, status: 429, detail: "rate limited" })
      .mockResolvedValueOnce(ok("third"));
    const result = await deliverInChunks(items(250), 100, sendChunk);
    expect(result).toEqual({ sent: 100, firstId: "first", failure: { status: 429, detail: "rate limited" } });
    expect(sendChunk).toHaveBeenCalledTimes(2);
  });

  it("treats a thrown fetch as a failed chunk, keeping what already went out", async () => {
    // Before, this threw out of the handler: a 500 with no audit row, so
    // the organizer was told nobody got it and could send it again.
    const sendChunk = vi.fn()
      .mockResolvedValueOnce(ok("first"))
      .mockRejectedValueOnce(new TypeError("error sending request"));
    const result = await deliverInChunks(items(142), 100, sendChunk);
    expect(result).toEqual({ sent: 100, firstId: "first", failure: { status: null, detail: "error sending request" } });
  });

  it("reports nothing sent when the first chunk fails", async () => {
    const sendChunk = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, detail: "bad key" });
    const result = await deliverInChunks(items(42), 100, sendChunk);
    expect(result).toEqual({ sent: 0, firstId: null, failure: { status: 401, detail: "bad key" } });
  });

  it("takes the id from the first chunk that has one", async () => {
    const sendChunk = vi.fn()
      .mockResolvedValueOnce({ ok: true, id: null })
      .mockResolvedValueOnce(ok("second"));
    const result = await deliverInChunks(items(150), 100, sendChunk);
    expect(result.firstId).toBe("second");
  });
});

describe("summarizeDelivery", () => {
  // 120 subscribers then 22 volunteers, the order index.ts builds them in.
  const recipients = [
    ...Array.from({ length: 120 }, () => ({ audience: "s" as const })),
    ...Array.from({ length: 22 }, () => ({ audience: "v" as const })),
  ];

  it("reports a full send", () => {
    expect(summarizeDelivery(recipients, { sent: 142 })).toEqual({
      sent: { subscribers: 120, volunteers: 22 },
      totalRecipients: 142,
      intendedRecipients: 142,
      partial: false,
    });
  });

  it("reports a partial send with the intended count and who it reached", () => {
    expect(summarizeDelivery(recipients, { sent: 100 })).toEqual({
      sent: { subscribers: 100, volunteers: 0 },
      totalRecipients: 100,
      intendedRecipients: 142,
      partial: true,
    });
  });
});
