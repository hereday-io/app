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

## Next — "make it come back" (next 2 months)

Seasonal SaaS dies if users don't return. Optimize for the returning
organizer.

- [x] **Duplicate-from-last-year** as a first-class dashboard action.
  Race organizers run the same event annually — this is the #1
  retention lever. Auto-increment year, reset to draft.
- [ ] **QR code in share popover.** Needs a QR library (`qrcode` is
  the obvious pick, ~15kb). Race-day signage → public page → funnel.
- [ ] **Open Graph tags per event.** `og:image` = route thumbnail,
  `og:title`, `og:description`. Note: SPA means crawlers without JS
  won't see these; plan for SSR or static prerender later.
- [ ] **Sitemap from `public_events`.** Free SEO traffic to every
  published event.
- [ ] **Email capture on spectator view.** Collect addresses before
  you build notifications. `event_subscribers(event_id, email)`.
- [ ] **Bulk cleanup migration.** Legacy base64 POI images + orphaned
  logo files in storage buckets. Flagged in the DB audit.

## Later — "make it sticky" (3-6 months, after Tier 0 is done)

Differentiation. Only start once revenue is real.

- [ ] **PostGIS migration.** Dual-write normalized `routes`/`pois`
  tables with `geography` columns. Prerequisite for everything below.
- [ ] **Live tracking MVP.** Opt-in participants share location to
  spectators. `tracking_pings` time-series table.
- [ ] **Checkpoints + splits** tied to live tracking.
- [ ] **Sponsor placements.** Paid marker slots + discount codes.
  Potential new revenue line beyond event fees.
- [ ] **`/discover` page** with spatial queries ("events near me").

## Parking lot — don't build until a paying user asks

- Notifications / push
- Multi-day events
- Teams / organizations (multi-admin)
- Race timing integration
- Turn-by-turn voice navigation
- "Advanced POIs" (scope was never defined — delete from wishlist)

---

## Observability principle

Every feature above should ship with one or more events logged to
`product_events`. "Did this feature get used" is a question we should
always be able to answer from SQL, not from guesswork.

---

## Archive: original phase-based roadmap

Kept for posterity. Phases 1 and 2 are substantially done; Phase 3 is
half-done (gating works, checkout doesn't); Phases 4 and 5 are not
started. Course elevation from Phase 5 actually shipped in Phase 1.

<details>
<summary>Original phases</summary>

### Phase 1: Core MVP Polish
- Route editor stability ✅
- POI creation + editing ✅
- Public map UI polish ✅
- Start/finish clarity ✅
- Legend improvements ⚠️
- Publish flow clarity ✅

### Phase 2: Premium Experience
- Branding (logo, colors) ✅
- Better public page layout ✅
- Shareable event pages ✅
- Improved mobile UX ✅

### Phase 3: Monetization
- Free vs paid tier gating ⚠️ (gating done, checkout missing)
- Branded maps (paid) ✅
- Advanced POIs ❌ (unscoped)
- Multi-route enhancements ✅

### Phase 4: Growth + Differentiation
- Sponsor POIs ❌
- Sponsor offers/discounts ❌
- QR / on-site engagement ❌
- Shareability improvements ❌

### Phase 5: Advanced Features
- Live tracking ❌
- Checkpoints ❌
- Notifications ❌
- Course elevation ✅ (already shipped in P1)
- Multi-day events ❌

</details>
