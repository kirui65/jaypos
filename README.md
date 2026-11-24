# Eminent Jay POS

Phase 1 core POS workspace for the Eminent Jay retail shop. Read [`docs/SPEC.md`](docs/SPEC.md), [`AGENTS.md`](AGENTS.md), and [`docs/PHASE1_PLAN.md`](docs/PHASE1_PLAN.md) before development.

## Requirements

- Node.js 20 or newer
- Corepack (to provide the pinned pnpm version)
- Supabase PostgreSQL for the shared/deployed database; Docker Compose PostgreSQL for local development

## Local setup

1. Copy `.env.example` to `.env` and set a development admin password if desired.
2. For local development, start PostgreSQL with `docker compose up -d postgres`. For Supabase, set `DATABASE_URL` to the transaction-pooler connection string (port 6543, with `pgbouncer=true`) and `DIRECT_URL` to the session-pooler connection string (port 5432). Use the database credentials from Supabase's server-side connection settings; never put them in frontend variables or commit them.
3. Install dependencies with `corepack pnpm install`.
4. Generate Prisma Client and apply migrations with `corepack pnpm db:generate` and `corepack pnpm db:migrate`.
5. Seed sample data with `corepack pnpm db:seed`. If no `ADMIN_SEED_PASSWORD` is set, the seed command prints a generated one-time password.
6. Start the applications with `corepack pnpm dev` (web at `http://localhost:5173`, API at `http://localhost:3001`).

For Supabase project linking, managed PostgreSQL connection setup, and migration/security details, see [`docs/SUPABASE.md`](docs/SUPABASE.md). Prisma remains the schema migration tool; the Supabase CLI link is for hosted project management.

## Checks

- `corepack pnpm test`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm format:check`

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for recorded assumptions and unresolved owner questions.
