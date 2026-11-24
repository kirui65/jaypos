import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

/**
 * Eminent Jay UI sweep: finds layout and content bugs across EVERY screen.
 *
 * It logs in, discovers screens by following links (sidebar, tables, tabs), visits each one at four
 * screen sizes, runs bug detectors, and writes:
 *   audit/sweep/report.md           findings grouped by rule
 *   audit/sweep/findings.json       raw findings
 *   audit/sweep/contact-sheet.html  every screen at every size on one page (open in a browser)
 *   audit/sweep/shots/*.png         the screenshots
 *
 * Run from the repo root (the API and web app must be running):
 *   E2E_BASE_URL=http://localhost:5173 E2E_ADMIN_USER=... E2E_ADMIN_PASS=... \
 *   E2E_STAFF_USER=... E2E_STAFF_PASS=... pnpm exec playwright test apps/web/e2e/ui-sweep.spec.ts
 *
 * Routes that are only reachable by clicking buttons (dialogs, drawers, multi-step flows) cannot be
 * discovered by links: list their routes in EXTRA_ROUTES, and add dialog states in STATES below.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const MAX_PAGES = Number(process.env.SWEEP_MAX_PAGES ?? 60);

const CREDS = {
  admin: { user: process.env.E2E_ADMIN_USER ?? '', pass: process.env.E2E_ADMIN_PASS ?? '' },
  staff: { user: process.env.E2E_STAFF_USER ?? '', pass: process.env.E2E_STAFF_PASS ?? '' },
};

const EXTRA_ROUTES: Record<'public' | 'admin' | 'staff', string[]> = {
  public: ['/login'],
  admin: [],
  staff: [],
};

/**
 * Extra UI states to capture after loading a route: open dialogs, drawers, tabs, etc.
 * Example: { role: 'staff', route: '/pos', name: 'payment-dialog', steps: async (page) => { ... } }
 * Keep steps non-destructive (open a dialog, never confirm a payment or delete).
 */
type StateStep = { role: 'admin' | 'staff'; route: string; name: string; steps: (page: Page) => Promise<void> };
const STATES: StateStep[] = [];

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '360x740', width: 360, height: 740 },
];

const SKIP_LINK = /log-?out|sign-?out|\/api\//i;
const OUT = 'audit/sweep';

type Raw = { severity: 'error' | 'warn'; rule: string; detail: string };
type Finding = Raw & { role: string; viewport: string; route: string };
type Shot = { role: string; viewport: string; route: string; file: string };

const findings: Finding[] = [];
const shots: Shot[] = [];

fs.mkdirSync(`${OUT}/shots`, { recursive: true });

