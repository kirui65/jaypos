# Eminent Jay - Retail Shop Web POS (Perfumes, Cosmetics, Boutique) - System Specification

> Project name: **Eminent Jay**. Theme: **white, blue, and warm yellow** (see 10.1).
> Audience: the coding agent (and any developer) building this project.
> Read this whole file before writing code. When something here is unclear or conflicts with reality, ask or leave a `TODO(spec)` comment. Do not guess silently.
> Items marked **[ASSUMPTION]** are defaults chosen to keep moving. They can be changed by the project owner.

---

## 1. Project Overview

A web-based Point of Sale and shop management system for a **retail shop in Kenya that sells perfumes, cosmetics, and boutique items** (clothing, shoes, bags, accessories **[ASSUMPTION]**: confirm the exact boutique range with the owner). It is used in **one shop at the moment**, but the data model must be ready for more branches later.

The catalog is organised by **department** (Men, Ladies, Children) and then by **type** (for example Perfumes, Makeup, Skincare, Clothing, Shoes). Different types have different variant attributes (see 6.5). The system must never assume that every product is a perfume.

### 1.1 Core requirements from the client
1. **POS**: fast till for selling perfumes, cosmetics, and boutique items.
2. **Staff portal**: restricted interface for the shop's staff (4 at launch). **Staff must log in before the POS can be used.**
3. **Admin portal**: full control for the owner. **Only the admin creates, edits, deactivates, and deletes staff accounts** and controls other staff features.
4. **Customer preferences**: store each customer's preferences (departments, types, brands, sizes, budget, and scents for perfume buyers) and use them for recommendations and marketing.
5. **Marketing via local bulk SMS**: campaigns and automated messages through a Kenyan bulk SMS provider.
6. **M-Pesa STK Push via Lipwa**: customer pays on their phone; the system reconciles automatically.
7. **Offline capable**: the till keeps working when the internet drops and syncs sales when it returns.
8. **Catalog by department and type**: Men, Ladies, Children, then type under each (perfumes, cosmetics, clothing, shoes, etc.), with the right variant fields for each type.

### 1.2 Goals
- Professional, fast, reliable. A staff member should complete a sale in under 15 seconds.
- Never lose a sale. Never double-count a sale.
- Owner can see true profit, stock, and staff performance at any time.
- Easy to maintain by a solo developer.

### 1.3 Non-goals (for now)
- Multi-branch operations UI (only the data model is prepared).
- Public e-commerce checkout (only an optional catalog page, see Phase 4).
- Native mobile apps (PWA only).

---

## 2. Users and Roles

| Role | Who | Main purpose |
|---|---|---|
| `admin` | Shop owner | Full access to everything, including creating and managing all staff accounts |
| `staff` | Shop employees (4 at launch) | Log in to the POS, make sales, look up stock and customers, run their own shift |

There are exactly **two roles: admin and staff**. There is no manager or supervisor role. Anything a supervisor would normally approve (refunds, voids, large discounts, stock adjustments) is done by the **admin**.

### 2.1 Permission matrix

