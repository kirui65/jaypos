# Eminent Jay UI Style Guide v2 (reference: QuickBite screenshots)

The six screenshots in `images/` are the visual reference. Study them before changing any UI. They show a food-ordering kiosk ("QuickBite") that the project owner likes. Eminent Jay must **feel like this** (simple, bold, clean, fast) but use **Eminent Jay's colours** (black, gold, white) and the features of a retail POS.

**Priority:** this guide overrides `/docs/SPEC.md` section 10.1 wherever they conflict (sidebar becomes a top bar, black cart panel becomes a white cart panel, serif headings become sans). Everything else in the spec still applies (tokens file, gold budget, accessibility, performance, permissions). The 3D/liquid background stays on the login screen only.

| File in `images/` | What it shows |
|---|---|
| 01-kiosk-cart-filled | Menu grid with items in the cart, selected cards, order panel with totals and the big Checkout button |
| 02-kiosk-cart-empty | Same screen, empty cart and disabled Checkout |
| 03-kiosk-check-your-order-dialog | Small confirmation dialog before placing the order |
| 04-owner-orders-dashboard | Owner screen: top navigation pills, stat cards, Active vs Delivered columns, order cards with status chips and actions |
| 05-owner-settings | Settings forms in stacked white cards, destructive actions in a "Data" card |
| 06-owner-invoice-preview-dialog | Invoice preview in a dialog with a monospace receipt |

## 1. Why the reference works (keep these principles)
1. **One accent colour**, used for primary actions and selected states only.
2. **Flat and clean:** white cards on a very light grey page, thin 1px borders, almost no shadows.
3. **Big tap targets** and big, bold numbers (prices, totals, counts).
4. **Black header bar** on every screen. Navigation and filters are **pills**; the selected pill is solid black with white text.
5. **Everything important fits on one screen:** items on the left, a fixed order panel on the right, total and the big button always visible.
6. **Quantity controls live on the card:** "Add" turns into a round "- 1 +" stepper and the card gets an accent border.
7. **Plain human words:** "Your order", "Back to menu", "Place order", "Mark ready". No jargon.
8. **Small, calm dialogs** with a clear title, a summary, and exactly two buttons (secondary left, primary right).
9. **Status chips** are pale tints with dark text ("Cash due", "Paid - cash").
10. Cards for orders/sales show a **big chip with the number**, the time on the right, items as "1x name", the amount in bold, then the actions.

## 2. Colour mapping (QuickBite to Eminent Jay)
Reference palette measured from the screenshots: page `#F8F8F8`, header near-black `#101818`, muted text `#606868`, border `#E8E8E8`, accent red `#D02810`, tint tiles pink `#F8E0D8` and cream `#F8F0D8`.

| Role | QuickBite | Eminent Jay token |
|---|---|---|
| Header / top bar | near-black | `--ej-black` `#0B0B0B` |
| Logo tile | yellow rounded square with letter | gold tile `--ej-gold` with black "EJ" (or the brand logo on black) |
| Page background | `#F8F8F8` | `--ej-paper` `#F7F6F2` |
| Cards, cart panel, dialogs | white | `--ej-white` |
| Borders and dividers | `#E8E8E8` | `--ej-line` `#E7E3D6` |
| Muted text | `#606868` | `--ej-muted` `#6B6B66` |
| Primary action (Checkout, Save, Place order, Mark ready) | red fill, white text | **gold `--ej-gold` fill, black text**; hover `--ej-gold-soft`; pressed `--ej-gold-deep` with white text |
| Add button on product cards | red pill | **black pill with white text** (hover `--ej-charcoal`). Reason: many gold pills on one screen looks cheap and breaks the gold budget. Make it a single token (`--ej-add-bg`) so it can be switched to gold. |
| Selected card border, stepper outline, text links ("Clear all") | red | `--ej-gold-deep` `#8A6D1A` (2px border on selected cards) |
| Selected pill | black fill, white text | same |
| Count badge on a nav pill | yellow circle | gold circle with black number |
| "Cash due" / pending chip | pale yellow | `--ej-gold-wash` fill, `--ej-gold-deep` text |
| "Paid" chip | pale green | `--ej-success` wash `#E8F3E9`, dark green text |
| Destructive (Cancel, Void, Clear all orders) | red outline/text | `--ej-danger` `#C62828` |
| Tinted image tiles (pink, cream) | pastel per category | **no pastels.** Use `--ej-paper` or `--ej-gold-wash` with the product photo (contain). Until photos exist use a neutral tile with the type's Lucide icon. |

