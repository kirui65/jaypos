# Project Progress

Last updated: 2026-11-24

## N1 UI foundation handoff (2026-11-24)

- Reviewed the N1 implementation in `6a2c318` against the backlog. The fixed shell, role-based sidebar, compact top bar, product cards and placeholders, filters/focus rings, branded login, toast/status treatments, and POS browser assertions were already present; these were left intact.
- The missing public-login audit setup was completed by stubbing `/api/brand` with the shop logo in the public Playwright test. The latest full audit completed with 52 PASS, 6 WARN, and 0 FAIL. Typecheck, lint, tests, and build pass. Updated screenshots cover public login at 360×740, 1024×768, 1280×720, and 1366×768.
- Latest Lighthouse: mobile performance 87, accessibility 100, best practices 96, LCP 815 ms, CLS 0.002, TBT 506 ms (WARN); desktop performance 100, accessibility 100, best practices 96, LCP 295 ms, CLS 0.001, TBT 0 ms.
- **Verification limit:** authenticated admin/staff pages, including POS and sales, were skipped because E2E credentials were not configured. The 1366×768 POS assertions remain in the audit spec, but they were not exercised by this run. API load check was also skipped because no API service was configured.

## Supabase integration handoff (2026-11-23)

- Installed and authenticated the Supabase CLI v3.3.0. The checkout is linked to the owner's active hosted project (`himlzgngxdexksnjycno`); `supabase projects list` confirms it is healthy and linked.
- Added `supabase/config.toml` for repeatable CLI project config. Prisma remains the only migration source; Supabase CLI migrations are disabled in the config to avoid a second schema history.
- Added `docs/SUPABASE.md` with setup, connection, migration, auth, storage, and Data API security guidance. Updated `.env.example` with Supavisor transaction/session pooler formats and TLS settings.
- Added Prisma migration `20261123180000_supabase_api_lockdown` to enable RLS and revoke Data API role grants on all POS tables. The API keeps using its private PostgreSQL connection and enforces app permissions.
- `corepack pnpm build` — passed. Prisma schema validation — passed. Docker is unavailable, so an isolated PostgreSQL 16 cluster was started under `/tmp` for local preview. The ignored local `.env` points to this local database; all Prisma migrations and the sample seed completed there. Supabase connection strings/password are still absent, so hosted migrations and seed remain unapplied.
- Fixed API workspace scripts to load the repo-root `.env` using `DOTENV_CONFIG_PATH`/`dotenv/config`; `dev`, Prisma generate/migrate, and seed commands now use the documented root env file.
- Local preview is running at `http://localhost:5173/` with API health at `http://localhost:3001/health`. Local admin and cashier demo accounts were created and both login requests returned HTTP 200. Their temporary passwords are intentionally not stored in this handoff.
- Supabase Auth, Storage, and Realtime are not wired into the app: Phase 1's source of truth requires Express sessions/roles, and there is no image upload feature. Do not expose Supabase service credentials in the web app.

## UI audit handoff (2026-11-23)

The requested UI audit/craft pass is in progress. Do not treat the mobile Lighthouse checks as passing yet.

