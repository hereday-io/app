# FEATURE_ROADMAP.md

This roadmap is sorted by **what unblocks the next dollar and the next
user**, not by phase. When in doubt, do the thing closest to the top.

The previous phase-based roadmap is archived at the bottom for
reference.

---

## 🚀 Recently shipped (since 2026-04-15)

Three major headlines from the last two weeks of work. Details
absorbed into the sections below; this callout is the quick-orient
summary for anyone dropping back into the roadmap.

- **Sponsor POIs** (~1 week target, shipped) — branded markers with
  logo + CTA + promo code, impression/click analytics card, soft-wall
  for Free tier at 1 branded sponsor. See original plan in "Advanced
  POIs" below.
- **Live-status POIs** (~1.5 weeks target, shipped) — volunteer
  status reporting via `/v/:token`, realtime `postgres_changes`
  subscription, colored status dots on public markers, status history
  log, Pro-gated.
- **Event Ops Center** (new surface, not in original roadmap) — a
  Pro-gated `/dashboard/events/:id` page that consolidates live
  volunteer statuses, scouted-marker review, analytics, and a unified
  activity feed. Driven by
  [prd_organizer_experience.md](prd_organizer_experience.md); started
  splitting organizer tooling off the public views so runners /
  spectators stay map-first.
- **Audit-driven polish pass** — full PM / Copy / Interaction /
  Synthesis agent audit surfaced ~20 fixes (terminology unification,
  touch targets, cold-stranger copy rewrites, click/dblclick race,
  delete/undo race, autosave tooltip state, volunteer haptic +
  sticky mini-header, waitlist capture replacing dead Stripe CTAs).
  All shipped.

**Focus now:** polish existing surfaces + close Stripe loop. No new
headline features until we have a paying customer or a clear signal
from usage that one would earn the investment.

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

- [x] **Billing schema migration.** Shipped — `events.paid_at`,
  `events.stripe_session_id`, `events.stripe_payment_id` all live.
  `public_events` view reads `paid_at IS NOT NULL` as canonical.
- [x] **Stripe integration — code complete.** All 9 edge functions
  deployed (`create-checkout`, `list-charges`, `get-receipt`,
  `get-payment-method`, `open-billing-portal`,
  `detach-payment-method`, `apply-promo`, `remove-promo`,
  `stripe-webhook`). Billing page at `/billing` is built. Promo
  code flow works. **Still blocked on the business bank account —
  `PAYMENTS_LIVE = false` in UpgradeModal, and every paid CTA now
  captures email to `pro_waitlist` instead of calling dead Stripe.**
  The day the bank clears: set `STRIPE_SECRET_KEY` +
  `STRIPE_PRICE_ID` + `STRIPE_WEBHOOK_SECRET` in Supabase, flip
  `PAYMENTS_LIVE = true`, redeploy frontend. Email the waitlist.
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
- [x] **Block clicks during snap.** `isSnappingRef` gate on the click
  handler to prevent race conditions when Mapbox Directions API is
  in-flight. Ref resets in all error paths (finally blocks).
- [x] **Route clear undo toast.** Snapshots waypoints, routeCoords,
  finished state, and auto start/finish POIs. Restores all on undo.
- [x] **Finish route button.** "Finish route" in the topbar after 3+
  waypoints as an alternative to double-click.
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
- [x] **Sitemap from `public_events`.** Free SEO traffic to every
  published event. Edge function + robots.txt already deployed.
- [x] **Email capture on spectator view.** `event_subscribers` table
  + `SubscribeButton` component live on runner view, spectator view,
  and event ended page. Source attribution tracks conversion by surface.
- [x] **Bulk cleanup migration.** No legacy base64 data remains —
  normal editor saves already materialized all images. Orphaned
  storage files on event delete deferred until scale warrants it.

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

