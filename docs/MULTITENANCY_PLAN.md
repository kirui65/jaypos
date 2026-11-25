# Multi-tenancy plan (N16a)

**Status:** planning only; no implementation is authorized until this plan is approved.  
**Business decision:** N16 is approved: many independent shops, each paying a configurable KSh 2,000 per month. Keep the amount in plan data, never in application constants.  
**Order:** establish tenant isolation first, then build N10 offline mode, N15 quotations, and N16b signup, billing, and the full platform console.

## 1. Current baseline and target

The current `Shop` is the tenant root and most business tables already carry `shop_id`. Preserve the existing shop row as **shop #1** and keep all current record IDs and history. This is a backfill and hardening migration, not a rebuild or data copy.

The present code is still single-shop in important places:

- Login looks up a username/email globally, and `/api/brand` selects the first shop. Both need a tenant-aware pre-login lookup.
- Some route queries already filter by the authenticated user’s `shopId`, but other lookups/relations and all transaction paths need a complete audit. A supplied `shop_id` must never select the tenant.
- `product_variants.sku`, `product_variants.barcode`, and `sales.client_uuid` are globally unique. `unmatched_payments.provider_request_id` is also globally unique. Receipt counters and receipt numbers and customer phones already have shop-scoped constraints; usernames are unique per shop, while email uniqueness needs a defined per-shop constraint.
- Payment configuration is selected from process-wide environment variables. The Lipwa callback and provider factory are also global.
- Product photos can currently be stored as data URLs in the database. There is no per-shop object-storage namespace yet.
- RLS is enabled on current application tables, but the existing Supabase migration deliberately creates no policies and relies on the trusted API connection. That is not tenant isolation for the API. RLS needs tenant policies and an application database role that cannot bypass them.
- Tests currently focus mostly on unit behavior and a few route/auth checks. They do not prove that two shops are isolated.

The target invariant is: **after authentication, every shop-scoped read, write, callback reconciliation, export, and file access gets its tenant from the validated server-side session or a narrowly defined provider callback mapping.** The database applies the same tenant context as a second guard. Shared platform data (plans, permissions, and platform accounts) is explicitly separate from shop data.

## 2. Tenant identity, login, and API boundary

1. Give each shop an immutable URL-safe slug (and allow a mapped custom host later if needed). Before login, resolve the request host/slug to one active shop. This is only a login/branding locator; it is not accepted as an API tenant selector after login. Do not accept `shop_id` from JSON, query parameters, headers, route IDs, or the browser cache as authority.
2. Scope username/email and password lookup to that resolved shop. This permits the same username or email in separate shops without ambiguity. Login attempts and lockouts are counted within the resolved shop and identifier/IP.
3. Store `shop_id` on the shop session as an immutable session claim and verify it against the user’s `shop_id` at authentication. Set `request.authUser.shopId`/`request.shopId` only from that checked session. Keep shop `admin` and `staff` authorization inside that tenant.
4. Replace `/api/brand`’s `findFirst` with host-resolved shop branding. Cache keys and headers must vary by the resolved shop so one shop’s logo/name cannot be served to another.
5. Keep callbacks, health, login, and any later public quote accept/signup routes as explicit exceptions with narrow input contracts. A Lipwa callback resolves the tenant through a server-side payment/integration correlation, verifies authenticity with that shop’s provider configuration, and never trusts a body `shop_id`.

The default deployment proposal is `{shop-slug}.<app-domain>` for login and shop URLs. **TODO(spec):** confirm the production domain strategy and whether custom domains are required. A tenant slug may identify the shop before login; it must never replace the session-derived `shop_id` on authenticated endpoints.

## 3. Query scoping, RLS, and relational integrity

### Application layer