- Audit entry point is now `scripts/audit.sh`; the browser spec is `apps/web/e2e/ui-audit.spec.ts`. The original root-level `audit.sh` and `ui-audit.spec.ts` were present as untracked files at session start and were left untouched.
- Read `docs/UI_CHANGELOG.md` and `docs/UI_DECISIONS.md` for changes and intentional/environment-dependent warnings.
- Design tokens now live in `apps/web/src/tokens.css`. POS cards expose `data-testid="product-card"` and cart lines expose `data-testid="cart-line"`.
- Browser audit dependencies `@playwright/test`, `@axe-core/playwright`, and `lighthouse` were added to root devDependencies. Chromium was installed in the local Playwright cache.
- `bash scripts/audit.sh` after the latest performance changes completed with typecheck, lint, tests, build, static UI checks, desktop Lighthouse, and Playwright/axe passing. Mobile performance is 72 (minimum 85) and TBT 1,966 ms (maximum 200 ms), so both mobile checks still fail. Mobile LCP is 870 ms and CLS is 0.000; desktop performance is 100. The browser E2E run passed and saved phone/tablet/desktop public login screenshots. The audit needed local port access and was run with approval.
- Remaining WARNs: the dashboard chart's data-driven inline height (documented as intentional), API load check skipped because no API service is configured, and logged-in admin/staff audits skipped because no database/API credentials are configured.
- Screenshot files are in `audit/screenshots/`. `before-*` are from the audit immediately before the last mobile performance optimization; `public-*-home.png` are the most recent after screenshots.
- The app now serves the login as semantic static HTML with a small native fetch bootstrap. React is dynamically imported only when a session exists or login succeeds, and `/sw.js` is registered after authentication. The Noto Sans preload was removed. Latest mobile run shows 301 ms script evaluation, but TBT rose to 1,966 ms with large style/layout and unattributed tasks; score is 72. The run before the static login change scored 76 with TBT 1,075 ms, so results remain variable and both mobile targets are unpassed. Latest report: `audit/lh-mobile.json`.
- The PWA virtual registration import was tried and rejected because the build lacked its `workbox-window` runtime dependency. The final implementation uses native `navigator.serviceWorker.register`; direct native registration has been verified by production build and the audit's browser checks.

Resume by reading this handoff and the UI docs, then inspect the remaining style/layout and unattributed long tasks in Lighthouse's trace. Run `bash scripts/audit.sh` after each performance change. Preserve the current screenshots and unrelated pre-existing working-tree edits. Do not claim zero FAILs until mobile Lighthouse performance and TBT pass.

## Current state

- **Approved scope:** Phase 1, milestones M1–M8 are implemented. The existing approval covers the planned milestones; do not restart at M1.
- **Source of truth:** `/docs/SPEC.md`. `/SPEC.md` and `/docs/SPEC.md` currently contain identical copies. Preserve both unless asked to change them.
- **Latest implementation commit:** `0d8d747` — `feat: build responsive POS and admin frontend`.
- **Working tree:** M1–M8 implementation is committed; the two original spec files remain untracked and were not included in the M1 commit.

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

Start with `corepack pnpm dev`:

- Web: `http://localhost:5173/`
- API health: `http://localhost:3001/health`
- Development design system: `http://localhost:5173/design`

The web app requires an available PostgreSQL database and seeded shop/admin data for sign-in and API-backed screens.

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

## Completed: M5 — Sales and shifts

- Added seller-owned shift open/current/close flows, audited cash in/out, and transactional close reconciliation for expected cash, manual M-Pesa, card, counted cash, and variance. A database partial unique index prevents multiple open shifts per seller.
- Added held cart create/list/resume endpoints. Carts store variant IDs and quantities; sale prices are always recalculated by the server.
- Added idempotent `POST /api/sales` keyed by `client_uuid`, an atomic per-shop receipt counter, server-owned variant prices/costs, discount limits/reasons, cash change, split cash/manual M-Pesa/card payments, and staff-safe sale serialization.
- Completed sales, sale items/payments, stock-level changes, stock ledger movements, and audit entries are committed in one serializable transaction. Regular variants, bundle components, bottle quantities/ml, and decants use conditional stock deductions to prevent overselling. M-Pesa manual payments remain pending verification. STK is deferred to M6.
- Added math, stock demand, staff cost-redaction, and shift cash reconciliation tests.
- **TODO(spec):** sales tax currently remains zero until VAT treatment is confirmed. Until configured, discounts require a reason unless a shop threshold is set.

## M5 checks

