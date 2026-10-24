# supabase/

Migrations, edge functions and the PGlite test harness for Hereday's
single Supabase project. There is no staging database: every migration
lands on prod, so run `npm run test:db` before applying one.

## Grants on new tables

Since 2026-10-30, Supabase gives no automatic Data API access to tables or
sequences created in `public` ([changelog 45329]). Tables created before
then keep their grants. A table created after that date can't be reached by
supabase-js, PostgREST or the edge functions until its migration grants
access. The error is `permission denied`, even for `service_role`, which
bypasses RLS but not grants.

Every migration that creates a table in `public` grants access in the same
file, only to the roles that use it and only for the commands they use:

```sql
CREATE TABLE public.things (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ...
);
ALTER TABLE public.things ENABLE ROW LEVEL SECURITY;
CREATE POLICY ... ;

-- Edge functions and server scripts: always.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.things TO service_role;
-- Signed-in app: only the commands it has a policy and a caller for.
GRANT SELECT, INSERT ON public.things TO authenticated;
-- Signed-out: only for a public flow, and extend
-- tests/anon_least_privilege.check.mjs with the new grant.
-- GRANT SELECT ON public.things TO anon;
```

- **`service_role` always gets grants.** Edge functions use it, and
  `tests/data_api_grants.check.mjs` fails if any table, view or sequence
  in `public` is unreachable by it.
- **`authenticated` gets only the commands the app uses.** RLS decides
  which rows; the grant decides which commands are possible at all, so a
  missing policy can't be opened later by a stray one (see
  `20261014150000_anon_least_privilege.sql`).
- **`anon` gets nothing by default.** That has been true since
  2026-10-14, before Supabase's change.
- **Sequences.** Prefer `GENERATED ... AS IDENTITY` or UUID keys, which
  need no sequence grant. A `SERIAL`/`BIGSERIAL` column needs
  `GRANT USAGE, SELECT ON SEQUENCE public.<table>_<col>_seq` for every role
  that inserts.
- **Views** in `public` also need explicit grants. Grant `SELECT` only.

`tests/pglite.mjs` replays Supabase's switch before the first migration
dated `20261030000000` or later. A migration that leaves out its grants
fails its own behaviour check there, not in prod.

Tables created before the cutoff rely on the old default grants. Rebuilding
the schema from these files on a fresh project (a new project, a preview
branch or `supabase db reset`) would leave them unreachable. Add a catch-up
grant migration before doing that.

[changelog 45329]: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
