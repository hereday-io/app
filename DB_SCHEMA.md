# DB_SCHEMA.md

Canonical description of the Hereday Supabase schema as it actually
exists in production. If this file and the migrations disagree, the
migrations win — update this doc.

## Philosophy

- Keep schema simple while the product is finding shape.
- One event = one document. Routes and POIs are JSONB arrays on the
  `events` row, not separate tables. The editor loads and saves the
  whole event in one round-trip.
- Denormalize now, normalize when the product demands it. PostGIS and
  dedicated `routes` / `pois` tables are planned but not built — see
  "Known gaps" at the bottom.
- RLS is the security boundary. Every table has it enabled.

---

## Tables

### `profiles`

One row per authenticated user, created automatically by the
`handle_new_user` trigger on `auth.users` insert.

| Column              | Type           | Notes                                       |
| ------------------- | -------------- | ------------------------------------------- |
| `id`                | uuid PK        | Synthetic. Kept for legacy reasons.         |
| `user_id`           | uuid UNIQUE    | FK → `auth.users(id)` ON DELETE CASCADE     |
| `display_name`      | text           | Defaults to the email localpart on signup.  |
| `organization_name` | text           | Free text, not a FK. No multi-user orgs.    |
| `avatar_url`        | text           |                                             |
| `is_paid`           | boolean        | Account-wide paid flag. No billing metadata.|
| `created_at`        | timestamptz    |                                             |
| `updated_at`        | timestamptz    | Maintained by trigger.                      |

**RLS:** users can SELECT / INSERT / UPDATE only their own row
(`auth.uid() = user_id`).

### `events`

The top-level entity. Everything an organizer builds in the editor
lives on this row — including the full route geometry and POI list as
JSONB arrays.

| Column           | Type                | Notes                                                       |
| ---------------- | ------------------- | ----------------------------------------------------------- |
| `id`             | uuid PK             |                                                             |
| `user_id`        | uuid NOT NULL       | FK → `auth.users(id)` ON DELETE CASCADE                     |
| `name`           | text NOT NULL       |                                                             |
| `city`           | text                | Free text display value. No coordinates.                    |
| `event_date`     | date                | No timezone.                                                |
| `status`         | text NOT NULL       | CHECK (`draft` or `published`). Default `draft`.            |
| `slug`           | text UNIQUE         | Globally unique. App appends a random suffix to avoid collisions. |
| `routes`         | jsonb NOT NULL      | `EventRoute[]` — see `src/types/mapEditor.ts`. Default `[]`.|
| `pois`           | jsonb NOT NULL      | `RoutePoi[]`. Default `[]`.                                  |
| `route_count`    | integer NOT NULL    | Denormalized counter. Maintained by the editor's save path. |
| `poi_count`      | integer NOT NULL    | Same.                                                       |
| `logo_url`       | text                | Public URL in the `event-logos` storage bucket.             |
| `branding_style` | text NOT NULL       | App-layer values: `none` / `corner` / `banner` / `both`. Not enforced at DB level. |
| `created_at`     | timestamptz         |                                                             |
| `updated_at`     | timestamptz         | Trigger-maintained.                                         |

**Indexes:**

- PK on `id`
- UNIQUE on `slug`
- `events_user_updated_idx` on `(user_id, updated_at DESC)` — dashboard query
- `events_slug_published_idx` partial on `(slug) WHERE status='published'` — public page lookup

**RLS policies on `events`:**

- Owners: full CRUD (`auth.uid() = user_id`)
- `anon` role: SELECT on rows where `status = 'published'`, but direct
  anon access is only used *through* the `public_events` view below.
  Never `SELECT *` from `events` in anon-facing client code — it leaks
  `user_id` and other owner-only columns. Use the view.

### `public_events` (view)

Column-filtered view over `events` for anonymous readers. Created in
the db-audit-hardening migration. Has `security_invoker = true` so RLS
on the underlying table still applies.

Exposed columns: `id`, `name`, `slug`, `city`, `event_date`, `routes`,
`pois`, `route_count`, `poi_count`, `logo_url`, `branding_style`,
`updated_at`.

Notably **not** exposed: `user_id`, `status`, `created_at`. The view
already filters `WHERE status = 'published'`, so callers don't need the
status column.

All public-page client reads must go through `public_events`, not
`events`. See `src/pages/EventPublic.tsx` for the reference pattern.

---

## JSONB shapes