- Add a tenant transaction boundary (`withShopTransaction(shopId, ...)`) and route all shop data access through it. It begins a Prisma transaction, sets a transaction-local PostgreSQL tenant value, and passes only that transaction client into repository/service functions. Use `SET LOCAL`/transaction-local configuration so a pooled connection cannot retain one shop’s context for the next request.
- Every Prisma predicate, raw SQL statement, nested relation, update/delete, count, pagination, and export also includes the session `shopId`. RLS is a backstop for a missed predicate, not a substitute for it.
- Reject or ignore client-supplied `shop_id`; preferably remove it from endpoint Zod schemas. Construct tenant fields on the server for inserts. Resolve records by both ID and tenant, returning the normal not-found response for a foreign ID.
- Scope all multi-step operations (sale + payment + stock ledger, refund + stock, quote conversion, and audit write) in one tenant transaction. A referenced customer, variant, shift, sale, user, or payment must belong to that same shop.

### PostgreSQL layer

- Define a policy for each tenant table using a transaction-local setting such as `current_setting('app.shop_id', true)`. Missing context denies access. Use `FORCE ROW LEVEL SECURITY` where appropriate.
- Run the API using a least-privilege runtime database role that is not the table owner and does not have `BYPASSRLS`. Keep migrations on a separate owner connection. Verify the production/Supabase role actually obeys RLS; the current trusted connection cannot be assumed to do so.
- Keep global lookup tables (role/permission definitions and plans) out of shop RLS or grant only the required read access. Scope `shops` and all customer, catalog, stock, sales, payment, shift, refund, settings, audit, session, file metadata, quote, and billing records appropriately. Auth bootstrap needed to resolve a session happens through a narrowly scoped resolver; it must not give ordinary tenant requests a cross-shop query path.
- Add composite ownership constraints where records point to other tenant records: unique `(shop_id, id)` keys on parent rows as needed and composite foreign keys such as `(shop_id, variant_id)`. This prevents a malformed write from linking a shop A sale to a shop B customer/variant even if application validation fails.
- Platform support access is a separate, explicit policy path with platform actor identity and audit records. Do not make a shop user’s `admin` role global or give the normal shop API a general cross-tenant bypass.

## 4. Uniqueness, settings, secrets, and files

### Per-shop uniqueness

Replace global business uniqueness with tenant-qualified keys:

- Variants: `(shop_id, sku)` and `(shop_id, barcode)`; allow a null barcode as today.
- Sales: `(shop_id, client_uuid)` for offline idempotency, plus the existing `(shop_id, receipt_no)` behavior. Keep the receipt counter keyed by shop.
- Unmatched provider payments: scope the provider/request identifier by shop and provider where the provider permits duplicates; define a safe callback correlation if provider IDs are only unique per merchant.
- Users: retain `(shop_id, username)` and add normalized, nullable per-shop email uniqueness if product policy requires email to identify a login. Customer phones remain `(shop_id, phone)`.
- New quotations: `(shop_id, client_uuid)` and `(shop_id, number)`; quote number counter per shop. New subscription invoice numbers are platform billing IDs with a documented global or per-shop namespace.

Audit every unique index before changing it. The existing one-shop rows should remain valid; migration preflight reports duplicate/conflicting rows and stops rather than silently deleting or renaming business data.

### Per-shop settings and payment credentials

Keep brand name/logo, receipt and invoice settings, tax/currency, SMS sender, payment configuration, and later subscription/feature settings tenant-owned. Move environment-based Lipwa settings into a shop integration record for shop #1 during controlled deployment; retain only a temporary, explicit migration fallback until the owner confirms the new credentials work.

Payment secrets are write-only in the UI and encrypted before database storage with authenticated encryption (for example AES-256-GCM). Store ciphertext, nonce, authentication tag, provider/config version, and key version; keep encryption keys outside PostgreSQL in deployment secrets. Never return secrets to the web client or log them. Document rotation: add a new key version, decrypt/re-encrypt records in a controlled job, verify, then retire the old key. Add required key variables to `.env.example`, not real values. Payment initiation, status query, and callback verification resolve the provider/config by the payment’s shop.

Store uploads under an immutable shop prefix such as `shops/{shop_id}/...`; enforce that the authenticated tenant owns the path when uploading, reading, deleting, and issuing signed URLs. Migrate current data-URL images without changing their content, preserve intentional external product image URLs, and avoid accepting arbitrary object keys from clients. Later quote PDFs and logos use the same prefix. **TODO(spec):** choose the object-storage provider and public/private delivery policy before implementation.

