import "./tokens.css";
import "./styles.css";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const root = document.getElementById("root")!;
const form = document.getElementById("login-form") as HTMLFormElement;
const errorBox = document.getElementById("login-error")!;
const submitButton = document.getElementById("login-submit") as HTMLButtonElement;

async function openShell() {
  root.innerHTML = '<main class="app-loading" aria-live="polite"><span class="spinner"></span><span>Opening your shop</span></main>';
  const { mountShell } = await import("./AuthenticatedShell.js");
  mountShell(root);
}

if (import.meta.env.DEV && window.location.pathname === "/design") {
  void openShell();
} else {
  void fetch(`${API_URL}/api/brand`)
    .then(async (response) => response.ok ? response.json() as Promise<{ brandName?: string; logoUrl?: string | null }> : undefined)
    .then((brand) => {
      if (!brand) return;
      const name = brand.brandName || "Shop";
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
      body: JSON.stringify({ identifier: data.get("identifier"), password: data.get("password") }),
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
        submitButton.textContent = "Sign in";
      });
  });
}