These live inside `events.routes` and `events.pois`. They are defined
by the TypeScript types in `src/types/mapEditor.ts` — the DB does not
enforce shape.

### `EventRoute` (entry in `events.routes`)

```ts
{
  id: string;                        // client-generated UUID
  name: string;                      // e.g. "5K"
  color: string;                     // hex
  visible: boolean;
  waypoints: [number, number][];     // [lng, lat] click points
  routeCoords: [number, number][];   // [lng, lat] snapped polyline
  segmentCoordCounts?: number[];     // enables precise undo
}
```

### `RoutePoi` (entry in `events.pois`)

```ts
{
  id: string;
  type: 'start' | 'finish' | 'water' | 'medical' | 'registration'
      | 'sponsor' | 'parking' | 'restroom' | 'aid-station' | 'custom';
  title: string;
  description: string;
  coordinates: [number, number];   // [lng, lat]
  imageUrl?: string;               // poi-images bucket public URL
  webLink?: string;
  imageDataUrl?: string;           // LEGACY base64, never written to DB post-migration
}
```

**`auto-start-*` / `auto-finish-*` POI IDs** are computed from the
first/last coordinate of each route and injected into the POI array by
the editor. They're persisted, though ideally they'd be derived on
read. Leave them for now.

**POI images:** the editor may hold a freshly pasted file as a base64
`imageDataUrl` in memory for preview. The save path
(`materializePoiImages` in `RouteEditor.tsx`) uploads any such POI to
the `poi-images` storage bucket, sets `imageUrl` to the resulting
public URL, and strips `imageDataUrl` before writing to Postgres.
**Base64 must never land in the DB.** Public views prefer `imageUrl`
and fall back to `imageDataUrl` only for rows written before the
migration.

---

## Storage buckets

### `event-logos`

Public bucket. Path layout: `{user_id}/{filename}`. RLS on
`storage.objects`:

- `SELECT`: public (anyone can fetch a logo URL)
- `INSERT` / `UPDATE` / `DELETE`: only if `auth.uid()::text` matches
  the first path segment — i.e. users can only touch their own folder.

### `poi-images`

Same shape and same policies as `event-logos`. Path layout:
`{user_id}/{event_id}/{poi_id}-{timestamp}.{ext}`. See
`src/lib/poiImageUpload.ts` for the upload helper.

---

## Triggers & functions

- `update_updated_at_column()` — generic `NEW.updated_at = now()`
  trigger. Attached to `profiles` and `events` for `BEFORE UPDATE`.
- `handle_new_user()` — `SECURITY DEFINER` function that inserts a
  `profiles` row on `auth.users` insert. Verify the `CREATE TRIGGER`
  attaching this to `auth.users` is present; the function definition
  alone does nothing.

---

## Known gaps (from the DB audit)

Documented here so future-you doesn't re-discover them.

1. **No PostGIS.** All coordinates live in JSONB as `[lng, lat]`
   tuples. Blocks spatial queries (discovery, "near me," route
   intersection). Planned: enable PostGIS and dual-write to normalized
   `routes` / `pois` tables with `geography` columns.
2. **Denormalized counters.** `route_count` and `poi_count` are
   maintained by the editor save path, not a trigger. Drift is
   possible. Replace with `GENERATED ALWAYS AS (jsonb_array_length(...))`
   or a trigger when moving off JSONB.
3. **`profiles.is_paid` is binary.** Insufficient for real billing —
   no Stripe customer id, no plan tier, no period end. Blocks the
   per-event pricing advertised on the landing page.
4. **No `organizations` table.** Everything is per-user. Adding
   multi-admin orgs will require a new table and a rewrite of every
   RLS policy.
5. **No soft delete.** Deleting an event is a hard cascade. Consider
   `deleted_at` before first real support incident.
6. **`event_date` is `DATE` with no timezone.** Works for display,
   breaks for "is happening now" logic.
7. **`branding_style` is free text.** Should be a CHECK or enum.
8. **Storage cleanup.** Deleting an event does not delete its logo or
   POI images from the buckets. Add a cleanup job.

---

## Migration philosophy

- Add columns instead of rewriting tables.
- Never break an existing reader without a transition period
  (dual-write, then flip reads, then drop).
- Migration filenames: `YYYYMMDDHHMMSS_short-description.sql`.
- All new DDL should ship with the matching RLS policy changes.

---

## Default rule

> "What's the simplest thing that works right now — that we won't
> regret in 6 months?"
