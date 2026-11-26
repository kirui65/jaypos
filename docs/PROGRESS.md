# Project Progress

Last updated: 2026-11-27

## POS discount cap and recorded shift close time (2026-11-27)

- Added a shared 20% maximum discount rule for every sale, including admin sales. The POS now uses a KES slider capped at 20% of the subtotal; staff can still request approval above their personal limit, but approval cannot bypass the global cap. The API checks discount requests and combined line/cart discounts.
- Shift closing continues to use the existing database timestamp, now recorded with the same value in the shift audit entry. The close summary displays the Nairobi closing time, and the admin shift activity lists both opening and closing times.
- Added coverage for the hard discount limit and for persisted/audited shift close timestamps.
- Checks: `corepack pnpm test` passed (59 passed, 4 database-dependent tests skipped); lint, typecheck, and production build passed. The focused POS discount approval browser test passed. The broader `pos-features` browser file still has two catalog checks with stale selectors. `format:check` reports existing formatting drift in 45 files, so no broad reformat was applied.

## Role-specific PIN sign-in and account management (2026-11-27)

- Cashier/staff PINs are exactly four digits; admin PINs are exactly eight digits. Sign-in accepts only the username and role-specific numeric PIN; the temporary-password option and password-based fallback have been removed.
- Admins can edit their own username/password and cashier usernames/passwords from the admin Staff page. Cashier passwords are set at account creation, and password edits preserve the cashier PIN. Account edits are audited and invalidate other sessions.
- New seeded admin accounts receive an eight-digit PIN from `ADMIN_SEED_PIN` or a generated value printed once by the seed command.
- Checks: `corepack pnpm test` passed (68 passed, 4 database-dependent tests skipped); lint, typecheck, and production build passed. The focused Playwright login test passed with role-specific PIN lengths and no temporary-password option. `format:check` still reports repository-wide formatting drift; no broad reformat was applied.

## Stock management editing and restoration (2026-11-26)

- Stock management now includes zero-stock variants and lets admins filter in-stock, out-of-stock, and inactive items. Admin actions open the existing product editor for the selected variant, reactivate inactive products or variants, and restore quantity through an audited stock adjustment. Bulk products can restore bottle count and millilitres; bundles and decants remain tied to their component stock.
- The default `/stock` response is preserved for other screens; only stock management requests empty variants. Staff continue to see active inventory without admin actions.
- Checks: 56 tests passed and 4 database-dependent tests skipped; lint, typecheck, and production build passed. Focused Prettier check reports existing formatting drift in large application/API/style files; no unrelated reformatting was applied.

## POS payment, shift entry, and mobile polish (2026-11-26)

- Added an audited cancel action for pending STK attempts. The POS keeps the cart available after cancellation, and late provider success is recorded as an unmatched payment for admin reconciliation. Lipwa's current API docs do not expose a server-side prompt cancellation endpoint, so staff are told to ask the customer to dismiss the prompt on their phone.
- Added bank transfer as a payment method, with an optional transaction reference, cash-plus-bank split payments, receipt/invoice reference output, and bank totals in shift close summaries. Added Prisma migration `20261126170000_bank_payment_method`; it has not been applied to a hosted database.
- Authenticated app startup opens the shift screen for both roles and routes through shift setup before other pages when no shift is active. Opening is recorded in the existing shift and audit records. The admin dashboard now shows recent shift openings, staff names, local opening times, opening floats, and active status.
- Fixed production catalog photo URLs to use the same API base as normal API requests, added variant-image fallback, and reveal the product placeholder when an image fails. New products remain visible in POS when out of stock.
- Added subtle raised 3D styling to POS product cards and adjusted the phone layout so the cart sheet clears the bottom tabs and product cards remain scrollable and usable.
- Checks: Prisma client generation, typecheck, lint, production build, and all available tests passed (54 passed, 4 database-dependent tests skipped). `format:check` still reports repository style differences across 45 files; no broad reformat was applied.

## Left-side navigation refinement (2026-11-26)

- Moved the desktop route links into a grouped vertical sidebar on the left. The main header now holds the current page title, connectivity, shift, and user controls.
- Kept the same role/permission filtering, tablet drawer, and phone quick tabs; the drawer lists the full vertical navigation.
- Updated the browser audit to check the vertical sidebar and its links. Typecheck, lint, the production build, and 44 tests passed; 4 database-dependent tests were skipped. The focused responsive browser check passed on desktop, tablet, and phone, including opening and closing the tablet drawer.
- `format:check` still reports repository-wide formatting differences across 45 files; unrelated files were not reformatted.

## Pre-deploy POS refinements (2026-11-26)

