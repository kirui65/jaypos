# Project Progress

Last updated: 2026-11-23

## Current state

- **Approved scope:** Phase 1, milestones M1–M8. M1–M4 are complete; resume at **M5: Sales and shifts**. The existing approval covers the planned milestones; do not restart at M1.
- **Source of truth:** `/docs/SPEC.md`. `/SPEC.md` and `/docs/SPEC.md` currently contain identical copies. Preserve both unless asked to change them.
- **Latest implementation commit:** `b4c45ee` — `feat: add catalog management`.
- **Working tree:** Supabase database decision documentation is being updated; the two original spec files remain untracked and were not included in the M1 commit.

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

## Completed: M3 — Catalog

- Added authenticated staff catalog reads and admin-only catalog create/edit endpoints for departments, product types and attribute templates, brands, products, variants, and bundles.
- Product creation accepts multiple variants for size/colour grids, validates configured attribute requirements and shop ownership, and supports perfume bulk/decant links.
- Added dedicated tester variant representation. Tester stock is hidden from staff and returned separately to admins; tester variants cannot be marked sellable.
- Catalog writes are audited. Staff serialization excludes cost fields; automated coverage checks staff and admin output.
- Added variant image and tester fields plus the `catalog.manage` permission in a database migration.

## M3 checks

- `corepack pnpm test` — passed, 15 tests (API tests required permission to bind a local port).
- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm format:check` — passed.
- Prisma schema validation — passed.
- **Not run:** applying the M3 migration; configure `DATABASE_URL` with the Supabase PostgreSQL connection string before applying migrations.

## Completed: M4 — Stock ledger

- Added staff stock and movement reads with cost price omitted from staff responses.
- Added admin-only batch receipts, adjustments, damage/tester write-offs, opening bulk bottle changes, and stock counts. Each operation updates stock level, appends a movement, and writes an audit record in a serializable database transaction.
- Purchase receipts recalculate weighted average cost; stock and remaining bulk millilitres cannot drop below zero. Sales, refunds, and decant movement types are not available through the manual stock endpoint.
- Added staff damage/tester/count reports and an admin review queue. Submitting/reviewing a report does not change stock; the admin must post a separate stock movement.
- Added the stock report model, permission, and migration.

## M4 checks

- `corepack pnpm test` — passed, 19 tests.
- `corepack pnpm lint` — passed after fixing the type-only import.
- `corepack pnpm typecheck` — passed.
- Prisma schema validation — passed.
- **Not run:** applying the M4 migration; configure `DATABASE_URL` with the Supabase PostgreSQL connection string first.

## Next: M5 — Sales and shifts

Implement shift open/close and cash reconciliation, held carts, idempotent sales, server-calculated totals and discounts, split/cash payments, receipt numbering, and transactional stock deductions for regular, decant, and bundle sales. Keep STK initiation in M6.

## Handoff reminders

- Read `/docs/SPEC.md`, then this file, before continuing implementation.
- Use the approved stack and milestone scope from the user prompt; do not start Phase 2–4 work.
- Use `corepack pnpm` commands when a `pnpm` shim is not available.
- No `.env` or production secrets have been created or committed. The seed generates a one-time admin password if `ADMIN_SEED_PASSWORD` is empty and prints it when creating the initial account.
- Lipwa provider field names and callback verification are still a `TODO(lipwa)`; consult current documentation before M6.
