# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/web/e2e/ui-audit.spec.ts >> admin pages >> admin | phone | /admin/staff
- Location: apps/web/e2e/ui-audit.spec.ts:76:9

# Error details

```
Error: console and network problems

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "console: Failed to load resource: the server responded with a status of 401 (Unauthorized)",
+ ]
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - complementary [ref=f1e4]:
    - link "Eminent Jay RETAIL POS" [ref=f1e5] [cursor=pointer]:
      - /url: /
      - generic [ref=f1e6]:
        - generic [ref=f1e7]: Eminent Jay
        - generic [ref=f1e8]: RETAIL POS
    - navigation [ref=f1e9]:
      - generic [ref=f1e10]:
        - generic [ref=f1e11]: Sell
        - link "Point of sale" [ref=f1e12] [cursor=pointer]:
          - /url: /
        - link "My shift" [ref=f1e18] [cursor=pointer]:
          - /url: /shift
        - link "Sales and receipts" [ref=f1e23] [cursor=pointer]:
          - /url: /sales
        - link "Stock lookup" [ref=f1e28] [cursor=pointer]:
          - /url: /stock
        - link "Returns" [ref=f1e33] [cursor=pointer]:
          - /url: /refunds
      - generic [ref=f1e39]:
        - generic [ref=f1e40]: Manage
        - link "Overview" [ref=f1e41] [cursor=pointer]:
          - /url: /admin
        - link "Catalog" [ref=f1e46] [cursor=pointer]:
          - /url: /admin/catalog
        - link "Staff" [ref=f1e51] [cursor=pointer]:
          - /url: /admin/staff
      - generic [ref=f1e57]:
        - generic [ref=f1e58]: System
        - button "Sign out" [ref=f1e59] [cursor=pointer]
    - generic [ref=f1e65]:
      - generic [ref=f1e66]: E
      - generic [ref=f1e67]:
        - generic [ref=f1e68]: Eminent Jay Owner
        - generic [ref=f1e69]: Administrator
  - generic [ref=f1e70]:
    - banner [ref=f1e71]:
      - button "Open navigation" [ref=f1e72] [cursor=pointer]
      - generic [ref=f1e75]: Eminent Jay / Admin workspace
      - generic [ref=f1e76]:
        - text: Online
        - button "E" [ref=f1e79] [cursor=pointer]
    - main [ref=f1e81]:
      - generic [ref=f1e83]:
        - paragraph [ref=f1e84]: ADMINISTRATION
        - heading "Staff accounts" [level=1] [ref=f1e85]
        - paragraph [ref=f1e86]: Create and manage shop staff access.
      - generic [ref=f1e87]:
        - generic [ref=f1e88]:
          - heading "Add a staff member" [level=2] [ref=f1e89]
          - generic [ref=f1e90]:
            - generic [ref=f1e91]:
              - generic [ref=f1e92]: Full name
              - textbox "Full name" [ref=f1e93]
            - generic [ref=f1e94]:
              - generic [ref=f1e95]: Username
              - textbox "Username" [ref=f1e96]
            - generic [ref=f1e97]:
              - generic [ref=f1e98]: Temporary password
              - textbox "Temporary password At least 12 characters. They will change it at first sign in." [ref=f1e99]
              - generic [ref=f1e100]: At least 12 characters. They will change it at first sign in.
            - generic [ref=f1e101]:
              - generic [ref=f1e102]: Discount limit (%)
              - spinbutton "Discount limit (%)" [ref=f1e103]: "0"
            - button "Create staff account" [ref=f1e104] [cursor=pointer]
        - generic [ref=f1e105]:
          - heading "Team members" [level=2] [ref=f1e106]
          - table [ref=f1e108]:
            - rowgroup [ref=f1e109]:
              - row [ref=f1e110]:
                - columnheader "Name" [ref=f1e111]
                - columnheader "Username" [ref=f1e112]
                - columnheader "Status" [ref=f1e113]
                - columnheader "Access" [ref=f1e114]
            - rowgroup [ref=f1e115]:
              - row [ref=f1e116]:
                - cell "Test Cashier" [ref=f1e117]
                - cell "cashier@eminentjay.local" [ref=f1e118]
                - cell "Active" [ref=f1e119]
                - cell [ref=f1e123]:
                  - button "Deactivate" [ref=f1e124] [cursor=pointer]
```

# Test source

