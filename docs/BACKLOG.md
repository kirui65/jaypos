# Eminent Jay - Build Backlog (after M7)

Read `/docs/SPEC.md` first. This file lists everything still missing, in the order to build it. If this file and the spec disagree, the spec wins; record the conflict in `/docs/DECISIONS.md`.

## How to work
- Do **one milestone at a time** (N1, N2, ...). Finish it completely, then stop and report.
- At the end of every milestone: run `pnpm -r typecheck`, lint, tests, then `bash scripts/audit.sh`. Fix every FAIL. Commit with a clear message. Write what changed in `docs/UI_CHANGELOG.md` and save before/after screenshots in `audit/screenshots`. Then wait for me to say "next".
- Test every screen at 1366x768, 1280x720, 1024x768 and 360x740.
- Scope tags: **[IN SCOPE]** is included in the contract price. **[ADD-ON]** is a paid extra: build it only when I ask, and keep the code ready for it (interfaces, `shop_id`, permissions).

## Global rules (apply to every milestone)
- **Design:** use only the tokens in the tokens file (section 10.1 of the spec). Icons are Lucide only (20px, 1.75 stroke). No two-letter placeholders, no emoji, no text symbols used as icons, no raw SKU strings or enum values shown to users.
- **Every screen** has loading (skeleton), empty (one clear action), and error states with human wording. Tab titles per page. Money is right-aligned with tabular numbers, formatted `KES 1,250.00`. Dates use `en-KE` and `Africa/Nairobi`.
- **Layout:** fixed-viewport shell (100dvh). Only inner panels scroll, with thin custom scrollbars. Primary actions (Pay, Save) are always visible without scrolling at 1366x768.
- **Brand name and logo come from settings** (`brand_name`, `logo_url`). Do not hard-code the product name anywhere. (The spelling "Jay" vs "Jae" is still unconfirmed with the client.)
- **Permissions (server-side, always):** two roles only, `admin` and `staff`. Only admin adds or edits stock. Staff never receive cost price or profit in any API response. Staff cannot manage accounts. Every important action writes an audit entry.
- **Money** is integer cents. Sale creation stays idempotent on `client_uuid`. Totals are recomputed on the server.
- Write tests with each feature. Add Playwright checks for new screens to `apps/web/e2e/ui-audit.spec.ts` (routes, test ids).

---

