// Regression tests for the Stripe webhook's event handlers: the code
// that turns a payment into Pro (events.paid_at) and logs revenue rows.
//
// Runs under Node via vitest (npm test). Events go through dispatchEvent
// as fixture Stripe.Event payloads; the database is FakeDb, which
// evaluates the handlers' real PostgREST filters in memory. The replay
// ledger in index.ts is not exercised here — its SQL is covered by
// supabase/tests/stripe_ledger.check.mjs (npm run test:db). So
// "duplicate delivery" below means a redelivery that got past the
// ledger (completion stamp failed, or a stale-claim reclaim racing a
// slow delivery), which the handlers must absorb on their own.

import type Stripe from "npm:stripe@17.3.1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchEvent, type ServiceClient, type StripeApi } from "./handlers.ts";
import { FakeDb, type Row } from "./fakeDb.ts";

// The acknowledged-but-owed cases must reach a person; assert they are
// reported. (Under Node the real reporter is a no-op anyway.)
const reportError = vi.hoisted(() => vi.fn());
vi.mock("../_shared/report.ts", () => ({ reportError }));

const EVENT_ID = "8f6c1f0e-3b52-4d7e-9a3c-2f7d5e1a9b01";
const USER_ID = "2c9a7e41-6d0b-4f3a-8e15-b7c4d9a0e6f2";
const OTHER_USER_ID = "5e1d3b8a-0c47-4a92-b6f1-93e2c8d7a405";
const CHARGE_ID = "ch_3PfixtureCharge";
const PI_ID = "pi_3PfixtureIntent";
const SESSION_ID = "cs_test_a1fixtureSession";

let db: FakeDb;
let stripe: ReturnType<typeof fakeStripe>;
let evtSeq = 0;

beforeEach(() => {
  reportError.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = new FakeDb({
    events: [{
      id: EVENT_ID,
      name: "Crystal Lake 5K",
      user_id: USER_ID,
      paid_at: null,
      plan: "free",
      stripe_session_id: null,
      stripe_payment_id: null,
    }],
    profiles: [{
      user_id: USER_ID,
      first_referrer: "https://www.google.com/",
      first_landing_page: "/pricing",
      utm_source: "newsletter",
      utm_medium: null,
      utm_campaign: "fall-races",
      utm_term: null,
      utm_content: null,
    }],
    product_events: [],
  });
  stripe = fakeStripe();
});

// ---------------------------------------------------------------- fixtures

function fakeStripe() {
  return {
    paymentIntents: {
      retrieve: vi.fn(async (id: string) => ({ id, object: "payment_intent", latest_charge: CHARGE_ID })),
    },
    charges: {
      update: vi.fn(async (id: string, params: { metadata: Record<string, string> }) => ({
        id,
        object: "charge",
        metadata: params.metadata,
      })),
    },
    checkout: {
      sessions: {
        // Only reached when a discount has no hereday_promo_code; tests
        // that go there override it.
        retrieve: vi.fn(async (_id: string, _params?: unknown): Promise<unknown> => {
          throw new Error("unexpected checkout.sessions.retrieve");
        }),
      },
    },
    promotionCodes: {
      retrieve: vi.fn(async (id: string): Promise<{ id: string; code: string }> => {
        throw new Error(`unexpected promotionCodes.retrieve(${id})`);
      }),
    },
  };
}

