# FEATURE_ROADMAP.md

This roadmap is sorted by **what unblocks the next dollar and the next
user**, not by phase. When in doubt, do the thing closest to the top.

The previous phase-based roadmap is archived at the bottom for
reference.

---

## Now — "make it buyable" (this month)

The landing page sells Pro. The product can't take money. Close that
loop before anything else.

**Pricing decision (locked 2026-04-09):** $49 per event, one-time,
no subscription. Matches how race organizers actually think — "I'm
running a 10K, I need a map, I'll pay for this 10K" — and avoids
the dead-month churn problem seasonal SaaS always hits. Annual /
team plans stay parked until we see large orgs running multiple
events per season; that's a real signal, not a guess.

- [ ] **Billing schema migration.** Pro is an *event* attribute, not
  a user attribute. One migration: `events.paid_at TIMESTAMPTZ`,
  `events.stripe_session_id TEXT`. The `public_events` view already
  computes `plan` from `owner_is_paid` — swap that to
  `paid_at IS NOT NULL`.
- [ ] **Stripe integration.** Checkout session in payment mode (not
  subscription), webhook handler for `checkout.session.completed`,
  both in Supabase edge functions. Requires keys + a single $49
  product/price in Stripe dashboard. **Blocked on external Stripe
  account factors — resume the moment the account is live.**
- [x] **Decide free-tier limits.** Set to 3 routes / 30 POIs. Sized so a
  typical small race (5K/10K/half trio, single aid-station set) fits
  entirely inside free. Marathon weekends and larger events hit Pro as
  genuine "outgrew it" moments, not demo walls. Pro is unlimited.
- [x] **"Made with Hereday" footer** on free-tier public pages.
  Free growth loop. Paid events can remove it.
- [x] **Analytics table + client logger.** `product_events` +
  `logEvent()` helper. Without this, every decision below is vibes.

## Soon — editor drawing UX (reverted, needs careful re-implementation)

These were implemented but caused a rendering regression in
RouteEditor.tsx and had to be reverted (commit a2c3b13, 2026-04-12).
The features themselves are correct — the bug was in how they interacted
with Mapbox GL's source/layer lifecycle. Re-implement one at a time
with isolated testing.

- [x] ~~**Rubber-band preview line.**~~ Removed — four separate
  implementations all caused the same rendering regression (routes
  and POIs stop loading on existing projects). The Mapbox GL
  source/layer lifecycle in RouteEditor.tsx is too fragile for an
  additional dynamic source. Not worth the risk.
- [x] ~~**Visible waypoint dots.**~~ Removed — caused same rendering
  issues as rubber-band. Not worth the risk.
- [x] **Cursor mode changes.** Crosshair while drawing, copy cursor
  during POI placement, default when idle.
- [ ] **Block clicks during snap.** `isSnappingRef` gate on the click
  handler to prevent race conditions when Mapbox Directions API is
  in-flight. Must ensure the ref resets in all error paths.
- [x] **Route clear undo toast.** Snapshots waypoints, routeCoords,
  finished state, and auto start/finish POIs. Restores all on undo.
- [x] **Finish route button.** "Finish route" in the topbar after 3+
  waypoints as an alternative to double-click.
- [ ] **First-publish upsell suppression.** Skip the `UpgradeModal`
  on the user's first-ever publish so the activation moment isn't
  interrupted. Show from second publish onward.
- [x] **Email verification gate on publish.** Unverified users go
  straight to dashboard + editor. Publish blocked until verified.
  Banner on dashboard with resend button.
- [x] **POI drop-in animation.** Bounce animation on marker placement.
  Class applied AFTER `.addTo(map)` via `newPoiIdRef` gating.

## Next — "make it come back" (next 2 months)

Seasonal SaaS dies if users don't return. Optimize for the returning
organizer.

- [x] **Duplicate-from-last-year** as a first-class dashboard action.
  Race organizers run the same event annually — this is the #1
  retention lever. Auto-increment year, reset to draft.
- [x] **QR code in share popover.** `ShareQrCode` component using
  `qrcode`. Race-day signage → public page → funnel.
- [x] **Open Graph tags per event.** Dynamic `og:title`/`og:description`
  per event, default OG image for home + routeless events. Note: SPA
  crawlers without JS still won't see these; SSR/prerender is a later
  call if it becomes a real SEO bottleneck.
- [ ] **Sitemap from `public_events`.** Free SEO traffic to every
  published event.
- [ ] **Email capture on spectator view.** Collect addresses before
  you build notifications. `event_subscribers(event_id, email)`.
  *Note: the photographer POI plan in Later subsumes this — the
  gallery popover is the forcing function for giving up an email
  ("notify me when my photos go up"). Ship this standalone only if
  photo galleries slip.*
- [ ] **Bulk cleanup migration.** Legacy base64 POI images + orphaned
  logo files in storage buckets. Flagged in the DB audit.

## Later — "make it sticky" (3-6 months, after Tier 0 is done)

Differentiation. Only start once revenue is real.

- [ ] **PostGIS migration.** Dual-write normalized `routes`/`pois`
  tables with `geography` columns. Prerequisite for `/discover` and
  anything spatial.
- [x] **Live tracking MVP.** Opt-in participants share location to
  spectators. Shipped as a Pro feature with per-event tracking window,
  runner broadcast, spectator live map, pace display, and stale-runner
  filtering. Sells the Pro upgrade directly.
- [ ] **Checkpoints + splits** tied to live tracking. Natural next
  layer on top of the tracking MVP — split times at aid stations,
  pace projections, leaderboard.