/** Runs inside the browser. Must stay self-contained (no outside references). */
function detectInPage(): Raw[] {
  const out: Raw[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const add = (severity: Raw['severity'], rule: string, detail: string) => {
    if (out.length < 400) out.push({ severity, rule, detail });
  };
  const isVisible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const name = (el: Element) => {
    const h = el as HTMLElement;
    const text = (h.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}${text ? ` "${text}"` : ''}`;
  };
  const all = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(
    (el) => !el.closest('svg') && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION', 'TEMPLATE'].includes(el.tagName) && isVisible(el),
  );
  const hasOwnText = (el: HTMLElement) =>
    Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
  const inScroller = (el: HTMLElement, axis: 'x' | 'y') => {
    let p = el.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      const v = axis === 'x' ? cs.overflowX : cs.overflowY;
      if (v === 'auto' || v === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };

  // 1. Page-level horizontal scroll
  const overflowX = document.documentElement.scrollWidth - vw;
  if (overflowX > 1) add('error', 'page-horizontal-scroll', `page is ${overflowX}px wider than the screen`);

  for (const el of all) {
    const cs = getComputedStyle(el);
    const text = (el.innerText || '').trim();

    // 2. Clipped content (overflow hidden/clip with content that does not fit)
    const clampValue = cs.getPropertyValue('-webkit-line-clamp');
    const clamped = clampValue !== '' && clampValue !== 'none';
    if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 2 && text && !clamped) {
      add('error', 'clipped-content', `${name(el)} hides ${el.scrollHeight - el.clientHeight}px of its content`);
    }
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && text && cs.textOverflow !== 'ellipsis') {
      add('warn', 'clipped-content-x', `${name(el)} hides ${el.scrollWidth - el.clientWidth}px of its content horizontally`);
    }

    // 3. Truncated text without a tooltip
    const truncatedLine = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    const truncatedClamp = clamped && el.scrollHeight > el.clientHeight + 1;
    if ((truncatedLine || truncatedClamp) && !el.title && !el.getAttribute('aria-label')) {
      add('warn', 'truncated-without-tooltip', `${name(el)} is truncated and has no title`);
    }

    // 4. Tiny scroll boxes (usually a fixed height that is too small)
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2 && el.clientHeight < 140 && el.clientWidth > 100) {
      add('warn', 'tiny-scroll-area', `${name(el)} scrolls inside only ${el.clientHeight}px`);
    }

    // 5. Tiny text
    if (hasOwnText(el) && parseFloat(cs.fontSize) < 12) {
      add('warn', 'tiny-text', `${name(el)} is ${Math.round(parseFloat(cs.fontSize))}px`);
    }

    // 6. Large fixed overlays left on screen
    if (cs.position === 'fixed') {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > vw * vh * 0.4 && !el.matches('[role="dialog"], dialog, aside, nav, header, footer')) {
        add('warn', 'large-fixed-overlay', `${name(el)} covers ${Math.round(((r.width * r.height) / (vw * vh)) * 100)}% of the screen`);
      }
    }

    // 7. Stuck loaders
    if (/^(loading|please wait)(\.\.\.|\u2026)?$/i.test(text)) {
      add('error', 'stuck-loading', `${name(el)} is still visible after the page settled`);
    }
  }

  // 8. Interactive elements: off-screen, overlapping, buried primary actions
  const interactive = all.filter((el) => el.matches('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]')).slice(0, 150);
  const dialog = document.querySelector('[role="dialog"], dialog[open]');
  const pool = dialog ? interactive.filter((el) => dialog.contains(el)) : interactive;
  for (const el of pool) {
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el, 'x')) {
      add('error', 'control-off-screen', `${name(el)} extends outside the screen (${Math.round(r.left)} to ${Math.round(r.right)} of ${vw})`);
    }
    const label = (el.innerText || el.getAttribute('aria-label') || '').trim();
    if (/^(pay|save|create|sign in|log in|complete|confirm|submit)\b/i.test(label) && vw >= 1024 && r.bottom > vh + 1 && !inScroller(el, 'y')) {
      add(/^pay/i.test(label) ? 'error' : 'warn', 'primary-action-below-fold', `${name(el)} is below the visible area (${Math.round(r.bottom)} > ${vh})`);
    }
  }
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 0 && h > 0) {
        const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
        if (smaller > 0 && (w * h) / smaller > 0.3) add('error', 'controls-overlap', `${name(a)} overlaps ${name(b)}`);
      }
    }
  }

  // 9. Raw or technical text that should never reach the UI
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const text = (node.textContent || '').trim();
    if (parent && text && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName) && isVisible(parent)) {
      if (/\bundefined\b|\bNaN\b|\[object Object\]|\bInfinity\b|\bnull\b/.test(text)) add('error', 'raw-value', `"${text.slice(0, 40)}"`);
      else if (/\b[A-Z]{3,}(_[A-Z]{2,})+\b|SAMPLE-|lorem ipsum/i.test(text)) add('warn', 'technical-text', `"${text.slice(0, 40)}"`);
      if (/\b(\w{3,})\s+\1\b/i.test(text)) add('warn', 'repeated-word', `"${text.slice(0, 40)}"`);
    }
    node = walker.nextNode();
  }

  // 10. Repeated sibling text (for example a title and a subtitle that say the same thing)
  for (const el of all) {
    const kids = Array.from(el.children).filter((c) => isVisible(c)) as HTMLElement[];
    for (let i = 1; i < kids.length; i++) {
      const a = (kids[i - 1].innerText || '').trim();
      const b = (kids[i].innerText || '').trim();
      if (a.length >= 3 && a === b) add('warn', 'repeated-sibling-text', `"${a.slice(0, 30)}" appears twice in a row inside ${name(el)}`);
    }
  }

  // 11. Navigation without real icons (catches two-letter placeholders)
  for (const link of Array.from(document.querySelectorAll<HTMLElement>('nav a, aside a, [role="navigation"] a')).filter((l) => isVisible(l))) {
    const hasIcon = !!link.querySelector('svg, img');
    const label = (link.innerText || '').trim();
    if (!hasIcon) add('warn', 'nav-link-without-icon', name(link));
    if (/^[A-Z]{2}\b/.test(label) && label.split(/\s+/)[0].length <= 3 && !hasIcon) add('error', 'placeholder-icon-text', name(link));
  }

  // 12. Broken images
  for (const img of Array.from(document.images)) {
    if (isVisible(img) && (!img.complete || img.naturalWidth === 0)) add('error', 'broken-image', img.src.slice(0, 80));
  }

  return out;
}

async function login(page: Page, creds: { user: string; pass: string }) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel(/username|email/i).fill(creds.user);
  await page.getByLabel(/password/i).fill(creds.pass);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await page.waitForLoadState('networkidle');
}

/** Follows links breadth-first. Dynamic routes (ids) are visited once per pattern. */
async function discoverRoutes(page: Page, extra: string[]): Promise<string[]> {
  const pattern = (route: string) => route.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|\b\d+\b/gi, ':id');
  const seen = new Set<string>();
  const routes: string[] = [];
  const queue: string[] = ['/', ...extra];
  while (queue.length && routes.length < MAX_PAGES) {
    const route = queue.shift() as string;
    const key = pattern(route);
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(route);
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' }).catch(() => undefined);
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => a.getAttribute('href') || ''),
    );
    for (const href of hrefs) {
      if (!href.startsWith('/') || href.startsWith('//') || SKIP_LINK.test(href)) continue;
      const clean = href.split('#')[0].split('?')[0];
      if (!clean || /\.[a-z0-9]{2,5}$/i.test(clean) || seen.has(pattern(clean))) continue;
      queue.push(clean);
    }
  }
  return routes;
}

const slug = (s: string) => (s === '/' ? 'home' : s.replace(/\W+/g, '-').replace(/^-|-$/g, ''));

async function inspect(page: Page, role: string, vp: { name: string }, route: string, label: string) {
  const problems: string[] = [];
  const onConsole = (m: { type: () => string; text: () => string }) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text().slice(0, 120)}`);
  };
  const onPageError = (e: Error) => problems.push(`exception: ${String(e).slice(0, 120)}`);
  const onFailed = (r: { url: () => string }) => problems.push(`request failed: ${r.url().slice(0, 100)}`);
  const onResponse = (r: { status: () => number; url: () => string }) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 100)}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);

  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(700);

  const base = { role, viewport: vp.name, route: label };
  const raw = await page.evaluate(detectInPage);
  for (const f of raw) findings.push({ ...base, ...f });
  for (const p of problems) findings.push({ ...base, severity: 'error', rule: 'console-or-network', detail: p });

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of axe.violations) {
    if (v.impact === 'serious' || v.impact === 'critical') {
      findings.push({ ...base, severity: 'error', rule: `a11y-${v.id}`, detail: `${v.help} (${v.nodes.length})` });
    }
  }

  const file = `${OUT}/shots/${role}-${vp.name}-${slug(label)}.png`;
  await page.screenshot({ path: file });
  shots.push({ ...base, file: file.replace(`${OUT}/`, '') });

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('requestfailed', onFailed);
  page.off('response', onResponse);
}