```ts
  15  | 
  16  | const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
  17  | 
  18  | const CREDS = {
  19  |   admin: { user: process.env.E2E_ADMIN_USER ?? '', pass: process.env.E2E_ADMIN_PASS ?? '' },
  20  |   staff: { user: process.env.E2E_STAFF_USER ?? '', pass: process.env.E2E_STAFF_PASS ?? '' },
  21  | };
  22  | 
  23  | const ROUTES: Record<'public' | 'admin' | 'staff', string[]> = {
  24  |   public: ['/'],
  25  |   admin: ['/', '/shift', '/sales', '/stock', '/refunds', '/admin', '/admin/catalog', '/admin/staff'],
  26  |   staff: ['/', '/shift', '/sales', '/stock', '/refunds'],
  27  | };
  28  | 
  29  | const VIEWPORTS = [
  30  |   { name: 'phone', width: 360, height: 740 },
  31  |   { name: 'tablet', width: 1024, height: 768 },
  32  |   { name: 'desktop', width: 1366, height: 768 },
  33  |   { name: 'laptop', width: 1280, height: 720 },
  34  | ];
  35  | 
  36  | // Design rules from the spec (section 10.1). Keep in sync with the tokens file.
  37  | const PALETTE_HEX = [
  38  |   '0B0B0B', '141414', '1C1C1C', '2A2A2A', // blacks
  39  |   'D4AF37', 'E8CF7A', '8A6D1A', 'FBF5E1', // golds
  40  |   'FFFFFF', 'F7F6F2', 'E7E3D6', '6B6B66', // neutrals
  41  |   '2E7D32', 'B26A00', 'C62828',           // status
  42  |   'E8F3E9', 'FBEFD9', 'FBE7E7',           // status washes
  43  | ];
  44  | const PALETTE = PALETTE_HEX.map((hex) => (hex.match(/../g) as string[]).map((h) => parseInt(h, 16)).join(','));
  45  | const TYPE_SCALE_PX = [12, 14, 16, 18, 20, 24, 30, 36];
  46  | const ALLOWED_FONTS = new RegExp(
  47  |   process.env.E2E_ALLOWED_FONTS ?? '^(EJ Sans|EJ Serif|Noto Sans|Noto Serif|ui-monospace|monospace|JetBrains Mono)$',
  48  |   'i',
  49  | );
  50  | const MIN_TARGET_PX = 40; // the spec asks for 44; 40 allows for rounding
  51  | 
  52  | fs.mkdirSync('audit/screenshots', { recursive: true });
  53  | 
  54  | async function login(page: Page, creds: { user: string; pass: string }) {
  55  |   await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  56  |   await page.getByLabel(/username|email/i).fill(creds.user);
  57  |   await page.getByLabel(/password/i).fill(creds.pass);
  58  |   await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  59  |   await page.waitForLoadState('networkidle');
  60  |   await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 20_000 });
  61  | }
  62  | 
  63  | const slug = (route: string) => (route === '/' ? 'home' : route.replace(/\W+/g, '-').replace(/^-|-$/g, ''));
  64  | 
  65  | test.describe.configure({ timeout: 60_000 });
  66  | 
  67  | for (const role of ['public', 'admin', 'staff'] as const) {
  68  |   test.describe(`${role} pages`, () => {
  69  |     test.skip(
  70  |       role !== 'public' && !CREDS[role as 'admin' | 'staff'].pass,
  71  |       `set E2E_${role.toUpperCase()}_USER and E2E_${role.toUpperCase()}_PASS to audit logged-in ${role} pages`,
  72  |     );
  73  | 
  74  |     for (const vp of VIEWPORTS) {
  75  |       for (const route of ROUTES[role]) {
  76  |         test(`${role} | ${vp.name} | ${route}`, async ({ page }) => {
  77  |           await page.setViewportSize({ width: vp.width, height: vp.height });
  78  | 
  79  |           const problems: string[] = [];
  80  |           if (role === 'public') {
  81  |             await page.route('**/api/auth/me', (route) =>
  82  |               route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  83  |             );
  84  |           }
  85  |           page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  86  |           page.on('pageerror', (e) => problems.push(`exception: ${String(e)}`));
  87  |           page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  88  |           page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  89  | 
  90  |           if (role !== 'public') await login(page, CREDS[role as 'admin' | 'staff']);
  91  |           await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  92  | 
  93  |           if (role !== 'public' && route === '/') {
  94  |             await expect(page.locator('.pos-page')).toBeVisible();
  95  |             const navLinks = page.locator('nav.main-nav a');
  96  |             for (let index = 0; index < await navLinks.count(); index += 1) {
  97  |               await expect(navLinks.nth(index).locator('svg'), 'each navigation item has a Lucide icon').toHaveCount(1);
  98  |             }
  99  |             const rawSkus = await page.getByTestId('product-card').evaluateAll((cards) => {
  100 |               const pattern = /\b[A-Z]{2,8}-[A-Z0-9]{2,8}-\d{2,}\b/;
  101 |               return cards.map((card) => card.textContent ?? '').filter((text) => pattern.test(text));
  102 |             });
  103 |             expect(rawSkus, 'product cards must show readable variants, never raw SKUs').toEqual([]);
  104 |             if (vp.width === 1366 && vp.height === 768) {
  105 |               const bodyScroll = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight || document.body.scrollHeight > window.innerHeight);
  106 |               expect(bodyScroll, 'POS must fit the 1366x768 viewport without body scroll').toBe(false);
  107 |               await expect(page.getByRole('button', { name: /Pay ·/ })).toBeInViewport();
  108 |             }
  109 |           }
  110 | 
  111 |           const text = (await page.locator('body').innerText()).slice(0, 400);
  112 |           test.skip(/404|page not found/i.test(text), `${route} does not exist yet`);
  113 | 
  114 |           // 1. No console errors, failed requests, or server errors
> 115 |           expect(problems, 'console and network problems').toEqual([]);
      |                                                            ^ Error: console and network problems
  116 | 
  117 |           // 2. No horizontal scrolling
  118 |           const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  119 |           expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);
  120 | 
  121 |           // 3. Accessibility (WCAG 2.1 AA): serious and critical issues fail the test
  122 |           const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  123 |           const serious = axe.violations
  124 |             .filter((v) => v.impact === 'serious' || v.impact === 'critical')
  125 |             .map((v) => `${v.id}: ${v.help} (${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'})`);
  126 |           expect(serious, 'accessibility violations').toEqual([]);
  127 | 
  128 |           // 4. Broken images
  129 |           const broken = await page.evaluate(() =>
  130 |             Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
  131 |           );
  132 |           expect(broken, 'broken images').toEqual([]);
  133 | 
  134 |           // 5. Fonts: the web fonts actually loaded and the body uses the UI font
  135 |           const fonts = await page.evaluate(async () => {
  136 |             await document.fonts.ready;
  137 |             return {
  138 |               body: getComputedStyle(document.body).fontFamily,
  139 |               loaded: Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family),
  140 |             };
  141 |           });
  142 |           expect.soft(fonts.body, 'body font-family').toMatch(/ej sans/i);
  143 |           expect.soft(fonts.loaded.length, 'web fonts loaded').toBeGreaterThan(0);
  144 | 
  145 |           // 6. Colours: only the Eminent Jay palette (catches default browser grey, stray blues, etc.)
  146 |           const offPalette = await page.evaluate((allowed: string[]) => {
  147 |             const seen = new Map<string, string>();
  148 |             for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
  149 |               const cs = getComputedStyle(el);
  150 |               if (cs.display === 'none' || cs.visibility === 'hidden') continue;
  151 |               for (const prop of ['color', 'backgroundColor', 'borderTopColor'] as const) {
  152 |                 const m = cs[prop].match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  153 |                 if (!m) continue;
  154 |                 if (m[4] !== undefined && Number(m[4]) === 0) continue;
  155 |                 const key = `${m[1]},${m[2]},${m[3]}`;
  156 |                 if (!allowed.includes(key) && !seen.has(key)) {
  157 |                   seen.set(key, `${el.tagName.toLowerCase()} (${prop})`);
  158 |                 }
  159 |               }
  160 |             }
  161 |             return Array.from(seen.entries()).map(([k, v]) => `rgb(${k}) on ${v}`).slice(0, 10);
  162 |           }, PALETTE);
  163 |           expect.soft(offPalette, 'colours outside the Eminent Jay palette').toEqual([]);
  164 | 
  165 |           // 7. Typography: sizes stay on the type scale, only approved font families
  166 |           const type = await page.evaluate((sizes: number[]) => {
  167 |             const off = new Map<string, string>();
  168 |             const families = new Set<string>();
  169 |             for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
  170 |               const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim());
  171 |               if (!hasText) continue;
  172 |               const cs = getComputedStyle(el);
  173 |               if (cs.display === 'none' || cs.visibility === 'hidden') continue;
  174 |               const px = Math.round(parseFloat(cs.fontSize));
  175 |               if (!sizes.includes(px) && !off.has(String(px))) {
  176 |                 off.set(String(px), `${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 20)}"`);
  177 |               }
  178 |               families.add(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
  179 |             }
  180 |             return {
  181 |               off: Array.from(off.entries()).map(([k, v]) => `${k}px on ${v}`).slice(0, 10),
  182 |               families: Array.from(families),
  183 |             };
  184 |           }, TYPE_SCALE_PX);
  185 |           expect.soft(type.off, 'font sizes outside the type scale').toEqual([]);
  186 |           expect.soft(type.families.filter((f) => !ALLOWED_FONTS.test(f)), 'unexpected font families').toEqual([]);
  187 | 
  188 |           // 8. Touch targets on phone and tablet
  189 |           if (vp.name !== 'desktop') {
  190 |             const small = await page.evaluate((min: number) => {
  191 |               const els = Array.from(
  192 |                 document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input:not([type=hidden]), select'),
  193 |               );
  194 |               return els
  195 |                 .filter((el) => {
  196 |                   const r = el.getBoundingClientRect();
  197 |                   const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  198 |                   return visible && !el.closest('p') && (r.height < min || r.width < min);
  199 |                 })
  200 |                 .slice(0, 8)
  201 |                 .map((el) => {
  202 |                   const r = el.getBoundingClientRect();
  203 |                   const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24);
  204 |                   return `${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`;
  205 |                 });
  206 |             }, MIN_TARGET_PX);
  207 |             expect.soft(small, `touch targets under ${MIN_TARGET_PX}px`).toEqual([]);
  208 |           }
  209 | 
  210 |           // 9. Loading speed: largest contentful paint
  211 |           const lcp = await page.evaluate(
  212 |             () =>
  213 |               new Promise<number>((resolve) => {
  214 |                 let value = 0;
  215 |                 new PerformanceObserver((list) => {
```