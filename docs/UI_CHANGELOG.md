# UI changelog

## 2026-11-26 — Left-side vertical navigation

- Moved the desktop navigation from the horizontal header into grouped Sell and Manage sections in a left sidebar.
- Kept connectivity, shift, and user controls in the main header. Tablet navigation opens as a left drawer; phone quick tabs remain available.
- Added a browser assertion for the desktop sidebar and kept the existing drawer and phone navigation checks.
- The desktop, tablet, and phone POS layout check passed. Screenshots: [desktop](../audit/screenshots/restyle-pos-empty-1366x768.png), [tablet](../audit/screenshots/restyle-pos-tablet.png), [phone](../audit/screenshots/restyle-pos-phone.png).

## 2026-11-26 — Professional login refresh

- Used the provided Eminent Jay wordmark as the default on sign-in and password-change screens, with configured shop logos still taking precedence.
- Reworked the login card hierarchy and role selector, clarified the form labels and access note, and framed the wide logo so it sits cleanly against the animated dark backdrop.
- Made the form scrollable on short phone screens. Public login checks passed at 360×740, 1024×768, 1280×720, and 1366×768, including the logo, image, accessibility, and layout checks.
- Screenshots: [phone](../audit/screenshots/public-phone-home.png), [desktop](../audit/screenshots/public-desktop-home.png).

## 2026-11-26 — Customer profiles and sales analysis

- Added customer directory search, return-visit and marketing-consent summaries, profile details, purchase history, preference editing, and an audited create/update flow.
- Added a role-gated Sales analysis page with 7/30/90-day presets, custom date filters, net sales, transactions, gross profit, payment mix, top products, and department/type results.
- Added responsive SVG charts with shaded front, top, and side faces to give sales and payment bars a 3D depth effect without adding a WebGL runtime.

## 2026-11-26 — Black, gold, white POS and tablet navigation

- Replaced the sidebar with a settings-branded black top bar, role-aware navigation, a tablet menu, and phone bottom tabs. Updated the login and authenticated app typography and palette.
- Refined the POS into a scrollable product grid with a pinned desktop order panel, touch-sized product/cart controls, and a phone cart sheet. Added mocked layout checks for phone, tablet, and desktop.
- Screenshots: [desktop empty cart](../audit/screenshots/restyle-pos-empty-1366x768.png), [desktop with item](../audit/screenshots/restyle-pos-filled-1366x768.png), [tablet](../audit/screenshots/restyle-pos-tablet.png), [phone](../audit/screenshots/restyle-pos-phone.png).

## 2026-11-24 — White, blue, and warm yellow POS theme

- Replaced the gold-on-black palette with bright white/cool-white page surfaces, blue actions and selected states, a deep navy sidebar/cart, and warm yellow sale-total accents.
- Updated shared tokens, Tailwind colors, the design preview swatches, login and boot colors, PWA theme color, and theme documentation.
- Refined operational typography to a consistent sans-serif hierarchy, strengthened primary button labels, and removed duplicate token/component declarations.
- Fixed POS cards so the full product detail and price fit, show stock on every item, and use consistent blue/yellow placeholder surfaces. The top bar now names the active route, and the held-cart control has readable contrast.

## 2026-11-24 — Loading and performance

- Added the inline dark boot splash, gold progress line, and theme color; split the compact public-login CSS from the authenticated app stylesheet so mobile login does not parse the full POS/admin CSS before sign-in.
- Added shared delayed/minimum-duration loading timing, layout-matched product/table/stat/cart/form skeletons, reduced-motion shimmer removal, fixed-width busy buttons, inert saving forms, progress feedback for background queries, and progressive product images.
- Added IndexedDB catalog warm start, catalog prefetch after login and on route hover/focus, 70 ms local search debounce, optimistic held-cart rollback, API compression, private conditional catalog caching, paged sales reads, and immutable hashed-asset caching in preview.
- Added Playwright checks for the reduced-motion static skeleton, no login shader canvas, POS product visibility within one second, route CLS, and absence of the full-screen bootstrap spinner. The app still needs per-route `React.lazy` chunks, virtualized product/sales lists, a customer API/cache, and the M-Pesa countdown/step/success/cancel UI; existing payment polling and retry remain. Sales API reads are paged, while POS products remain DOM-rendered.
- Screenshots: [before phone login](../audit/screenshots/before-phone-home.png), [after phone login](../audit/screenshots/public-phone-home.png), plus the login shader timestamps in `audit/screenshots/login-shader-0.png` through `login-shader-2.png`.
- Latest completed loading audit measurements: JavaScript 122 KB gzip (400 KB budget), desktop Lighthouse 97 with LCP 1,217 ms and CLS 0.004. The mobile Lighthouse run is variable in this environment; latest run scored 73 with LCP 1,326 ms, CLS 0.000, and TBT 1,520 ms, below the requested performance/TBT target. The final authenticated sweep was interrupted after 26/59 tests while correcting the small phone product-card target; rerun the full audit before treating this as complete.

## 2026-11-24 — Login liquid-gold treatment

