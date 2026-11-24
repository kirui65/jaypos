# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/web/e2e/ui-audit.spec.ts >> public pages >> public | phone | /
- Location: apps/web/e2e/ui-audit.spec.ts:76:9

# Error details

```
Error: largest contentful paint in ms

expect(received).toBeLessThan(expected)

Expected: < 2500
Received:   3716
```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e4]:
    - img "Eminent Jay logo" [ref=e5]
    - paragraph [ref=e7]: Eminent Jay
  - generic [ref=e8]:
    - paragraph [ref=e9]: RETAIL POINT OF SALE
    - heading "Sign in to the till" [level=1] [ref=e10]
    - paragraph [ref=e11]: Sign in to open your shop till.
    - generic [ref=e12]:
      - generic [ref=e13]:
        - generic [ref=e14]: Username or email
        - textbox "Username or email" [active] [ref=e15]
      - generic [ref=e16]:
        - generic [ref=e17]: Password
        - textbox "Password" [ref=e18]
      - button "Sign in" [ref=e19] [cursor=pointer]
```

# Test source

```ts
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
  216 |                   for (const entry of list.getEntries()) value = entry.startTime;
  217 |                 }).observe({ type: 'largest-contentful-paint', buffered: true });
  218 |                 setTimeout(() => resolve(value), 400);
  219 |               }),
  220 |           );
> 221 |           expect.soft(lcp, 'largest contentful paint in ms').toBeLessThan(2500);
      |                                                              ^ Error: largest contentful paint in ms
  222 | 
  223 |           // 10. Screenshot for the eye test
  224 |           await page.screenshot({ path: `audit/screenshots/${role}-${vp.name}-${slug(route)}.png`, fullPage: true });
  225 |           if (role !== 'public' && route === '/') {
  226 |             await page.screenshot({ path: `audit/screenshots/after-pos-${vp.width}x${vp.height}.png`, fullPage: false });
  227 |           }
  228 |         });
  229 |       }
  230 |     }
  231 |   });
  232 | }
  233 | 
  234 | test('POS feels instant: tapping a product puts it in the cart quickly', async ({ page }) => {
  235 |   test.skip(!CREDS.admin.pass, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');
  236 |   await page.setViewportSize({ width: 1024, height: 768 });
  237 |   await login(page, CREDS.admin);
  238 |   await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  239 | 
  240 |   // Needs data-testid="product-card" on product tiles and data-testid="cart-line" on cart rows.
  241 |   const card = page.getByTestId('product-card').first();
  242 |   await card.waitFor({ state: 'visible', timeout: 20_000 });
  243 | 
  244 |   const start = Date.now();
  245 |   await card.click();
  246 |   await page.getByTestId('cart-line').first().waitFor();
  247 |   const elapsed = Date.now() - start;
  248 |   expect(elapsed, 'milliseconds from tap to cart line').toBeLessThan(150);
  249 | });
  250 | 
```