# Eminent Jay - Addendum: Quotations (N15) and Subscription Model (N16)

Read `/docs/SPEC.md`, `/docs/BACKLOG.md` and `/docs/design-reference/STYLE_GUIDE.md` first. Both features below are **[ADD-ON]** (not in the original 150k scope) and must follow every global rule in BACKLOG.md (tokens only, two roles, staff never see cost or profit, audit everything, tests, `bash scripts/audit.sh` clean).

**Current scope: one shop.** N16 is deferred until a second shop is signed. Its previously approved KSh 2,000 per-shop monthly price is retained for future planning. Implement N15 as a single-shop feature. Follow the current build order at the bottom.

---

## N15 Quotations

**Current scope: one shop.** Implement quotations for the existing shop only; do not make signup, billing, platform-console, or multi-tenant changes a prerequisite.

### Why
The shop quotes jobs (events, decor, bouquets, gift hampers, bulk orders) before the customer pays. A quote needs custom lines, a validity date, a deposit, a branded PDF, and a one-tap conversion into a sale.

### Data model (all tables carry `shop_id`; money in integer cents)
- `quotations`: id, shop_id, client_uuid (unique, idempotent create), number (per shop, `QT-000001`, never reused), version (1, 2, 3...), parent_quote_id (for revisions), customer_id (nullable) plus a customer snapshot (name, phone, email, address), title (for example event name), event_date (optional), status (`draft | sent | accepted | rejected | expired | converted | cancelled`), issue_date, valid_until, subtotal_cents, discount_cents, tax_cents, delivery_cents, total_cents, deposit_percent or deposit_cents, terms, notes, reject_reason, created_by, approved_by, converted_sale_id, sent_at, sent_via, accepted_at, share_token_hash (nullable).
- `quotation_lines`: quote_id, sort_order, line_type (`product | custom | service | delivery | discount`), variant_id (nullable), description, quantity, unit, unit_price_cents, unit_cost_cents (snapshot, admin only), discount_cents, tax_rate, line_total_cents, image_url (optional).
- `quotation_events`: quote_id, type (created, edited, revised, sent, viewed, accepted, rejected, expired, converted, cancelled), user_id, created_at, detail.
- `quote_templates`: shop_id, name, terms text, default validity days (admin-managed).

### Behaviour
- **Create** from the POS ("Save as quote" on the cart) or from the Quotes screen. Attach or quick-create a customer. Add catalog items (by search or scan) and **custom lines** (free text, quantity, unit, price) for services such as labour, setup, transport.
- **Pricing rules:** discounts follow the same per-user limits as sales (above the limit needs admin override). VAT follows shop settings. Prices on the quote are **locked until `valid_until`**.
- **Validity:** default from settings (14 days). A nightly job marks overdue quotes `expired`.
- **Revisions:** editing a quote that was already sent creates a new version (v2, v3) and keeps the old one read-only. Only the latest version can be accepted.
- **Deposit:** optional percentage or amount. "Record deposit" creates a payment linked to the quote (cash or M-Pesa STK) and shows the balance due.
- **Share:** branded A4 PDF; share by WhatsApp link, SMS link (consenting customers or direct, one-to-one), or download. Optional public read-only page behind an unguessable token, expiring with the quote, with an "Accept" button that records name, phone and time (setting off by default; staff can also mark accepted manually).
- **Convert:** "Convert to sale" loads the lines into the POS cart at the quoted prices (the deposit already paid is shown as a credit), then completes as a normal sale and links both ways. If catalog price or stock changed since the quote, show the differences and require a clear choice to honour the quoted price. The quote becomes `converted` when the sale completes.
- **Stock:** not reserved by default. Optional setting "reserve stock when a quote is accepted" (later).
- **Follow-up:** a "Follow up" list (sent quotes with no reply after N days, quotes expiring in 2 days).
- **Permissions:** staff create, edit, send and convert their own quotes and see their own list; the admin sees all, approves large discounts, archives quotes, and sees margin. **Cost and margin are admin-only** (never in staff API responses).
- **Offline:** drafts can be created and edited offline through the outbox (idempotent on `client_uuid`). Sending, sharing, and deposits need internet.
- **Audit:** every create, edit, send, accept, convert, and cancel is audited.

### Screens (follow STYLE_GUIDE.md)
- **Quotes** (nav pill): stat cards (open value, accepted this month, conversion rate, expiring soon), filters (status, date, customer, search), quote cards in the style of the sale cards (number chip "QT-0012", time, customer, amount, status chip, actions: Open, Send, Convert, Duplicate).
- **Quote editor:** left = customer block and a lines table (add item search, add custom line, qty stepper, price, discount, remove); right = pinned summary panel (subtotal, discount, VAT, delivery, total, deposit, valid until, terms) with "Save draft" and a gold "Send quote". Mobile and tablet portrait: summary becomes a bottom sheet with a sticky action bar.
- **Quote preview dialog** with the PDF look, and the buttons "Download PDF", "Send on WhatsApp", "Send SMS", "Convert to sale".
- **PDF:** logo and shop details (name, address, phone, KRA PIN), "QUOTATION", number and version, issue and valid-until dates, customer block, lines table (item, description, qty, unit price, amount), totals, deposit due, payment details (M-Pesa till or paybill from settings), terms, and an acceptance block ("Accepted by / Signature / Date"). Uses the brand name and logo from settings.

### Reports (admin)
Quotes sent, accepted, rejected and expired; conversion rate; open pipeline value; average days to close; rejection reasons; quoted vs sold margin.

