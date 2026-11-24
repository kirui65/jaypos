# UI changelog

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

### Verification still open

- Latest full audit after the static login and font-preload changes: typecheck, lint, tests, build, static UI checks, desktop Lighthouse, and Playwright/axe pass. Mobile performance is 72/85 and TBT is 1,966/200 ms, so both mobile targets remain unmet. LCP is 870 ms and CLS is 0.000. Script evaluation is only 301 ms; remaining long tasks are mostly style/layout and unattributed work in this local throttled run. See `docs/PROGRESS.md` for the handoff.