function session(overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  return {
    id: SESSION_ID,
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    payment_intent: PI_ID,
    amount_subtotal: 4900,
    amount_total: 4900,
    currency: "usd",
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    metadata: { hereday_event_id: EVENT_ID, hereday_user_id: USER_ID },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

function charge(overrides: Record<string, unknown> = {}): Stripe.Charge {
  return {
    id: CHARGE_ID,
    object: "charge",
    amount: 4900,
    amount_refunded: 4900,
    refunded: true,
    currency: "usd",
    payment_intent: PI_ID,
    metadata: {
      hereday_event_id: EVENT_ID,
      hereday_event_name: "Crystal Lake 5K — Pro unlock",
      hereday_user_id: USER_ID,
    },
    ...overrides,
  } as unknown as Stripe.Charge;
}

function stripeEvent(type: string, object: unknown, id = `evt_fixture_${++evtSeq}`): Stripe.Event {
  return {
    id,
    object: "event",
    type,
    api_version: "2023-10-16",
    created: 1760000000,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  } as unknown as Stripe.Event;
}

const completed = (s = session()) => stripeEvent("checkout.session.completed", s);
const asyncSucceeded = (s = session()) => stripeEvent("checkout.session.async_payment_succeeded", s);
const asyncFailed = (s = session()) => stripeEvent("checkout.session.async_payment_failed", s);
const refunded = (c = charge()) => stripeEvent("charge.refunded", c);

/** Deliver one event, the way index.ts does after claiming it. */
const deliver = (event: Stripe.Event) =>
  dispatchEvent(stripe as unknown as StripeApi, db as unknown as ServiceClient, event);

const theEvent = () => db.rows("events").find((r) => r.id === EVENT_ID)!;
const revenueRows = (type: string) => db.rows("product_events").filter((r) => r.event_type === type);
const writes = () => db.queries.filter((q) => q.op !== "select");

/** Mark the fixture event as already paid, as a completed checkout leaves it. */
function seedPaid(fields: Row = {}) {
  Object.assign(theEvent(), {
    paid_at: "2026-10-01T12:00:00.000Z",
    plan: "pro",
    stripe_session_id: SESSION_ID,
    stripe_payment_id: CHARGE_ID,
    ...fields,
  });
}

// ------------------------------------------------------------------ tests

describe("checkout.session.completed (paid)", () => {
  it("grants Pro and mirrors plan, session and charge onto the event", async () => {
    await deliver(completed());

    const ev = theEvent();
    expect(typeof ev.paid_at).toBe("string");
    expect(Number.isNaN(Date.parse(ev.paid_at as string))).toBe(false);
    expect(ev.plan).toBe("pro");
    expect(ev.stripe_session_id).toBe(SESSION_ID);
    expect(ev.stripe_payment_id).toBe(CHARGE_ID);
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(PI_ID);
  });

  it("only flips paid_at while it is still NULL", async () => {
    await deliver(completed());
    const update = db.queries.find((q) => q.table === "events" && q.op === "update")!;
    expect(update.filters).toEqual([`id=eq.${EVENT_ID}`, "paid_at=is.null"]);
  });

  it("logs exactly one purchase_completed row with the buyer's attribution", async () => {
    await deliver(completed());

    const rows = revenueRows("purchase_completed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      event_type: "purchase_completed",
      user_id: USER_ID,
      event_id: EVENT_ID,
      properties: {
        amount_total: 4900,
        amount_subtotal: 4900,
        currency: "usd",
        stripe_session_id: SESSION_ID,
        stripe_charge_id: CHARGE_ID,
        // Attribution from the profile; null columns are dropped, as are
        // amount_discount / percent_off / promo_code with no discount.
        first_referrer: "https://www.google.com/",
        first_landing_page: "/pricing",
        utm_source: "newsletter",
        utm_campaign: "fall-races",
      },
    });
    expect(db.rows("product_events")).toHaveLength(1);
  });

  it("stamps the charge with the event name for the billing page", async () => {
    await deliver(completed());
    expect(stripe.charges.update).toHaveBeenCalledTimes(1);
    expect(stripe.charges.update).toHaveBeenCalledWith(CHARGE_ID, {
      metadata: {
        hereday_event_id: EVENT_ID,
        hereday_event_name: "Crystal Lake 5K — Pro unlock",
        hereday_user_id: USER_ID,
      },
    });
  });

  it("falls back to the event owner when the session has no hereday_user_id", async () => {
    db.rows("profiles").push({ user_id: OTHER_USER_ID, utm_source: "partner" });
    theEvent().user_id = OTHER_USER_ID;
    await deliver(completed(session({ metadata: { hereday_event_id: EVENT_ID } })));

    const [row] = revenueRows("purchase_completed");
    expect(row.user_id).toBe(OTHER_USER_ID);
    expect(row.properties).toMatchObject({ utm_source: "partner" });
  });

  it("acknowledges a session without hereday_event_id and touches nothing", async () => {
    await deliver(completed(session({ metadata: {} })));
    expect(db.queries).toEqual([]);
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith("stripe-webhook", expect.any(Error),
      expect.objectContaining({ severity: "critical", stage: "missing_event_id" }));
  });

  it("acknowledges a session whose event no longer exists", async () => {
    db.rows("events").length = 0;
    await expect(deliver(completed())).resolves.toBeUndefined();
    expect(writes()).toEqual([]);
    expect(stripe.charges.update).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith("stripe-webhook", expect.any(Error),
      expect.objectContaining({ severity: "critical", stage: "event_not_found", hereday_event_id: EVENT_ID }));
  });
});

describe("duplicate deliveries", () => {
  it("a redelivered completed event keeps the original paid_at and logs nothing more", async () => {
    const event = completed();
    await deliver(event);
    const firstPaidAt = theEvent().paid_at;

    await deliver(event);

    expect(theEvent().paid_at).toBe(firstPaidAt);
    expect(revenueRows("purchase_completed")).toHaveLength(1);
    // The second pass sees paid_at set and never issues the UPDATE.
    expect(db.queries.filter((q) => q.table === "events" && q.op === "update")).toHaveLength(1);
  });

  it("completed and async_payment_succeeded both reading 'paid' log one sale", async () => {
    await deliver(completed());
    await deliver(asyncSucceeded());
    expect(revenueRows("purchase_completed")).toHaveLength(1);
  });

  it("two deliveries racing past the same stale read log one sale", async () => {
    // Delivery A reads paid_at NULL; before it writes, delivery B (a
    // reclaim of A's claim) runs start to finish. A's UPDATE then matches
    // no row, so it must not log.
    const a = completed();
    const b = stripeEvent("checkout.session.completed", session(), a.id);
    let raced = false;
    db.afterQuery = async (q, result) => {
      if (raced || q.table !== "events" || q.op !== "select") return;
      raced = true;
      expect((result.data as Row).paid_at).toBeNull();
      await deliver(b);
    };

    await deliver(a);

    expect(raced).toBe(true);
    expect(revenueRows("purchase_completed")).toHaveLength(1);
    expect(db.queries.filter((q) => q.table === "events" && q.op === "update")).toHaveLength(2);
  });
});

describe("delayed payment methods", () => {
  it("unpaid at checkout grants nothing; async_payment_succeeded then grants once", async () => {
    await deliver(completed(session({ payment_status: "unpaid" })));

    expect(theEvent().paid_at).toBeNull();
    expect(db.queries).toEqual([]);
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(revenueRows("purchase_completed")).toHaveLength(0);

    const settled = asyncSucceeded();
    await deliver(settled);
    expect(theEvent().paid_at).not.toBeNull();
    expect(theEvent().plan).toBe("pro");
    expect(revenueRows("purchase_completed")).toHaveLength(1);

    await deliver(settled);
    expect(revenueRows("purchase_completed")).toHaveLength(1);
  });

  it("async_payment_failed grants nothing and writes nothing", async () => {
    await deliver(completed(session({ payment_status: "unpaid" })));
    await deliver(asyncFailed(session({ payment_status: "unpaid" })));

    expect(theEvent().paid_at).toBeNull();
    expect(theEvent().plan).toBe("free");
    expect(db.queries).toEqual([]);
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(stripe.charges.update).not.toHaveBeenCalled();
  });
});

describe("$0 checkout (100%-off promotion code)", () => {
  const free = () => session({
    payment_status: "no_payment_required",
    payment_intent: null,
    amount_subtotal: 4900,
    amount_total: 0,
    total_details: { amount_discount: 4900, amount_shipping: 0, amount_tax: 0 },
    metadata: { hereday_event_id: EVENT_ID, hereday_user_id: USER_ID, hereday_promo_code: "FIRSTMAP" },
  });

  it("grants Pro with no charge to point at", async () => {
    await deliver(completed(free()));

    expect(theEvent().paid_at).not.toBeNull();
    expect(theEvent().plan).toBe("pro");
    expect(theEvent().stripe_session_id).toBe(SESSION_ID);
    expect(theEvent().stripe_payment_id).toBeNull();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(stripe.charges.update).not.toHaveBeenCalled();
  });

  it("logs a zero-revenue conversion with the code and 100% off", async () => {
    await deliver(completed(free()));

    const rows = revenueRows("purchase_completed");
    expect(rows).toHaveLength(1);
    expect(rows[0].properties).toMatchObject({
      amount_total: 0,
      amount_subtotal: 4900,
      amount_discount: 4900,
      percent_off: 100,
      promo_code: "FIRSTMAP",
      stripe_session_id: SESSION_ID,
    });
    expect(rows[0].properties).not.toHaveProperty("stripe_charge_id");
  });
});

describe("promotion codes", () => {
  const discounted = (metadata: Record<string, string>) => session({
    amount_subtotal: 4900,
    amount_total: 3675,
    total_details: { amount_discount: 1225, amount_shipping: 0, amount_tax: 0 },
    metadata: { hereday_event_id: EVENT_ID, hereday_user_id: USER_ID, ...metadata },
  });
  const breakdown = (promotion_code: unknown) => ({
    id: SESSION_ID,
    total_details: {
      amount_discount: 1225,
      breakdown: { discounts: [{ amount: 1225, discount: { id: "di_1", promotion_code } }], taxes: [] },
    },
  });

  it("uses the code pre-applied on /billing without asking Stripe", async () => {
    await deliver(completed(discounted({ hereday_promo_code: "FALL25" })));

    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(revenueRows("purchase_completed")[0].properties).toMatchObject({
      amount_total: 3675,
      amount_discount: 1225,
      percent_off: 25,
      promo_code: "FALL25",
    });
    expect(stripe.charges.update).toHaveBeenCalledWith(CHARGE_ID, {
      metadata: expect.objectContaining({ hereday_promo_code: "FALL25", hereday_promo_percent_off: "25" }),
    });
  });

  it("resolves a code typed on Stripe's page through total_details.breakdown", async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue(breakdown("promo_1Pfixture"));
    stripe.promotionCodes.retrieve.mockResolvedValue({ id: "promo_1Pfixture", code: "RUNCLUB" });

    await deliver(completed(discounted({})));

    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(SESSION_ID, {
      expand: ["total_details.breakdown"],
    });
    expect(stripe.promotionCodes.retrieve).toHaveBeenCalledWith("promo_1Pfixture");
    expect(revenueRows("purchase_completed")[0].properties).toMatchObject({ promo_code: "RUNCLUB" });
  });

  it("reads an already-expanded promotion code object directly", async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue(
      breakdown({ id: "promo_1Pfixture", object: "promotion_code", code: "RUNCLUB" }),
    );

    await deliver(completed(discounted({})));

    expect(stripe.promotionCodes.retrieve).not.toHaveBeenCalled();
    expect(revenueRows("purchase_completed")[0].properties).toMatchObject({ promo_code: "RUNCLUB" });
  });

  it("still grants Pro when the promotion code lookup fails", async () => {
    stripe.checkout.sessions.retrieve.mockRejectedValue(new Error("Stripe 503"));

    await deliver(completed(discounted({})));

    expect(theEvent().paid_at).not.toBeNull();
    const [row] = revenueRows("purchase_completed");
    expect(row.properties).not.toHaveProperty("promo_code");
    expect(row.properties).toMatchObject({ percent_off: 25 });
  });
});

