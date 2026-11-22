# Eminent Jay POS

Phase 1 core POS workspace for the Eminent Jay retail shop. Read [`docs/SPEC.md`](docs/SPEC.md), [`AGENTS.md`](AGENTS.md), and [`docs/PHASE1_PLAN.md`](docs/PHASE1_PLAN.md) before development.

## Requirements

- Node.js 20 or newer
- Corepack (to provide the pinned pnpm version)
- Docker Compose

## Local setup

1. Copy `.env.example` to `.env` and set a development admin password if desired.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Install dependencies with `corepack pnpm install`.
4. Generate Prisma Client and apply migrations with `corepack pnpm db:generate` and `corepack pnpm db:migrate`.
5. Seed sample data with `corepack pnpm db:seed`. If no `ADMIN_SEED_PASSWORD` is set, the seed command prints a generated one-time password.
6. Start the applications with `corepack pnpm dev` (web at `http://localhost:5173`, API at `http://localhost:3001`).

## Checks

- `corepack pnpm test`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm format:check`

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for recorded assumptions and unresolved owner questions.
