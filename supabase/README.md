# Supabase Setup and Usage Guide

For more details, visit the [Elato Supabase Docs](https://www.elatoai.com/docs/blog/database).

## Apply Local Database Updates

Database migrations are versioned in `supabase/migrations`. Pulling new ElatoAI
code does not automatically alter an already-running local database.

Apply pending migrations after pulling a new ElatoAI version:

```sh
supabase start
supabase migration list --local
supabase migration up --local
```

`supabase migration up --local` preserves existing local data, records applied
migration timestamps, and skips them on later runs. For a disposable development
database, `supabase db reset` also applies every migration, but deletes existing
local data first.

## Boson Upgrade

Boson support requires
`supabase/migrations/20260901072000_add_boson_voices.sql`. It updates the
`personalities_provider_check` constraint to allow `boson`. The voice catalog is
defined in the frontend, not in a database `voices` table. The error below means
this migration has not yet been applied to the local database receiving the
request:

```text
new row for relation "personalities" violates check constraint
"personalities_provider_check"
```

Run `supabase migration up --local` from the repository root to apply it.

## Hosted Supabase

Only self-hosters with a separate hosted Supabase project need to apply the same
migrations remotely:

```sh
supabase login
supabase link --project-ref <your-project-ref>
supabase db push --dry-run
supabase db push
```
