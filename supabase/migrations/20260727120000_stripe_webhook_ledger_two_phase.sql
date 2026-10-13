-- ─────────────────────────────────────────────────────────────────────
-- Stripe webhook ledger: split the row into claim + complete
-- ─────────────────────────────────────────────────────────────────────
-- The H-1 replay guard (20260501120000) inserts the ledger row *before*
-- dispatching to the handler and treats any unique violation as "already
-- processed". That makes the guard swallow its own retries: when the
-- handler fails and returns 500, Stripe redelivers the same event id,
-- collides with the claim row the failed delivery left behind, and gets
-- a 200 without the work ever having run.
--
-- Net effect: any transient failure permanently drops that webhook. The
-- live path is the stripe.paymentIntents.retrieve() call inside
-- handleCheckoutCompleted — a Stripe API blip there means events.paid_at
-- never flips and a paying customer silently doesn't get Pro.
--
-- Split the row into two phases:
--   processed_at  — when a delivery *claimed* the event. This is already
--                   the column's de-facto meaning, so it keeps its type,
--                   its NOT NULL, its default, and its audit index.
--   completed_at  — when the handler actually finished. NULL means the
--                   claim is still outstanding.
--
-- A duplicate delivery is only a replay when completed_at IS NOT NULL.
-- An outstanding claim older than the staleness window is reclaimable,
-- which is what lets a Stripe retry pick up after a failed delivery.
-- Reclaiming on elapsed time (rather than on cleanup code deleting the
-- row) is deliberate: it also recovers deliveries that timed out or had
-- their isolate killed, where no catch block would ever have run.

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Backfill. Every pre-existing row was written by the old
-- insert-then-dispatch flow, which only left rows behind for events it
-- considered done. Marking them complete stops a redelivery of an old
-- event from being mistaken for a stale claim and re-run.
UPDATE public.stripe_webhook_events
   SET completed_at = processed_at
 WHERE completed_at IS NULL;

-- No new index: the reclaim probe filters on event_id, which is already
-- the primary key, so it is a single-row lookup.

COMMENT ON COLUMN public.stripe_webhook_events.processed_at IS
  'When a delivery claimed this event. Bumped when a stale claim is reclaimed.';
COMMENT ON COLUMN public.stripe_webhook_events.completed_at IS
  'When the handler finished. NULL = claim outstanding; only a non-NULL value makes a duplicate delivery a replay.';