- Fixed product photo uploads to accept WebP, JPEG, and PNG data URLs, preserve the actual encoded format on disk, and retry client-side compression to fit the API limit. Product photos can be changed or removed while editing a product.
- Changed brand entry to free text with optional name suggestions; unknown brands are created automatically. Added product editing for details and individual variants, including SKU, price, cost, attributes, and photo.
- Added cart-level discounts at payment with a reason and server-enforced staff limits. Above-limit requests are audited, require an administrator username/PIN approval, expire after ten minutes, and can only be used once for the same requester and cart.
- Switched the production sign-in form to username and PIN. Accounts without a PIN use their temporary password during setup, then configure a PIN; login fields disable password-manager autofill/save hints. Staff creation now requires a PIN.
- Added API coverage for image format persistence, discount cart binding and limits, discount request/approval, and PIN authentication. Checks: 52 tests passed and 4 DB-dependent tests skipped; lint, typecheck, and production build passed. Three feature browser tests and the focused login browser test passed. Targeted Prettier checks passed; repository-wide `format:check` still reports style differences in 46 files, so unrelated files were left untouched.

## Public login refinement (2026-11-26)

- Added the supplied Eminent Jay logo as the public login and password-change fallback while keeping a configured shop logo in front when one exists.
- Refined the sign-in hierarchy, Admin/Cashier selector, field labels, secure-access note, and responsive layout. The logo now keeps its wide wordmark proportions in a subtle framed panel; small screens can scroll instead of clipping the form.
- Updated the default brand name to Eminent Jay for empty or generic seeded shop settings.
- Checks: typecheck, lint, production build, and 44 tests passed; 4 database-dependent tests were skipped. The login role test, reduced-motion/accessibility check, and public page checks at phone, tablet, laptop, and desktop sizes passed. `format:check` still reports repository-wide formatting differences across 45 files; unrelated files were not reformatted.

## Customer profiles and sales analysis (2026-11-26)

- Added shop-scoped customer create/edit/profile APIs with normalized Kenyan phone numbers, consent source/date tracking, preference profiles, lifetime spend after approved refunds, and recent purchase history. Customer writes are audited; duplicate phone numbers return a clear conflict response.
- Added the Customers page for staff and admins with search, repeat-visit and marketing-consent summaries, profile editing, preference tags, and purchase history.
- Added an admin-only sales analysis API with Nairobi-local date filters, refund-aware net sales and gross profit, payment mix, product performance, and department/type breakdowns. Ranges up to 35 days are grouped by day; longer ranges use seven-day buckets.
- Added the Sales analysis page with 7/30/90-day presets, custom dates, summary cards, and responsive SVG bar charts with shaded front/top/side faces for a lightweight 3D effect.
- Reused the current schema; no migration was required. Typecheck and lint passed. The new customer API file was formatted. Repo-wide `format:check` still reports existing style issues across the large app/API files and other untouched files; no broad reformat was applied. Tests and browser audit were not run in this pass.

## Restyle and tablet pass handoff (2026-11-26)

- Replaced the sidebar with a settings-branded black top bar, role-aware desktop navigation, a tablet menu, and phone bottom tabs. Restyled the public sign-in page and POS in black, gold, white, and paper tones.
- Reworked product cards and cart controls for touch use, kept the desktop order panel pinned, and adapted the cart to a phone bottom sheet. Added responsive POS screenshots at phone, tablet, and desktop sizes.
- Typecheck, lint, tests, and production web build passed. The full audit found one phone hit-area assertion on the brand link and More tab; both controls were enlarged, then the focused phone/tablet/desktop POS Playwright test passed. The full audit was not rerun after that small CSS fix. Authenticated API-backed route checks and API load checks need configured credentials/services.
- **Next:** N10 offline sync, then N15 quotations as a single-shop feature, then the remaining backlog.

## Single-shop tenant-ready foundation handoff (2026-11-26)