test.describe.configure({ timeout: 15 * 60_000 });

for (const role of ['public', 'admin', 'staff'] as const) {
  test(`sweep: ${role} screens at every size`, async ({ page }) => {
    const creds = role === 'public' ? null : CREDS[role];
    test.skip(creds !== null && !creds.pass, `set E2E_${role.toUpperCase()}_USER and E2E_${role.toUpperCase()}_PASS`);

    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    if (creds) await login(page, creds);
    const routes = role === 'public' ? EXTRA_ROUTES.public : await discoverRoutes(page, EXTRA_ROUTES[role]);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of routes) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' }).catch(() => undefined);
        const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 300);
        if (/page not found|404/i.test(body)) {
          findings.push({ role, viewport: vp.name, route, severity: 'warn', rule: 'route-not-found', detail: 'discovered link leads to a 404 page' });
          continue;
        }
        await inspect(page, role, vp, route, route);
      }
      if (role !== 'public') {
        for (const state of STATES.filter((s) => s.role === role)) {
          await page.goto(`${BASE}${state.route}`, { waitUntil: 'networkidle' }).catch(() => undefined);
          try {
            await state.steps(page);
            await inspect(page, role, vp, state.route, `${state.route} [${state.name}]`);
          } catch (error) {
            findings.push({ role, viewport: vp.name, route: state.route, severity: 'warn', rule: 'state-step-failed', detail: `${state.name}: ${String(error).slice(0, 100)}` });
          }
        }
      }
    }

    const blocking: Record<string, number> = {};
    for (const f of findings.filter((x) => x.role === role && x.severity === 'error')) {
      blocking[f.rule] = (blocking[f.rule] ?? 0) + 1;
    }
    expect(blocking, `blocking UI problems for ${role} (see ${OUT}/report.md)`).toEqual({});
  });
}