## 5. `platform_owner` and `/platform`

`platform_owner` is a platform-level actor, not a third shop role. Prefer a separate platform principal/session and permission check rather than making the existing non-null `User.shop_id` nullable or letting a shop user select another tenant. The regular `/api` shop middleware must reject platform sessions; the platform middleware must reject shop sessions. Add a protected `/platform` route group and web route guard.

N16a establishes the principal, session, audited access boundary, and route shell. The full console belongs to N16b and includes shop search/status/plan/activity, manual suspend/reactivate and trial/grace controls, manual payment entry, CSV export, announcements, plan/feature management, and subscription/revenue views. “View as” is read-only, requires recorded shop-owner consent, expires, and writes platform and shop audit events; it must not silently change the shop user’s identity or permissions.

## 6. Shop #1 migration and rollout

1. Inventory all Prisma models, SQL tables, endpoint queries, stored image formats, unique indexes, and production environment configuration. Take and verify a restorable backup. Record row counts and orphan/duplicate checks before migration.
2. Add the tenant slug and any required ownership keys/tables. Preserve the existing shop’s UUID as shop #1 and preserve every existing row ID. Confirm all current `shop_id` references point to that shop; repair only by an explicit reviewed mapping, otherwise abort.
3. Add composite foreign keys and replace global unique indexes with per-shop indexes in a staged migration. Since shop #1 is the only production tenant at this point, no business rows move. Make migration checks fail on duplicate data rather than dropping rows.
4. Add encrypted per-shop provider settings and a one-time, auditable configuration transfer for shop #1. Do not print or commit credential values. Validate a mocked payment flow first; a live transaction waits on the Lipwa decision and owner credentials.
5. Deploy tenant-aware auth/API code, then RLS policies and the least-privilege runtime role. Run a canary check that shop #1 still opens, sells, refunds, prints, and reads its existing reports before enabling shop creation.
6. Update development/test seeds to include two isolated shops with same username/SKU/barcode/receipt/client UUID fixtures where supported. Production migration creates only shop #1; it must never create demo shop #2 or demo sales. New shop provisioning becomes supported in N16b.
7. Keep a rollback point before enforcing RLS. A rollback restores prior code/schema from backup; do not “roll back” by deleting or merging tenant data.

## 7. Cross-tenant automated tests (all endpoints)

Build a disposable PostgreSQL integration-test database with shops A and B, sessions/users for each, and deliberately overlapping IDs/business keys. Tests must never point at the developer or production database. Run actual Express routes with separate authenticated cookies, not only isolated helper functions.

Create a source-controlled endpoint manifest/coverage check. For **every registered endpoint**, the suite must classify it as tenant-scoped, platform-only, public tenant-resolved, public provider callback, or deliberately global (`/health`). Adding an endpoint without a classification and isolation case fails CI. Current coverage must include:

- `/api/auth`: login, `me`, logout, password/PIN actions, staff list/create/edit/reset/delete.
- `/api/catalog`: catalog list, product image, department/type/brand/product/variant/bundle writes and reads.
- `/api/stock`: levels, damaged stock, movements, counts, reports and review.
- `/api/sales`: documents settings, owner summary and PDF, list/create, held-cart list/create/resume, invoice and receipt.
- `/api/shifts`: current/open/cash movements/close; `/api/refunds`: list/create/review; `/api/payments`: STK, status check, mock completion, pending, unmatched and reconciliation.
- Public `/api/brand`, the provider callback, and the later `/platform`, signup, billing, quote/public-share, and export routes when introduced. Health is verified to return no tenant information.

For each tenant API read, prove A cannot list, search, paginate, export, download, or guess B records by ID through path, query, nested relation, or filter. For each write, submit B IDs and a forged `shop_id` in body/query/header; assert rejection/not-found and compare B’s rows, stock, balances, audit trail, files, and payment state before and after. Also prove A cannot cause a side effect against B through bulk operations, idempotent retries, PDF/image endpoints, callback replay, or foreign relation IDs. Verify B remains unaffected and can still access its own data.

