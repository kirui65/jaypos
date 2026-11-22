# Project Progress

Last updated: 2026-11-22

## Current state

- **Approved scope:** Phase 1, milestones M1–M8. M1 and M2 are complete; resume at **M3: Catalog**. The existing approval covers the planned milestones; do not restart at M1.
- **Source of truth:** `/docs/SPEC.md`. `/SPEC.md` and `/docs/SPEC.md` currently contain identical copies. Preserve both unless asked to change them.
- **Latest implementation commit:** `HEAD` — `feat: add authentication and staff management`.
- **Working tree:** implementation is committed. The two original spec files are untracked in this checkout; they were not included in the M1 commit.

## Completed: M1 — Foundation

- pnpm workspace scaffold: `apps/web`, `apps/api`, and `packages/shared`.
- React/Vite/Tailwind/TanStack Query/React Router web starter; Express/Zod API starter with `GET /health`.
- PostgreSQL Docker Compose configuration, Prisma schema and initial SQL migration for the core business tables, and an idempotent sample seed script.
- Seed creates the Eminent Jay shop, `admin` and `staff` roles, permissions, an admin account, Men/Ladies/Children departments, sample perfumes/cosmetics/clothing variants, and opening stock movements.
- Shared integer-cent money helpers, Kenyan mobile normalization, Zod schemas, and constants.
- Root instructions, README, Phase 1 plan, decisions log, `.env.example`, and workspace scripts are present.

## M1 checks

- `corepack pnpm test` — passed, 8 tests.
- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm format:check` — passed.
- `corepack pnpm build` — passed for API and web.
- Prisma schema validation — passed.
- **Not run:** applying migrations or running the seed against PostgreSQL. Docker is not installed and nothing is listening on `localhost:5432` in the current environment. Recheck this once Docker/Postgres is available.

## Local preview

The M1 development servers were started with `corepack pnpm dev`:

- Web: `http://localhost:5173/`
- API health: `http://localhost:3001/health`

Both responded successfully at last check. If the processes are no longer running in a new session, restart with `corepack pnpm dev`. The web page is only the foundation placeholder; the POS interface is planned for M8.

## Next: M2 — Authentication and staff management

Implement login/logout, password-change enforcement, PIN unlock, rate limiting/lockout, server-side permission middleware, admin-only staff management, archival/deletion rules, last-admin protections, audit entries, and permission tests. Follow the detailed acceptance criteria in `/docs/PHASE1_PLAN.md` and record decisions in `/docs/DECISIONS.md`.

At the end of M2, run tests, lint, typecheck, and formatting check; fix failures; create a focused commit; then update this progress file with the new state and next milestone.

## Handoff reminders

- Read `/docs/SPEC.md`, then this file, before continuing implementation.
- Use the approved stack and milestone scope from the user prompt; do not start Phase 2–4 work.
- Use `corepack pnpm` commands when a `pnpm` shim is not available.
- No `.env` or production secrets have been created or committed. The seed generates a one-time admin password if `ADMIN_SEED_PASSWORD` is empty and prints it when creating the initial account.
- Lipwa provider field names and callback verification are still a `TODO(lipwa)`; consult current documentation before M6.

## Completed: M2 — Authentication and staff management

- Added opaque 256-bit server sessions, stored as SHA-256 token hashes, in HttpOnly SameSite cookies with an 8-hour expiry and revocation.
- Added username/email login, logout, current-user lookup, forced password changes, own PIN setup/change and PIN unlock, failed-login/PIN logging, and a five-failure/15-minute lockout per identifier and IP.
- Added configured-origin CORS and unsafe-request origin checks, security headers, and default authentication for API routes.
- Added server-side role permission checks and staff-only permission-removal overrides. Staff management endpoints support create, edit, force logout, password/PIN reset, activation/deactivation, and hard-delete versus archive based on account history. Staff operations are audited; staff endpoints cannot target admin accounts.
- Added database migration for auth sessions and login-attempt records, plus permission/auth route tests.

## M2 checks

- `corepack pnpm test` — passed, 13 tests.
- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm format:check` — passed.
- Prisma schema validation — passed.
- **Not run:** applying the M2 migration. Docker is unavailable and nothing is listening on `localhost:5432`; retry when PostgreSQL is available.

## Next: M3 — Catalog

Implement configurable departments and product types, attribute templates, products and variants, size/colour grids, perfume decant links, bundles, tester stock representation, and staff-safe serialization. Follow the acceptance criteria in `/docs/PHASE1_PLAN.md`; keep M4 stock mutations out of scope. At milestone end, run the required checks, create a focused commit, and update this file.