## 3. Typography
- **UI font:** one clean humanist sans (Inter, or Noto Sans to match the reference more closely), weights 400, 600, 700. **No serif in the app.** The serif stays only for the Eminent Jay wordmark on the login screen and the receipt header.
- **Scale (px):** 12, 14, 16, 18, 20, 22, 24, 28, 32. Base text 16 on the POS and 14 in dense tables.
- **Use:** page titles 28/700; dialog titles 24/700; panel titles ("Your order") 22/700; item names 16-18/700; category or variant text 14 muted; helper text 12-13 muted; prices 18-20/700; totals 22-28/700; stat numbers 28-32/700. Money always tabular numbers, right-aligned in lists.
- Update the sweep and audit specs' allowed type scale to this list.

## 4. Shape, spacing, elevation
- Cards radius 12, dialogs radius 16, inputs radius 8-10, big CTAs and Add buttons and pills fully rounded (pill), compact action buttons inside cards radius 8.
- Cards: white, 1px `--ej-line` border, **no shadow**. Dialogs: shadow `0 16px 48px rgba(11,11,11,.25)` over a `rgba(11,11,11,.5)` backdrop.
- Page padding 24 (16 on phones), grid gap 16, section gap 24. Tap targets 44px minimum, primary CTA 56px high.

## 5. App shell: top bar replaces the sidebar
- **Top bar**, 64px high, `--ej-black`. Left: gold logo tile (40px, radius 10), brand name 18/700 white, a 12px subtitle ("Retail POS", or "Owner dashboard" for admin) in light grey.
- **Right:** navigation pills, then a user chip and a white **"Lock"** pill button (locks the till and asks for the PIN; it does not log out; sign out lives in the user menu).
  - Staff pills: Point of sale, My shift, Sales, Stock, Returns.
  - Admin adds: Overview, Catalog, Customers, Reports, Staff, Settings. Show at most 6 pills at 1366px and collapse the rest into a "More" menu. Below 1024px use a menu button; on phones use a bottom tab bar.
  - Active pill: white fill, black text, 600 weight. Inactive pills: white text, no fill, hover `rgba(255,255,255,.12)`. Counts (pending approvals, held carts) use a small gold badge.
- No sidebar. The online/offline and shift indicators sit in the top bar next to the user chip, as small status text with a dot.

## 6. Screen blueprints
### 6.1 Point of sale (references 01, 02)
- **Two columns filling the viewport (100dvh minus the top bar):** left = products (scrolls inside), right = order panel, 340-360px wide, white, 1px left border, pinned.
- **Left:** search field (48px high, white, 1px border, radius 12, icon, "/" hint), then department pills (All, Men, Ladies, Children), then a second smaller row of type pills. Pills are 44px high (type row 36px), 16/600, padding 0 20; selected = black fill + white text; unselected = white with border. Then the product grid: `grid-template-columns: repeat(auto-fill, minmax(210px, 1fr))`, gap 16. At 1366x768 at least two rows of cards must be visible.
- **Product card:** white, 1px border, radius 12, padding 12. Image tile on top (3:2, radius 8, `--ej-paper` background, product photo `object-fit: contain`). Name 16/700 (max 2 lines, then ellipsis with a title tooltip). Muted line: brand and variant ("Amber Woods - 100 ml EDP"). Bottom row: price 18/700 on the left, **Add pill** (44px high, about 72px wide) on the right.
  - If the product has several variants (size, colour), show variant chips above the price. The Add button adds the selected variant. Out of stock: dimmed card, "Out of stock" chip, no Add button. Low stock: small "3 left" chip.
  - **In the cart:** the card gets a 2px `--ej-gold-deep` border and the Add pill becomes a stepper: round 36px outlined "-" and "+" buttons with the quantity between them (like reference 01).