- [x] **Sponsor POIs — done right (revenue story).** Shipped.
  `RoutePoi.sponsor: { logoUrl, logoDataUrl, brandColor, ctaText,
  ctaUrl, promoCode }` nested on POIs (no migration). Branded marker
  with logo + "SPONSORED" pill, ad-unit popover with copyable promo,
  three analytics events (`sponsor_impression`, `sponsor_click`,
  `sponsor_promo_copied`) rolled into a Sponsors card in the
  analytics sheet + Ops Center. Soft-wall on Free: overflow sponsors
  render as generic ⭐, organizer sees amber "Showing as a generic
  pin publicly" hint in the editor. **Not yet shipped:** CSV bulk
  import (deferred — not worth it until sponsors actually ask).

- [x] **Live-status POIs (differentiation story).** Shipped.
  `poi_statuses` + `poi_status_history` tables live, reused the
  pre-existing `poi_volunteer_tokens` (purpose='status' was
  pre-scaffolded). Event-wide tokens for v1 (simpler than per-POI);
  `/v/:token` page with giant Open/Low/Closed/Moved buttons, name
  capture, haptic on submit, sticky mini-header when editing,
  optimistic updates + rollback, offline resilience inherited from
  scout path. Public map renders colored status dots via
  `postgres_changes` subscription. Simplified public popover per PRD
  — state pill + short note only, organizer metadata moved to Ops
  Center. **Not yet shipped:** per-POI token scoping (deferred to
  v2), status history timeline in analytics (next item in polish
  pile), `moved_to` coordinate flow + ghosted original pin, rate
  limits per token.

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

### Organizer-to-subscriber messaging

**Status:** Next-in-line once we have a paying customer or a clear
usage signal. Scoped below; hold on implementation until polish pile
is drained. When Stripe unblocks and the first paid event ships, this
is the natural retention lever to build next.

The `event_subscribers` table already collects email addresses across
three surfaces (runner view, spectator view, event ended page). This
plan turns that list into a communication channel organizers control.

- [ ] **Email provider integration.** Connect a transactional email
  service (Resend, Postmark, or SendGrid) via Supabase edge function.
  Single `send-event-update` function that accepts `eventId`, `subject`,
  `body` (plain text + simple HTML), validates the caller owns the
  event, queries `event_subscribers` for that event (excluding
  `unsubscribed_at IS NOT NULL`), and sends in batch. Rate-limit:
  max 1 send per event per 24h to prevent spam. Hereday-branded
  template with event name, organizer's logo, and unsubscribe link.

- [ ] **Unsubscribe flow (legally required).** Signed-token URL in
  every email footer → `/unsubscribe/:token` page that sets
  `unsubscribed_at` on the `event_subscribers` row. No login required.
  Edge function to generate + verify HMAC tokens from
  `(subscriber_id, event_id)`. Must ship before or with the first
  send — CAN-SPAM / GDPR non-negotiable.

- [ ] **Dashboard compose UI.** "Send update" button on each event
  card (or in event detail panel). Opens a compose dialog: subject
  line, body textarea with markdown preview, subscriber count shown,
  confirm step before send ("This will email X subscribers"). Show
  send history with timestamps so organizers know what they've sent.

- [ ] **Pro gating.** Free events: collect subscribers (already works),
  view count on dashboard (already works), but cannot send. Pro events:
  full send capability. This makes subscriber messaging a Pro
  differentiator — organizers collect emails for free, but need Pro
  to actually reach them. Pitch: "Your participants already signed up.
  Upgrade to talk to them."

**Use cases:** course changes before race day, weather alerts, post-race
photo gallery announcements, "registration for next year is open",
sponsor shoutouts. Each of these is a reason for the organizer to come
back to Hereday between events — retention, not just activation.

**What to watch:** deliverability reputation (start with a verified
sending domain on hereday.io), bounce handling (mark hard-bounced
addresses), and abuse prevention (rate limits + content review if
volume grows).

## Polish pile — the current focus (2026-04-18 → first paying user)