test.afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));

  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(`${f.severity}|${f.rule}`) ?? [];
    list.push(f);
    byRule.set(`${f.severity}|${f.rule}`, list);
  }
  const lines: string[] = ['# UI sweep report', '', `Generated ${new Date().toISOString()}`, ''];
  const errors = findings.filter((f) => f.severity === 'error').length;
  lines.push(`**${errors} blocking errors, ${findings.length - errors} warnings, ${shots.length} screenshots.**`, '');
  for (const sev of ['error', 'warn'] as const) {
    lines.push(sev === 'error' ? '## Errors (fix these first)' : '## Warnings', '');
    const rules = Array.from(byRule.entries()).filter(([k]) => k.startsWith(`${sev}|`)).sort((a, b) => b[1].length - a[1].length);
    if (!rules.length) lines.push('None.', '');
    for (const [key, list] of rules) {
      lines.push(`### ${key.split('|')[1]} (${list.length})`);
      const unique = new Map<string, Finding>();
      for (const f of list) if (!unique.has(`${f.route}|${f.detail}`)) unique.set(`${f.route}|${f.detail}`, f);
      for (const f of Array.from(unique.values()).slice(0, 12)) lines.push(`- \`${f.role}\` ${f.viewport} ${f.route}: ${f.detail}`);
      if (unique.size > 12) lines.push(`- ...and ${unique.size - 12} more (see findings.json)`);
      lines.push('');
    }
  }
  fs.writeFileSync(`${OUT}/report.md`, lines.join('\n'));

  const rows = new Map<string, Shot[]>();
  for (const s of shots) {
    const key = `${s.role} ${s.route}`;
    rows.set(key, [...(rows.get(key) ?? []), s]);
  }
  const html = [
    '<!doctype html><meta charset="utf-8"><title>UI sweep contact sheet</title>',
    '<style>body{font:14px system-ui;margin:24px;background:#f7f6f2;color:#0b0b0b}h2{margin:32px 0 8px;font-size:16px}',
    '.row{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:8px}figure{margin:0}',
    'img{height:260px;border:1px solid #e7e3d6;border-radius:8px;background:#fff}figcaption{font-size:12px;color:#6b6b66;margin-top:4px}</style>',
    '<h1>UI sweep contact sheet</h1>',
  ];
  for (const [key, list] of rows) {
    html.push(`<h2>${key}</h2><div class="row">`);
    for (const s of list) html.push(`<figure><a href="${s.file}"><img loading="lazy" src="${s.file}" alt="${key} ${s.viewport}"></a><figcaption>${s.viewport}</figcaption></figure>`);
    html.push('</div>');
  }
  fs.writeFileSync(`${OUT}/contact-sheet.html`, html.join('\n'));
});