Add direct database tests using the production runtime role: no tenant context yields no tenant rows; A context sees/changes only A; B cannot be inserted under A context; a transaction that ends cannot leak A context into the next pooled request. Test composite foreign keys and RLS policies independently of Express. Test platform owners cannot use shop endpoints and shop admins cannot use `/platform`; platform view-as is denied without consent and audited when allowed.

Run these checks for every new endpoint as part of root `pnpm test` and make the audit script fail when the integration suite is absent, skipped, or lacks endpoint manifest coverage. CI must report the tested endpoint count so a newly added route cannot silently escape the suite.

## 8. Effects on offline sync, N15 quotations, and existing checks

### N10 offline sync

- Partition IndexedDB/cache keys and outbox by tenant and user/device (or use an isolated database per tenant). Shop A’s catalog, customers, settings, permissions, receipts, and pending work must not render or sync under shop B’s login. Clear or quarantine the prior tenant’s cached view on account/tenant switch; do not discard unsynced sales.
- Each offline record carries a local tenant marker for partitioning and diagnostics, but the API ignores it as authority. Sync uses the authenticated session’s shop, validates the marker matches, and derives database `shop_id` from that session. A queue from another shop remains blocked until that shop’s session is restored.
- Make idempotency `(shop_id, client_uuid)`; preserve creation-order sync, retry visibility, negative-stock review, and shop-specific receipt counters. Local receipt prefixes and sequence state are tenant/device scoped.
- On every online check/sync, refresh tenant identity and subscription entitlement. Keep the existing offline-auth expiry separate from subscription-status freshness: honor the stricter active limit (current SPEC suggests a 24-hour offline login cap; N16 addendum proposes up to 72 hours since subscription check). Once selling is blocked, keep safe read/export/payment-renewal and outbox recovery paths available so data is not stranded. **TODO(spec):** confirm whether the offline-login cap remains 24 hours after subscription grace is added.
- Add tenant-switch, same-browser/two-shop, cross-shop UUID, expired-session, stale-subscription, and queued-sale recovery tests before marking N10 done.

### N15 quotations

Build quotes only after the tenant base and tenant-aware offline sync. Every quote/template/event/line/payment has the same `shop_id`; all reads and transitions are tenant scoped; versions, `QT-` numbering, and idempotency counters are per shop. Conversion must prove quote, customer, products, deposit, and new sale belong to one shop and preserve quoted pricing rules. Share tokens are hashed and resolve only the quote they represent; public accept/share exposes no cost or margin. Shop settings control PDF branding and payment details. Staff serialization never includes `unit_cost_cents` or margin; admin-only reporting remains within the shop. Offline draft outbox items are tenant-partitioned; send/share/deposit still require online access.

### Existing tests and scripts

- Update tests and factories to create an explicit shop/session. Keep pure unit tests fast, but add real two-shop database/API integration tests for endpoint coverage and RLS.
- Update root `pnpm test` to run the cross-tenant suite and make its test database requirement explicit. Use a disposable `TEST_DATABASE_URL`; fail clearly rather than silently skip tenant tests. Existing `/health`, permissions, sales math, stock ledger, payments, serialization, invoice, and profitability tests remain and gain shop-scoped fixtures where they touch persistence.
- Update seed logic so development/test data has shop A and shop B, including intentionally overlapping per-shop keys; production seed/migration retains only the real shop #1. Seed platform role/permissions separately and never generate or print production platform credentials.
- Root `scripts/audit.sh` currently runs typecheck, lint, tests, build, static/UI audit, optional Lighthouse, and optional API load check. Make the mandatory test section include cross-tenant integration and endpoint-manifest coverage; add platform/two-tenant UI cases when the console exists. Keep authenticated UI credentials external to the repo. Typecheck/lint/build and existing visual checks remain required at milestone completion. No scripts are changed in this planning step.

## 9. Risks and open decisions