describe("charge.refunded", () => {
  beforeEach(() => seedPaid());

  it("revokes Pro and logs purchase_refunded with amount_refunded", async () => {
    await deliver(refunded(charge({ metadata: { ...charge().metadata, hereday_promo_code: "FALL25" } })));

    expect(theEvent().paid_at).toBeNull();
    expect(theEvent().plan).toBe("free");
    const rows = revenueRows("purchase_refunded");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: "purchase_refunded",
      user_id: USER_ID,
      event_id: EVENT_ID,
      properties: {
        amount_total: 4900,
        amount_refunded: 4900,
        currency: "usd",
        stripe_charge_id: CHARGE_ID,
        promo_code: "FALL25",
        utm_source: "newsletter",
      },
    });
  });

  it("only revokes events that are still paid", async () => {
    await deliver(refunded());
    const update = db.queries.find((q) => q.table === "events" && q.op === "update")!;
    expect(update.filters).toEqual(["paid_at=not.is.null", `id=eq.${EVENT_ID}`]);
  });

  it("does not double-log a redelivered refund", async () => {
    const event = refunded();
    await deliver(event);
    await deliver(event);
    expect(revenueRows("purchase_refunded")).toHaveLength(1);
  });

  it("matches on stripe_payment_id when the charge predates metadata stamping", async () => {
    await deliver(refunded(charge({ metadata: {} })));

    expect(theEvent().paid_at).toBeNull();
    const update = db.queries.find((q) => q.table === "events" && q.op === "update")!;
    expect(update.filters).toContain(`stripe_payment_id=eq.${CHARGE_ID}`);
    const [row] = revenueRows("purchase_refunded");
    // No hereday_user_id on the charge: falls back to the event's owner.
    expect(row.user_id).toBe(USER_ID);
  });

  it("ignores a partial refund", async () => {
    await deliver(refunded(charge({ amount_refunded: 1000, refunded: false })));

    expect(theEvent().paid_at).not.toBeNull();
    expect(db.queries).toEqual([]);
  });

  it("logs nothing when no paid event matches", async () => {
    theEvent().paid_at = null;
    await deliver(refunded());
    expect(revenueRows("purchase_refunded")).toHaveLength(0);
  });
});