- Replaced the split login screen with a centered dark glass card and token-driven near-black/bronze static backdrop. Added a lazy-loaded, standalone raw WebGL liquid-gold shader with low-resolution 30 fps rendering, damped pointer parallax, visibility pause, cleanup, and static fallback for reduced motion, save-data, low-memory/CPU, phone widths, or WebGL errors.
- Kept the shader in its own small module; the card uses a solid dark fallback when backdrop filtering is unavailable. Reduced the self-hosted logo to 320 px / about 15 KB and load it from the initial HTML. Documented glass usage limits in `docs/DECISIONS.md`.
- Playwright verifies shader rendering on a simulated capable desktop, static fallback with reduced motion, axe checks at three animation timestamps, and screenshots in `audit/screenshots/login-shader-0.png` through `login-shader-2.png`.
- Phone widths use the static gold/bronze backdrop and translucent card without backdrop blur; the shader remains available on capable larger screens. Typecheck, lint, unit tests, and UI audit pass. Latest full audit: 51 PASS, 7 WARN, 0 FAIL; mobile Lighthouse performance 87, accessibility 100, best practices 96, LCP 2,878 ms, CLS 0.000, TBT 207 ms; desktop performance 98, accessibility 100, best practices 96, LCP 1,199 ms, CLS 0.000, TBT 0 ms.

## 2026-11-24 — N1 audit completion

- Kept the existing N1 shell, product card, filter, login, toast, and status-pill implementation. Added a deterministic public brand response to the Playwright login audit so it exercises the configured logo without requiring an API or database process.
- Re-ran the audit at 360×740, 1024×768, 1280×720, and 1366×768. Public login passed all viewports; the existing POS checks assert no body scroll and an in-viewport Pay action at 1366×768, and verify that every nav link has an SVG icon.
- Latest `bash scripts/audit.sh`: **52 PASS, 6 WARN, 0 FAIL**. Mobile Lighthouse performance 87, accessibility 100, best practices 96, LCP 815 ms, CLS 0.002; TBT 506 ms is a WARN. Desktop performance 100, accessibility 100, best practices 96, LCP 295 ms, CLS 0.001, TBT 0 ms.
- The audit saved updated public login screenshots for all four viewports in `audit/screenshots/`. Admin and staff routes were skipped because `E2E_ADMIN_*` and `E2E_STAFF_*` credentials were not configured; authenticated POS and sales could not be visually rechecked in this run.

## 2026-11-23

- Moved palette, typeface, radius, and shadow definitions into `apps/web/src/tokens.css` and made the application stylesheet consume the shared tokens.
- Aligned the browser audit with the real routes and auth flow, corrected the POS route, and set the add-to-cart threshold to 150 ms.
- Added POS product/cart test IDs, search autofocus, `/` search focus, Enter-to-add, Ctrl+Enter payment, and Escape-to-close behavior.
- Replaced template welcome copy and dingbat navigation marks, added a branded 404, route-aware tab titles, a favicon, a PWA manifest, theme color, and a self-hosted font preload.
- Added image dimensions and reduced-motion behavior; updated audit invocation for the available Corepack pnpm setup.
- Added route-aware page titles, Nairobi-local date/time formatting, payment status announcements, and barcode matching in the local product search.
- Added a lightweight unauthenticated entry and deferred the authenticated shell, query client, and router into a separate chunk. The latest build is about 124 KB gzip across the JavaScript bundles.
- Normalized rendered font sizes to the spec scale and corrected inherited control border colors.
- Deferred service-worker registration until authentication. The app now registers `/sw.js` through the browser API; PWA generation remains enabled in Vite without injecting registration into the public login page.
- Replaced the React login entry with semantic static HTML and a small native fetch bootstrap. React and the app shell are imported only when `/auth/me` finds a session or login succeeds. Removed the large Noto Sans preload so it does not compete with first paint.
- Added the provided Eminent Jay logo to login and password-change screens as an optimized 800 px WebP (about 76 KB from the original 1.2 MB PNG).

### Screenshots

- `audit/screenshots/before-phone-home.png`, `before-tablet-home.png`, and `before-desktop-home.png` preserve the public login view from before the final font-size and border-color adjustments.
- `audit/screenshots/public-phone-home.png`, `public-tablet-home.png`, and `public-desktop-home.png` are the latest after screenshots.

### Verification follow-up

- The latest loading changes pass typecheck, lint, tests, and build. The latest mobile Lighthouse measurement remains below target because of high TBT; the final Playwright sweep needs a clean completion after the phone product-card sizing fix. See `docs/PROGRESS.md` for the current handoff.

## 2026-11-24 — Owner profitability and sales invoices

- Added owner dashboard cards for today's net sales, gross profit, and gross margin, with the seven-day chart using server-calculated refund-aware totals.
- Added Invoice PDF actions to sales records, and previous/next pagination to browse beyond the first 100 transactions.
- Checkout now accepts optional customer name, phone, and email for invoices. Printable sales invoices include those details and clearly state that the PDF is not an eTIMS tax invoice.
- Added a Download report PDF action to the admin overview and a product photo form with URL, device upload, camera capture, and live preview options.
- Corrected a late square-image rule that overrode the POS card art height. Cards now keep the price visible, clamp long product names cleanly, and reveal the branded fallback when a linked image cannot load.
- Added an item-by-item checkout review modal with quantity edit and remove controls, plus an admin editor for business details and receipt/invoice copy.
- Made review quantity buttons visibly blue on white, clarified their disabled state, and separated lowering quantity from removing a cart item.
- Added a print-ready invoice preview with print and PDF download actions from Sales & receipts; the admin Receipts & invoices screen now shows live receipt and invoice samples that respond to template edits.
- Unified operational page, modal, and table typography around the Noto Sans UI face and a consistent size/weight hierarchy while preserving the brand wordmark treatment.
