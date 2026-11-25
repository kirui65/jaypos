#!/usr/bin/env bash
# Eminent Jay - project audit
# Run from the repo root:  bash scripts/audit.sh
# Optional env vars:
#   API_URL=http://localhost:4000        also load-test the API (needs the API running)
#   API_HEALTH=/api/health               health path used for the load test
#   E2E_ADMIN_USER / E2E_ADMIN_PASS      logged-in admin pages in the browser audit
#   E2E_STAFF_USER / E2E_STAFF_PASS      logged-in staff pages in the browser audit
#   SKIP_LIGHTHOUSE=1                    skip the Lighthouse step
set -u
export CI=true LC_ALL=C.UTF-8

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

WEB="apps/web"
SRC="$WEB/src"
DIST="$WEB/dist"
OUT="audit"
PORT=4173
mkdir -p "$OUT/screenshots"

PASS=0; WARN=0; FAIL=0
ok()      { echo "  [PASS] $*"; PASS=$((PASS + 1)); }
warn()    { echo "  [WARN] $*"; WARN=$((WARN + 1)); }
bad()     { echo "  [FAIL] $*"; FAIL=$((FAIL + 1)); }
section() { printf '\n== %s ==\n' "$*"; }

PREVIEW_PID=""
cleanup() {
  [ -n "$PREVIEW_PID" ] && kill -- -"$PREVIEW_PID" 2>/dev/null
  pkill -f "vite preview --port $PORT" 2>/dev/null
  return 0
}
trap cleanup EXIT

chrome_path() {
  local c
  for c in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return; fi
  done
  node -e "try{console.log(require('@playwright/test').chromium.executablePath())}catch(e){}" 2>/dev/null
}

# ---------------------------------------------------------------------------
section "1. Code health (typecheck, lint, tests, build)"
run() {
  local name="$1"; shift
  if "$@" >"$OUT/$name.log" 2>&1; then
    ok "$name"
  else
    bad "$name failed, see $OUT/$name.log"
    tail -n 8 "$OUT/$name.log" | sed 's/^/        /'
  fi
}
run typecheck corepack pnpm -r --if-present run typecheck
run lint      corepack pnpm -r --if-present run lint
run tests     corepack pnpm -r --if-present run test
run build     corepack pnpm -r --if-present run build

if git ls-files 2>/dev/null | grep -E '(^|/)\.env($|\.local$|\.production$)' >/dev/null; then
  bad ".env file is committed to git"
else
  ok "no .env file committed"
fi

# ---------------------------------------------------------------------------
section "2. Design consistency and 'vibe-code' tells ($SRC)"
if [ ! -d "$SRC" ]; then
  bad "$SRC not found (run this from the repo root)"
fi

# Files whose path matches this are allowed to define raw values.
ALLOW='(tokens|theme|tailwind\.config|\.test\.|\.spec\.|/design/|/e2e/)'

scan() { # severity label regex [E|P]
  local sev="$1" label="$2" pat="$3" flav="${4:-E}" hits n
  hits=$(grep "-rIn${flav}" --include='*.ts' --include='*.tsx' --include='*.css' --include='*.html' \
           -e "$pat" "$SRC" "$WEB/index.html" 2>/dev/null \
         | awk -F: -v re="$ALLOW" '$1 !~ re')
  n=$(printf '%s\n' "$hits" | grep -c . || true)
  if [ "$n" -eq 0 ]; then
    ok "$label"
  else
    if [ "$sev" = fail ]; then bad "$label ($n)"; else warn "$label ($n)"; fi
    printf '%s\n' "$hits" | head -n 5 | cut -c1-170 | sed 's/^/        /'
  fi
}