### Tests
Totals and discounts, revision history, expiry job, price lock and the conversion difference check, deposit balance, idempotent create, cost hidden from staff responses, PDF contains the right figures, permissions, offline draft sync.

### Done when
A staff member can create a quote with catalog and custom lines, send the PDF on WhatsApp, record a deposit, and convert it to a sale in the POS, and the admin can see the pipeline and margin.

---

## N16 Subscription model (multi-tenant) - DEFERRED until a second shop is signed

**Status: DEFERRED.** The current product is for one shop. Do not implement N16, multi-tenancy, signup, subscription billing, or the platform console until a second shop is signed. The previously approved KSh 2,000 per-shop monthly price is retained for when this scope is resumed.

### Business model (confirmed by the client; implement as configuration, not constants)
The client wants to monetise the app with a subscription of **KSh 2,000 per month** (per shop; keep the amount in the `plans` table, never hard-coded). Treat this as: **many independent shops use the same hosted app and each pays the subscription**. The plan price, trial length, grace period, seat limits, and feature flags live in a `plans` table so they can change without code changes.

### Architecture
- **One shop = one tenant.** `shop_id` is already on every business table. Make isolation airtight:
  - `shop_id` always comes from the authenticated session, **never from client input**. Every query and every endpoint is scoped by it.
  - Add **Row Level Security policies** by `shop_id` as a second layer (the API sets the tenant per connection or transaction).
  - Uniqueness is per shop: receipt and quote numbers, SKUs, barcodes, customer phones, usernames or emails per shop.
  - Files and images stored under a per-shop prefix.
- **Per-shop settings:** brand name, logo, receipt layout, tax, currency, SMS sender, and **payment credentials (Lipwa/M-Pesa) encrypted at rest**. Each shop collects its own money into its own till or paybill. **Open risk:** confirm with Lipwa whether a multi-merchant (partner) setup is supported, or whether every shop must register its own Lipwa account; design the per-shop payment settings and onboarding around the answer.
- **Roles:** `platform_owner` (the client; a separate console at `/platform`), plus the existing `admin` and `staff` inside each shop. Plans can cap staff seats and product counts.
- **The current shop becomes shop #1.** Write a migration and backfill. Update seeds and tests so they always run with two shops.
- **Do this before building more screens.** Retrofitting tenant isolation later is much harder.

### Signup and onboarding
Public signup (shop name, owner name, phone, email, password, accept terms), SMS OTP verification, bot and abuse protection (rate limits, CAPTCHA), creation of the shop and its admin, a setup wizard (logo, tax, receipt, first products via import, first staff), seed of starter departments and types, and the start of a free trial.

### Billing
- **Subscription fields:** `subscriptions` (shop_id, plan_id, status `trialing | active | past_due | suspended | cancelled`, trial_ends_at, current_period_start/end, next_due, grace_until, last_payment_at), `billing_invoices` (number `SUB-000123`, period, amount, status), `billing_payments` (M-Pesa receipt, amount, phone, raw callback), all idempotent.
- **Collecting the money:** a "Pay subscription" screen for the shop owner with an STK Push to the platform's own till or paybill through the `PaymentProvider` interface (prefilled phone, 1 month or several months upfront). Reuse the unmatched-payments queue. M-Pesa has no card-style auto-debit; investigate Safaricom's **Ratiba (standing order)** API behind a `RecurringPaymentProvider` interface as an optional later improvement (check availability and requirements with the provider; do not assume the Lipwa integration supports it).
- **Lifecycle (all configurable):** trial (default 14 days) then active; reminders by SMS (5 days before, 1 day before, on the due date, and after); `past_due` with a banner and a grace period (default 7 days); then read-only mode (view, export, pay; no new sales or edits); `suspended` after a longer period; reactivation immediately after payment. **Data is never deleted** by non-payment, and a shop can always export its data.
- **Offline tolerance:** tills keep working offline; the subscription status is checked at every sync and online check, and an offline device keeps working for a limited window (default 72 hours) after the last successful check.
- **Receipts for the subscription:** SMS and PDF confirmation per payment.

### Platform console (client only)
Shops list with status, plan, last payment, last active, staff count and search; create, suspend and reactivate manually; extend trial or grace; record a manual (cash or bank) payment; **"view as" support access** that is read-only, needs the shop owner's consent, and is fully audited; revenue dashboard (active shops, trials, MRR, churn, failed renewals, SMS spend); announcements banner to shops; CSV export; plan and feature-flag management.

### Security and compliance
- **Automated cross-tenant tests on every endpoint** (shop A can never read, write, export or guess shop B's data). This is the most important test suite of the whole project.
- Encrypted payment credentials with a rotation path; audit trail; rate limits; per-shop data export and deletion; separate backups restore tests.
- The platform operator becomes a **data processor** for each shop's customer data. Prepare terms of service, a privacy policy and a data processing agreement template, and confirm data-protection registration requirements (ODPC) with a lawyer. The agent must not provide legal text as final; mark clearly as drafts for legal review.

### Done when
Two shops cannot see each other's data (proved by the automated test suite); trial, active, past_due and suspended flows are tested with a fake clock; subscription payments are idempotent; reminders send; the platform console works; and a new shop can sign up and make its first sale in under 10 minutes.

---

## Current build order
1. Finish the restyle and tablet-first pass.
2. N10 offline mode for the existing shop.
3. N15 quotations as a single-shop feature.
4. Continue with the remaining backlog.

N16 remains deferred until a second shop is signed. Do not treat the earlier multi-tenant architecture or billing steps above as current implementation requirements.