## N1 [IN SCOPE] UI foundation and shell polish
- Fixed-viewport app shell. Sidebar with Lucide icons, grouped sections (Sell, Manage, System). Active item = 3px gold bar + charcoal background + gold icon (not a solid fill). One consistent hover state. Admin sees the extra sections; staff see a shorter menu.
- Compact top bar (shop name, open shift, online/sync indicator, user menu). Remove big page titles on the POS.
- Product cards: 4:3 image area, name 15px semibold, brand muted, readable variant chips ("100 ml", "EDP", "Navy / 4-5Y"), bold price, stock shown only when low or out, hover lift, pressed state, quantity badge when already in the cart. Type-specific placeholder (tinted tile with the type's icon and the product name) until a photo exists, never the same monogram everywhere.
- Filter chips: clear selected state (gold-wash fill, gold-deep text and border). Custom focus ring (gold-deep on light, gold on dark).
- Login: logo on a black panel or circular crop (no black square inside the white card), split layout on wide screens, fits 768px height with no scroll.
- Toasts: bottom-center, never covering cart actions. Status pills: one pill per row.
- Playwright checks: POS at 1366x768 has no body scroll and the Pay button is inside the viewport; every nav link contains an `<svg>`.
- **Done when:** the audit has zero FAILs and the POS, login, and sales screens look finished at all four sizes.

## N2 [IN SCOPE] POS completion
- **Customer:** attach by phone or name (search as you type), quick-create with phone only, marketing-consent checkbox, customer chip in the cart. Show their preferences and recommended products when attached.
- **Discounts:** line and cart discounts (percent or amount) within the user's limit. Above the limit asks for an admin PIN/override and a reason. Sale notes.
- **Cart rows:** full product name (wrap, never truncate), variant chips, unit price, quantity stepper, remove button, undo after remove.
- **Held carts:** "Held (n)" button, hidden section when empty, resume and discard.
- **Payment dialog:** method cards with Lucide icons (Cash, M-Pesa, Split, and Manual M-Pesa when offline). Cash: quick-amount buttons (exact, 500, 1,000, 2,000), numeric keypad, change due. M-Pesa: phone field prefilled from the customer, "Send request", waiting state with countdown, "Check status", "Cancel", success and failure states. Split: builder that shows the remaining balance. No duplicated labels.
- **After payment:** success screen with receipt options (print 80mm, print 58mm, PDF, SMS or WhatsApp link) and a "New sale" button.
- **Speed and input:** barcode scanner support (keyboard wedge, with a visible "scanned" flash), autofocus, "/" focuses search, Enter adds the first match, Ctrl+Enter opens payment, Esc closes dialogs. Quick-sell favourites strip (admin picks favourites). Tap-to-cart in under 150 ms.
- If no shift is open, show a clear "Open your shift" prompt instead of a broken POS.
- **Done when:** a full sale (customer, discount, cash or M-Pesa, receipt) can be completed with the keyboard and with touch, and the tests cover discounts, limits, and payment states.

## N3 [IN SCOPE] Shifts and day-end
- **My shift:** open (float count), live totals (cash, M-Pesa, card, refunds), cash in/out with reasons, close with a denomination count and variance.
- Shift summary printable (A4 PDF and 80mm). Admin shift list with variance flags and a detail view.
- **End-of-day (Z) report:** sales by payment method, refunds, discounts, cash variance, top items. Printable and PDF.
- **Done when:** closing a shift produces correct totals that match the sales list, and variances beyond a configurable threshold are flagged.

## N4 [IN SCOPE] Stock management (admin only)
- **Stock screen:** levels per variant with filters (department, type, low, out), search, movement history per variant. Staff get the same screen read-only.
- **Admin actions:** receive goods, adjustment (reason required), stock take sessions (count, review differences, approve), write-off damaged and tester items, open a new bulk bottle, CSV/Excel import with a validation preview and error report, per-type import templates.
- **Damage/tester reports:** staff submit (item, quantity, reason, optional photo). Admin review queue to approve (posts the stock change) or reject.
- **Labels:** print barcode, shelf, and price labels per variant.
- **Alerts:** low-stock and negative-stock review list.
- **Tests:** staff cannot call any stock write endpoint (403), every movement is in the ledger and audited.
- **Done when:** the admin can onboard the opening stock from a spreadsheet and the ledger reconciles with the levels.

## N5 [IN SCOPE] Catalog administration
- Products and variants forms using the type's attribute template, size/colour grid creator, image upload (resize to WebP, max 800px, cached thumbnails), departments and types management, brand management, active/inactive toggles, price and cost editing (admin only), duplicate product.
- Product list with search, filters, and bulk actions (activate, deactivate, change price).
- **[ADD-ON]** decants (bulk bottle linking), bundles/gift sets, testers setup UI. Keep the data model ready.
- **Done when:** a new perfume, a clothing item with sizes and colours, and a cosmetic can be created end to end, with photos, and sold at the POS.

## N6 [IN SCOPE] Staff management completion (admin only)
- Staff list with search, status (one pill: Active / Deactivated), last login, role.
- Create (temporary password, optional PIN, discount limit), edit, reset password/PIN, set discount limit, permission toggles (can only remove staff permissions), force logout, activate/deactivate.
- **Delete:** hard delete if no history, otherwise archive (cannot log in, name stays on records). Last admin cannot be deleted or deactivated. Confirmation dialogs name what will happen.
- Per-staff activity view (sales, refunds, discounts, cash variance, recent logins).
- **[ADD-ON]** attendance (clock in/out), targets, commission rules and monthly commission report.
- **Done when:** the admin can run the whole staff lifecycle without touching the database, and tests cover the safety rules.

## N7 [IN SCOPE] Customers and preferences
- Customer list with search and filters, profile page (purchase history, total spend, last visit, notes), preference form (departments, types, brands, sizes, colours, budget, scent families for perfume buyers, free-text notes), consent and opt-out fields with the date and source.
- Merge duplicates (admin). Data-protection tools (admin): export a customer's data, anonymise on request while keeping financial records.
- Recommendations panel at the POS (department, type, brand, size, budget, and scent family for perfumes).
- **[ADD-ON]** scent quiz, birthday list, referral codes.
- **Done when:** preferences show up at the POS for an attached customer, and an opted-out customer is never included in marketing audiences.

## N8 [IN SCOPE] Settings, audit log, payments queue
- **Settings:** shop profile (brand name, logo, address, phone, KRA PIN), receipt layout and footer with live preview (80mm and 58mm), tax (VAT on/off, rate, inclusive/exclusive, category per type), discount limit defaults, negative-stock policy, session timeouts, Lipwa config (secrets masked, "Test connection"), SMS provider config (masked, balance display). Secrets are write-only.
- **Audit log viewer:** filter by user, action, entity, date. Export to CSV. Read-only.
- **Payments queue:** unmatched payments (assign to a sale or mark as reviewed), pending manual M-Pesa verifications (admin confirms against the transaction code), failed and expired payments with retry.
- **Done when:** the admin can configure the shop from the UI only and every settings change appears in the audit log.

## N9 [IN SCOPE] Dashboard and basic reports
- **Dashboard:** stat cards (today's sales, number of sales, average sale, payment mix), 7-day sales chart (gold and black), top products, low-stock list, pending items (unmatched payments, refund requests, damage reports), staff currently on shift. No more than 6 widgets above the fold.
- **Reports** with date range and export (CSV, Excel, PDF): sales by day/week/month, by staff, by department, by type, by product, by payment method; profit by product, type, and department (admin only); stock valuation; discounts and refunds.
- **[ADD-ON]** expenses and net profit, owner daily-summary SMS, supplier balances, anomaly alerts.
- **Done when:** report totals match the sales list and the Z report, and cashiers cannot reach profit data.

## N10 [IN SCOPE] Offline mode (basic)
- Implement spec section 6.3: service worker for the app shell, IndexedDB cache (catalog, customers, settings, permissions), outbox with `client_uuid`, idempotent sync, offline unlock for already-known staff (24h maximum), offline cash sales and "M-Pesa pending verification" sales, offline receipts with a local number prefix, visible online/offline state with an unsynced counter, "Sync now" button, warning before logout with unsynced items, negative-stock review list.
- Disable STK Push, SMS, and admin management screens while offline, with a clear message.
- **Tests:** Playwright with the network disabled (sell offline, reconnect, verify one sale per `client_uuid`, no duplicates).
- **Done when:** the shop can keep selling cash with the internet off and everything syncs correctly afterwards.

## N11 [IN SCOPE] Manual bulk SMS
- `SmsProvider` interface with a mock and an adapter for the chosen local provider (leave clearly marked `TODO(sms-provider)` where the provider's real API details are needed; do not invent fields).
- Compose screen: audience (all consenting customers, or a department/type filter), placeholders (`{name}`), character and segment counter with cost estimate, preview, send now or schedule, quiet hours, opt-out line.
- Delivery report webhook, per-message status, campaign history and report, provider balance display. Sending runs through a job queue with retries.
- **[ADD-ON]** saved segments, automated triggers (thank-you, birthday, win-back, back-in-stock), attributed sales.
- **Done when:** a test campaign sends only to consenting customers, delivery statuses update, and opt-outs are respected.

## N12 [ADD-ON] Later phases (build only when requested)
Purchasing and suppliers, expenses and net profit, loyalty tiers, gift cards, lay-by and pre-orders, commissions, automated SMS and segments, public catalog with WhatsApp ordering, 2FA for admin, eTIMS (if the client is VAT-registered), dark mode, multi-branch UI.

## N13 [IN SCOPE] Finishing touches that make it feel premium
- Command palette (Ctrl/Cmd+K): jump to screens, search products and customers.
- Keyboard shortcut help panel ("?").
- Notification bell (low stock, pending approvals, failed payments).
- First-run setup wizard (brand, logo, tax, receipt, first admin, first products).
- Designed 404 and error pages, favicon, app icons, per-page tab titles, unsaved-changes warning on forms.
- Unsupported-feature banners are friendly and specific.
- **Realistic demo seed data:** about 40 products across perfumes (real brands), cosmetics, men's, ladies' and children's clothing with sizes and colours, 25 customers with preferences, and 30 days of sales with a believable mix of payment methods. Used for demos, switchable off for production.

## N14 [IN SCOPE] Final QA and handover
- Zero FAILs in `bash scripts/audit.sh`, including Lighthouse (login) and the Playwright UI audit with staff and admin credentials. Accessibility violations: none serious or critical.
- Performance: API p99 under 300ms on the health and sales endpoints; no screen over 1s to interactive on the preview build.
- Docs: `docs/USER_GUIDE.md` (staff and admin, with screenshots), `docs/DEPLOYMENT.md` (Render + Supabase + domain, environment variables, backup and restore steps), `docs/HANDOVER.md` (checklist, credentials process), and a 20-minute staff training script.
- Security pass: dependency audit, rate limits, no secrets in the repo, RLS on every table, cost data hidden from staff responses (tested).