- **Order panel (white):** header "Your order" 22/700 with **"Clear all"** as a gold-deep underlined link on the right. Under it a customer row ("Walk-in customer", tap to attach). Line items: name 16/700, "KES 8,500 each" 12 muted, stepper under it, line total right-aligned bold, 1px separators. Empty state: plain text "Your cart is empty. Tap Add on anything you like." with a small icon.
- **Pinned footer of the panel** (always visible): rows for Subtotal, Discount, VAT, Round off (14 muted, values right-aligned), a 1px divider, **Total** 22/700 with the amount, then the **Pay pill**: full width, 56px, gold, black 18/700 text, label "Pay - KES 22,500". Disabled state: light grey fill, white-grey text (like reference 02). Below it a row with two outline pills: "Hold" and "Discount".
- **Check your order dialog** (reference 03) before payment: title "Check your order", lines "1x Item .... KES", totals block, a one-line note, then the payment method as three pill buttons (Cash, M-Pesa, Split) with their inputs (cash received with quick amounts, M-Pesa phone). Footer: outline pill **"Back to sale"** (left) and gold pill **"Complete sale"** / **"Send M-Pesa request"** (right). Success: checkmark, receipt number, buttons "Print receipt" and "New sale".

### 6.2 Sales and day view (reference 04)
- Title "Sales - Today" 28/700, right side: date input, "Today" button, "Export day (CSV)" button (white, 1px border, radius 10).
- **Stat cards row** (4 across, white, radius 12, padding 16): label 14 muted, value 28/700. Staff: Sales, Items sold, Cash collected, M-Pesa collected. Admin also sees Net revenue and Gross profit (never visible to staff).
- **Two columns** with a pale grey panel background and a count badge on each title: "In progress" (held carts, M-Pesa pending, refund requests) and "Completed".
- **Sale card:** white, radius 12, padding 16. Top row: a **number chip** (gold fill, black bold number, radius 8; grey chip for completed) and on the right the time in muted text ("06:31 pm - 14 min ago"). Then item lines "1x Name". Then amount bold on the left and the **status chip** on the right ("Payment pending", "Paid - cash", "Paid - M-Pesa", "Refunded"). Then actions: the primary action as a compact filled button, secondary actions as white outlined buttons ("Receipt", "Return"), destructive as a red outline ("Void", admin only).

### 6.3 Settings, staff, catalog forms (reference 05)
- Stacked white cards (radius 12, padding 20, 1px border), max-width 720 for forms; two-column layouts only where the content needs it (for example staff: create form on the left, team list on the right).
- Labels 14/700, inputs 44px high with radius 8 and a 1px border, helper text 12 muted below, checkboxes with a clear label, the primary "Save" gold button at the end of the card.
- A **"Data / Danger zone"** card for destructive actions: white outlined buttons with red text (never red-filled).
- Tables (staff, products, stock): white card, header row `--ej-paper` with 12px uppercase muted labels, 56px rows, one status chip per row, row actions as small outlined buttons.

### 6.4 Receipt preview dialog (reference 06)
- White dialog (radius 16, padding 24), title "Receipt EJ-000011". Inside it a bordered paper area with a **monospace** receipt: shop name in bold caps, a bordered "RECEIPT NO." box with a large number, date and reference line, dashed separators, item lines with qty, subtotal / VAT / round off / **Total** bold, a boxed payment line ("PAID - CASH"), and the footer message. Buttons: outline pill "Close" (left), gold pill "Print receipt" (right). Also offer "Download PDF" and "Send by SMS/WhatsApp" as secondary actions.

## 7. Components checklist
- **Pills** (nav, filters): 44px, radius full, selected black.
- **Buttons:** primary gold pill 56px (CTA) or 44px; secondary white with 1px border; tertiary link in gold-deep; destructive outline red; Add = black pill.
- **Steppers:** round 36px outlined buttons, quantity 16/700 between them.
- **Chips:** 12/700 text, padding 4px 10px, radius full, pale tint with dark text, with a leading dot or icon for status (never colour alone).
- **Number chips:** radius 8, 18/700, gold or grey.
- **Dialogs:** two buttons only; Escape and backdrop click close non-destructive dialogs.
- **Loading:** skeletons shaped like the real cards; **empty:** one plain sentence and one action; **error:** a pale red banner with a Retry button.

## 8. Acceptance criteria
- Side by side with the reference screenshots, the same structure and feel (top bar, pills, white cards, pinned order panel, big primary button) in Eminent Jay's colours.
- At 1366x768: the POS shows the search, both filter rows, at least two rows of product cards, and the whole order panel including the Pay button without page scroll; the grid scrolls inside its area.
- At 1024x768 and 360x740 the layout adapts (cart becomes a bottom sheet with a sticky Pay bar on phones).
- No sidebar, no letter-code icons, no pastel tiles, no serif in the app, no off-palette colours, and gold appears only where section 2 allows.
- All earlier rules still hold: tokens only, accessibility AA, staff never see cost or profit, `bash scripts/audit.sh` and the UI sweep have zero FAILs.