- Kept the product scoped to one shop. N16 multi-tenancy, signup, billing, and the platform console are deferred until a second shop is signed; N15 quotations remain a single-shop feature. The active order is restyle and tablet pass, N10 offline, N15 quotations, then the remaining backlog.
- Added a Prisma migration that preserves the current shop and its records as shop #1, gives it the `main` slug, and enforces per-shop SKU/barcode uniqueness alongside the existing per-shop receipt-number and customer-phone rules. Username and email remain globally unique.
- Added a shared query/data helper that takes the shop from the authenticated session, persisted shop identity on auth sessions, and two-shop endpoint tests for sales, products, customers, staff, and stock.
- Shop branding, logo, receipt text, and tax now read from shop settings. Uploaded product images use a `shops/{shopId}/product-images/` path. Legacy embedded images have a migration script; it has not been run against the hosted database.
- Checks: typecheck, lint, tests, and build passed. `bash scripts/audit.sh` finished with 50 PASS, 8 WARN, and 0 FAIL; mobile Lighthouse TBT was 188 ms and desktop TBT was 0 ms. The logged-in page sweep was skipped because E2E credentials were not configured. The migration was applied only to the isolated local `tenant_test` database.
- **Next:** finish the restyle and tablet pass before beginning N10 offline work.

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
- Render service `jaypos` now has `LIPWA_API_KEY` and `LIPWA_CHANNEL_ID` set as service environment variables. Deploy `dep-dc3ti7bl550s73fie5rg` completed with status `live`; secret values are not stored in the repository. **TODO(lipwa):** verify the merchant account and complete a minimum-value live transaction, including callback/status reconciliation, before accepting production payments.

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
- No `.env` or production secrets have been created or committed. The seed accepts `ADMIN_SEED_PIN` or generates and prints the initial admin PIN when creating an account without one.
- The Render Lipwa API key and channel are configured, and the callback URL remains defined in `render.yaml`. A minimum-value live merchant transaction and callback/status reconciliation remain a `TODO(lipwa)` before production payments.

## Post-M8 — Loading/performance handoff (2026-11-24)

- Added the boot/login loading treatment, delayed skeleton primitives, saving controls, IndexedDB catalog cache, route data prefetch, API compression, cache headers, and paged sales reads. No customer API/UI exists yet, and route pages remain in the authenticated app chunk; product cards use normal DOM rendering.
- `corepack pnpm -r --if-present run typecheck`, `corepack pnpm lint`, `corepack pnpm test`, and `corepack pnpm build` passed during the latest audit.
- Latest completed Lighthouse: desktop performance 97, LCP 1,217 ms, CLS 0.004. Latest mobile score 73, LCP 1,326 ms, CLS 0.000, TBT 1,520 ms; mobile target remains unmet despite disabling the shader on small devices and splitting login CSS.
- Authenticated Playwright sweep was stopped after 26/59 cases while resolving touch sizing. Rerun `bash scripts/audit.sh` with `E2E_ADMIN_USER`, `E2E_ADMIN_PASS`, `E2E_STAFF_USER`, and `E2E_STAFF_PASS` before marking loading/performance complete.

## Post-M8 — POS theme update (2026-11-24)

- Updated the app palette to white, blue, and warm yellow: bright surfaces, blue actions/navigation, a deep navy sidebar and cart, and yellow total/highlight accents.
- Updated the design tokens, Tailwind theme, design preview swatches, login/boot colors, PWA theme color, and the Phase 1 theme documentation. Follow-up polish tightened heading hierarchy, fixed clipped product details, made stock counts visible on every POS card, unified placeholder colors, improved held-cart contrast, and made the top bar identify the current route.
- `corepack pnpm -r --if-present run typecheck` and `corepack pnpm build` passed. Lint, automated tests, Lighthouse, and authenticated E2E were not run for this visual update; the prior mobile Lighthouse and authenticated E2E limitations remain as recorded above.

## Post-M8 — Profitability and invoices (2026-11-24)

- Added an admin-only owner summary endpoint for Nairobi-local daily net sales, gross profit, and gross margin for today and the previous seven days. It uses sale-time cost snapshots and approved refund events, including cost recovery only for returns put back into sellable stock. The dashboard no longer derives financial totals from the first 100 sales.
- Added audited, numbered invoices from completed sales, with optional buyer name/phone/email captured during checkout, line items, recorded discounts/tax, payment totals, and balance due. Sales history now opens a print-ready HTML invoice preview and offers a direct PDF download. The PDF is explicitly labeled as a sales record, not an eTIMS tax invoice.
- Added a weekly profitability report PDF to the admin overview, previous/next pagination to the sales register, and a product photo field with live preview when adding catalog items and opening stock. The field accepts public URLs, local uploads, and mobile camera capture; uploads are resized to WebP before saving.
- Added admin controls for shop details, receipt footer, and invoice terms, with live receipt and invoice samples on the Receipts & invoices page. Receipt and invoice previews include saved customer details when provided; document settings do not change sale items or amounts. Added a quantity review/edit step before checkout payment and improved its control contrast, spacing, and remove behavior.
- Fixed the POS card artwork sizing conflict that forced square artwork over the fixed card layout. Cards now keep a consistent compact photo area, wrap product names across two lines, keep prices visible, and show the branded fallback if a linked photo fails to load.
- Updated typography tokens and alignment for page headings, dialogs, forms, and tables; standard POS screens use a consistent sans-serif hierarchy.
- **TODO(spec):** eTIMS transmission and tax configuration remain unimplemented; see `docs/DECISIONS.md`.
- Checks: typecheck, lint, tests (34), and production build passed. Backend invoice renderer files are formatted. `format:check` reports pre-existing formatting differences in the large frontend files; unrelated areas were left untouched.