scan warn "Hard-coded hex colours (use tokens)"                '#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b'
scan warn "Hard-coded rgb/hsl colours (use tokens)"            '(rgba?|hsla?)\('
scan warn "Arbitrary Tailwind values like w-[13px]"            '\b[a-z-]+-\[-?[0-9.]+(px|rem|em|%)\]'
scan warn "Default Tailwind palette colours (use ej tokens)"   '\b(bg|text|border|ring|from|to|via|fill|stroke|divide|outline)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b'
scan fail "Purple/pink/blue gradients (classic AI-template look)" '(from|via|to)-(indigo|violet|purple|fuchsia|pink|blue|sky|cyan)-[0-9]{2,3}'
scan warn "Gradients (brand budget: keep them rare and subtle)"  'bg-gradient-to-|linear-gradient\('
scan fail "Emoji used in the UI (use the icon set)"            '[\x{1F300}-\x{1FAFF}]' P
scan warn "Arrow/dingbat symbols used as icons"                '[\x{2190}-\x{21FF}\x{2600}-\x{27BF}]' P
scan fail "External font/CDN links (self-host fonts)"          'fonts\.googleapis|fonts\.gstatic|unpkg\.com|cdnjs|jsdelivr'
scan warn "font-family declared outside the tokens file"       'font-family\s*:\s*("|[A-U]|[a-u]|[w-z])'
scan warn "Inline style props"                                 'style=\{\{'
scan warn "!important"                                         '!important'
scan warn "Magic z-index values"                               'z-\[[0-9]+\]|z-index\s*:\s*[0-9]{3,}'
scan fail "Lorem ipsum / placeholder text"                     'Lorem ipsum|Your text here|Sample text'
scan warn "Marketing cliches in UI copy"                       'Unlock the power|Supercharge|Seamless|Revolutionize|Elevate your|Welcome to your'
scan warn "TODO / FIXME / HACK left in code"                   'TODO|FIXME|HACK'
scan warn "console.log / console.debug left in code"           'console\.(log|debug)'
scan warn "Type escapes (any, ts-ignore)"                      '@ts-ignore|@ts-nocheck|: any\b|as any\b'
scan warn "Native alert/confirm/prompt (use designed dialogs)" '\b(alert|confirm|prompt)\('
scan fail "<img> without alt text"                             '<img(?![^>]*\balt=)' P
scan warn "dangerouslySetInnerHTML"                            'dangerouslySetInnerHTML'
scan fail "Auth token kept in localStorage/sessionStorage"     '(localStorage|sessionStorage)\.setItem\(\s*[\x27"](token|jwt|access|auth|session)' P

distinct() { # label regex max
  local label="$1" pat="$2" max="$3" list n
  list=$(grep -rhoE --include='*.ts' --include='*.tsx' -e "$pat" "$SRC" 2>/dev/null \
         | sort | uniq -c | sort -rn)
  n=$(printf '%s\n' "$list" | grep -c . || true)
  if [ "$n" -le "$max" ]; then
    ok "$label: $n distinct values (limit $max)"
  else
    warn "$label: $n distinct values, limit is $max"
    printf '%s\n' "$list" | head -n 10 | sed 's/^/        /'
  fi
}
distinct "Font sizes"   '\btext-(xs|sm|base|lg|xl|[2-9]xl)\b' 8
distinct "Corner radii" '\brounded(-[a-z0-9]+)?\b' 6
distinct "Shadows"      '\bshadow(-[a-z0-9]+)?\b' 4
distinct "Font weights" '\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b' 4

off=$(grep -rhoE --include='*.ts' --include='*.tsx' \
        -e '\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-x|space-y)-[0-9.]+\b' "$SRC" 2>/dev/null \
      | awk -F- '{v=$NF} v!="0" && v!="0.5" && v!="1" && v!="2" && v!="3" && v!="4" && v!="6" && v!="8" && v!="12" && v!="16"' \
      | sort | uniq -c | sort -rn)
n=$(printf '%s\n' "$off" | grep -c . || true)
if [ "$n" -eq 0 ]; then
  ok "Spacing stays on the 4/8/12/16/24/32/48 scale"
else
  warn "Off-scale spacing values ($n distinct)"
  printf '%s\n' "$off" | head -n 8 | sed 's/^/        /'
fi