- `corepack pnpm test` — passed, 26 tests.
- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm format:check` — passed.
- Prisma schema validation — passed.
- **Not run:** applying the M5 migration; configure `DATABASE_URL` with the Supabase PostgreSQL connection string first.

## Completed: M6 — Payments

- Added a provider interface with mock and Lipwa adapters, documented Lipwa request/status fields, bearer authentication, and whole-KES amount conversion. STK initiation records the provider request and remains pending until the authenticated Lipwa status query confirms payment.
- Added callback notifications verified through Lipwa status queries, status polling and 90-second expiry, manual status checks, amount/phone/receipt mismatch handling, payment and sale audits, and an admin unmatched-payment queue. Pending STK sales deduct stock only after confirmed payment; late stock conflicts are accepted and flagged for review.
- Added the unmatched-payment migration, environment examples, and provider contract tests.
- **TODO(lipwa):** configure credentials, channel, and public callback URL, then verify the merchant account and live minimum-value transaction before production.

## M6 checks

- `corepack pnpm test` — passed, 29 tests.
- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm format:check` — passed.
- Prisma schema validation — passed.
- **Not run:** applying the M6 migration; configure the Supabase `DATABASE_URL` first.

## Completed: M7 — Refunds and receipts

- Added staff refund requests limited to their sales, server-calculated return amounts and quantities, cumulative paid/sold limits, and admin approval or rejection with audit records.
- Approval can return items to sellable stock transactionally or record them in a separate damaged-stock balance. Restocks append stock movements. Exchanges can link the refund to a completed replacement sale.
- Added an admin damaged-stock view and audited receipt reprints in black-and-white thermal HTML (58/80 mm) and PDF with Nairobi time, item/payment details, M-Pesa receipt codes, and a visible COPY mark.
- Added migrations for exchange links and damaged-return balances.

## M7 checks

- `corepack pnpm test` — passed, 29 tests.
- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm format:check` — passed.
- Prisma schema validation — passed.
- **Not run:** applying M6–M7 migrations; configure the Supabase `DATABASE_URL` first.

## Completed: M8 — Frontend

- Added self-hosted Noto Sans and Noto Serif fonts with license text, CSS design tokens, Tailwind token mappings, accessible focus/status treatments, and responsive Eminent Jay login, role-based navigation, POS and admin layouts. `/design` is available only in Vite development mode.
- Added sign-in, forced password change, sign-out, role and permission-gated screens, and authenticated API requests using the server session cookie.
- Built the responsive POS with product search/type/department filters, quantity-aware stock availability for regular, decant, bulk, and bundle items, cart hold/resume, cash/change, M-Pesa STK, split cash/STK, status polling, and a development-only mock payment completion control.
- Connected shift open/cash movement/close and reconciliation summaries; sales history, refund requests/review, 58/80 mm receipt printing and PDF; staff creation/activation, catalog creation, stock lookup/adjustment, damaged stock, owner overview, and unmatched-payment reconciliation.
- Added server protection for the development mock-payment completion action. Admin screens are hidden from staff navigation and guarded on direct routes; server permissions remain authoritative.

## M8 checks

- `corepack pnpm test` — passed, 29 tests.
- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm format:check` — passed.
- `corepack pnpm build` — passed for API and web; PWA shell generation completed.
- **Not run:** browser end-to-end sign-in/sale/refund flow or applying the M6–M7 migrations. Both require a configured Supabase `DATABASE_URL` and seeded database.

## Handoff reminders

- Read `/docs/SPEC.md`, then this file, before continuing implementation.
- Use the approved stack and milestone scope from the user prompt; do not start Phase 2–4 work unless asked.
- Use `corepack pnpm` commands when a `pnpm` shim is not available.
- No `.env` or production secrets have been created or committed. The seed generates a one-time admin password if `ADMIN_SEED_PASSWORD` is empty and prints it when creating the initial account.
- Lipwa credentials, channel ID, callback URL, and a live merchant transaction remain a `TODO(lipwa)` before production.
