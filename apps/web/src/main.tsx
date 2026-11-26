import "./tokens.css";
import "./login.css";

const API_URL = (
  import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:3001")
).replace(/\/$/, "");
const root = document.getElementById("root")!;
const form = document.getElementById("login-form") as HTMLFormElement;
const errorBox = document.getElementById("login-error")!;
const submitButton = document.getElementById("login-submit") as HTMLButtonElement;
const subtitle = document.getElementById("login-subtitle");
const roleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-role-option]"));
let selectedRole: "admin" | "staff" = "admin";
let disposeLoginShader: (() => void) | undefined;

function selectRole(role: "admin" | "staff") {
  selectedRole = role;
  for (const button of roleButtons) {
    const active = button.dataset.roleOption === role;
    button.setAttribute("aria-checked", String(active));
    button.classList.toggle("role-option-active", active);
  }
  if (subtitle) {
    subtitle.textContent =
      role === "admin"
        ? "Manage inventory, reports and staff."
        : "Open the till and process sales.";
  }
  if (!submitButton.disabled) {
    submitButton.textContent = role === "admin" ? "Sign in as Admin" : "Sign in as Cashier";
  }
  errorBox.hidden = true;
}

async function openShell() {
  document.body.classList.remove("public-login");
  disposeLoginShader?.();
  root.innerHTML = '<main class="app-loading" aria-live="polite"><span class="spinner"></span><span>Opening your shop</span></main>';
  const { mountShell } = await import("./AuthenticatedShell.js");
  mountShell(root);
}

function scheduleLoginShader() {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(max-width: 640px)").matches || nav.connection?.saveData ||
      (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4) ||
      (nav.deviceMemory !== undefined && nav.deviceMemory <= 4)) return;
  const load = () => {
    if (!document.querySelector(".login-page")) return;
    void import("./login-gold-shader.js")
      .then(({ mountLoginShader }) => {
        const host = document.querySelector<HTMLElement>(".login-backdrop");
        if (!host || !document.querySelector(".login-page")) return;
        try { disposeLoginShader = mountLoginShader(host); } catch { /* Keep the static CSS background. */ }
      })
      .catch(() => undefined);
  };
  const idle = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number };
  requestAnimationFrame(() => {
    if (idle.requestIdleCallback) idle.requestIdleCallback(load, { timeout: 1800 });
    else window.setTimeout(load, 250);
  });
}

if (import.meta.env.DEV && window.location.pathname === "/design") {
  void openShell();
} else {
  if (import.meta.env.DEV) reportWebVitals();
  if (window.location.pathname === "/") scheduleLoginShader();
  void fetch(`${API_URL}/api/brand`)
    .then(async (response) => response.ok ? response.json() as Promise<{ brandName?: string; logoUrl?: string | null }> : undefined)
    .then((brand) => {
      if (!brand) return;
      const name = brand.brandName || "Eminent Jay";
      document.title = `${name} | Retail point of sale`;
      for (const node of document.querySelectorAll<HTMLElement>("[data-brand-name]")) node.textContent = name;
      const logo = document.querySelector<HTMLImageElement>("#login-logo");
      if (logo && brand.logoUrl) { logo.src = brand.logoUrl; logo.alt = `${name} logo`; logo.hidden = false; }
    })
    .catch(() => undefined);
  void fetch(`${API_URL}/api/auth/me`, { credentials: "include" })
    .then(async (response) => response.ok ? response.json() : undefined)
    .then((body: { user?: unknown } | undefined) => {
      if (body?.user) void openShell();
    })
    .catch(() => undefined);

  for (const [index, button] of roleButtons.entries()) {
    button.addEventListener("click", () => {
      const role = button.dataset.roleOption === "staff" ? "staff" : "admin";
      selectRole(role);
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const next = roleButtons[(index + 1) % roleButtons.length];
      if (!next) return;
      const role = next.dataset.roleOption === "staff" ? "staff" : "admin";
      selectRole(role);
      next.focus();
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = "Signing in…";
    const data = new FormData(form);
    void fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: data.get("identifier"),
        password: data.get("password"),
        role: selectedRole,
      }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
        return openShell();
      })
      .catch((reason: unknown) => {
        errorBox.textContent = reason instanceof Error ? reason.message : "Sign-in failed. Check your details and try again.";
        errorBox.hidden = false;
      })
      .finally(() => {
        submitButton.disabled = false;
        submitButton.textContent = selectedRole === "admin" ? "Sign in as Admin" : "Sign in as Cashier";
      });
  });
}

function reportWebVitals() {
  if (!("PerformanceObserver" in window)) return;
  const log = (name: string, value: number) => console.info(`[web-vitals] ${name}: ${Math.round(value * 10) / 10} ms`);
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length) log("LCP", entries[entries.length - 1]!.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
    let cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) cls += entry.value;
      console.info(`[web-vitals] CLS: ${cls.toFixed(4)}`);
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const worst = entries.reduce((max, entry) => Math.max(max, entry.duration), 0);
      if (worst) log("INP candidate", worst);
    }).observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch { /* Browser does not expose all web-vitals entry types. */ }
}
