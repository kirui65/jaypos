# Eminent Jay Engineering Rules

- Read `/docs/SPEC.md` fully before coding; it is the product source of truth.
- Current scope: Phase 1 core POS only. Do not build Phase 2–4 features unless asked.
- Use pnpm workspaces: `apps/web` (React, TypeScript, Vite, Tailwind, TanStack Query, React Router), `apps/api` (Node 20, strict TypeScript, Express, Zod), and `packages/shared` (shared types, schemas, constants, money and phone utilities).
- Use PostgreSQL and Prisma migrations; Docker Compose is for local PostgreSQL. Never commit secrets; maintain `.env.example`.
- Money is integer cents. Validate API input with Zod, use parameterized database access, enforce permissions server-side, and never expose cost/profit to staff.
- Keep stock changes in an append-only ledger and update it transactionally with stock levels. Only admins can perform manual stock changes. Audit important writes.
- Keep external providers behind interfaces with mock implementations. Record assumptions and unresolved questions in `/docs/DECISIONS.md` as `TODO(spec)`.
- Keep changes small, add tests with features, and do not reformat unrelated files.

## Commands

Once workspace scripts exist, use the root scripts:

- `pnpm dev` — run the web and API apps
- `pnpm test` — run Vitest tests
- `pnpm lint` — run ESLint
- `pnpm typecheck` — typecheck all workspaces
- `pnpm format:check` — check Prettier formatting
- `pnpm db:migrate` — apply Prisma migrations
- `pnpm db:seed` — seed local development data

Run the test, lint, and typecheck commands at each milestone; also run format check when relevant.