describe("transient failures throw so Stripe retries", () => {
  it("event lookup error", async () => {
    db.fail("events", "select");
    await expect(deliver(completed())).rejects.toThrow(/event lookup failed/);
    expect(writes()).toEqual([]);
  });

  it("paid_at update error (including an enforce_pro_gates exception)", async () => {
    db.fail("events", "update", { message: "pro gate violated", code: "P0001" });
    await expect(deliver(completed())).rejects.toThrow(/event update failed.*pro gate violated/);
    expect(theEvent().paid_at).toBeNull();
    expect(revenueRows("purchase_completed")).toHaveLength(0);
  });

  it("Stripe's retry after a failed update grants once", async () => {
    db.fail("events", "update", { message: "connection reset" }, 1);
    const event = completed();
    await expect(deliver(event)).rejects.toThrow();

    await deliver(event);

    expect(theEvent().paid_at).not.toBeNull();
    expect(revenueRows("purchase_completed")).toHaveLength(1);
  });

  it("PaymentIntent retrieval error", async () => {
    stripe.paymentIntents.retrieve.mockRejectedValue(new Error("Stripe 500"));
    await expect(deliver(completed())).rejects.toThrow("Stripe 500");
    expect(db.queries).toEqual([]);
  });

  it("refund revoke error", async () => {
    seedPaid();
    db.fail("events", "update");
    await expect(deliver(refunded())).rejects.toThrow(/refund revoke failed/);
    expect(theEvent().paid_at).not.toBeNull();
    expect(revenueRows("purchase_refunded")).toHaveLength(0);
  });
});

describe("best-effort side effects never fail the delivery", () => {
  it("a failed revenue insert still acknowledges the grant", async () => {
    db.fail("product_events", "insert");
    await expect(deliver(completed())).resolves.toBeUndefined();
    expect(theEvent().paid_at).not.toBeNull();
  });

  it("a failed attribution lookup logs the sale unattributed", async () => {
    db.fail("profiles", "select");
    await deliver(completed());
    const [row] = revenueRows("purchase_completed");
    expect(row.properties).not.toHaveProperty("utm_source");
    expect(row.properties).toMatchObject({ amount_total: 4900 });
  });

  it("a failed charge metadata stamp still acknowledges the grant", async () => {
    stripe.charges.update.mockRejectedValue(new Error("Stripe 500"));
    await expect(deliver(completed())).resolves.toBeUndefined();
    expect(revenueRows("purchase_completed")).toHaveLength(1);
  });
});

describe("dispatch", () => {
  it("acknowledges event types it doesn't handle without side effects", async () => {
    await expect(deliver(stripeEvent("customer.created", { id: "cus_1" }))).resolves.toBeUndefined();
    expect(db.queries).toEqual([]);
  });
});
