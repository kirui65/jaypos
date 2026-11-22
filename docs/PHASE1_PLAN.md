# Phase 1 Plan — Core POS

Work through M1–M8 in order, one milestone at a time. At each milestone's end, run tests, lint, and typecheck, fix failures, commit the milestone with a clear message, and report what exists and what is next. Do not begin implementation until the owner approves Step 0. Keep Phase 2–4 features out of scope.

## M1 — Foundation

- Create the pnpm workspace layout, Docker Compose PostgreSQL, strict TypeScript setup, Prisma schema and first migration, `.env.example`, and scripts.
- Model the Phase 1 core tables listed in the task, with `shop_id` on business tables, integer cents for money, and an append-only stock ledger.
- Seed one Eminent Jay shop, exactly the `admin` and `staff` roles, one admin account, Men/Ladies/Children, sample types, and perfume/cosmetic/clothing variants.
- Add shared money and Kenyan phone utilities and an API health endpoint.
- **Acceptance:** usable local foundation; seed data as specified; migration runs; money is integer cents; shared phone normalization supports `2547XXXXXXXX` and `2541XXXXXXXX`; health endpoint responds.

## M2 — Authentication and staff management

- Implement login/logout, session or short-lived JWT plus refresh per the spec, forced password change, PIN unlock, failed-login rate limits/lockout, and server-side permission middleware.
- Support exactly two roles and admin-only staff create/edit/reset/activate/deactivate/archive/delete operations, with last-admin protections and audit entries.
- **Acceptance:** staff accounts are admin-managed only; role permissions and staff permission-removal overrides are enforced on every protected route; inactive accounts cannot authenticate; accounts with history are archived, accounts without history can be deleted; last active admin is protected; permission tests pass.

## M3 — Catalog

- Add departments, configurable product types and attribute templates, products, variants, size/colour grid creation, perfume decant links, bundles, and tester stock representation.
- Keep cost fields out of staff-facing API serialization.
- **Acceptance:** admin can manage catalog data and staff can read it; variants can represent perfume, clothing, and cosmetics attributes; staff API responses never contain cost or profit (tested).

## M4 — Stock ledger

- Implement admin stock receipts/adjustments/counts/write-offs/opening bulk bottles/import actions as in-scope, using append-only movements and transactional stock level updates. Add staff damage/tester reports for admin review without changing stock.
- **Acceptance:** every stock mutation has a ledger movement in the same transaction; only admins can perform manual stock changes; staff can read stock and submit reports but cannot mutate stock; completed sales and approved refunds are the only non-admin-originated causes of stock change; tests cover ledger consistency and authorization.

## M5 — Sales and shifts

- Implement shift open/close and cash reconciliation, held carts, idempotent `POST /sales` keyed by `client_uuid`, server-side totals, discounts, split payments/change, receipt numbering, and transactional stock deductions for regular, decant, and bundle sales.
- Require an open shift and record the actual seller (staff or admin).
- **Acceptance:** sales require an open shift; duplicate `client_uuid` never creates a duplicate; concurrent sales cannot oversell the last item; amounts and stock are correct; discount policy and seller attribution are enforced and tested.

## M6 — Payments

- Define `PaymentProvider`, mock and Lipwa adapters, STK initiation, verified callback handling, idempotency, amount mismatch handling, status polling/manual check, expiry, and unmatched payment queue.
- Read current Lipwa documentation before implementing provider-specific behavior; if unavailable, leave explicit `TODO(lipwa)` placeholders without inventing field names.
- **Acceptance:** a sale completes only from server-confirmed payments covering its total; duplicate, late, and mismatched callbacks behave safely and are tested; provider failures and pending/expired states are surfaced.

## M7 — Refunds and receipts

- Implement staff refund requests and admin approval/rejection, restock-versus-damaged disposition, refund limits, and linked exchange records as a refund plus a new sale.
- Add receipt data and printable black-and-white 58 mm/80 mm HTML plus PDF output.
- **Acceptance:** staff cannot approve refunds; approved refunds cannot exceed sold/paid amounts and update stock transactionally; receipt content follows the spec and reprints are marked and audited.

## M8 — Frontend

- Build the Eminent Jay design tokens and Tailwind mapping, self-hosted fonts, login/password-change, role-based shell, POS, payment states, shift flows, my sales, stock lookup, refund requests, and Phase 1 admin screens.
- Add a development-only `/design` route for token and component-state review. Do not add offline UI or Phase 2–4 modules.
- **Acceptance:** core role flows are usable; staff cannot access admin actions; POS follows the 65/35 design and responsive guidance; no hard-coded theme values outside token definitions; focus, contrast, and status treatments follow section 10.1; `/design` shows the design system.

## Phase 1 definition of done

The spec's Phase 1 acceptance criterion is met: admin creates staff; staff logs in, opens a shift, sells with cash and STK (mock), prints a receipt, and closes with correct totals; stock is correct and admin-only for manual changes; admin can inspect sales and stock; actions are audited; tests pass. Also run lint and typecheck as required for this session.