Agreed with Kevin: **no new headline features until we have a paying
customer or clear usage signal.** The existing product is already
broader than most solo-founder SaaS at this stage; the leverage is in
tightening what's here, not adding more doors.

This section absorbs the remainder of the PM / Copy / Interaction
audit backlog plus deferrals from recent PRs. Order is rough — grab
what matches the mood.

### Quality of life (existing surfaces)
- [ ] **Editor thin-sidebar-rail** — today sidebar toggles between
  full width and hidden. 40px rail with section icons (Routes /
  Markers / Branding / Basemap) lets organizers keep map width while
  still seeing context. (Interaction P1)
- [ ] **Universal Escape handler in editor** — dismissal inconsistent
  across Share popover, Live popover, Shortcuts overlay, pending POI
  mode. One window-level listener with priority ordering.
- [ ] **Volunteer page keyboard-push fix polish** — sticky mini-header
  shipped; still worth adding a small "Saved" visual between the
  action and the row closing for haptic confirmation parity.
- [ ] **Signup microcopy tightening** — Copy agent flagged a few P2
  lines ("Check your email to verify — you can start building" splits
  two ideas). Minor, drive-by.
- [ ] **Signup password strength meter** — prior audit item (F-line),
  still open. Premium SaaS bar.
- [ ] **Snap-to-roads dashed-line fallback per-segment** — shipped a
  destructive toast for visibility; the premium fix is tracking
  failed segment indices and rendering them dashed in the route's
  own color. Medium effort.

### Deepen Ops Center (PRD v2 items)
- [ ] **Status history timeline card** — full `poi_status_history`
  timeline with filters by marker / volunteer / date range. Table is
  live and growing; frontend view not built.
- [ ] **Subscriber list view** — who's subscribed, source attribution,
  organizer can unsubscribe anyone. `event_subscribers` + source
  column already exist.
- [ ] **Organizer status override** — let organizer set a marker's
  status directly from Ops Center, not only via the volunteer link.
  Useful when volunteers flake or connectivity drops.
- [ ] **Volunteer roster** — named volunteers per event, assign to
  markers, see who's been active vs silent. Lightweight; could be a
  JSON column on events or a new small table.
- [ ] **Export race-day ops sheet** — single-page printable PDF with
  every marker's current status for the race director's clipboard.
  Reuses the `generateRaceDayChecklist` pattern.

### Delight tier (cheap wins that make it feel premium)
- [ ] **Confetti on first publish** — in progress (handled by Claude
  Design, not me).
- [ ] **Cursor trail while drawing a route** — Strava-web pattern.
  Tiny canvas overlay above Mapbox.
- [ ] **Live pulse on Volunteer page header** — postgres_changes is
  wired but nothing on-screen says "live." 1.5s pulse on the radio
  icon, costs nothing.
- [ ] **Marker drop-in sound effect** (first placement per session) —
  the animation shipped; soft tap SFX for the first one of a session
  would round it out.
- [ ] **Live pill inner glow** — static green pill → 2-second inner
  glow cycle for subtle signal that the event is alive.
- [ ] **Drag-drop reorder slide animation in route sidebar** — rows
  currently jump; a 150ms transform ease would feel Apple-level.

### Infra + correctness
- [ ] **Re-deploy scout rate-limit logic** — `submit-scouted-poi` v2
  is live with the new table but keep an eye on whether the legacy
  array-scan fallback ever fires in logs.
- [ ] **Activity feed polling → realtime** — currently polls every
  30s. When it's clear volume doesn't swamp the realtime channel,
  swap to `postgres_changes` on `poi_status_history` + `event_subscribers`.

---

## Parking lot — don't build until a paying user asks

- Native runner app (PWA or Expo) — solves background GPS, permission
  friction, and screen-lock killing `watchPosition` in Safari. Scope
  to runner tracking only; organizer tools and spectator view stay web.
  Build once live tracking is driving Pro upgrades.
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