| Capability | staff | admin |
|---|---|---|
| Log in, open/close own shift | Y | Y |
| Use the POS: create sale (cash / M-Pesa / split) | Y (must be logged in) | Y (same POS, recorded under the admin's name) |
| Apply discount | up to personal limit set by admin, with a 20% sale cap | up to 20% of the sale subtotal |
| Hold / resume cart | Y | Y |
| View product, price, stock | Y | Y |
| View cost price and profit | N | Y |
| Request refund / return | Y (request only) | Approve |
| Void a completed sale | N | Y |
| Submit a damage / tester report (a note only, does not change stock) | Y | Y |
| View own sales and shift summary | Y | Y |
| View all sales, dashboard, reports | N | Y |
| Create/edit customers and preferences | Y | Y |
| Delete customers | N | Y |
| Create/edit products, prices, departments, types | N | Y |
| **Add or edit stock** (receive goods, adjustments, stock take, damage/tester write-offs, opening a bulk bottle, bulk import, opening quantities) | N | Y |
| Purchasing, suppliers | N | Y |
| Expenses | N | Y |
| Send SMS campaigns | N | Y |
| **Create staff accounts** | N | Y |
| **Edit staff usernames/passwords, reset PINs, activate/deactivate, delete staff accounts** | N | Y |
| **Other staff features** (discount limit, permission toggles, attendance, targets, commission) | N | Y |
| Settings, integrations, audit log | N | Y |
| Edit account username/password (admin page) | N | Y |
| Change own PIN | Y | Y |

Permissions must be enforced **on the server**. Hiding a button in the UI is not security. Implement as a permission list per role (e.g. `sales.create`, `sales.void`, `stock.write`) checked by middleware, not hard-coded role names scattered in code. The admin can switch individual permissions off for a specific staff member (stored as per-user overrides, e.g. no discounts, no customer editing). Overrides can only remove staff permissions, never grant admin-only ones.

---

## 3. Recommended Technical Stack **[ASSUMPTION]**

The owner has not fixed the stack. Use this unless told otherwise:

- **Frontend:** React + TypeScript, Vite, Tailwind CSS, TanStack Query, React Router. Installed as a **PWA** (service worker + manifest).
- **Offline storage:** IndexedDB via **Dexie**.
- **Backend:** Node.js + TypeScript, Express (or Fastify), REST JSON API.
- **Database:** PostgreSQL (preferred, for transactions and reporting). Use an ORM/query builder such as Prisma or Drizzle with migrations.
- **Auth:** server-side sessions or short-lived JWT + refresh token in httpOnly cookie. Passwords hashed with argon2/bcrypt. Staff may use a PIN for quick till unlock (see 6.1).
- **Jobs/queue:** a simple DB-backed or BullMQ/Redis job queue for SMS sending, payment status polling, backups, scheduled reports.
- **Validation:** Zod on every API input.
- **Hosting:** a single VPS (Docker Compose: app, db, reverse proxy with HTTPS). Daily backups off the server.
- **Testing:** Vitest/Jest for unit tests, Playwright for key end-to-end flows.

Keep the code in one repository with clear folders:

```
/apps/web        # React PWA (staff + admin UI)
/apps/api        # Node API
/packages/shared # shared types, zod schemas, constants (money, phone utils)
/docs            # this spec, API notes, runbooks
```

---

## 4. Architecture

```
[Browser PWA]  <--HTTPS-->  [API server]  <-->  [PostgreSQL]
   |  IndexedDB                  |  \
   |  (catalog cache,            |   +--> Lipwa API (STK Push) ; Lipwa callback -> /api/payments/callback
   |   outbox of sales)          |   +--> SMS provider API (bulk SMS) ; delivery report webhook
   +- service worker             +--> Job worker (SMS queue, payment polling, backups, scheduled reports)
```

Principles:
- **Server is the source of truth.** The browser keeps a cache plus an outbox of unsynced actions.
- **Stock is an append-only ledger** (`stock_movements`). Current stock is derived or maintained by trigger/transaction from that ledger.
- **Money is stored as integers** in the smallest unit (cents of KES, i.e. `amount_cents`). Never use floats for money. One helper module for formatting and arithmetic.
- **Every write that matters is audited** (who, what, when, before/after).
- **Everything is multi-shop ready:** main business tables carry `shop_id` (default to the single shop). Do not build multi-shop UI yet.
- All timestamps stored in UTC, displayed in `Africa/Nairobi`.

---

## 5. Roles of the Two Portals

One web app, one login, **role-based menus and routes**. Do not build two separate apps.

- **Staff portal** (`staff` role, login required): POS, my shift, my sales, stock lookup, customer lookup, refund requests, damage/tester reports (notes to the admin; they never change stock). Staff see stock levels read-only.
- **Admin portal** (`admin` role): everything else (dashboard, inventory management, purchasing, expenses, customers, marketing, reports, staff accounts, settings, audit log). The admin can also use the POS.

The same screens (e.g. product list) render with fewer fields/actions for staff (no cost price, no edit buttons).

---

## 6. Modules and Behaviour

### 6.1 Authentication and Security
- **No public sign-up.** Accounts exist only if the admin creates them (see 6.11). Staff cannot create or edit accounts. The admin manages their own and cashier usernames/passwords from the Staff page; password changes are not available elsewhere.
- **Login is mandatory.** Every screen and every API call (except the login page and the Lipwa/SMS provider callbacks) requires an authenticated session. The POS cannot be opened and no sale can be made without a logged-in staff or admin user. Every sale, refund, and shift records which user did it.
- Login by username and role-specific PIN only. Cashier/staff PINs contain exactly 4 digits; admin PINs contain exactly 8 digits. Passwords are never accepted at sign-in.
- Admins set an account password of at least 12 characters when creating a cashier, and can later edit account passwords from the Staff page. Admins can also edit their own username/password there. Cashiers cannot change usernames or account passwords.
- Every account has its sign-in PIN when created. There is no temporary-password login or forced password-change step.
- **Offline login:** after a staff member has logged in online on a device once, the device keeps a locally hashed credential so they can unlock the till while offline. The device refreshes its user list at every sync. An account that the admin deactivated or deleted is blocked at the next sync or online check; offline devices may keep an existing session until they reconnect, so enforce a maximum offline session length (e.g. 24 hours) after which an online login is required.
- Lock screen after configurable inactivity (default 5 min on till). Auto-logout after longer inactivity (default 30 min), with a warning if there are unsynced sales.
- Failed login rate limiting and temporary lockout. Log failed attempts.
- Admin accounts: optional two-factor (TOTP). **[ASSUMPTION]** required for admin in Phase 4, optional before.
- Password changes are performed by the admin on the Staff page. Password updates do not reset the account PIN or force the account through a password-change login screen.
- **Registered devices (tills):** admin can name and approve devices; sales record `device_id`. Unregistered devices can be blocked from POS. (Phase 3.)
- Security headers, CORS restricted to the app origin, CSRF protection if cookies are used, input validation everywhere, parameterised queries only.

### 6.2 POS (the till)
**Who can sell:** both `staff` and `admin`. The admin uses the same POS screen as staff: same login, same cart, payments, receipts, and offline behaviour. When the admin sells, the sale is recorded under the admin's own name, like any other seller. Differences for the admin: discounts up to the 20% sale cap without approval, no approval needed for refunds or voids, and cost price/profit visible.
Layout: product search/scan on the left, cart on the right, payment button always visible. Keyboard friendly.

**Product lookup**
- Search by name, brand, SKU, barcode. Instant results from local IndexedDB cache (works offline).
- Barcode scan via USB scanner (keyboard wedge) and camera (optional).
- Filter chips: department (Men / Ladies / Children), type, brand, size, colour, and type-specific attributes (for example concentration for perfumes).
- Show size variant, price, and stock count on each result. Out of stock items are visibly marked and blocked unless the setting `allow_negative_stock` is on.

**Cart**
- Add/remove items, change quantity, per-line discount (percent or amount) limited by role. The combined per-line and cart discount cannot exceed 20% of the pre-discount sale subtotal. The POS uses a KES slider whose maximum is 20% of that subtotal, and the server enforces the same cap.
- Staff discounts above the staff member's personal limit require an administrator's approval; that approval cannot raise the 20% sale cap. A discount reason is required when above a set threshold.
- Attach a customer (search by phone or name, or quick-create with phone only).
- **Hold / park** carts and resume later (stored locally and synced).
- Notes per sale (e.g. gift wrapping).

**Perfume-specific selling** (applies only to the Perfumes type)
- Sell by bottle (variant) or by **decant/refill** (by ml from a bulk bottle). A decant sale deducts ml from the bulk bottle's remaining volume and records the stock movement.
- Sell **gift sets/bundles**: a bundle is a product made of component variants; selling it deducts each component.
- **Testers** are tracked as separate stock and never appear as sellable.

**Boutique and cosmetics selling**
- Clothing, shoes, and similar items are sold by **size + colour variant**. The POS shows a size/colour picker with per-variant stock, so the staff member selects the exact variant.
- Children's items use age-range sizes (e.g. 2-3Y, 4-5Y); adult items use S/M/L/XL or numeric sizes. Size sets are configurable per type.
- Cosmetics may have shade, volume/weight, and an optional **batch and expiry date**. Warn when selling near-expiry items.
- Scanning a barcode must resolve straight to the exact variant.

**Payment**
- Methods: `cash`, `mpesa_stk`, `mpesa_manual` (till/paybill code entered manually, verified later), `card` (record only, if the shop has a card machine), `credit` (customer account / lay-by, see 6.9).
- **Split payments:** any combination that sums to the total. Change due is computed for cash.
- **STK Push flow** (see 6.4): staff enters/confirms customer phone, system sends the prompt, shows "waiting for payment" with live status, then marks the payment as paid or failed. A sale is only completed once payments cover the total.
- On completion: stock is deducted, receipt generated, loyalty points awarded, sale is queued for sync if offline.

**Receipts**
- Thermal printer (ESC/POS, 58/80 mm) via browser print with a thermal-friendly layout; optional WebUSB/Bluetooth later.
- PDF receipt, plus SMS receipt (short link or summary) if the customer consents.
- Receipt shows: shop name/logo, address, phone, KRA PIN, receipt number, date/time, staff, items, discounts, VAT breakdown (if enabled), payment breakdown, M-Pesa receipt code(s), customer name/points (if attached), custom footer.
- Reprint allowed (marked "COPY"), logged.

**Returns, refunds, exchanges**
- Find the original sale by receipt number or phone. Select items and quantities, with a required reason (defective, wrong item, changed mind, etc.).
- Staff create a **refund request**; the admin approves. Approved refunds restock the item (or send it to "damaged" stock) and record the money-out method.
- Refund limits: cannot exceed what was sold and paid. Return policy is a shop setting per product type (for example no restock for opened perfume or cosmetics, a return window in days for clothing and shoes). Exchanges (same item in another size/colour, or a different item) are common for boutique items and must be quick to process.
- Exchanges are a refund plus a new sale linked together.

**Shift management**
- Open shift: choose till, enter opening cash float.
- During shift: sales, refunds, cash in/out (petty cash with reason).
- Close shift: staff counts cash (by denomination optional). System shows expected cash, M-Pesa total, card total, variance. The closing timestamp is saved with the shift and audit record, shown in the close summary and admin shift activity, and displayed in `Africa/Nairobi`. A shift close summary is saved and printable. Variance beyond a threshold is flagged for admin.
- Staff cannot sell without an open shift.

### 6.3 Offline Mode (PWA)
Required behaviours:
1. **App shell caching** via service worker (e.g. Workbox) so the app opens with no internet.
2. **Local cache in IndexedDB** of: products, variants, prices, stock levels (last known), customers (recent/all within a limit), settings, tax config, the current user's permissions. Refreshed on login and periodically when online (delta sync using `updated_at` cursors).
3. **Outbox:** every sale/refund/shift event created offline is stored in an `outbox` table with a **client-generated UUID** (`client_uuid`), a timestamp, and status (`pending`, `syncing`, `synced`, `failed`).
4. **Sync triggers:** `online` event, app start, a 30-60 second timer while online, Background Sync API where supported, and a manual **Sync now** button. Safari/iOS lacks Background Sync, so the timer and manual trigger are required.
5. **Idempotency:** the server uses `client_uuid` as a unique key. Re-sending the same sale must return the existing record, never create a duplicate.
6. **Order of sync:** process outbox items in creation order. Stop and surface the error if an item fails permanently; do not drop it.
7. **What works offline:** staff unlock with PIN/password (see 6.1), cash sales, `mpesa_manual` sales marked "pending verification", product/customer lookup, holding carts, shift open/close, receipts (local print).
8. **What does not work offline:** STK Push, sending SMS, payment verification, reports, admin management. The UI must say so clearly and disable those actions.
9. **Visible status:** always show an online/offline indicator and a counter of unsynced items. Warn before logout, before clearing data, and on app close if unsynced items exist.
10. **Local receipt numbers offline:** use a per-device prefix and sequence (e.g. `T1-000123`) and map to the server's official number after sync. Never reuse numbers.
11. **Stock conflicts:** if a synced offline sale makes stock negative, accept the sale, flag stock as negative, and show it in an admin "needs review" list. Never reject a real sale that already happened.
12. **Pending M-Pesa manual sales:** the admin verifies them against the M-Pesa statement/transaction code; unverified ones appear in a review queue.
13. IndexedDB data is considered fragile: the UI must make clear that unsynced sales are lost if browser data is cleared. Consider requesting persistent storage (`navigator.storage.persist()`).

### 6.4 M-Pesa STK Push via Lipwa
> The agent must read the current Lipwa documentation before implementing. API field names below are placeholders. Wrap the provider behind an interface so it can be swapped.

**Interface:** `PaymentProvider { initiateStk(phone, amountCents, reference, narration), queryStatus(providerRequestId), parseCallback(request) }` with a `LipwaProvider` implementation.

**Flow**
1. Staff member clicks "Pay with M-Pesa". Phone is normalised to `2547XXXXXXXX` / `2541XXXXXXXX` format (shared util, validate Safaricom numbers).
2. API creates a `payments` row (`status = pending`) with our own reference (e.g. sale or payment UUID), then calls Lipwa to initiate STK Push.
3. Customer enters PIN on their phone.
4. Lipwa calls our **callback endpoint** (`POST /api/payments/lipwa/callback`). Verify authenticity (shared secret/signature/IP allowlist per Lipwa's docs), parse, and update the payment (`paid` / `failed` / `cancelled`) with the M-Pesa receipt code, amount, phone, and raw payload stored for audit.
5. The till UI gets the update by polling `GET /api/payments/:id` every 2-3 seconds (or SSE/WebSocket), with a timeout (e.g. 90 seconds).
6. **Fallback when the callback is delayed or lost:** a background job and a "Check status" button call Lipwa's status query for payments still `pending`. A payment is never left pending forever; after the timeout it becomes `expired` and the staff member can retry or choose another method.
7. **Idempotency and safety:** callback handler is idempotent (same callback twice = one update). Verify the paid amount matches the expected amount. Handle mismatch (underpaid/overpaid) explicitly: flag it, do not silently complete.
8. **Orphan payments:** a successful callback with no matching open sale goes into an "unmatched payments" queue for admin to reconcile.
9. The sale cannot be marked complete until paid amount >= total. Never trust the browser to say "paid"; only the server's payment record counts.
10. Log every payment event. Store M-Pesa receipt code on the sale and on the receipt.

**Config** (admin settings, secrets in environment variables, never in the database in plain text or in the frontend): Lipwa credentials, callback URL, shortcode/till reference, environment (sandbox/live).

### 6.5 Inventory

**Catalog structure**
- **Hierarchy:** every product has a **department** (`men`, `ladies`, `children`, and optionally `unisex`) and a **type** (a tree, e.g. Perfumes, Body sprays, Makeup, Skincare, Hair care, Clothing > Dresses/Tops/Trousers, Shoes, Bags, Accessories, Gift sets). Department and type are **separate fields**, not one merged category tree, so reports, filters, and SMS segments can slice by either. Admin can add and edit departments and types without code changes.
- Tables: `brands`, `departments`, `product_types` (with `parent_id`), `products`, and `product_variants` (the sellable unit).
- A variant has: SKU, barcode, selling price, cost price, reorder level, active flag, image, plus **type-specific attributes** stored as structured values: perfumes use size (ml) and concentration (EDP/EDT/parfum/cologne/oil); clothing and shoes use size and colour; makeup uses shade and volume/weight; cosmetics may have batch and expiry date. Each product type defines an **attribute template** (which fields exist, which are required, allowed values such as size sets), so adding a type does not need a schema change. A product can have many variants (for example a dress in 4 sizes x 3 colours), so the admin UI must make creating a size/colour grid fast.
- Product-level metadata for recommendations: for perfumes, scent family (floral, woody, citrus, oriental, fresh, gourmand...), top/heart/base notes (tags), occasion tags, season tags, "similar to" tags. For all types: department, brand, and style/occasion tags.
- **Decant/refill support (Perfumes type only):** a variant can be flagged `is_bulk` with a total ml volume; decant variants (e.g. 5ml, 10ml) reference the bulk variant and a `ml_per_unit`. Selling a decant deducts `ml_per_unit` from the bulk bottle's remaining ml.
- **Bundles/gift sets:** `bundle_items` list components and quantities.
- **Testers:** tracked via a stock type `tester`, not sellable.

**Stock ledger**
- `stock_movements` (append-only): `variant_id`, `shop_id`, `quantity_delta` (or `ml_delta` for bulk), `type` (`purchase`, `sale`, `refund_restock`, `adjustment`, `damage`, `tester`, `transfer_in`, `transfer_out`, `stock_take`, `decant`), `reference_type/id`, `reason`, `user_id`, `created_at`.
- Current stock per variant per shop is kept in `stock_levels` and updated in the same DB transaction as the movement.
- Adjustments always require a reason and appear in the audit log.

**Stock ownership rule: only the admin adds or edits stock.**
- Admin-only actions (permission `stock.write`, enforced on the server): receive goods, create or edit a product/variant's opening or current quantity, adjustments, stock take, damage/tester write-offs, opening a new bulk bottle for decants, bulk stock import, and transfers. Staff have **read-only** access to stock levels and cannot do any of these, and permission overrides can never grant them.
- The only stock changes that happen without the admin are **automatic results of a completed sale** (deducting the sold quantity, the decant ml, or a bundle's components). These are system-generated from the sale record and are not manual edits.
- An approved refund restocks the item or sends it to damaged stock, and only the admin can approve it.
- Staff who find damaged items, testers used, or a wrong count submit a **report** (item, quantity, reason, optional photo). It appears in the admin's review queue; the admin decides and posts any stock change.

**Stock operations**
- Receive goods against a purchase order (partial receipts allowed), updating cost.
- **Stock take:** start a count session, enter counted quantities, system shows differences, admin approves, adjustments posted.
- Low-stock alerts (dashboard + optional SMS/email to owner). Reorder suggestions based on sales velocity.
- Dead-stock report (no sales in N days).
- Bulk import products/stock from CSV/Excel with a validation preview and an error report. Provide a downloadable template per product type, with one row per variant (size/colour combinations included).
- Print barcode, shelf, and price labels per variant (needed for clothing and shoes, which often have no manufacturer barcode).
- **Cost method:** **[ASSUMPTION]** weighted average cost, recalculated on each purchase receipt. Batch tracking is a later add-on.

### 6.6 Purchasing and Suppliers
- Suppliers (name, phone, email, payment terms).
- Purchase orders: draft, ordered, partially received, received, cancelled.
- Goods received notes updating stock and cost.
- Supplier balances: what is owed, due dates, payments made (cash/M-Pesa/bank) with reference.

### 6.7 Customers and Preferences
- Customer: name, phone (unique, normalised), optional email, date of birth (or just birthday month/day), gender (optional), notes, source, created date.
- **Marketing consent** fields: `sms_consent` (bool), consent date, consent source (till/form/verbal), `opted_out_at`. Required for marketing SMS (see 11).
- **Preference profile:** departments of interest (men, ladies, children, and who they usually buy for), favourite types, preferred brands, budget range, occasions, preferred sizes and colours, free-text notes. For perfume buyers also: favourite scent families and liked/disliked notes ("allergic to musk" etc.).
- Preference sources: staff entry at the till, an optional short **scent quiz**, and learning from purchase history (suggested tags, always editable).
- **Customer view:** purchase history, total spend, last visit, loyalty points/tier, outstanding credit, preference summary, recommended products.
- **Recommendations:** at the till, when a customer is attached, show suggested products matched on department, type, brand, size, budget, and (for perfumes) scent family/notes and "similar scents". Also suggest add-ons from other types (for example a gift set or accessory with a perfume). Simple scoring rules are enough (no ML required).
- Duplicate protection by phone number. Merge duplicate customers (admin).

### 6.8 Marketing: Bulk SMS (local provider)
> Provider is a **Kenyan bulk SMS service** (name to be confirmed by the owner). Implement behind an `SmsProvider` interface with an adapter per provider, so switching is a config change.

**Features**
- **Manual campaigns:** choose audience (all consenting customers, or a saved segment), write message with placeholders (`{name}`, `{last_scent}`, `{points}`), preview, character/segment counter with cost estimate, send now or schedule.
- **Segments** (saved filters): bought from a department or type (e.g. ladies' dresses, children's wear, perfumes), bought a scent family, spent over X, not visited in N days, birthday this month, loyalty tier, bought brand Y, high-value customers, never bought.
- **Automated triggers** (admin can toggle each, edit templates):
  - Thank-you after purchase (optional)
  - Review/feedback request N days after purchase
  - Birthday offer
  - Win-back after N days inactive
  - Back-in-stock for a customer's wished item
  - Low loyalty points reminder / tier upgrade
- **Transactional SMS:** receipts, shift/daily summary to owner, payment alerts. Kept separate from marketing and not blocked by marketing opt-out.
- **Safety rules:** only send marketing to customers with `sms_consent = true` and no opt-out. Include an opt-out instruction ("Reply STOP" or provider's method) in marketing messages. Honour opt-outs immediately. Respect quiet hours (e.g. no marketing 9pm-8am). Rate-limit sending.
- **Delivery tracking:** store per-message status (`queued`, `sent`, `delivered`, `failed`) from the provider's delivery report webhook, plus provider message id, cost, and failure reason.
- **Campaign report:** sent, delivered, failed, cost, and (optional) attributed sales within N days.
- **SMS balance:** show provider credit balance, alert the owner when low.
- Sending runs through a **job queue** with retries and backoff. Never send SMS inside the request that creates a sale.

### 6.9 Customer Credit, Lay-by, Pre-orders, Gift Cards, Loyalty
- **Customer credit / lay-by:** a sale can be partly paid; the balance is tracked on the customer account with payments over time. Stock is reserved or released per shop setting. Requires admin permission to enable per customer.
- **Pre-orders/deposits** for out-of-stock items: deposit recorded, linked to a pending order, converted to a sale on arrival.
- **Gift cards/vouchers:** issue with code and value, redeem as a payment method, track balance and expiry.
- **Loyalty:** points earned per amount spent (rate configurable), redeemable as a discount/payment. Tiers (e.g. Bronze/Silver/Gold) by spend. Points ledger is append-only with reasons.
- **Referral codes:** optional, reward both sides.

### 6.10 Expenses and Accounting-lite
- Expense categories (rent, power, salaries, transport, packaging, marketing, other) with amount, date, payment method, receipt photo, notes, and who recorded it.
- Petty cash in/out tied to shifts.
- Net profit report: revenue - COGS - expenses.
- Daily reconciliation: cash counted vs system, M-Pesa received (from payment records) vs sales, variance and notes.

### 6.11 Staff Management (admin only)
**Only the admin manages staff accounts.** Staff have no access to this screen or its API endpoints.
- **Create:** name, username/email, phone, account password (at least 12 characters, set by the admin), required 4-digit sign-in PIN, and personal discount limit. Role is `staff`. Launch size is 4 staff plus the admin, but do not hard-code a limit.
- **Edit:** staff username/password, name, contact details, discount limit, permission toggles (e.g. allow/deny discounts, allow/deny customer editing), reset PIN, force logout of active sessions. The same admin page lets the admin edit their own username/password.
- **Activate / deactivate:** a deactivated account cannot log in, keeps all its history, and any open sessions end. It can be re-activated.
- **Delete:** the admin can delete a staff account, with a confirmation. If the account has no history (no sales, shifts, payments, or audit entries), it is removed completely. If it has history, it is **archived**: it disappears from normal lists, cannot log in, and its name stays on historical sales, receipts, and audit logs. Never leave sales without a staff name.
- **Safety:** the last active admin cannot be deleted or deactivated, and an admin cannot delete themselves. Every action on this screen is audited.
- **Other staff features:** clock in/out (attendance), sales targets, **commission** rules (percentage of sales or per product) with a monthly commission report, and a staff performance report (sales, average sale value, discount usage, refunds/voids, cash variance per shift).
- Staff can see their own sales, shift summary, and (if enabled) their own targets. They cannot see other staff members' figures.

### 6.12 Reports and Dashboard
**Owner dashboard (live):** today's sales, number of sales, average basket, payments by method, top products, low-stock count, unsynced/pending items, unmatched payments, staff currently on shift.

**Reports** (date range filters, export to CSV/Excel/PDF):
- Sales by day/week/month, by staff, by department, by type, by product/brand, by payment method
- Gross margin and profit by product, type, and department
- Best and slowest sellers, dead stock, stock valuation; size/colour sell-through for boutique items; near-expiry cosmetics
- Discounts given, refunds, voids
- Cash shift reports and variances
- Expense and net profit report
- Customer reports: top customers, new vs returning, retention
- SMS campaign performance
- Supplier balances and purchases
- VAT report (if enabled)
- **Daily summary sent to the owner** by SMS/email at closing time (scheduled job).

**Alerts:** unusual activity (many voids/refunds, large discounts, after-hours sales), negative stock, big cash variance.

### 6.13 Settings
- Shop profile (name, address, phone, logo, KRA PIN, receipt footer). Default shop/brand name is **Eminent Jay**. The logo upload replaces the default text logo in the app header, login page, and receipts.
- Tax: VAT on/off, rate, prices tax-inclusive or exclusive, and a VAT category per product type if rates differ. **eTIMS** integration toggle (see 11.2).
- Payment settings (Lipwa), SMS settings (provider, sender ID, quiet hours), loyalty rates, staff discount limits (subject to the 20% sale cap), refund policy, negative stock policy, receipt numbering format, till/device registry, inactivity timeouts, backup settings.
- Settings changes are audited. Secrets are write-only in the UI.

### 6.14 Audit Log
Immutable log of: logins, failed logins, price changes, stock adjustments, discounts over threshold, refunds, voids, settings changes, role changes, SMS campaign sends, data exports, receipt reprints. Fields: user, action, entity, entity id, before/after JSON, device, IP, timestamp. Viewable and filterable by admin.

### 6.15 Optional Public Catalog (Phase 4)
Read-only public page listing in-stock items with price and photos and an "Order on WhatsApp" button (pre-filled message). No online payment in v1.

---

## 7. Data Model (core tables)

All tables have `id` (UUID), `created_at`, `updated_at`. Business tables have `shop_id`. Money columns end with `_cents`. Use foreign keys and indexes (phone, sku, barcode, `client_uuid`, `created_at`, `status`).

**Identity and config**
- `shops` (name, address, phone, kra_pin, logo_url, settings_json)
- `users` (shop_id, name, username/email, phone, password_hash, pin_hash, role_id, discount_limit_pct, permission_overrides_json, must_change_password, active, archived_at, created_by, last_login_at, totp_secret)
- `roles`, `permissions`, `role_permissions` (seed exactly two roles: `admin` and `staff`)
- `devices` (shop_id, name, token_hash, approved, last_seen_at)
- `settings` (shop_id, key, value_json)
- `audit_logs`

**Catalog and stock**
- `brands`, `departments` (men, ladies, children, unisex), `product_types` (parent_id for sub-types, attribute_template_json, tax_category, return_window_days)
- `products` (brand_id, department_id, product_type_id, name, description, attributes_json for product-level tags such as scent_family, notes_top/heart/base[], occasion_tags[], image_url, active)
- `product_variants` (product_id, sku, barcode, attributes_json for type-specific values such as size_ml, concentration, size, colour, shade; price_cents, cost_cents, reorder_level, batch_no, expiry_date, is_bulk, bulk_volume_ml, parent_bulk_variant_id, ml_per_unit, is_tester_allowed, active). Index the attributes used for filtering; consider typed columns for size and colour.
- `bundle_items` (bundle_variant_id, component_variant_id, quantity)
- `stock_levels` (shop_id, variant_id, quantity, ml_remaining)
- `stock_movements` (see 6.5)
- `stock_takes`, `stock_take_lines`
- `suppliers`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `supplier_payments`

**Sales**
- `sales` (shop_id, client_uuid UNIQUE, receipt_no, device_id, shift_id, seller_id, customer_id, status `[draft|completed|voided|partially_refunded|refunded]`, subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents, change_cents, notes, offline_created_at, synced_at, needs_review, review_reason)
- `sale_items` (sale_id, variant_id, qty, ml_qty, unit_price_cents, unit_cost_cents, discount_cents, tax_cents, line_total_cents)
- `payments` (sale_id, method, status `[pending|paid|failed|cancelled|expired|pending_verification|unmatched]`, amount_cents, phone, provider, provider_request_id, mpesa_receipt, raw_request_json, raw_callback_json, verified_by, verified_at)
- `refunds` (sale_id, requested_by, approved_by, status, reason, refund_method, amount_cents), `refund_items`
- `held_carts`
- `shifts` (shop_id, device_id, seller_id, opened_at, closed_at, opening_cash_cents, expected_cash_cents, counted_cash_cents, variance_cents, notes)
- `cash_movements` (shift_id, type in/out, amount_cents, reason)

**Customers and marketing**
- `customers` (shop_id, name, phone UNIQUE per shop, email, birthday, gender, sms_consent, consent_at, consent_source, opted_out_at, loyalty_points, tier, credit_balance_cents, notes)
- `customer_preferences` (customer_id, departments[], product_types[], scent_families[], liked_notes[], disliked_notes[], brands[], budget_min_cents, budget_max_cents, occasions[], sizes[], colours[], notes)
- `loyalty_ledger` (customer_id, points_delta, reason, sale_id)
- `gift_cards`, `gift_card_transactions`
- `segments` (name, filter_json)
- `sms_templates` (name, body, type)
- `sms_campaigns` (name, segment_id, body, status, scheduled_at, cost_cents)
- `sms_messages` (campaign_id, customer_id, phone, body, type `[marketing|transactional]`, status, provider_message_id, cost_cents, error, sent_at, delivered_at)
- `automation_rules` (trigger, enabled, delay_days, template_id)

**Finance**
- `expenses` (category, amount_cents, method, date, notes, receipt_url, user_id)
- `daily_closings` (date, expected/actual totals, variance, notes)

---

## 8. API Outline (REST, JSON, all under `/api`)

Conventions: plural nouns, cursor/limit pagination, consistent error shape `{ error: { code, message, details } }`, Zod validation, permission middleware on every route, `Idempotency-Key` / `client_uuid` on create endpoints used by offline sync.

- **Auth:** `POST /auth/login`, `POST /auth/pin-unlock`, `POST /auth/logout`, `POST /auth/refresh`, `GET /me`
- **Sync:** `GET /sync/catalog?since=` (products, variants, stock, customers delta), `POST /sync/outbox` (batch of offline events, returns per-item result)
- **Catalog:** `GET/POST/PATCH /departments`, `GET/POST/PATCH /product-types`, `GET/POST /products`, `GET/PATCH /products/:id`, `GET/POST/PATCH /variants`, `POST /variants/grid` (create size x colour variants in one call), `POST /products/import`, `GET /labels` (barcode/price labels)
- **Stock:** `GET /stock`, `POST /stock/adjustments`, `POST /stock/takes`, `POST /stock/takes/:id/approve`
- **Purchasing:** `/suppliers`, `/purchase-orders`, `/purchase-orders/:id/receive`
- **Sales:** `POST /sales` (idempotent), `GET /sales`, `GET /sales/:id`, `POST /sales/:id/void`, `POST /sales/:id/reprint`
- **Payments:** `POST /payments/stk` , `GET /payments/:id`, `POST /payments/:id/check`, `POST /payments/lipwa/callback` (public, verified), `GET /payments/unmatched`, `POST /payments/:id/verify-manual`
- **Refunds:** `POST /refunds` (request), `POST /refunds/:id/approve|reject`
- **Shifts:** `POST /shifts/open`, `POST /shifts/:id/close`, `POST /shifts/:id/cash-movement`, `GET /shifts`
- **Customers:** `/customers`, `/customers/:id/preferences`, `/customers/:id/history`, `/customers/:id/recommendations`, `POST /customers/merge`
- **Marketing:** `/segments`, `/sms/templates`, `/sms/campaigns`, `POST /sms/campaigns/:id/send`, `POST /sms/webhook/delivery`, `GET /sms/balance`, `/automations`
- **Loyalty/gift cards:** `/loyalty`, `/gift-cards`
- **Expenses:** `/expenses`
- **Staff:** `/users`, `/roles`, `/attendance`, `/commissions`
- **Reports:** `GET /reports/:name?from=&to=&format=json|csv|xlsx|pdf`, `GET /dashboard`
- **Settings/Audit:** `/settings`, `/audit-logs`, `/devices`

---

## 9. Key Business Rules (cheat sheet)

1. Money = integer cents. Totals computed on the server; the client total is only a preview and must match or be rejected.
2. A sale is `completed` only when `paid_cents >= total_cents`. For STK, only a server-confirmed payment counts.
3. Sale creation is **idempotent** on `client_uuid`.
4. Stock changes only through `stock_movements` inside the same DB transaction as the business event.
5. Offline sales are never rejected for stock reasons; they are flagged `needs_review` if stock goes negative.
6. The combined per-line and cart discount cannot exceed 20% of the pre-discount sale subtotal. Staff discounts above the user's personal limit require admin approval (admin PIN/override at the till) and a reason; approval cannot raise the 20% cap.
7. Refunds require a reason and approval; refunded amount cannot exceed paid amount; restock vs damaged chosen at approval.
8. Voids are only for same-day/same-shift sales (setting) and need the admin; everything is audited.
9. Cost price and profit are hidden from `staff`, both in UI and in API responses.
10. Marketing SMS only to consenting, not-opted-out customers, outside quiet hours.
11. Staff cannot sell without an open shift on a registered device (when device registry is enabled).
12. Users are deactivated, never deleted, if they have transactions.
13. Receipt numbers are unique, never reused, and sequential per shop (with device prefix for offline-created ones until synced).
14. Decant sales deduct ml from the linked bulk bottle. If the remaining ml is insufficient, a staff member sees "Ask the admin to open a new bottle" and cannot continue that sale; only the admin can open a new bottle (which records a stock movement).
15. Every settings, price, stock, role, and refund change writes an audit log entry.
16. Every product has exactly one department and one type; the required variant attributes come from the type's attribute template.
17. Perfume-only features (decants, testers, scent fields) appear only for the Perfumes type.
18. Each size/colour variant has its own SKU, barcode, and stock; the POS always sells a specific variant.
19. Return windows and restock rules follow the product type's settings; an exchange is processed as a linked refund plus new sale.
20. `seller_id` on sales and shifts is the user who made the sale (staff or admin). An admin needs an open shift to sell, exactly like staff, so cash is always tied to a shift.
21. Only the admin can add or edit stock (`stock.write`). Staff have read-only stock; the only stock changes caused by staff activity are the automatic deductions from their completed sales.
22. Admin sales appear in sales reports under the admin's name. Commission and sales targets apply to `staff` only unless the admin turns them on for an admin account.

---

## 10. UI/UX Guidelines

- Mobile/tablet/desktop responsive. The till is optimised for a touchscreen and a keyboard + scanner.
- Large tap targets on the POS, high contrast, clear totals, always-visible Pay button.
- Fast: product search under 100 ms from local cache; avoid full page reloads; optimistic UI with server confirmation for payments.
- Always show: online/offline state, unsynced count, current user, current shift.
- Clear empty states, loading states, and error messages in plain language ("M-Pesa request timed out. Retry or choose another method").
- Confirm destructive actions. Never show raw errors to staff.
- Premium, professional look in the Eminent Jay theme (white, blue, warm yellow; see 10.1). Consistent components (a small design system built on the design tokens below).
- Accessible: labels, keyboard navigation, focus states.
- Interface language English first; structure strings for English/Swahili (i18n) from the start.
- Currency displayed as `KES 1,250.00`. Phone numbers displayed locally (07xx) but stored normalised.


### 10.1 Brand and Theme: Eminent Jay (white, blue, warm yellow)

**Name:** Eminent Jay. Use it in the app header, login page, browser tab title, PWA name, receipt header, and SMS signature.

**Design intent:** calm, clear, and practical for a busy point of sale. Keep the product and admin surfaces bright, use blue for primary actions and navigation, and reserve warm yellow for totals and small highlights. Deep navy provides contrast in the sidebar and POS cart.

**How to build it:** define all tokens below once (CSS variables plus the Tailwind theme extension). **No hex colours, font sizes, radii, or shadows may be hard-coded in components.** Build a dev-only `/design` route that shows every token and component state so the look can be reviewed without clicking through the app. **[ASSUMPTION]** The blue and warm yellow values are defaults; replace them if the client provides official brand colours.

#### Colour tokens

| Token | Value | Use |
|---|---|---|
| `--ej-black` | `#14243A` | Deep navy sidebar, login background, cart panel, primary text on white |
| `--ej-ink` | `#1A2B40` | Main text and raised surfaces |
| `--ej-charcoal` | `#1D3858` | Hover/selected rows in navy areas |
| `--ej-graphite` | `#2B4A6D` | Dividers on navy |
| `--ej-blue` | `#2864C5` | Primary action, active marker, focus on dark, key actions |
| `--ej-blue-soft` | `#356FB8` | Button hover and subtle emphasis |
| `--ej-blue-deep` | `#1D4F91` | Blue text on white and focus ring on white |
| `--ej-blue-wash` | `#EAF2FB` | Selected row/card background and soft highlights |
| `--ej-yellow` | `#F2C94C` | POS total and small highlights on navy |
| `--ej-yellow-soft` | `#F7D978` | Warm yellow hover and details on navy |
| `--ej-yellow-deep` | `#745900` | Yellow text on white |
| `--ej-yellow-wash` | `#FFF7DC` | Warm highlight backgrounds |
| `--ej-white` | `#FFFFFF` | Cards, inputs, main content |
| `--ej-paper` | `#F5F8FC` | Page background, table header, disabled fill |
| `--ej-line` | `#DCE5EF` | Borders and dividers on white |
| `--ej-muted` | `#596A7E` | Secondary text on white |
| `--ej-success` / `--ej-warning` / `--ej-danger` | `#2E7D32` / `#B26A00` / `#C62828` | Status only; each has a pale wash for pills (`#E8F3E9`, `#FBEFD9`, `#FBE7E7`) |

Verify every text/background pair with a contrast checker (AA: 4.5:1 for text, 3:1 for icons, borders, and focus rings). White text on `--ej-blue` and navy text on `--ej-yellow` pass. Use `--ej-blue-deep` for blue text on white; reserve yellow text for dark navy backgrounds.

#### Accent rules
- Blue is used for primary buttons, active navigation, focus rings, and selected states (with `--ej-blue-wash`).
- Warm yellow is reserved for the POS grand total, small markers, and selected details on navy surfaces. Do not use it for body text, status colours, large backgrounds, table fills, or gradients.
- Destructive actions are always danger red, never a brand accent.

#### Typography
- **UI font:** Inter (or system UI fallback). **Brand and display font:** Playfair Display or Cormorant Garamond, used only for the Eminent Jay wordmark, login heading, and receipt header. **Self-host the fonts (woff2)** with fallbacks so the till looks identical offline.
- **Scale (px):** 12, 14, 16, 18, 20, 24, 30, 36. Body 14 (POS and touch screens 16). Page titles 24-30 semibold. Section titles 18 semibold. Labels 12-13 medium, small caps or uppercase with slight letter spacing for table headers.
- **Money and numbers:** always `font-variant-numeric: tabular-nums`, right-aligned in tables, format `KES 1,250.00`. The grand total is 32-36 px semibold.
- Line height 1.4 for UI text, 1.2 for headings. Maximum text line length about 70 characters.

#### Spacing, shape, and elevation
- **Spacing scale (px):** 4, 8, 12, 16, 24, 32, 48. Use only these. Card padding 24, form field gap 16, page gutter 24 (16 on mobile).
- **Radius:** 8 for buttons and inputs, 12 for cards, 16 for modals and the login card, full round for pills and badges.
- **Borders:** 1 px `--ej-line` on white. Prefer border plus a very soft shadow over heavy shadows.
- **Shadows:** cards `0 1px 2px rgba(11,11,11,.06), 0 4px 12px rgba(11,11,11,.05)`; menus and popovers `0 8px 24px rgba(11,11,11,.12)`; modals `0 16px 48px rgba(11,11,11,.25)`. No coloured or glowing shadows.
- **Touch targets:** at least 44 px high anywhere; 48-56 px on the POS.

#### Layout
- **App shell:** deep navy sidebar (240 px, collapsible to a 72 px icon rail; a bottom tab bar on phones), white top bar with a 1 px line. The top bar shows the shop name, the open shift, the online/offline and unsynced indicator, and the user menu. The content area is `--ej-paper`, with content on white cards.
- **Navigation item:** white icon and label; hover `--ej-charcoal`; active item has a 3 px warm yellow bar on its left edge and yellow icon/label on `--ej-charcoal`.
- **Staff see a shorter menu than the admin.** Hidden items do not leave gaps.

#### Components and states
- **Primary button:** `--ej-blue` background, white text, 600 weight, 44 px high (56 px for Pay). Hover `--ej-blue-soft`. Pressed `--ej-blue-deep` with white text. Disabled: `--ej-paper` background, `--ej-muted` text, no shadow. Loading: spinner replaces the label and the button keeps its width.
- **Secondary button:** navy background, white text (hover `--ej-charcoal`). **Tertiary/ghost:** text only with a blue underline on hover. **Danger:** red background, white text.
- **Inputs:** 44 px high, 1 px `--ej-line` border, 8 px radius, label above, helper text below in `--ej-muted`. Focus: 2 px `--ej-blue-deep` ring on white. Error: red border plus a clear message with an icon below the field.
- **Tables:** header row `--ej-paper` with 12 px uppercase `--ej-muted` labels; rows 48 px (a 40 px dense option); hover and selected `--ej-blue-wash`, selected also has a 3 px blue left border; money right-aligned; sticky header; zebra striping off by default.
- **Status pills:** pale wash background, darker text, and an icon plus a label (never colour alone). Examples: Paid, Pending, Failed, Low stock, Needs review, Synced, Offline.
- **Cards and stat cards:** white, 12 px radius, soft shadow. A stat card shows a small muted label, a large tabular number, and an optional change indicator.
- **Toasts:** navy background, white text, 3 px left border (blue for info, green for success, red for error), auto-dismiss after 4 seconds, top-right on desktop and bottom on mobile. Errors stay until dismissed.
- **Modals and drawers:** white, 16 px radius, backdrop `rgba(11,11,11,.6)`. Destructive confirmations name what will be affected and use a red confirm button.
- **Empty states:** a simple line illustration or icon, a one-line explanation, and one action.
- **Loading:** skeleton shimmer in `--ej-paper` for lists and cards; spinners only inside buttons and for payment waiting.

#### Icons, imagery, and motion
- **Icons:** one set only (Lucide), outline style, 1.75 px stroke, 20 px default and 24 px on the POS. Navy or charcoal; blue for active/highlighted icons and yellow only on navy surfaces.
- **Product images:** square (1:1), `object-fit: contain` on white or `--ej-paper`. Uploads are compressed to WebP (max 800 px) and cached for offline use (thumbnails). Placeholder: a thin blue "EJ" monogram on `--ej-paper`.
- **Motion:** 150 ms ease-out for hover and press, 200 ms for modals, drawers, and toasts. No bouncing or parallax. A short success check animation after a payment completes. Respect `prefers-reduced-motion`.

#### Screen-specific design
- **Login page:** deep navy background with a centered glass card (16 px radius), the Eminent Jay wordmark in the serif font above it in white with a 48 px by 1 px warm yellow line beneath, one blue primary button. Optional faint blue/yellow radial glow behind the card. No stock photos.
- **POS screen:** two zones.
  - Left (about 65%): search and scan bar on top; department tabs (Men / Ladies / Children) as pill tabs; type chips under them; a product grid of white cards (image, name, brand, price semibold, stock badge). The selected or just-added card gets a blue border.
  - Right (about 35%): a **deep navy cart panel** with white text; line items with quantity steppers; a subtotal and discount area; the **grand total in warm yellow at 32-36 px**; a full-width **Pay** button (blue, 56 px high, 18 px semibold) with a secondary Hold button outlined in white.
  - Payment step: large method buttons (Cash, M-Pesa, Split) 64 px high; a numeric keypad for cash tendered; the M-Pesa waiting state shows a spinner, a countdown, and clear "Check status" and "Cancel" actions.
  - Must be comfortable on a 1024x768 tablet and usable on a 360 px phone (cart becomes a bottom sheet).
- **Admin dashboard:** a row of stat cards, then a blue-and-yellow chart of sales, then two tables (low stock, pending items). Keep it airy, with no more than 4 to 6 widgets above the fold.
- **Forms (products, staff, customers):** single column or two-column on desktop, grouped in cards with section titles, a sticky save bar at the bottom with Save (blue) and Cancel (ghost).

#### Charts, reports, and print
- **Chart palette:** series 1 `--ej-blue`, series 2 `--ej-yellow-deep`, series 3 `--ej-muted`, series 4 `--ej-blue-deep`. Gridlines `--ej-line`, no heavy borders, direct labels where possible, tooltip navy with white text. Charts must stay readable in greyscale print (use markers or labels).
- **Thermal receipts:** **black and white only** (thermal printers cannot print gold). The Eminent Jay name in bold and centered at the top, a double rule, fixed-width alignment, a short footer line. Works for 58 mm and 80 mm.
- **PDF receipts, invoices, and reports:** white page, the serif wordmark, a 2 px blue rule under the header, table header in `--ej-paper`, totals in a box with a warm yellow left bar. Print stylesheet removes the sidebar and backgrounds.
- **SMS and email:** plain text signed "Eminent Jay".

#### PWA and dark mode
- **PWA:** manifest `name` and `short_name` "Eminent Jay", `theme_color` `#14243A`, `background_color` `#FFFFFF`, blue-on-navy icons (192, 512, and maskable), and a navy splash screen.
- **Dark mode (optional, Phase 4):** surfaces `--ej-black`, `--ej-ink`, `--ej-charcoal`; text `--ej-paper`; borders `--ej-graphite`; blue and yellow unchanged. The default experience is the bright content area with navy navigation.

#### Tailwind and CSS setup (reference)
```css
:root {
  --ej-black:#14243A; --ej-ink:#1A2B40; --ej-charcoal:#1D3858; --ej-graphite:#2B4A6D;
  --ej-blue:#2864C5; --ej-blue-soft:#356FB8; --ej-blue-deep:#1D4F91; --ej-blue-wash:#EAF2FB;
  --ej-yellow:#F2C94C; --ej-yellow-soft:#F7D978; --ej-yellow-deep:#745900; --ej-yellow-wash:#FFF7DC;
  --ej-white:#FFFFFF; --ej-paper:#F5F8FC; --ej-line:#DCE5EF; --ej-muted:#596A7E;
  --ej-success:#2E7D32; --ej-warning:#B26A00; --ej-danger:#C62828;
  --ej-radius-sm:8px; --ej-radius-md:12px; --ej-radius-lg:16px;
}
```
Map these into `tailwind.config` under `theme.extend.colors` (for example `ej.black`, `ej.blue`, `ej.yellow`) and use the names in components.

#### Theme acceptance criteria
- All colours, fonts, radii, spacing, and shadows come from the tokens. No hard-coded hex values outside the token file.
- All text passes WCAG AA, every interactive element has a visible focus state, and status never relies on colour alone.
- The `/design` page shows every component in all its states.
- The POS is comfortable at 1024x768 and usable at 360 px wide; Lighthouse accessibility score of 90 or more on the login, POS, and dashboard screens.
- Warm yellow appears only as a small accent on navy surfaces; blue carries primary actions.

---

## 11. Compliance (Kenya)

1. **Data Protection Act, 2019:** customer phone numbers, purchase history and preferences are personal data. Collect only what is needed, record consent for marketing, support opt-out and data deletion/export requests (admin tool), restrict access by role, and keep a privacy notice text configurable in settings. The shop may need to register with the **ODPC** as a data controller (owner to confirm).
2. **KRA eTIMS:** if the shop is VAT-registered, receipts/invoices may need to go through KRA eTIMS. Build the tax fields (PIN, VAT rate, tax per line) from the start and keep an `EtimsProvider` interface so integration can be added. **Owner to confirm** whether it is required for this client.
3. **Retention:** do not hard-delete sales, payments, or audit logs. Anonymise customers on deletion requests while keeping financial records.
4. **M-Pesa:** store M-Pesa receipt codes for every mobile-money sale for reconciliation and disputes.

---

## 12. Non-Functional Requirements

- **Availability:** the till must keep selling during internet loss (offline mode) and must open within 3 seconds on a normal laptop/phone once cached.
- **Performance:** API p95 under 300 ms for common calls; reports on 100k sales rows under 3 s with proper indexes.
- **Reliability:** DB transactions on all multi-step writes, retry with backoff on external calls, no data loss on crash.
- **Backups:** automatic daily encrypted DB backups kept off-server, retention 30 days, plus a **documented and tested restore procedure**.
- **Monitoring:** error tracking (e.g. Sentry), uptime check, and log retention. Alert on callback failures and queue backlog.
- **Security:** HTTPS only, secrets in env vars, least privilege, dependency updates, rate limiting, input validation, no sensitive data in logs, cost data hidden from staff API responses.
- **Scalability:** single shop now; schema ready for several shops without a rewrite.
- **Maintainability:** typed code, migrations, seed data, README, and a runbook for common operations.

---

## 13. Testing Requirements

- **Unit tests:** money math, discounts, tax, decant deduction, bundle deduction, phone normalisation, permission checks, loyalty calculation.
- **Integration tests:** sale creation idempotency, stock ledger consistency, payment callback handling (duplicate, mismatch, late), refund approval flow, SMS consent filtering, outbox sync ordering.
- **End-to-end (Playwright):** login, open shift, sell with cash, sell with STK (mocked provider), offline sale then sync, refund request and approval, close shift.
- **Provider mocks:** build mock `PaymentProvider` and `SmsProvider` implementations for local dev and tests.
- **Manual UAT script** for the client before go-live.

---

## 14. Delivery Plan (phases with acceptance criteria)

### Phase 1: Core POS (must be solid before anything else)
Auth + roles, departments and types, products/variants (perfume, size/colour attributes, decants, bundles), stock ledger, POS with cash and STK Push (Lipwa), receipts, shifts, refunds request/approval, basic customers, audit log, basic admin screens, staff portal, and admin-only staff management.
**Done when:** the admin can create staff accounts; a staff member can log in, open a shift, sell via cash and STK Push, print a receipt, close the shift with correct totals; stock is correct; admin can see sales and stock; all actions audited; tests pass.

### Phase 2: Offline and Sync
PWA, IndexedDB cache, outbox, idempotent sync, offline receipts, manual M-Pesa verification queue, negative-stock review list, sync status UI.
**Done when:** with the network disabled the till completes cash sales; on reconnect all sales sync once with no duplicates; conflicts show in the review list.

### Phase 3: Customers, Marketing, Purchasing
Customer preference profiles, scent quiz, recommendations, segments, bulk SMS campaigns, automations, delivery reports, suppliers and purchase orders, stock takes, bulk import, device registry.
**Done when:** a campaign to a segment sends only to consenting customers and delivery statuses update; PO receiving updates stock and cost.

### Phase 4: Professional Polish
Dashboard and full reports, expenses and net profit, loyalty tiers, gift cards, lay-by/pre-orders, commissions, owner daily summary, alerts, 2FA for admin, eTIMS (if required), public catalog, Swahili, hardware printing improvements, backups/monitoring hardening, documentation and training material.

---

## 15. Conventions for the Coding Agent

1. Read this spec first. Keep it updated in `/docs/SPEC.md` when decisions change; record decisions in `/docs/DECISIONS.md`.
2. Work phase by phase. Do not start a later phase's features until the current phase meets its acceptance criteria, unless asked.
3. Use TypeScript strict mode. Share types and Zod schemas through `/packages/shared`.
4. Every schema change goes through a migration. Provide seed data (one shop, the two roles admin and staff, an admin user, sample products).
5. Never put secrets in code or commit `.env`. Provide `.env.example`.
6. Write tests with each feature, especially money, stock, payments, and sync.
7. Keep external providers (Lipwa, SMS, eTIMS) behind interfaces with mock implementations.
8. Prefer small, reviewable commits with clear messages.
9. When something in this spec is ambiguous, ask or add `TODO(spec): question` rather than inventing behaviour.
10. Never expose cost price or profit data to the staff role in any API response.

---

## 16. Open Questions for the Project Owner

1. Which **bulk SMS provider** is the client using (API docs, sender ID, DLR webhook support)?
2. Lipwa details: environment credentials, callback security method, till/paybill setup, status query endpoint.
3. Is the shop **VAT-registered**, and is **eTIMS** required now?
4. Receipt printer model and connection type (USB/Bluetooth/network). Barcode scanner available?
5. How many tills (devices) at launch? Staff count is 4 and there are only two roles (admin, staff). Is there more than one admin account?
6. Does the shop sell **decants/refills** and **gift sets** from day one?
7. Hosting preference and budget (VPS location, domain name).
8. Negative stock policy: allow or block when online?
9. Opening stock: will the client supply an Excel list for the first import?
10. Branding assets: Eminent Jay logo file (SVG/PNG), tagline, receipt footer text, and confirmation of the official blue and warm yellow shades if the brand already has them.
11. What exactly does **boutique** include (clothing, shoes, bags, accessories, jewellery)? Which size sets and colours are used?
12. Final list of **types** under Men, Ladies, and Children. Are Unisex items needed?
13. Which types have expiry dates or return windows (cosmetics, clothing)?
14. Do all product types share the same VAT treatment?