- [ ] **`/discover` page** with spatial queries ("events near me").

### Advanced POIs — three-part arc

The existing `sponsor` POI type is a generic ⭐. "Advanced" means
turning POIs into surfaces that sell Pro, drive differentiation, and
bring runners back after the event. Ship in this order — each plan
builds infrastructure the next one reuses.

- [ ] **Sponsor POIs — done right (revenue story).** Extend `RoutePoi`
  with an optional `sponsor: { logoUrl, brandColor, ctaText, ctaUrl,
  promoCode }` block (no migration — POIs live in the `events` JSON
  column). Sponsor markers render with the sponsor's logo in the
  circle instead of the ⭐ emoji and a "SPONSORED" ribbon. Public
  popover becomes a branded ad unit: logo, filled CTA button in
  `brandColor`, copyable promo code, no directions link. Fire
  `sponsor_impression` on popover open and `sponsor_click` on CTA tap
  into the existing `product_events` table. New "Sponsors" card in
  the per-event analytics panel ranked by clicks. Free tier = 1
  sponsor; Pro = unlimited + CSV bulk import + analytics card. The
  pitch: "Hereday lets your sponsor sales guy prove $500/marker."
  ~1 week.

- [ ] **Live-status POIs (differentiation story).** Three new tables:
  `poi_statuses` (current state: `open | low | closed | moved` + note
  + `moved_to` coord), `poi_status_history` (append-only timeline),
  `poi_volunteer_tokens` (unauthenticated scoped tokens). Organizers
  generate volunteer links per POI (or event-wide for Pro) from the
  editor — each link opens a tokenized `/v/:token` page with giant
  status buttons, no login. Updates propagate via Supabase
  `postgres_changes` subscription (reuses the tracking subscription
  pattern). Public markers get a colored dot overlay (yellow/low,
  red/closed, blue/moved) and the popover shows "Low · updated 3
  minutes ago by Kevin." Organizer analytics gets a "Status history"
  timeline ("water ran low at mile 6 at 10:42 AM"). Pro gates
  unlimited tokens + event-wide tokens + history panel. Watch out
  for: rate-limit per token, log IPs in history, let organizers
  revoke. ~1.5 weeks.

- [ ] **Photographer POIs + post-race galleries (retention story).**
  New `photo` POI type (📸 in the amenities category). New
  `poi_photos` table (`event_id`, `poi_id`, `storage_path`,
  `thumbnail_path`, `bib_number`, `uploaded_by`) and a `poi-photos`
  storage bucket. `process-photo-upload` edge function generates a
  400×400 thumbnail and compresses full-res to 1600px max long edge.
  Public popover shows photo count + "View gallery" button opening a
  lightbox (`PhotoGalleryModal`) with grid view, bib-number filter,
  lazy load. External photographers upload via a tokenized
  `/upload/:token` page — reuses the `poi_volunteer_tokens` table
  from the live-status plan with a new `purpose` column
  (`status`/`upload`), which is why status POIs ship first. Photo
  popovers also host the email capture form →
  `event_subscribers(event_id, email, bib_number)`, which kills the
  "Email capture on spectator view" line item above at the same
  time. **Storage is the risk** — free cap 30 photos/event, Pro cap
  2,000 (marketed as "unlimited for typical races"), scheduled
  cleanup deletes free photos 90 days after `event_date`, Pro photos
  1 year. Free-event downloads carry a watermark baked in by an edge
  function on fetch. Notification emails when photos go up are
  parked until the capture table has real volume. ~2 weeks.

## Parking lot — don't build until a paying user asks

- Notifications / push
- Multi-day events
- Teams / organizations (multi-admin)
- Race timing integration
- Turn-by-turn voice navigation

---

## Observability principle

Every feature above should ship with one or more events logged to
`product_events`. "Did this feature get used" is a question we should
always be able to answer from SQL, not from guesswork.

---

## Archive: original phase-based roadmap

Kept for posterity. Phases 1 and 2 are done; Phase 3 is half-done
(gating works, checkout is blocked on Stripe account factors); Phase 4
is partially done (QR, OG tags, analytics); Phase 5 is partially done
(live tracking + course elevation shipped). Course elevation from
Phase 5 actually shipped in Phase 1.

<details>
<summary>Original phases</summary>

### Phase 1: Core MVP Polish
- Route editor stability ✅
- POI creation + editing ✅
- Public map UI polish ✅
- Start/finish clarity ✅
- Legend improvements ✅
- Publish flow clarity ✅

### Phase 2: Premium Experience
- Branding (logo, colors) ✅
- Better public page layout ✅
- Shareable event pages ✅
- Improved mobile UX ✅

### Phase 3: Monetization
- Free vs paid tier gating ⚠️ (gating done, checkout missing)
- Branded maps (paid) ✅
- Advanced POIs ⚠️ (now scoped — see "Advanced POIs" in Later)
- Multi-route enhancements ✅

### Phase 4: Growth + Differentiation
- Sponsor POIs ❌
- Sponsor offers/discounts ❌
- QR / on-site engagement ✅ (ShareQrCode)
- Shareability improvements ✅ (OG tags, GPX export, per-event analytics)

### Phase 5: Advanced Features
- Live tracking ✅ (Pro feature: runner broadcast + spectator live map)
- Checkpoints ❌
- Notifications ❌
- Course elevation ✅ (already shipped in P1)
- Multi-day events ❌

</details>
