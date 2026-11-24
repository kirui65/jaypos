# Supabase integration

## What this project uses

- Hosted Supabase PostgreSQL is the production database.
- Prisma is the API's only database client and the source of schema migrations in `apps/api/prisma/migrations`.
- The Express API owns login, sessions, roles, permissions, and database authorization, as required by `docs/SPEC.md`.
- The browser does not connect to Supabase directly. Do not put a database URL, service-role key, or other privileged Supabase secret in a `VITE_*` variable.
- Supabase Auth and Storage are not enabled as application features in this Phase 1 implementation. Product images use URLs; Supabase Storage can be added with an explicit upload feature and bucket policies.

The CLI project link is stored under `supabase/.temp/` and ignored by Git. Each developer links their own CLI after installing it and signing in:

```sh
supabase login
supabase link --project-ref himlzgngxdexksnjycno
```

`supabase/config.toml` is committed for consistent CLI project configuration. Do not use `supabase db push` or `supabase migration` for app tables; that would create a second migration history beside Prisma.

## Connect the API to hosted PostgreSQL

Copy `.env.example` to `.env`, then open the Supabase Dashboard's **Connect** panel for the project and copy the server-side PostgreSQL connection details. URL-encode any reserved characters in the database password.

- `DATABASE_URL` is used by the running API. Use Supavisor transaction mode (port `6543`) with `pgbouncer=true`, `connection_limit=1`, and `sslmode=require`.
- `DIRECT_URL` is used by Prisma schema and migration commands. Use the session pooler (port `5432`) with `sslmode=require`. A direct database host can be used when the environment supports its network requirements.
- Keep both values only in the ignored `.env` file or the deployment secret manager. Never commit them or put them in frontend variables.

Then run:

```sh
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:seed
```

The seed creates the shop, roles, sample catalog, and the initial admin account. Set `ADMIN_SEED_PASSWORD` in `.env` before seeding if you want a known development password; otherwise capture the one-time password printed by the seed command.

## Data API protection

The migration `20261123180000_supabase_api_lockdown` enables row-level security on every POS table and grants no `anon` or `authenticated` access. No client-facing RLS policies are defined because all application reads and writes go through the permission-checked Express API. The API's private PostgreSQL connection is trusted and bypasses RLS as the table owner.

When adding an app table, include RLS enablement and revoke Data API role privileges in that feature's Prisma migration. Never add a broad `USING (true)` policy to POS tables. If direct Supabase client access is introduced later, design least-privilege policies for that specific use first.

## Local development

Docker Compose PostgreSQL remains the default local database. It does not include the Supabase Auth, Storage, or Realtime services. The local Docker database accepts the same Prisma migrations, including the RLS lockdown migration (which skips Supabase role revokes when those roles are absent).

## Current connection status

The Supabase CLI is installed and authenticated on the development machine, and this checkout is linked to project `himlzgngxdexksnjycno`. The project is healthy. The current ignored `.env` points to an isolated local PostgreSQL test database; Supabase connection strings/password have not been added, so migrations and seeding have not been applied to the hosted database.