| Risk / question | Plan to reduce it |
|---|---|
| **Lipwa multi-merchant support is unknown.** A shared integration may or may not support each shop’s own till/paybill and credentials. | Confirm partner/merchant model, callback signing, status lookup, channel IDs, and whether each merchant needs an account before live onboarding. Keep shop-specific provider config and callback correlation independent of the answer. If unsupported, onboarding requires each shop’s own Lipwa account or a different provider; do not route every shop’s collections to the platform account. |
| Existing runtime DB connection may own tables or bypass RLS. | Provision a distinct least-privilege runtime role, test actual production connection behavior, and fail deployment if policies do not restrict it. Keep migration credentials separate. |
| Global unique keys and single-tenant assumptions can cause data loss or misrouting during migration. | Preflight index and reference checks, preserve IDs, stage migrations, require verified backup/restore, and abort on conflicts. |
| Direct Prisma queries make it easy to miss an endpoint or nested lookup. | Central tenant transaction boundary, explicit tenant predicates, composite FKs, route manifest coverage, and DB-level RLS tests. |
| Login and brand resolution need a tenant locator before there is a session. | Use host/slug only for initial resolution, scope credentials to that shop, then use the session thereafter. Confirm custom-domain needs and prevent cross-host cache reuse. |
| Encrypted credential key loss or rotation can interrupt payment processing. | Back up key material securely, keep key versions, test rotation/restore, redact values, and provide a controlled credential re-entry path. |
| Callback IDs may collide across Lipwa merchants or be unverifiable with one callback URL. | Resolve via provider-supported merchant/channel reference or an opaque per-shop callback route, verify signature/status, and test replay/idempotency before live use. |
| Platform support access increases privacy impact. | Separate principal and route guards; explicit consent, time bounds, read-only queries, prominent access logging, and independent audits. |
| Shop-specific files, cached data, and offline queues can leak across reused devices. | Tenant-qualified object prefixes, signed access checks, cache/outbox partitioning, explicit switch handling, and two-shop same-device tests. |
| Processor obligations and shop/customer data duties need formal review. | Prepare terms/privacy/DPA as drafts for legal review in N16b; confirm ODPC duties with qualified counsel. |
| Addendum’s subscription offline window and SPEC’s offline authentication window differ. | Keep separate clocks and enforce the earlier expiry until the owner confirms the policy. |

## 10. Estimate and milestone gates

Estimate assumes one experienced full-time developer, existing stack, a working disposable PostgreSQL environment, and no major external-provider delays. Ranges include code and automated verification, not legal review, Lipwa response time, production credential provisioning, or customer UAT.

| Milestone | Work and exit gate | Estimate |
|---|---|---:|
| N16a.1 — Tenant schema and shop #1 migration | Preflight/backup plan, slug, composite ownership constraints, per-shop unique indexes, preserve all shop #1 IDs, two-shop non-production fixtures. | 2–3 days |
| N16a.2 — Tenant auth and API scope | Host/slug resolver, tenant-scoped login/session, public brand lookup, tenant transaction boundary, query audit/refactor for every current route. | 4–6 days |
| N16a.3 — RLS, settings, files, payments, platform boundary | Least-privilege DB role and policies, encrypted per-shop credentials/provider resolver, per-shop file prefixes, `platform_owner` principal/session and `/platform` route guard. | 3–5 days |
| N16a.4 — Security suite and regression | Endpoint manifest and two-shop API/RLS suite, seed changes, preserve current POS/auth/stock/refund/payment/report behavior, update audit/test integration. | 3–5 days |
| **N16a total** | Multi-tenant foundation accepted; no tenant can read or mutate another tenant through any current endpoint. | **12–19 days** |
| N10 — Tenant-aware offline mode | Cache/outbox partitioning, session/entitlement checks, scoped idempotency and receipts, offline conflict/recovery tests. | 4–7 days |
| N15 — Tenant-aware quotations | Quote lifecycle, revisions, deposits, PDFs/share, conversion, permissions, offline draft sync, tenant tests. | 7–11 days |
| N16b — Signup, billing, and full platform console | Onboarding, configurable KSh 2,000 plan, trials/subscriptions/payments/reminders, lifecycle gates, full `/platform`, exports and draft legal documents. | 10–16 days |
| **Overall sequence** | N16a → N10 → N15 → N16b, matching the addendum. | **33–53 days** |

Approval gate: review and approve this plan before any schema, API, seed, frontend, script, or other code changes. At each later milestone, report checks and update the project handoff as directed by the repository workflow.