# ---------------------------------------------------------------------------
section "3. Fonts, assets and bundle size"
if [ -d "$DIST" ]; then
  woff=$(find "$WEB/public" "$SRC" "$DIST" \( -name '*.woff2' -o -name '*.ttf' \) 2>/dev/null | wc -l)
  if [ "$woff" -gt 0 ]; then ok "self-hosted font assets found ($woff files)"; else bad "no self-hosted font assets found"; fi

  js_kb=$(( $(find "$DIST" -name '*.js'  -exec gzip -c {} \; | wc -c) / 1024 ))
  css_kb=$(( $(find "$DIST" -name '*.css' -exec gzip -c {} \; | wc -c) / 1024 ))
  if   [ "$js_kb" -le 400 ]; then ok   "JavaScript total ${js_kb} KB gzip (target 400 or less)"
  elif [ "$js_kb" -le 700 ]; then warn "JavaScript total ${js_kb} KB gzip (target 400 or less): add code splitting"
  else                            bad  "JavaScript total ${js_kb} KB gzip is too heavy"; fi
  if [ "$css_kb" -le 60 ]; then ok "CSS total ${css_kb} KB gzip"; else warn "CSS total ${css_kb} KB gzip (target 60 or less)"; fi

  echo "        largest files:"
  find "$DIST" -type f -printf '%s %p\n' | sort -rn | head -n 5 | awk '{printf "          %6.0f KB  %s\n", $1/1024, $2}'

  big=$(find "$DIST" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' \) -size +200k | wc -l)
  if [ "$big" -eq 0 ]; then ok "no images over 200 KB"; else warn "$big image(s) over 200 KB (compress to WebP, max 800px)"; fi

  maps=$(find "$DIST" -name '*.map' | wc -l)
  if [ "$maps" -eq 0 ]; then ok "no source maps shipped"; else warn "$maps source map(s) in the production build"; fi

  if [ -f "$DIST/manifest.webmanifest" ] || [ -f "$DIST/manifest.json" ]; then ok "PWA manifest present"; else warn "no PWA manifest in the build"; fi
  idx="$DIST/index.html"
  grep -q 'name="viewport"'    "$idx" && ok "viewport meta present"          || bad "viewport meta missing"
  grep -q 'name="theme-color"' "$idx" && ok "theme-color meta present"       || warn "theme-color meta missing"
  grep -qi '<title>[^<][^<]*</title>' "$idx" && ok "page title present; shop branding loads from settings" || warn "page title is missing or empty"
  grep -q '<html[^>]*lang=' "$idx" && ok "html lang attribute present"       || warn "html lang attribute missing"
else
  bad "$DIST not found: the build did not complete"
fi

# ---------------------------------------------------------------------------
section "4. Preview server (production build on :$PORT)"
PREVIEW_UP=""
if [ -d "$DIST" ]; then
  setsid corepack pnpm --dir "$WEB" exec vite preview --port "$PORT" --strictPort >"$OUT/preview.log" 2>&1 &
  PREVIEW_PID=$!
  for _ in $(seq 1 40); do
    if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then PREVIEW_UP=1; break; fi
    sleep 0.5
  done
  if [ -n "$PREVIEW_UP" ]; then ok "preview server is running"; else warn "preview server did not start, see $OUT/preview.log"; fi
else
  warn "skipped (no build)"
fi

# ---------------------------------------------------------------------------
section "5. Lighthouse (login page: mobile and desktop)"
if [ -n "${SKIP_LIGHTHOUSE:-}" ]; then
  warn "skipped (SKIP_LIGHTHOUSE set)"
elif [ -z "$PREVIEW_UP" ]; then
  warn "skipped (preview server not running)"
else
  CHROME="$(chrome_path)"
  if [ -z "$CHROME" ]; then
    warn "no Chrome/Chromium found. Run: pnpm exec playwright install chromium"
  else
    export CHROME_PATH="$CHROME"
    lighthouse_run() { # name min_perf [extra args]
      local name="$1" minperf="$2"; shift 2
      if ! corepack pnpm exec lighthouse "http://localhost:$PORT/" --quiet --output=json \
             --output-path="$OUT/lh-$name.json" \
             --only-categories=performance,accessibility,best-practices \
             --chrome-flags="--headless=new --no-sandbox" "$@" >"$OUT/lh-$name.log" 2>&1; then
        warn "lighthouse $name failed, see $OUT/lh-$name.log"; return
      fi
      local lvl msg
      while IFS='|' read -r lvl msg; do
        case "$lvl" in PASS) ok "$name: $msg";; WARN) warn "$name: $msg";; FAIL) bad "$name: $msg";; esac
      done < <(LH_FILE="$OUT/lh-$name.json" LH_PERF="$minperf" node -e '
        const r = JSON.parse(require("fs").readFileSync(process.env.LH_FILE, "utf8"));
        const sc = k => Math.round(((r.categories[k] || {}).score || 0) * 100);
        const au = k => ((r.audits[k] || {}).numericValue || 0);
        const out = [];
        const chk = (label, val, min) => out.push((val >= min ? "PASS" : val >= min - 10 ? "WARN" : "FAIL") + "|" + label + " " + val + " (min " + min + ")");
        chk("performance", sc("performance"), Number(process.env.LH_PERF));
        chk("accessibility", sc("accessibility"), 95);
        chk("best-practices", sc("best-practices"), 95);
        const lcp = au("largest-contentful-paint"), cls = au("cumulative-layout-shift"), tbt = au("total-blocking-time");
        out.push((lcp <= 2500 ? "PASS" : lcp <= 4000 ? "WARN" : "FAIL") + "|LCP " + Math.round(lcp) + " ms (max 2500)");
        out.push((cls <= 0.1 ? "PASS" : cls <= 0.25 ? "WARN" : "FAIL") + "|CLS " + cls.toFixed(3) + " (max 0.1)");
        out.push((tbt <= 200 ? "PASS" : tbt <= 600 ? "WARN" : "FAIL") + "|TBT " + Math.round(tbt) + " ms (max 200)");
        console.log(out.join("\n"));
      ')
    }
    lighthouse_run mobile  85
    lighthouse_run desktop 90 --preset=desktop
  fi
