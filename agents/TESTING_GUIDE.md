# TESTING_GUIDE.md

Manual-test recipes for Hereday features that can't be covered by
automated tests — Stripe flows, offline sync, on-device behavior, etc.
Append to this file as new flows ship; each section should be runnable
without reading the commit history.

---

## Billing / Pro status

Pricing is locked at $49 per event, one-time. "Pro" is an event
attribute (`events.paid_at IS NOT NULL`), **not** a user attribute.
See [20260411120000_event_billing_columns.sql](supabase/migrations/20260411120000_event_billing_columns.sql)
for the schema.

### Manually flip a single event to Pro

Use this for comps, internal events, or reproducing a Pro-only bug
without running a real Stripe checkout.

```sql
UPDATE public.events
   SET paid_at = now(),
       plan    = 'pro'
 WHERE id = '<event-uuid>';
```

Expected effects (refresh the editor + the public page):
- Editor: paywall limits lift (unlimited routes/POIs), Branding panel
  unlocks, Pro-only controls appear.
- Public page: "Made with Hereday" footer disappears.
- `public_events.owner_is_paid` returns `true` for the row.

### Manually revoke Pro (for testing free-tier behavior)

```sql
UPDATE public.events
   SET paid_at = NULL,
       stripe_session_id = NULL,
       plan    = 'free'
 WHERE id = '<event-uuid>';
```

### What the Stripe webhook will do (once the account is live)

The `checkout.session.completed` handler should run a single UPDATE
per successful payment. This is the whole contract between Stripe and
the billing schema:

```sql
UPDATE public.events
   SET paid_at           = now(),
       stripe_session_id = $1,  -- cs_xxx from the event
       plan              = 'pro'
 WHERE id = $2;
```

Reconcile a webhook by hand:

```sql
SELECT id, name, paid_at, stripe_session_id, plan
  FROM public.events
 WHERE stripe_session_id = 'cs_test_xxx';
```

### Pre-Stripe smoke test (what we can verify today)

1. Create a free event. Confirm the editor enforces 3 routes / 30 POIs
   limits and the public page shows "Made with Hereday".
2. Flip it Pro with the SQL above. Hard-refresh both the editor and
   the public page. Limits lift; footer disappears.
3. Revoke it. Hard-refresh. Limits return; footer returns.
4. Check a second user's event is unaffected — Pro is per-event, not
   per-user.

---

## Mobile POI Scout

Ships in [Phase 1](feature_roadmap.md). Scout links let anyone with
the URL drop POIs into a review queue on a specific event, without
logging in.

### Happy path (desktop → phone → desktop)

1. **Desktop**: open an event in the editor, click the Compass icon
   in the top bar → "Generate scout link". Copy the URL (or scan the
   QR).
2. **Phone**: open the URL. No login prompt. See the event name,
   existing routes (if any), and existing POIs dimmed at 50% opacity.
3. **Phone**: pan/zoom so the center crosshair sits where the POI
   should go. Tap "Drop pin here". Fill the category, type, title,
   and optional description. Tap Save.
4. **Phone**: a green checkmark marker drops at the pin location.
   A toast confirms. Repeat to scout more POIs.
5. **Desktop**: reload the editor. The amber "N scouted POIs waiting
   for review" banner appears at the top. Click "Review".
6. **Desktop**: the floating review panel opens on the right. Each
   scouted POI also renders on the map with a dashed amber ring +
   pulsing shadow. Click a row → map flies to that POI. Click Accept
   → the pin switches to the regular white-ring style and the row
   disappears. Click Reject → the pin disappears entirely.
7. **Desktop**: autosave commits both the accept and the reject via
   the normal editor save path (no new endpoint).

### Offline queue (hardest thing to get right)

1. Put the phone in airplane mode.
2. Drop a pin. Save. Toast reads "Saved locally — will retry when
   online".
3. Turn WiFi back on. Within a few seconds the queue auto-flushes
   (triggered by the `online` event listener in ScoutPage).
4. Reload the desktop review panel — the POI should be there.

### Rate limit

The `submit-scouted-poi` edge function rejects a token that has
submitted > 50 POIs in the past hour. To hit it, script a burst and
verify the 51st returns a 429-style error.

### Revoke a scout token

From the desktop Scout Link dialog click Revoke. The same URL on the
phone should now fail to resolve with a clear error screen.

### Scout link against a draft event

The whole point of scouting is walking the course *before* publishing,
so the flow must work on unpublished events. Verify: create a new
event without publishing it, generate a scout link, open on the
phone. The map should still load (uses a service-role read bypassing
the `public_events` view on purpose).

### Mobile gate untouched

Open `/editor?id=X` directly on a phone. Still gated by
[MobileEditorGate](src/components/editor/MobileEditorGate.tsx) — the
scout link is the only mobile entry point.

---

## Live tracking (Pro feature)

Existing. Flows live in the tracking section of
[SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md). Add a dedicated
recipe here next time we touch it.