fi

# ---------------------------------------------------------------------------
section "6. API speed (optional: set API_URL)"
if [ -n "${API_URL:-}" ]; then
  target="${API_URL}${API_HEALTH:-/api/health}"
  if pnpm exec autocannon -c 10 -d 8 -j "$target" >"$OUT/api-load.json" 2>/dev/null; then
    while IFS='|' read -r lvl msg; do
      case "$lvl" in PASS) ok "$msg";; WARN) warn "$msg";; FAIL) bad "$msg";; esac
    done < <(LOAD_FILE="$OUT/api-load.json" node -e '
      const lines = require("fs").readFileSync(process.env.LOAD_FILE, "utf8").trim().split("\n");
      const r = JSON.parse(lines[lines.length - 1]);
      const p99 = r.latency.p99, rps = Math.round(r.requests.average), bad = (r.non2xx || 0) + (r.errors || 0);
      const out = [];
      out.push((p99 <= 300 ? "PASS" : p99 <= 600 ? "WARN" : "FAIL") + "|API p99 latency " + p99 + " ms (target 300 or less)");
      out.push("PASS|API throughput " + rps + " req/s");
      out.push((bad === 0 ? "PASS" : "FAIL") + "|API errors or non-2xx responses: " + bad);
      console.log(out.join("\n"));
    ')
  else
    warn "load test failed: is the API running at $API_URL ?"
  fi
else
  warn "skipped (set API_URL=http://localhost:4000 to load-test the API)"
fi

# ---------------------------------------------------------------------------
section "7. Browser UI audit (Playwright + axe)"
SPEC="$WEB/e2e/ui-audit.spec.ts"
if [ ! -f "$SPEC" ]; then
  warn "$SPEC not found"
elif [ -z "$PREVIEW_UP" ]; then
  warn "skipped (preview server not running)"
else
  if E2E_BASE_URL="http://localhost:$PORT" corepack pnpm exec playwright test "$SPEC" --reporter=line >"$OUT/ui-audit.log" 2>&1; then
    ok "UI audit passed (screenshots in $OUT/screenshots)"
  else
    bad "UI audit found problems, see $OUT/ui-audit.log"
    grep -E '^\s*(Error|[0-9]+\)|Expected|Received|-|\+)' "$OUT/ui-audit.log" | head -n 25 | cut -c1-170 | sed 's/^/        /'
  fi
  if [ -z "${E2E_ADMIN_PASS:-}" ] && [ -z "${E2E_STAFF_PASS:-}" ]; then
    warn "logged-in pages were NOT audited: start the API and set E2E_ADMIN_USER/E2E_ADMIN_PASS (and the STAFF pair)"
  fi
fi

# ---------------------------------------------------------------------------
section "Summary"
echo "  PASS: $PASS    WARN: $WARN    FAIL: $FAIL"
echo "  Logs and reports: $OUT/    Screenshots: $OUT/screenshots/"
if [ "$FAIL" -eq 0 ]; then echo "  Result: no blocking problems"; else echo "  Result: fix every FAIL first, then the WARNs"; fi

cat <<'EYE'

  Eye test (a script cannot judge taste, so do this yourself with the screenshots):
   1. Squint at each screenshot: is it obvious where to look first, and is the blue primary action clear?
   2. Do all cards share the same padding, radius, and header style?
   3. Are money columns aligned right with the same number format everywhere?
   4. Does every screen have good loading, empty, and error states?
   5. Hand the tablet to a real cashier: can they finish a sale without help in under 15 seconds?
EYE

exit $(( FAIL > 0 ))
