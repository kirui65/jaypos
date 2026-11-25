import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, cents, currencyInput, money, shopDate, shopDateTime, shopTime } from "./api.js";
import { Icon } from "./Icons.js";
import { CartPanelSkeleton, FormSkeleton, ProductGridSkeleton, TableSkeleton } from "./LoadingStates.js";
import { ProgressiveImage } from "./ProgressiveImage.js";
import { readLocal, writeLocal } from "./localCache.js";
import { useDebouncedValue, useDelayedLoading } from "./useDelayedLoading.js";

type AppUser = {
  id: string;
  name: string;
  username: string;
  role: "admin" | "staff";
  permissions: string[];
  mustChangePassword: boolean;
  discountLimitPct: number;
  active?: boolean;
};
type BrandSettings = { brandName: string; logoUrl: string | null };
type Variant = {
  id: string;
  sku: string;
  barcode: string | null;
  attributes: Record<string, unknown>;
  priceCents: number;
  stock: number;
  mlRemaining: number | null;
  isBulk: boolean;
  bulkVolumeMl: number | null;
  parentBulkVariantId: string | null;
  mlPerUnit: number | null;
};
type Product = {
  id: string;
  name: string;
  active: boolean;
  imageUrl: string | null;
  department: { id: string; name: string; code: string };
  productType: { id: string; name: string; code: string };
  brand: { name: string } | null;
  variants: Variant[];
};
type Catalog = {
  departments: { id: string; name: string; code: string }[];
  productTypes: { id: string; name: string; code: string; attributeTemplateJson?: unknown }[];
  brands: { id: string; name: string }[];
  products: Product[];
  bundles?: { bundleVariantId: string; componentVariantId: string; quantity: number }[];
  taxSettings?: { enabled: boolean; rateBps: number; inclusive: boolean };
};
type HeldCart = { id: string; label: string | null; createdAt: string; cartJson: { items: { variantId: string; quantity: number }[] } };
type CartLine = { product: Product; variant: Variant; quantity: number };
const APP_ROUTE_TITLES: Record<string, string> = {
  "/": "Point of sale",
  "/shift": "My shift",
  "/sales": "Sales and receipts",
  "/stock": "Stock lookup",
  "/refunds": "Returns",
  "/admin": "Overview",
  "/admin/catalog": "Catalog",
  "/admin/staff": "Staff",
  "/admin/documents": "Receipts & invoices",
};

function availableUnits(catalog: Catalog | undefined, product: Product, variant: Variant): number {
  const allVariants = catalog?.products.flatMap((row) => row.variants) ?? [];
  if (variant.parentBulkVariantId && variant.mlPerUnit) {
    const bulk = allVariants.find((row) => row.id === variant.parentBulkVariantId);
    return Math.max(0, Math.floor((bulk?.mlRemaining ?? 0) / variant.mlPerUnit));
  }
  if (["gift-sets", "gift_sets"].includes(product.productType.code.toLowerCase())) {
    const components = (catalog?.bundles ?? []).filter((row) => row.bundleVariantId === variant.id);
    if (!components.length) return 0;
    return Math.max(
      0,
      Math.min(
        ...components.map((row) => {
          const component = allVariants.find((item) => item.id === row.componentVariantId);
          if (!component) return 0;
          const quantityUnits = Math.floor(component.stock / row.quantity);
          const volumeUnits =
            component.isBulk && component.bulkVolumeMl
              ? Math.floor((component.mlRemaining ?? 0) / (component.bulkVolumeMl * row.quantity))
              : Number.MAX_SAFE_INTEGER;
          return Math.min(quantityUnits, volumeUnits);
        }),
      ),
    );
  }
  return variant.stock;
}
type Sale = {
  id: string;
  receiptNo: string;
  status: string;
  createdAt: string;
  totalCents: number;
  paidCents: number;
  seller: { name: string };
  items: {
    id: string;
    qty: number;
    lineTotalCents: number;
    variant: { id: string; sku: string; product: { name: string } };
  }[];
  payments: { id: string; method: string; status: string; mpesaReceipt?: string | null }[];
};
type OwnerSummary = {
  today: {
    date: string;
    netRevenueCents: number;
    profitCents: number;
    marginPct: number | null;
    saleCount: number;
  };
  days: {
    date: string;
    netRevenueCents: number;
    profitCents: number;
    marginPct: number | null;
    saleCount: number;
  }[];
};
type DocumentSettings = {
  name: string;
  logoUrl: string;
  address: string;
  phone: string;
  kraPin: string;
  receiptPrefix: string;
  receiptFooter: string;
  invoiceTerms: string;
  taxEnabled: boolean;
  taxRateBps: number;
  taxInclusive: boolean;
};
const UserContext = createContext<AppUser | null>(null);
const useUser = () => useContext(UserContext)!;
const useRefresh = (...keys: string[][]) => {
  const client = useQueryClient();
  return () => keys.forEach((queryKey) => void client.invalidateQueries({ queryKey }));
};

function Button({
  children,
  className = "",
  loading = false,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button className={`button ${loading ? "button-loading" : ""} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      <span className="button-label">{children}</span>{loading && <span className="spinner button-spinner" aria-label="Loading" />}
    </button>
  );
}

function RouteProgress() {
  const location = useLocation();
  const fetching = useIsFetching() > 0;
  const [routeChanging, setRouteChanging] = useState(false);
  const show = useDelayedLoading(fetching || routeChanging);
  useEffect(() => {
    setRouteChanging(true);
    const timer = window.setTimeout(() => setRouteChanging(false), 180);
    return () => window.clearTimeout(timer);
  }, [location.key]);
  return show ? <div className="route-progress" role="progressbar" aria-label="Loading content" /> : null;
}
function PageHeader({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {detail && <p className="muted">{detail}</p>}
      </div>
      {action}
    </header>
  );
}
function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "success" | "error";
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" aria-live="polite">
      <span>{label}</span>
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function FormError({ value }: { value: unknown }) {
  return value instanceof Error ? <Notice tone="error">{value.message}</Notice> : null;
}

function LoginPage({ brand, onLogin }: { brand: BrandSettings; onLogin: (user: AppUser) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api<{ user: AppUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      }),
    onSuccess: ({ user }) => onLogin(user),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }
  return (
    <main className="login-page">
      <section className="login-brand-panel">{brand.logoUrl && <img className="login-logo" src={brand.logoUrl} alt={`${brand.brandName} logo`} width={220} height={220} />}<div className="gold-rule" /><p>{brand.brandName}</p></section>
      <section className="login-card">
        <p className="login-kicker">RETAIL POINT OF SALE</p>
        <h1>Sign in to the till</h1>
        <p className="muted">Sign in to open your {brand.brandName} till.</p>
        <form onSubmit={submit} className="stack-form" inert={mutation.isPending || undefined}>
          <Field label="Username or email">
            <input
              autoComplete="username"
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <FormError value={mutation.error} />
          <Button className="button-full button-lg" loading={mutation.isPending}>
            Sign in
          </Button>
        </form>
      </section>
    </main>
  );
}

function PasswordChange({ brand, onDone }: { brand: BrandSettings; onDone: () => void }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ ...(currentPassword ? { currentPassword } : {}), newPassword }),
      }),
    onSuccess: onDone,
  });
  return (
    <main className="login-page">
      <section className="login-brand-panel">{brand.logoUrl && <img className="login-logo" src={brand.logoUrl} alt={`${brand.brandName} logo`} width={220} height={220} />}<div className="gold-rule" /><p>{brand.brandName}</p></section>
      <section className="login-card">
        <h1>Set a new password</h1>
        <p className="muted">Use at least 12 characters to secure your account.</p>
        <form
          className="stack-form"
          inert={mutation.isPending || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Current password (if set)">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              minLength={12}
              value={newPassword}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </Field>
          <FormError value={mutation.error} />
          <Button className="button-full" loading={mutation.isPending}>
            Save password
          </Button>
        </form>
      </section>
    </main>
  );
}

const navSections = [
  { label: "Sell", items: [
    { to: "/", label: "Point of sale", icon: "cart" as const, permission: "sales.create" },
    { to: "/shift", label: "My shift", icon: "clock" as const, permission: "sales.create" },
    { to: "/sales", label: "Sales and receipts", icon: "receipt" as const, permission: "sales.read.own" },
    { to: "/stock", label: "Stock lookup", icon: "boxes" as const, permission: "stock.read" },
    { to: "/refunds", label: "Returns", icon: "rotate" as const, permission: "refunds.request" },
  ]},
  { label: "Manage", items: [
    { to: "/admin", label: "Overview", icon: "layout" as const, permission: "sales.read.all" },
    { to: "/admin/catalog", label: "Catalog", icon: "package" as const, permission: "catalog.manage" },
    { to: "/admin/staff", label: "Staff", icon: "users" as const, permission: "staff.manage" },
    { to: "/admin/documents", label: "Receipts & invoices", icon: "receipt" as const, permission: "catalog.manage" },
  ]},
];

function PageNotFound() {
  return (
    <section className="access-denied">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>This page is not available in this workspace.</p>
      <Link className="button" to="/">
        Return to point of sale
      </Link>
    </section>
  );
}

function AppShell({ brand, onLogout }: { brand: BrandSettings; onLogout: () => void }) {
  const user = useUser();
  const queryClient = useQueryClient();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const { data: shiftState } = useQuery({
    queryKey: ["current-shift"],
    queryFn: () => api<{ shift: { id: string } | null }>("/shifts/current"),
  });
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.matches("input, textarea, select")) return;
      const field = document.querySelector<HTMLInputElement>(".search-wrap input, input[aria-label='Search sales'], input[aria-label='Search table']");
      if (field) { event.preventDefault(); field.focus(); }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  const visibleSections = navSections.map((section) => ({
    ...section,
    items: section.items.filter((item) => user.permissions.includes(item.permission)),
  })).filter((section) => section.items.length > 0);
  const navItems = visibleSections.flatMap((section) => section.items);
  const desktopItems = navItems.slice(0, user.role === "admin" ? 6 : 5);
  const desktopMoreItems = navItems.slice(desktopItems.length);
  const mobileItems = navItems.slice(0, 4);
  const mobileMoreItems = navItems.slice(mobileItems.length);
  function prefetchRoute(path: string) {
    const requests: Record<string, () => Promise<unknown>> = {
      "/": () => queryClient.prefetchQuery({ queryKey: ["catalog"], queryFn: () => api<Catalog>("/catalog") }),
      "/shift": () => queryClient.prefetchQuery({ queryKey: ["current-shift"], queryFn: () => api("/shifts/current") }),
      "/sales": () => queryClient.prefetchQuery({ queryKey: ["sales", user.role], queryFn: () => api(`/sales${user.role === "admin" ? "?scope=all" : ""}`) }),
      "/stock": () => queryClient.prefetchQuery({ queryKey: ["stock"], queryFn: () => api("/stock") }),
      "/refunds": () => queryClient.prefetchQuery({ queryKey: ["refunds"], queryFn: () => api("/refunds") }),
      "/admin/catalog": () => queryClient.prefetchQuery({ queryKey: ["catalog"], queryFn: () => api<Catalog>("/catalog") }),
      "/admin/staff": () => queryClient.prefetchQuery({ queryKey: ["staff"], queryFn: () => api("/auth/staff") }),
      "/admin/documents": () => queryClient.prefetchQuery({ queryKey: ["document-settings"], queryFn: () => api<{ settings: DocumentSettings }>("/sales/documents/settings") }),
    };
    void requests[path]?.();
  }
  function navLink(item: (typeof navItems)[number]) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === "/"}
        onClick={() => {
          setMobileMenu(false);
          setMoreMenuOpen(false);
        }}
        className={({ isActive }) => `nav-link ${isActive ? "nav-active" : ""}`}
        onMouseEnter={() => prefetchRoute(item.to)}
        onFocus={() => prefetchRoute(item.to)}
      >
        <Icon name={item.icon} className="nav-glyph" />
        <span>{item.label}</span>
      </NavLink>
    );
  }
  return (
    <div className="app-shell">
        <header className="topbar app-header">
          <Link to="/" className="brand-lockup" onClick={() => setMobileMenu(false)}>
            {brand.logoUrl ? <img className="brand-logo" src={brand.logoUrl} alt="" /> : <span className="brand-monogram" aria-hidden="true"><Icon name="cart" /></span>}
            <span>
              <b>{brand.brandName}</b>
              <small>{user.role === "admin" ? "OWNER DASHBOARD" : "RETAIL POS"}</small>
            </span>
          </Link>
          <button
            className="menu-toggle"
            aria-label={mobileMenu ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileMenu}
            onClick={() => setMobileMenu((open) => !open)}
          >
            <Icon name={mobileMenu ? "x" : "menu"} />
            <span>Menu</span>
          </button>
          <nav className={`main-nav ${mobileMenu ? "nav-open" : ""}`} aria-label="Main navigation">
            {(mobileMenu ? navItems : desktopItems).map((item) => navLink(item))}
            {!mobileMenu && desktopMoreItems.length > 0 && (
              <div className="more-nav-wrap">
                <button className={`nav-link more-nav-trigger ${moreMenuOpen ? "nav-active" : ""}`} aria-expanded={moreMenuOpen} onClick={() => setMoreMenuOpen((open) => !open)}>
                  <Icon name="menu" className="nav-glyph" />
                  <span>More</span>
                </button>
                {moreMenuOpen && <div className="more-nav-popover">{desktopMoreItems.map((item) => navLink(item))}</div>}
              </div>
            )}
          </nav>
          <div className="topbar-right">
            <span className={`connectivity-indicator ${online ? "" : "connectivity-offline"}`} role="status" aria-label={online ? "Online" : "Offline"}>
              <Icon name={online ? "wifi" : "wifi-off"} />
              <span>{online ? "Online" : "Offline"}</span>
            </span>
            <span className="topbar-divider" />
            <span className="shift-indicator" role="status">
              {shiftState?.shift ? "Shift open" : shiftState ? "No open shift" : "Shift status loading"}
            </span>
            <span className="topbar-divider" />
            <div className="user-menu-wrap">
              <button className="user-menu-trigger" aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen((open) => !open)}>
                <span className="topbar-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="topbar-user-name">{user.name}</span>
              </button>
              {userMenuOpen && <div className="user-menu-popover"><b>{user.name}</b><small>{user.role === "admin" ? "Administrator" : "Staff member"}</small><button onClick={onLogout}><Icon name="logout" />Sign out</button></div>}
            </div>
          </div>
        </header>
        {mobileMenu && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
        <div className="app-main">
          <main className="content">
          <RouteProgress />
          <Routes>
            <Route path="/" element={<POSPage />} />
            <Route path="/shift" element={<ShiftPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route path="/refunds" element={<RefundsPage />} />
            <Route
              path="/admin"
              element={
                <RoleGate permission="sales.read.all">
                  <DashboardPage />
                </RoleGate>
              }
            />
            <Route
              path="/admin/catalog"
              element={
                <RoleGate permission="catalog.manage">
                  <CatalogAdminPage />
                </RoleGate>
              }
            />
            <Route
              path="/admin/staff"
              element={
                <RoleGate permission="staff.manage">
                  <StaffAdminPage />
                </RoleGate>
              }
            />
            <Route
              path="/admin/documents"
              element={
                <RoleGate permission="catalog.manage">
                  <DocumentSettingsPage />
                </RoleGate>
              }
            />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
          </main>
        </div>
      <nav className="mobile-tabbar" aria-label="Quick navigation">
        {mobileItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"} aria-label={item.label} onClick={() => setMoreMenuOpen(false)}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        {mobileMoreItems.length > 0 && (
          <div className="mobile-more-wrap">
            <button className={moreMenuOpen ? "nav-active" : ""} aria-expanded={moreMenuOpen} onClick={() => setMoreMenuOpen((open) => !open)}><Icon name="menu" /><span>More</span></button>
            {moreMenuOpen && <div className="mobile-more-popover">{mobileMoreItems.map((item) => navLink(item))}</div>}
          </div>
        )}
      </nav>
    </div>
  );
}

function RoleGate({ permission, children }: { permission: string; children: React.ReactNode }) {
  const user = useUser();
  return user.permissions.includes(permission) ? (
    <>{children}</>
  ) : (
    <section className="access-denied">
      <div className="empty-symbol"><Icon name="x" /></div>
      <h1>Access restricted</h1>
      <p>This page is only available to administrators.</p>
      <Link className="button" to="/">
        Return to point of sale
      </Link>
    </section>
  );
}

function POSPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    data: catalog,
    isPending,
    error,
  } = useQuery({ queryKey: ["catalog"], queryFn: async () => {
    const fresh = await api<Catalog>("/catalog");
    void writeLocal("catalog", fresh).catch(() => undefined);
    return fresh;
  } });
  useEffect(() => {
    if (queryClient.getQueryData(["catalog"])) return;
    let active = true;
    void readLocal<Catalog>("catalog").then((cached) => {
      if (active && cached && !queryClient.getQueryData(["catalog"])) queryClient.setQueryData(["catalog"], cached);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [queryClient]);
  const { data: currentShift, isPending: shiftPending } = useQuery({
    queryKey: ["current-shift"],
    queryFn: () => api<{ shift: { id: string } | null }>("/shifts/current"),
  });
  const { data: heldCarts } = useQuery({
    queryKey: ["held-carts"],
    queryFn: () => api<{ carts: HeldCart[] }>("/sales/held-carts"),
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 70);
  const [department, setDepartment] = useState("");
  const [type, setType] = useState("");
  const [showHeld, setShowHeld] = useState(false);
  const [holdError, setHoldError] = useState("");
  const [holdPending, setHoldPending] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState<"cash" | "mpesa_stk" | "split">("cash");
  const [tender, setTender] = useState("");
  const [phone, setPhone] = useState("");
  const [invoiceBuyerName, setInvoiceBuyerName] = useState("");
  const [invoiceBuyerPhone, setInvoiceBuyerPhone] = useState("");
  const [invoiceBuyerEmail, setInvoiceBuyerEmail] = useState("");
  const [activePaymentId, setActivePaymentId] = useState("");
  const [stkInitiated, setStkInitiated] = useState(false);
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const products = catalog?.products ?? [];
  const variants = useMemo(
    () =>
      products
        .filter(
          (p) =>
            p.active &&
            (!department || p.department.id === department) &&
            (!type || p.productType.id === type) &&
            (!debouncedSearch ||
              `${p.name} ${p.brand?.name ?? ""} ${p.variants.map((v) => `${v.sku} ${v.barcode ?? ""}`).join(" ")}`
                .toLowerCase()
                .includes(debouncedSearch.toLowerCase())),
        )
        .flatMap((product) => product.variants.map((variant) => ({ product, variant }))),
    [products, department, type, debouncedSearch],
  );
  const showTillSkeleton = useDelayedLoading(isPending || shiftPending);
  const subtotal = cart.reduce((sum, line) => sum + line.variant.priceCents * line.quantity, 0);
  const taxSettings = catalog?.taxSettings;
  const taxRateBps = taxSettings?.enabled ? Math.max(0, Math.min(10000, taxSettings.rateBps)) : 0;
  const taxCents = taxRateBps
    ? Math.round((subtotal * taxRateBps) / (taxSettings?.inclusive ? 10000 + taxRateBps : 10000))
    : 0;
  const total = subtotal + (taxSettings?.inclusive ? 0 : taxCents);
  const invoiceDetailsStarted = Boolean(
    invoiceBuyerName.trim() || invoiceBuyerPhone.trim() || invoiceBuyerEmail.trim(),
  );
  const invoiceDetailsValid =
    !invoiceDetailsStarted || Boolean(invoiceBuyerName.trim() && invoiceBuyerPhone.trim());
  const paymentStatus = useQuery({
    queryKey: ["payment-check", activePaymentId],
    enabled: !!activePaymentId && stkInitiated,
    queryFn: () =>
      api<{ status: string }>(`/payments/${activePaymentId}/check`, { method: "POST", body: "{}" }),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 2500 : false),
  });
  useEffect(() => {
    function handleTillKeys(event: KeyboardEvent) {
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target?.matches("input, textarea, select")) return;
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setReviewOpen(false);
        setPayOpen(false);
      }
      if (event.ctrlKey && event.key === "Enter" && cart.length) {
        event.preventDefault();
        setReviewOpen(true);
      }
    }
    window.addEventListener("keydown", handleTillKeys);
    return () => window.removeEventListener("keydown", handleTillKeys);
  }, [cart.length, total]);
  const refresh = useRefresh(["catalog"], ["sales"], ["current-shift"], ["stock"], ["held-carts"]);
  const saleMutation = useMutation({
    mutationFn: async () => {
      const cashCents = cents(tender || currencyInput(total));
      const payments =
        method === "cash"
          ? [{ method: "cash", amountCents: cashCents }]
          : method === "mpesa_stk"
            ? [{ method: "mpesa_stk", amountCents: total, phone }]
            : [
                { method: "cash", amountCents: cashCents },
                { method: "mpesa_stk", amountCents: total - cashCents, phone },
              ];
      const result = await api<{ sale: Sale }>("/sales", {
        method: "POST",
        body: JSON.stringify({
          clientUuid: crypto.randomUUID(),
          items: cart.map(({ variant, quantity }) => ({ variantId: variant.id, quantity })),
          ...(invoiceDetailsValid && invoiceBuyerName.trim() && invoiceBuyerPhone.trim()
            ? {
                customerDetails: {
                  name: invoiceBuyerName.trim(),
                  phone: invoiceBuyerPhone.trim(),
                  ...(invoiceBuyerEmail.trim() ? { email: invoiceBuyerEmail.trim() } : {}),
                },
              }
            : {}),
          payments,
        }),
      });
      return { result, method };
    },
    onSuccess: async ({ result, method: paidBy }) => {
      if (paidBy !== "cash") {
        const payment = result.sale.payments.find((row) => row.method === "mpesa_stk");
        if (!payment) throw new Error("The STK payment record was not returned");
        setActivePaymentId(payment.id);
        setStkInitiated(false);
        setReceiptSale(result.sale);
        await api(`/payments/${payment.id}/stk`, { method: "POST", body: "{}" });
        setStkInitiated(true);
      } else {
        setReceiptSale(result.sale);
        setCart([]);
        setPayOpen(false);
        setTender("");
        setInvoiceBuyerName("");
        setInvoiceBuyerPhone("");
        setInvoiceBuyerEmail("");
      }
      refresh();
    },
  });
  const mockComplete = useMutation({
    mutationFn: () =>
      api(`/payments/${activePaymentId}/mock-complete`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      void paymentStatus.refetch();
      refresh();
    },
  });
  function addToCart(product: Product, variant: Variant) {
    setCart((current) => {
      const found = current.find((row) => row.variant.id === variant.id);
      if (found)
        return current.map((row) =>
          row.variant.id === variant.id ? { ...row, quantity: row.quantity + 1 } : row,
        );
      return [...current, { product, variant, quantity: 1 }];
    });
  }
  if (isPending || shiftPending) {
    if (!showTillSkeleton) return <div className="loading-reserve" aria-hidden="true" />;
    return <div className="pos-skeleton-layout"><section className="pos-skeleton-browser"><span className="skeleton search-skeleton" /><span className="skeleton pos-skeleton-filters" /><span className="skeleton pos-skeleton-filters" /><ProductGridSkeleton /></section><CartPanelSkeleton /></div>;
  }
  if (error)
    return (
      <>
        <PageHeader title="Point of sale" />
        <Notice tone="error">{error.message}</Notice>
      </>
    );
  if (!currentShift?.shift)
    return (
      <>
        <PageHeader
          eyebrow="YOUR TILL"
          title="Ready when you are"
          detail="Open a shift before you start a sale."
        />
        <section className="empty-card">
          <div className="empty-symbol"><Icon name="clock" /></div>
          <h2>No active shift</h2>
          <p>Record your opening cash float to unlock the till.</p>
          <Button onClick={() => navigate("/shift")}>Open a shift</Button>
        </section>
      </>
    );
  return (
    <div className="pos-page">
      <div className="pos-layout">
        <section className="product-browser">
          <div className="search-wrap">
            <Icon name="search" />
            <input
              aria-label="Search products"
              ref={searchRef}
              autoFocus
              placeholder="Search products, brand or SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && variants[0]) {
                  event.preventDefault();
                  addToCart(variants[0].product, variants[0].variant);
                }
              }}
            />
            <kbd>/</kbd>
          </div>
          <div className="chip-row">
            {[{ id: "", name: "All departments" }, ...(catalog?.departments ?? [])].map((item) => (
              <button
                key={item.id}
                className={`chip ${department === item.id ? "chip-active" : ""}`}
                onClick={() => setDepartment(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="chip-row chip-row-types">
            {[{ id: "", name: "All types" }, ...(catalog?.productTypes ?? [])].map((item) => (
              <button
                key={item.id}
                className={`chip chip-small ${type === item.id ? "chip-active" : ""}`}
                onClick={() => setType(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="product-grid">
            {variants.map(({ product, variant }) => {
              const available = availableUnits(catalog, product, variant);
              const inCart = cart.find((line) => line.variant.id === variant.id)?.quantity ?? 0;
              return (
                <article
                  key={variant.id}
                  className={`product-card ${inCart > 0 ? "product-selected" : ""}`}
                  data-testid="product-card"
                >
                  <button className="product-card-main" disabled={available <= inCart} onClick={() => addToCart(product, variant)} aria-label={`Add ${product.name}`}>
                    <div className={`product-art product-art-${product.productType.code.toLowerCase()}`}>
                      <span className="product-placeholder" aria-hidden={product.imageUrl ? "true" : undefined}>
                        <Icon className="product-type-icon" name={productTypeIcon(product.productType.code)} />
                        <small>{product.name}</small>
                      </span>
                      {product.imageUrl && (
                        <ProgressiveImage
                          src={resolveCatalogImage(product.imageUrl)}
                          alt={`${product.name}`}
                          width={240}
                          height={240}
                          {...(product.imageUrl.startsWith("/api/")
                            ? { crossOrigin: "use-credentials" as const }
                            : {})}
                        />
                      )}
                      {available <= 0 && <span className="stock-badge stock-empty">Out of stock</span>}
                      {available > 0 && available <= 5 && <span className="stock-badge stock-low">{available} left</span>}
                    </div>
                    <div className="product-card-body">
                      <span className="product-brand">
                        {product.brand?.name ?? product.productType.name}
                      </span>
                      <b title={product.name}>{product.name}</b>
                      <span className="variant-chips">{Object.entries(variant.attributes ?? {}).filter(([,value]) => value !== null && value !== undefined && String(value).trim() !== "").slice(0, 3).map(([key,value]) => <span className="variant-chip" key={key}>{formatVariant(key, value)}</span>)}</span>
                    </div>
                  </button>
                  <div className="product-card-action">
                    <strong>{money(variant.priceCents)}</strong>
                    {inCart > 0 ? (
                      <div className="product-stepper" aria-label={`${inCart} in cart`}>
                        <button aria-label={`Remove one ${product.name}`} onClick={() => {
                          setCart((rows) => rows.flatMap((row) => row.variant.id !== variant.id ? [row] : row.quantity > 1 ? [{ ...row, quantity: row.quantity - 1 }] : []));
                        }}><Icon name="minus" /></button>
                        <span>{inCart}</span>
                        <button aria-label={`Add one ${product.name}`} disabled={inCart >= available} onClick={() => addToCart(product, variant)}><Icon name="plus" /></button>
                      </div>
                    ) : available > 0 ? (
                      <button className="product-add" aria-label={`Add ${product.name}`} onClick={() => addToCart(product, variant)}>Add</button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          {variants.length === 0 && (
            <div className="empty-inline">No products match your search.</div>
          )}
        </section>
        <aside className="cart-panel">
          <div className="cart-title">
            <h2>Your order</h2>
            <button className="cart-clear" onClick={() => setCart([])} disabled={!cart.length}>
              Clear all
            </button>
          </div>
          <button className="held-toggle" onClick={() => setShowHeld(!showHeld)}>
            Held carts <span>{heldCarts?.carts.length ?? 0}</span>
          </button>
          {showHeld && (
            <div className="held-list">
              {(heldCarts?.carts ?? []).map((held) => (
                <button
                  key={held.id}
                  onClick={async () => {
                    try {
                      const result = await api<{
                        cart: { cartJson: { items: { variantId: string; quantity: number }[] } };
                      }>(`/sales/held-carts/${held.id}/resume`, { method: "POST", body: "{}" });
                      const resumed = result.cart.cartJson.items.flatMap((item) => {
                        const match = products
                          .flatMap((product) =>
                            product.variants.map((variant) => ({ product, variant })),
                          )
                          .find((row) => row.variant.id === item.variantId);
                        return match ? [{ ...match, quantity: item.quantity }] : [];
                      });
                      setCart(resumed);
                      setShowHeld(false);
                      refresh();
                    } catch (e) {
                      setHoldError(e instanceof Error ? e.message : "Could not resume cart");
                    }
                  }}
                >
                  <b>{held.label ?? "Held cart"}</b>
                  <small>
                    {held.cartJson.items.length} items ·{" "}
                    {shopTime(held.createdAt)}
                  </small>
                </button>
              ))}
            </div>
          )}
          {holdError && <Notice tone="error">{holdError}</Notice>}
          <div className="cart-lines" tabIndex={0} aria-label="Cart items">
            {cart.length === 0 ? (
              <div className="cart-empty">
                <span><Icon name="cart" /></span>
                <p>Your cart is empty. Tap Add on anything you like.</p>
              </div>
            ) : (
              cart.map((line) => (
                <div className="cart-line" data-testid="cart-line" key={line.variant.id}>
                  <div className="cart-item-name">
                    <b>{line.product.name}</b>
                    <small>
                      {Object.entries(line.variant.attributes ?? {}).filter(([,value]) => value !== null && value !== undefined && String(value).trim() !== "").slice(0, 2).map(([key,value]) => formatVariant(key,value)).join(" · ") || line.product.brand?.name || line.product.productType.name} · {money(line.variant.priceCents)}
                    </small>
                  </div>
                  <div className="qty-control">
                    <button
                      aria-label="Decrease quantity"
                      onClick={() =>
                        setCart((rows) =>
                          rows.flatMap((row) =>
                            row.variant.id !== line.variant.id
                              ? [row]
                              : row.quantity > 1
                                ? [{ ...row, quantity: row.quantity - 1 }]
                                : [],
                          ),
                        )
                      }
                    >
                      <Icon name="minus" />
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      aria-label="Increase quantity"
                      disabled={
                        line.quantity >= availableUnits(catalog, line.product, line.variant)
                      }
                      onClick={() => addToCart(line.product, line.variant)}
                    >
                      <Icon name="plus" />
                    </button>
                  </div>
                  <b className="cart-line-total">
                    {money(line.variant.priceCents * line.quantity)}
                  </b>
                </div>
              ))
            )}
          </div>
          <div className="cart-footer">
          <div className="cart-summary">
            <div>
              <span>Subtotal</span>
              <b>{money(subtotal)}</b>
            </div>
            {taxCents > 0 && <div><span>VAT</span><b>{money(taxCents)}</b></div>}
            <div className="grand-total">
              <span>Total due</span>
              <b>{money(total)}</b>
            </div>
          </div>
          <Button
            className="button-full button-lg pay-button"
            disabled={!cart.length}
            onClick={() => {
              setReviewOpen(true);
            }}
          >
            Pay · {money(total)}
          </Button>
          <button
            className="hold-button"
            disabled={!cart.length || holdPending}
            onClick={async () => {
              if (!cart.length || holdPending) return;
              const previousCart = cart;
              const draftId = `pending-${Date.now()}`;
              const draft: HeldCart = { id: draftId, label: shopTime(new Date()), createdAt: new Date().toISOString(), cartJson: { items: cart.map(({ variant, quantity }) => ({ variantId: variant.id, quantity })) } };
              setHoldPending(true);
              setCart([]);
              queryClient.setQueryData<{ carts: HeldCart[] }>(["held-carts"], (current) => ({ carts: [draft, ...(current?.carts ?? [])] }));
              try {
                await api("/sales/held-carts", {
                  method: "POST",
                  body: JSON.stringify({
                    label: draft.label,
                    items: draft.cartJson.items,
                  }),
                });
                queryClient.setQueryData<{ carts: HeldCart[] }>(["held-carts"], (current) => ({ carts: (current?.carts ?? []).filter((item) => item.id !== draftId) }));
                refresh();
                setHoldError("");
              } catch (e) {
                setCart(previousCart);
                queryClient.setQueryData<{ carts: HeldCart[] }>(["held-carts"], (current) => ({ carts: (current?.carts ?? []).filter((item) => item.id !== draftId) }));
                setHoldError(e instanceof Error ? e.message : "Could not hold this cart. Try again.");
              } finally {
                setHoldPending(false);
              }
            }}
          >
            {holdPending ? "Saving cart…" : "Hold cart"}
          </button>
          </div>
        </aside>
      </div>
      {reviewOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card cart-review-modal" role="dialog" aria-modal="true" aria-labelledby="cart-review-title">
            <button className="modal-close" aria-label="Close" onClick={() => setReviewOpen(false)}>
              <Icon name="x" />
            </button>
            <p className="eyebrow">FINAL CHECK</p>
            <h2 id="cart-review-title">Review your items</h2>
            <p className="muted">Confirm products and quantities before taking payment.</p>
            <div className="cart-review-list">
              {cart.map((line) => (
                <article className="cart-review-item" key={line.variant.id}>
                  <div className="cart-review-details">
                    <b>{line.product.name}</b>
                    <small>{line.variant.sku} · {money(line.variant.priceCents)} each</small>
                  </div>
                  <div className="qty-control">
                    <button
                      type="button"
                      aria-label={`Decrease ${line.product.name} quantity`}
                      disabled={line.quantity <= 1}
                      onClick={() => setCart((rows) => rows.map((row) =>
                        row.variant.id === line.variant.id
                          ? { ...row, quantity: Math.max(1, row.quantity - 1) }
                          : row,
                      ))}
                    >
                      <Icon name="minus" />
                    </button>
                    <span aria-live="polite">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${line.product.name} quantity`}
                      disabled={line.quantity >= availableUnits(catalog, line.product, line.variant)}
                      onClick={() => addToCart(line.product, line.variant)}
                    >
                      <Icon name="plus" />
                    </button>
                  </div>
                  <b className="cart-review-total">{money(line.variant.priceCents * line.quantity)}</b>
                  <button
                    type="button"
                    className="cart-review-remove"
                    aria-label={`Remove ${line.product.name}`}
                    onClick={() => setCart((rows) => rows.filter((row) => row.variant.id !== line.variant.id))}
                  >
                    <Icon name="x" />
                  </button>
                </article>
              ))}
              {cart.length === 0 && <p className="muted">Your cart is empty. Add products to continue.</p>}
            </div>
            <div className="cart-review-summary">
              <span>{cart.reduce((sum, line) => sum + line.quantity, 0)} items</span>
              <b>{money(total)}</b>
            </div>
            <div className="action-row cart-review-actions">
              <button className="button button-secondary" onClick={() => setReviewOpen(false)}>Back to cart</button>
              <Button
                disabled={!cart.length}
                onClick={() => {
                  setReviewOpen(false);
                  setPayOpen(true);
                  setTender(currencyInput(total));
                }}
              >
                Continue to payment
              </Button>
            </div>
          </section>
        </div>
      )}
      {payOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-title"
            inert={saleMutation.isPending || undefined}
          >
            {!activePaymentId && (
              <button
                className="modal-close"
                aria-label="Close"
                onClick={() => {
                  setPayOpen(false);
                  saleMutation.reset();
                }}
              >
                <Icon name="x" />
              </button>
            )}
            {activePaymentId ? (
              <>
                <div className="modal-icon modal-icon-wait" aria-hidden="true"><span className="spinner" /></div>
                <p className="eyebrow">MPESA STK PUSH</p>
                <h2 id="pay-title">
                  {stkInitiated ? "Waiting for payment" : "Start payment prompt"}
                </h2>
                <p className="muted">
                  {stkInitiated
                    ? `A prompt was sent to ${phone}. Ask the customer to enter their M-Pesa PIN.`
                    : `Send an M-Pesa prompt to ${phone}.`}
                </p>
                <div className="payment-amount">{money(total)}</div>
                {stkInitiated && (
                  <div className="payment-status" aria-live="polite">
                    <span
                      className={`status-dot ${paymentStatus.data?.status === "paid" ? "status-dot-green" : ""}`}
                    />
                    {paymentStatus.data?.status === "paid"
                      ? "Payment confirmed"
                      : paymentStatus.data?.status === "failed" ||
                          paymentStatus.data?.status === "expired"
                        ? `Payment ${paymentStatus.data.status}`
                        : paymentStatus.data?.status === "unmatched"
                          ? "Payment needs admin review"
                          : "Waiting for customer"}
                  </div>
                )}
                {stkInitiated && (
                  <button
                    className="text-button payment-check"
                    onClick={() => void paymentStatus.refetch()}
                  >
                    Check status
                  </button>
                )}
                {import.meta.env.DEV && stkInitiated && (
                  <Button
                    className="button-full"
                    onClick={() => mockComplete.mutate()}
                    disabled={mockComplete.isPending || paymentStatus.data?.status === "paid"}
                  >
                    Simulate M-Pesa payment
                  </Button>
                )}
                {(!stkInitiated ||
                  paymentStatus.data?.status === "failed" ||
                  paymentStatus.data?.status === "expired") && (
                  <Button
                    className="button-full"
                    disabled={saleMutation.isPending}
                    onClick={async () => {
                      try {
                        await api(`/payments/${activePaymentId}/stk`, {
                          method: "POST",
                          body: "{}",
                        });
                        setStkInitiated(true);
                        await paymentStatus.refetch();
                      } catch {
                        saleMutation.reset();
                      }
                    }}
                  >
                    {stkInitiated ? "Try STK again" : "Send payment prompt"}
                  </Button>
                )}
                {paymentStatus.data?.status === "paid" && (
                  <Button
                    className="button-full"
                    onClick={() => {
                      setCart([]);
                      setPayOpen(false);
                      setActivePaymentId("");
                      setStkInitiated(false);
                    setInvoiceBuyerName("");
                    setInvoiceBuyerPhone("");
                    setInvoiceBuyerEmail("");
                      refresh();
                    }}
                  >
                    Done
                  </Button>
                )}
                <FormError
                  value={paymentStatus.error ?? mockComplete.error ?? saleMutation.error}
                />
              </>
            ) : (
              <>
                <p className="eyebrow">PAYMENT</p>
                <h2 id="pay-title">Complete sale</h2>
                <p className="muted">
                  Amount due <b>{money(total)}</b>
                </p>
                <details className="invoice-details">
                  <summary>
                    Invoice details <span>Optional</span>
                  </summary>
                  <div className="invoice-details-fields">
                    <Field label="Customer name">
                      <input
                        autoComplete="name"
                        placeholder="Name on invoice"
                        value={invoiceBuyerName}
                        onChange={(event) => setInvoiceBuyerName(event.target.value)}
                      />
                    </Field>
                    <Field label="Customer phone">
                      <input
                        autoComplete="tel"
                        inputMode="tel"
                        placeholder="0712 345 678"
                        value={invoiceBuyerPhone}
                        onChange={(event) => setInvoiceBuyerPhone(event.target.value)}
                      />
                    </Field>
                    <Field label="Customer email">
                      <input
                        autoComplete="email"
                        inputMode="email"
                        placeholder="name@example.com"
                        type="email"
                        value={invoiceBuyerEmail}
                        onChange={(event) => setInvoiceBuyerEmail(event.target.value)}
                      />
                    </Field>
                    {!invoiceDetailsValid && (
                      <p className="field-hint">Enter both the customer name and phone, or clear the invoice details.</p>
                    )}
                  </div>
                </details>
                <div className="payment-methods">
                  <button
                    className={`payment-method ${method === "cash" ? "payment-method-active" : ""}`}
                    onClick={() => setMethod("cash")}
                  >
                    <Icon name="banknote" />
                    <b>Cash</b>
                    <small>Cash tendered</small>
                  </button>
                  <button
                    className={`payment-method ${method === "mpesa_stk" ? "payment-method-active" : ""}`}
                    onClick={() => setMethod("mpesa_stk")}
                  >
                    <Icon name="banknote" />
                    <b>M-Pesa</b>
                    <small>STK Push</small>
                  </button>
                  <button
                    className={`payment-method ${method === "split" ? "payment-method-active" : ""}`}
                    onClick={() => {
                      setMethod("split");
                      setTender(currencyInput(Math.floor(total / 2)));
                    }}
                  >
                    <Icon name="layout" />
                    <b>Split</b>
                    <small>Cash + M-Pesa</small>
                  </button>
                </div>
                {method !== "mpesa_stk" && (
                  <Field
                    label={method === "split" ? "Cash contribution (KES)" : "Cash received (KES)"}
                  >
                    <input
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.01"
                      value={tender}
                      onChange={(e) => setTender(e.target.value)}
                    />
                  </Field>
                )}
                {method !== "cash" && (
                  <Field
                    label="Customer phone number"
                    hint="Use a Kenyan mobile number, e.g. 0712 345 678"
                  >
                    <input
                      autoFocus
                      inputMode="tel"
                      placeholder="0712 345 678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </Field>
                )}
                {method === "cash" && cents(tender) > total && (
                  <Notice>Change due: {money(cents(tender) - total)}</Notice>
                )}
                {method === "split" && (
                  <Notice>M-Pesa STK balance: {money(Math.max(0, total - cents(tender)))}</Notice>
                )}
                {method === "split" &&
                  total - cents(tender) > 0 &&
                  (total - cents(tender) < 1000 || (total - cents(tender)) % 100 !== 0) && (
                    <Notice tone="error">
                      The M-Pesa portion must be a whole KES amount of at least KES 10.
                    </Notice>
                  )}
                <FormError value={saleMutation.error} />
          <Button
                  className="button-full button-lg"
            loading={saleMutation.isPending}
                  disabled={
                    (method === "cash" && cents(tender) < total) ||
                    !invoiceDetailsValid ||
                    (method === "mpesa_stk" && !phone.trim()) ||
                    (method === "split" &&
                      (cents(tender) <= 0 ||
                        cents(tender) >= total ||
                        !phone.trim() ||
                        total - cents(tender) < 1000 ||
                        (total - cents(tender)) % 100 !== 0))
                  }
                  onClick={() => saleMutation.mutate()}
                >
                  {method === "cash"
                      ? "Complete cash sale"
                      : method === "split"
                        ? "Pay cash + M-Pesa"
                        : "Send payment prompt"}
                </Button>
              </>
            )}
          </section>
        </div>
      )}
      {receiptSale && !payOpen && !activePaymentId && (
        <div className="toast success-toast">
          <span>Paid</span>
          <span>Sale {receiptSale.receiptNo} completed.</span>
          <button onClick={() => void printReceipt(receiptSale.id, "html")}>Print receipt</button>
          <button onClick={() => void printReceipt(receiptSale.id, "pdf")}>PDF</button>
          <button aria-label="Dismiss" onClick={() => setReceiptSale(null)}>
                <Icon name="x" />
          </button>
        </div>
      )}
    </div>
  );
}

function formatVariant(key: string, value: unknown) {
  const normalized = key.toLowerCase().replace(/[_-]/g, " ").trim();
  const label = typeof value === "number" && /ml|volume/.test(normalized) ? `${value} ml` : String(value);
  return label.replace(/\s+/g, " ").replace(/\b(edp|edt|edc)\b/gi, (part) => part.toUpperCase());
}

function productTypeIcon(typeCode: string): "spray" | "shirt" | "feet" | "sparkles" {
  const code = typeCode.toLowerCase();
  if (/perfume|fragrance|scent|body.?spray/.test(code)) return "spray";
  if (/shoe|footwear|sandal/.test(code)) return "feet";
  if (/cloth|dress|top|trouser|apparel/.test(code)) return "shirt";
  return "sparkles";
}

async function printReceipt(saleId: string, format: "html" | "pdf" = "html") {
  const base = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const response = await fetch(`${base}/api/sales/${saleId}/receipt?format=${format}&width=80`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Could not load receipt");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
}

function resolveCatalogImage(imageUrl: string) {
  if (!imageUrl.startsWith("/api/")) return imageUrl;
  const base = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return `${base}${imageUrl}`;
}

async function printInvoice(saleId: string) {
  const base = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const preview = window.open(`${base}/api/sales/${saleId}/invoice?format=html`, "_blank");
  if (!preview) throw new Error("Allow pop-ups to preview the invoice");
  preview.opener = null;
}

async function downloadInvoice(saleId: string) {
  const base = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const response = await fetch(`${base}/api/sales/${saleId}/invoice?format=pdf&download=1`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Could not generate invoice PDF");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `invoice-${saleId.slice(0, 8)}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadOwnerReport() {
  const base = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const response = await fetch(`${base}/api/sales/reports/owner-summary.pdf`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Could not generate the owner report");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "owner-profitability-report.pdf";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function encodeProductImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose a photo smaller than 12 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Photo editing is not supported in this browser.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const compressed = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.78),
  );
  if (!compressed) throw new Error("Could not prepare this photo.");
  if (compressed.size > 200_000)
    throw new Error("This photo is still too large. Choose a smaller image.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this photo."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read this photo."));
    reader.readAsDataURL(compressed);
  });
}

function ShiftPage() {
  const refresh = useRefresh(["current-shift"]);
  const { data, isPending } = useQuery({
    queryKey: ["current-shift"],
    queryFn: () =>
      api<{
        shift: {
          id: string;
          openingCashCents: number;
          openedAt: string;
          cashMovements: { type: string; amountCents: number; reason: string }[];
        } | null;
      }>("/shifts/current"),
  });
  const showLoading = useDelayedLoading(isPending);
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState("");
  const [reason, setReason] = useState("");
  const [movementType, setMovementType] = useState<"in" | "out">("in");
  const [message, setMessage] = useState("");
  const [closeSummary, setCloseSummary] = useState<{
    expectedCashCents: number;
    countedCashCents: number;
    varianceCents: number;
    mpesaManualCents: number;
    cardCents: number;
  } | null>(null);
  const mutation = useMutation({
    mutationFn: (body: { path: string; data: unknown }) =>
      api<{
        totals?: {
          expectedCashCents: number;
          countedCashCents: number;
          varianceCents: number;
          mpesaManualCents: number;
          cardCents: number;
        };
      }>(body.path, { method: "POST", body: JSON.stringify(body.data) }),
    onSuccess: (result, variables) => {
      if (variables.path === "/shifts/close" && result.totals) {
        setCloseSummary(result.totals);
        setMessage("Shift closed. Review your reconciliation summary.");
      } else setMessage("Shift updated successfully.");
      setAmount("");
      setCount("");
      setReason("");
      refresh();
    },
  });
  if (isPending) return showLoading ? <FormSkeleton /> : <div className="loading-reserve" aria-hidden="true" />;
  const shift = data?.shift;
  return (
    <>
      <PageHeader
        eyebrow="TILL CONTROL"
        title="My shift"
        detail="Open and close your till, and keep cash movements accounted for."
      />
      {message && <Notice tone="success">{message}</Notice>}
      {closeSummary && (
        <section className="metric-grid metric-grid-three section-spaced">
          <Metric
            label="Expected cash"
            value={money(closeSummary.expectedCashCents)}
            detail="Based on float, sales and movements"
          />
          <Metric
            label="Counted cash"
            value={money(closeSummary.countedCashCents)}
            detail="Cash counted at close"
          />
          <Metric
            label="Variance"
            value={money(closeSummary.varianceCents)}
            detail={`M-Pesa ${money(closeSummary.mpesaManualCents)} · Card ${money(closeSummary.cardCents)}`}
          />
        </section>
      )}
      <FormError value={mutation.error} />
      {!shift ? (
        <section className="surface form-surface">
          <h2>Open a shift</h2>
          <p className="muted">Enter the cash float in your drawer before selling.</p>
          <form
            className="inline-form"
            inert={mutation.isPending || undefined}
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({ path: "/shifts/open", data: { openingCashCents: cents(amount) } });
            }}
          >
            <Field label="Opening float (KES)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </Field>
            <Button loading={mutation.isPending}>Open shift</Button>
          </form>
        </section>
      ) : (
        <>
          <section className="metric-grid metric-grid-three">
            <Metric
              label="Shift status"
              value="Open"
              detail={`Since ${shopDateTime(shift.openedAt)}`}
            />
            <Metric
              label="Opening float"
              value={money(shift.openingCashCents)}
              detail="Cash at start of shift"
            />
            <Metric
              label="Cash movements"
              value={String(shift.cashMovements.length)}
              detail="In and out logged"
            />
          </section>
          <div className="content-columns">
            <section className="surface form-surface">
              <h2>Record cash in or out</h2>
              <form
                className="stack-form"
                inert={mutation.isPending || undefined}
                onSubmit={(e) => {
                  e.preventDefault();
                  mutation.mutate({
                    path: "/shifts/cash-movements",
                    data: { type: movementType, amountCents: cents(amount), reason },
                  });
                }}
              >
                <Field label="Movement">
                  <select
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as "in" | "out")}
                  >
                    <option value="in">Cash in</option>
                    <option value="out">Cash out</option>
                  </select>
                </Field>
                <Field label="Amount (KES)">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Reason">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    required
                  />
                </Field>
                <Button loading={mutation.isPending}>Save movement</Button>
              </form>
            </section>
            <section className="surface form-surface">
              <h2>Close shift</h2>
              <p className="muted">
                Count the cash in your drawer. The system calculates expected cash and variance.
              </p>
              <form
                className="stack-form"
                inert={mutation.isPending || undefined}
                onSubmit={(e) => {
                  e.preventDefault();
                  mutation.mutate({
                    path: "/shifts/close",
                    data: { countedCashCents: cents(count) },
                  });
                }}
              >
                <Field label="Cash counted (KES)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    required
                  />
                </Field>
                <Button className="button-danger">Close shift</Button>
              </form>
            </section>
          </div>
          <section className="surface table-surface">
            <h2>Cash movement log</h2>
            <DataTable
              headers={["Type", "Reason", "Amount"]}
              rows={shift.cashMovements.map((item) => [
                item.type === "in" ? "Cash in" : "Cash out",
                item.reason,
                money(item.amountCents),
              ])}
              empty="No cash movements recorded."
            />
          </section>
        </>
      )}
    </>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </article>
  );
}
function DataTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  if (!rows.length) return <div className="table-empty"><Icon name="receipt" /><p>{empty}</p><Link className="text-button" to="/">Go to point of sale</Link></div>;
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Scrollable data table">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th className={/total|amount|price|money/i.test(header) ? "money-cell" : ""} key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, col) => (
                <td className={/total|amount|price|money/i.test(headers[col] ?? "") ? "money-cell" : ""} key={col}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SalesPage() {
  const user = useUser();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Sale | null>(null);
  const [reason, setReason] = useState("");
  const [saleItemId, setSaleItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [feedback, setFeedback] = useState("");
  const [page, setPage] = useState(1);
  const { data, isPending, error } = useQuery({
    queryKey: ["sales", user.role, page],
    queryFn: () =>
      api<{ sales: Sale[]; page: number; pageSize: number }>(
        `/sales?${user.role === "admin" ? "scope=all&" : ""}page=${page}&pageSize=100`,
      ),
  });
  const showLoading = useDelayedLoading(isPending);
  const request = useMutation({
    mutationFn: () =>
      api("/refunds", {
        method: "POST",
        body: JSON.stringify({
          saleId: selected!.id,
          reason,
          items: [{ saleItemId, quantity: Number(quantity) }],
        }),
      }),
    onSuccess: () => {
      setSelected(null);
      setFeedback("Refund request sent for admin review.");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["refunds"] });
    },
  });
  if (isPending) return showLoading ? <TableSkeleton /> : <div className="loading-reserve" aria-hidden="true" />;
  return (
    <>
      <PageHeader
        eyebrow="TRANSACTIONS"
        title="Sales & receipts"
        detail="Review transactions, preview receipts and invoices, or manage a return."
      />
      {feedback && <Notice tone="success">{feedback}</Notice>}
      {error && <FormError value={error} />}
      <section className="surface table-surface">
        <DataTable
          headers={["Receipt", "Date", "Seller", "Items", "Total", "Status", "Actions"]}
          empty="No sales found."
          rows={(data?.sales ?? []).map((sale) => [
            <b>{sale.receiptNo}</b>,
            shopDateTime(sale.createdAt),
            sale.seller.name,
            sale.items.reduce((sum, item) => sum + item.qty, 0),
            money(sale.totalCents),
            <StatusPill value={sale.status} />,
            <div className="action-row">
              <button
                className="text-button"
                onClick={() => void printReceipt(sale.id).catch((e) => setFeedback(e.message))}
              >
                Preview receipt
              </button>
              <button
                className="text-button"
                onClick={() =>
                  void printReceipt(sale.id, "pdf").catch((e) => setFeedback(e.message))
                }
              >
                PDF
              </button>
              {sale.status === "completed" ||
              sale.status === "partially_refunded" ||
              sale.status === "refunded" ? (
                <button
                  className="text-button"
                  onClick={() => void printInvoice(sale.id).catch((e) => setFeedback(e.message))}
                >
                  Preview invoice
                </button>
              ) : null}
              {sale.status === "completed" ||
              sale.status === "partially_refunded" ||
              sale.status === "refunded" ? (
                <button
                  className="text-button"
                  onClick={() => void downloadInvoice(sale.id).catch((e) => setFeedback(e.message))}
                >
                  Invoice PDF
                </button>
              ) : null}
              {sale.status === "completed" || sale.status === "partially_refunded" ? (
                <button
                  className="text-button"
                  onClick={() => {
                    setSelected(sale);
                    setSaleItemId(sale.items[0]?.id ?? "");
                  }}
                >
                  Return
                </button>
              ) : null}
            </div>,
          ])}
        />
        <div className="table-pagination">
          <span>
            Page {page} · {data?.sales.length ?? 0} records shown
          </span>
          <div className="action-row">
            <button
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <button
              disabled={(data?.sales.length ?? 0) < 100}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {selected && (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true">
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close">
              <Icon name="x" />
            </button>
            <p className="eyebrow">RETURN REQUEST</p>
            <h2>{selected.receiptNo}</h2>
            <form
              className="stack-form"
              inert={request.isPending || undefined}
              onSubmit={(e) => {
                e.preventDefault();
                request.mutate();
              }}
            >
              <Field label="Item">
                <select value={saleItemId} onChange={(e) => setSaleItemId(e.target.value)}>
                  {selected.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.variant.product.name} · sold {item.qty}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quantity">
                <input
                  type="number"
                  min="1"
                  max={selected.items.find((item) => item.id === saleItemId)?.qty ?? 1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </Field>
              <Field label="Reason">
                <select value={reason} onChange={(e) => setReason(e.target.value)} required>
                  <option value="">Choose a reason</option>
                  <option value="Defective">Defective</option>
                  <option value="Wrong item">Wrong item</option>
                  <option value="Changed mind">Changed mind</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <FormError value={request.error} />
              <Button className="button-full" loading={request.isPending}>
                Send refund request
              </Button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
function StatusPill({ value }: { value: string }) {
  const success = ["completed", "paid", "approved", "open", "active", "verified", "synced"].includes(value);
  const danger = ["failed", "rejected", "expired", "voided", "inactive"].includes(value);
  const labels: Record<string, string> = {
    completed: "Completed",
    partially_refunded: "Partially refunded",
    pending_verification: "Pending verification",
    needs_review: "Needs review",
    out_of_stock: "Out of stock",
    inactive: "Deactivated",
    unmatched: "Unmatched",
  };
  const label = labels[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <span
      className={`status-pill ${success ? "status-success" : danger ? "status-danger" : "status-pending"}`}
    >
      <Icon className="status-icon" name={success ? "check" : danger ? "alert" : "clock"} />
      {label}
    </span>
  );
}

function StockPage() {
  const user = useUser();
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  const { data, isPending } = useQuery({
    queryKey: ["stock"],
    queryFn: () =>
      api<{
        stock: {
          id: string;
          quantity: number;
          mlRemaining: number | null;
          variant: {
            id: string;
            sku: string;
            barcode: string | null;
            priceCents: number;
            costCents?: number;
            product: { name: string };
          };
        }[];
      }>("/stock"),
  });
  const showLoading = useDelayedLoading(isPending);
  const [variantId, setVariantId] = useState("");
  const [delta, setDelta] = useState("");
  const [stockReason, setStockReason] = useState("");
  const client = useQueryClient();
  const adjustment = useMutation({
    mutationFn: () =>
      api("/stock/movements", {
        method: "POST",
        body: JSON.stringify({
          movements: [
            { variantId, type: "adjustment", quantityDelta: Number(delta), reason: stockReason },
          ],
        }),
      }),
    onSuccess: () => {
      setFeedback("Stock adjustment saved and audited.");
      setDelta("");
      setStockReason("");
      void client.invalidateQueries({ queryKey: ["stock"] });
    },
  });
  if (isPending) return showLoading ? <TableSkeleton /> : <div className="loading-reserve" aria-hidden="true" />;
  const rows = (data?.stock ?? []).filter(({ variant }) =>
    `${variant.product.name} ${variant.sku} ${variant.barcode ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="INVENTORY"
        title="Stock lookup"
        detail="On-hand quantity and remaining bulk volume across the catalog."
      />
      {feedback && <Notice tone="success">{feedback}</Notice>}
      <div className="toolbar">
        <div className="search-wrap search-wrap-light">
          <span>Find</span>
          <input
            placeholder="Find a product, SKU or barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="result-count">{rows.length} variants</span>
      </div>
      <section className="surface table-surface">
        <DataTable
          headers={[
            "Product",
            "SKU / barcode",
            "On hand",
            "Bulk volume",
            "Price",
            ...(user.role === "admin" ? ["Cost"] : []),
          ]}
          empty="No stock rows found."
          rows={rows.map(({ variant, quantity, mlRemaining }) => [
            <>
              <b>{variant.product.name}</b>
            </>,
            <>
              {variant.sku}
              <small className="table-subline">{variant.barcode ?? "No barcode"}</small>
            </>,
            <StatusPill value={quantity > 0 ? `${quantity} units` : "out of stock"} />,
            mlRemaining === null ? "—" : `${mlRemaining} ml`,
            money(variant.priceCents),
            ...(user.role === "admin" ? [money(variant.costCents ?? 0)] : []),
          ])}
        />
      </section>
      {user.role === "admin" && (
        <>
          <section className="surface form-surface section-spaced">
            <h2>Manual stock adjustment</h2>
            <p className="muted">Admin only. Every change is recorded in the stock ledger.</p>
            <form
              className="inline-form inline-form-wrap"
              inert={adjustment.isPending || undefined}
              onSubmit={(e) => {
                e.preventDefault();
                adjustment.mutate();
              }}
            >
              <Field label="Variant">
                <select value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
                  <option value="">Choose a product</option>
                  {rows.map(({ variant }) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.product.name} · {variant.sku}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quantity change">
                <input
                  type="number"
                  step="1"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  required
                />
              </Field>
              <Field label="Reason">
                <input
                  value={stockReason}
                  onChange={(e) => setStockReason(e.target.value)}
                  required
                />
              </Field>
            <Button loading={adjustment.isPending}>Post adjustment</Button>
            </form>
            <FormError value={adjustment.error} />
          </section>
          <DamagedStockPanel />
        </>
      )}
    </>
  );
}
function DamagedStockPanel() {
  const { data } = useQuery({
    queryKey: ["damaged-stock"],
    queryFn: () =>
      api<{
        levels: {
          id: string;
          quantity: number;
          variant: { sku: string; product: { name: string } };
        }[];
      }>("/stock/damaged"),
  });
  return (
    <section className="surface table-surface section-spaced">
      <h2>Damaged returns</h2>
      <DataTable
        headers={["Product", "SKU", "Damaged units"]}
        rows={(data?.levels ?? []).map((row) => [
          row.variant.product.name,
          row.variant.sku,
          row.quantity,
        ])}
        empty="No damaged returns are waiting for review."
      />
    </section>
  );
}

function RefundsPage() {
  const user = useUser();
  const { data, isPending } = useQuery({
    queryKey: ["refunds"],
    queryFn: () =>
      api<{
        refunds: {
          id: string;
          status: string;
          reason: string;
          amountCents: number;
          createdAt: string;
          sale: { receiptNo: string };
          requester: { name: string };
          items: {
            id: string;
            quantity: number;
            disposition: string;
            saleItem: { id: string; variant: { product: { name: string } } };
          }[];
        }[];
      }>("/refunds"),
  });
  const showLoading = useDelayedLoading(isPending);
  const client = useQueryClient();
  const [method, setMethod] = useState("cash");
  const [dispositions, setDispositions] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const decide = useMutation({
    mutationFn: ({ refundId, decision }: { refundId: string; decision: "approve" | "reject" }) => {
      const row = data?.refunds.find((item) => item.id === refundId);
      return api(`/refunds/${refundId}`, {
        method: "PATCH",
        body: JSON.stringify({
          decision,
          ...(decision === "approve"
            ? {
                refundMethod: method,
                dispositions: row?.items.map((item) => ({
                  saleItemId: item.saleItem.id,
                  disposition: dispositions[item.saleItem.id] ?? "restock",
                })),
              }
            : {}),
        }),
      });
    },
    onSuccess: () => {
      setMessage("Refund decision saved.");
      void client.invalidateQueries({ queryKey: ["refunds"] });
      void client.invalidateQueries({ queryKey: ["stock"] });
    },
  });
  if (isPending) return showLoading ? <TableSkeleton columns={5} /> : <div className="loading-reserve" aria-hidden="true" />;
  return (
    <>
      <PageHeader
        eyebrow="RETURNS"
        title={user.role === "admin" ? "Refund review" : "My refund requests"}
        detail={
          user.role === "admin"
            ? "Approve or reject staff return requests."
            : "Requests are reviewed by the shop admin."
        }
      />
      {message && <Notice tone="success">{message}</Notice>}
      <FormError value={decide.error} />
      <section className="refund-grid">
        {(data?.refunds ?? []).map((refund) => (
          <article className="surface refund-card" key={refund.id}>
            <div className="refund-card-top">
              <div>
                <span className="eyebrow">{refund.sale.receiptNo}</span>
                <h2>{money(refund.amountCents)}</h2>
              </div>
              <StatusPill value={refund.status} />
            </div>
            <p>{refund.reason}</p>
            <small className="muted">
              Requested by {refund.requester.name} ·{" "}
              {shopDate(refund.createdAt)}
            </small>
            <ul className="refund-items">
              {refund.items.map((item) => (
                <li key={item.id}>
                  {item.quantity} × {item.saleItem.variant.product.name}
                </li>
              ))}
            </ul>
            {user.role === "admin" && refund.status === "requested" && (
              <div className="refund-controls">
                <Field label="Refund method">
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="mpesa_manual">M-Pesa</option>
                    <option value="card">Card</option>
                  </select>
                </Field>
                {refund.items.map((item) => (
                  <Field key={item.id} label={`${item.saleItem.variant.product.name} disposition`}>
                    <select
                      value={dispositions[item.saleItem.id] ?? "restock"}
                      onChange={(e) =>
                        setDispositions((value) => ({
                          ...value,
                          [item.saleItem.id]: e.target.value,
                        }))
                      }
                    >
                      <option value="restock">Return to sellable stock</option>
                      <option value="damaged">Damaged stock</option>
                    </select>
                  </Field>
                ))}
                <div className="action-row">
                  <Button
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ refundId: refund.id, decision: "approve" })}
                  >
                    Approve refund
                  </Button>
                  <button
                    className="text-button danger-text"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ refundId: refund.id, decision: "reject" })}
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
      </section>
      {!data?.refunds.length && (
        <div className="empty-card">
          <h2>No refund requests</h2>
          <p>Requests will appear here when a return is submitted.</p>
        </div>
      )}
    </>
  );
}

function DashboardPage() {
  const [reportPending, setReportPending] = useState(false);
  const [reportError, setReportError] = useState("");
  const { data: summary } = useQuery({
    queryKey: ["owner-summary"],
    queryFn: () => api<OwnerSummary>("/sales/reports/owner-summary"),
  });
  const { data: sales } = useQuery({
    queryKey: ["sales", "all"],
    queryFn: () => api<{ sales: Sale[] }>("/sales?scope=all"),
  });
  const { data: stock } = useQuery({
    queryKey: ["stock"],
    queryFn: () =>
      api<{ stock: { quantity: number; variant: { product: { name: string } } }[] }>("/stock"),
  });
  const { data: pending } = useQuery({
    queryKey: ["pending-payments"],
    queryFn: () => api<{ payments: { id: string }[] }>("/payments/pending?scope=all"),
  });
  const today = summary?.today;
  const days = (summary?.days ?? []).map((day) => ({
    date: new Date(`${day.date}T00:00:00+03:00`),
    valueCents: day.netRevenueCents,
  }));
  const peak = Math.max(1, ...days.map((day) => day.valueCents));
  return (
    <>
      <PageHeader
        eyebrow="OWNER VIEW"
        title="Good day"
        detail="A quick overview of today's shop activity."
        action={
          <Button
            loading={reportPending}
            onClick={async () => {
              setReportPending(true);
              setReportError("");
              try {
                await downloadOwnerReport();
              } catch (error) {
                setReportError(error instanceof Error ? error.message : "Could not generate report");
              } finally {
                setReportPending(false);
              }
            }}
          >
            Download report PDF
          </Button>
        }
      />
      {reportError && <Notice tone="error">{reportError}</Notice>}
      <section className="metric-grid metric-grid-three">
        <Metric
          label="Sales today"
          value={money(today?.netRevenueCents ?? 0)}
          detail={`${today?.saleCount ?? 0} completed sales, after refunds`}
        />
        <Metric
          label="Gross profit today"
          value={money(today?.profitCents ?? 0)}
          detail="After approved refunds and restocks"
        />
        <Metric
          label="Gross margin today"
          value={
            today?.marginPct === null || today?.marginPct === undefined
              ? "—"
              : `${today.marginPct}%`
          }
          detail="Gross profit ÷ net sales"
        />
        <Metric
          label="Average basket"
          value={money(
            today?.saleCount ? Math.round((today.netRevenueCents ?? 0) / today.saleCount) : 0,
          )}
          detail="Today's net sales per sale"
        />
        <Metric
          label="Low stock"
          value={String(stock?.stock.filter((row) => row.quantity < 4).length ?? 0)}
          detail="Variants at 3 units or less"
        />
        <Metric
          label="Payments pending"
          value={String(pending?.payments.length ?? 0)}
          detail="M-Pesa status checks"
        />
      </section>
      <section className="surface chart-surface section-spaced">
        <div className="section-title-row">
          <div>
            <h2>Sales this week</h2>
            <p className="muted">Net sales by day · after approved refunds</p>
          </div>
          <span className="chart-legend">
            <span /> KES
          </span>
        </div>
        <div
          className="sales-chart"
          role="img"
          aria-label={`Sales for the last seven days. Peak ${money(peak)}.`}
        >
          {days.map((day) => (
            <div
              className="chart-column"
              key={day.date.toISOString()}
              title={`${shopDate(day.date)}: ${money(day.valueCents)}`}
            >
              <b>{day.valueCents ? money(day.valueCents) : "—"}</b>
              <div className="chart-track">
                <span
                  className={
                    day.date === days[days.length - 1]?.date
                      ? "chart-bar chart-bar-today"
                      : "chart-bar"
                  }
                  style={{
                    height: `${
                      day.valueCents > 0
                        ? Math.max(8, Math.round((day.valueCents / peak) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>
              <small>
                {shopDate(day.date, {
                  weekday: "short",
                  month: undefined,
                  day: undefined,
                  dateStyle: undefined,
                })}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className="surface table-surface section-spaced">
        <div className="section-title-row">
          <h2>Recent sales</h2>
          <Link className="text-button" to="/sales">
            View all sales
          </Link>
        </div>
        <DataTable
          headers={["Receipt", "Seller", "Items", "Total", "Status"]}
          rows={(sales?.sales ?? [])
            .slice(0, 8)
            .map((sale) => [
              sale.receiptNo,
              sale.seller.name,
              sale.items.reduce((sum, item) => sum + item.qty, 0),
              money(sale.totalCents),
              <StatusPill value={sale.status} />,
            ])}
          empty="Sales appear after the first transaction."
        />
      </section>
      <UnmatchedPaymentsPanel />
    </>
  );
}

function UnmatchedPaymentsPanel() {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ["unmatched-payments"],
    queryFn: () =>
      api<{
        payments: {
          id: string;
          amountCents: number;
          phone: string | null;
          mpesaReceipt: string | null;
          createdAt: string;
        }[];
      }>("/payments/unmatched"),
  });
  const { data: pending } = useQuery({
    queryKey: ["pending-payments"],
    queryFn: () =>
      api<{
        payments: { id: string; amountCents: number; phone: string | null; status: string }[];
      }>("/payments/pending?scope=all"),
  });
  const [choices, setChoices] = useState<Record<string, string>>({});
  const reconcile = useMutation({
    mutationFn: ({ orphanId, paymentId }: { orphanId: string; paymentId: string }) =>
      api(`/payments/unmatched/${orphanId}/reconcile`, {
        method: "PATCH",
        body: JSON.stringify({ paymentId }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["unmatched-payments"] });
      void client.invalidateQueries({ queryKey: ["pending-payments"] });
      void client.invalidateQueries({ queryKey: ["sales"] });
      void client.invalidateQueries({ queryKey: ["sales", "all"] });
    },
  });
  if (!data?.payments.length) return null;
  return (
    <section className="surface table-surface section-spaced">
      <div className="section-title-row">
        <h2>Unmatched M-Pesa payments</h2>
        <StatusPill value="needs review" />
      </div>
      <p className="muted">
        Match confirmed transactions to an open sale with the same amount and phone.
      </p>
      <DataTable
        headers={["Receipt code", "Amount", "Phone", "Received", "Open sale payment", "Action"]}
        empty="No unmatched payments."
        rows={data.payments.map((orphan) => {
          const candidates = (pending?.payments ?? []).filter(
            (item) =>
              item.amountCents === orphan.amountCents &&
              (!orphan.phone || !item.phone || item.phone.endsWith(orphan.phone.slice(-9))),
          );
          return [
            orphan.mpesaReceipt ?? "—",
            money(orphan.amountCents),
            orphan.phone ?? "—",
            shopDateTime(orphan.createdAt),
            <select
              aria-label={`Sale payment for ${orphan.mpesaReceipt ?? "unmatched payment"}`}
              value={choices[orphan.id] ?? ""}
              onChange={(event) =>
                setChoices((value) => ({ ...value, [orphan.id]: event.target.value }))
              }
            >
              <option value="">Select matching payment</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.status} · {candidate.phone ?? "no phone"}
                </option>
              ))}
            </select>,
            <Button
              disabled={!choices[orphan.id] || reconcile.isPending}
              onClick={() =>
                reconcile.mutate({ orphanId: orphan.id, paymentId: choices[orphan.id]! })
              }
            >
              Reconcile
            </Button>,
          ];
        })}
      />
      {reconcile.error && <FormError value={reconcile.error} />}
    </section>
  );
}

function StaffAdminPage() {
  const { data, isPending } = useQuery({
    queryKey: ["staff"],
    queryFn: () => api<{ staff: AppUser[] }>("/auth/staff"),
  });
  const showLoading = useDelayedLoading(isPending);
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [discount, setDiscount] = useState("0");
  const [message, setMessage] = useState("");
  const setStatus = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/auth/staff/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["staff"] }),
  });
  const create = useMutation({
    mutationFn: () =>
      api("/auth/staff", {
        method: "POST",
        body: JSON.stringify({
          name,
          username,
          temporaryPassword: password,
          discountLimitPct: Number(discount),
        }),
      }),
    onSuccess: () => {
      setName("");
      setUsername("");
      setPassword("");
      setMessage("Staff account created.");
      void client.invalidateQueries({ queryKey: ["staff"] });
    },
  });
  if (isPending) return showLoading ? <TableSkeleton columns={5} /> : <div className="loading-reserve" aria-hidden="true" />;
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Staff accounts"
        detail="Create and manage shop staff access."
      />
      {message && <Notice tone="success">{message}</Notice>}
      <FormError value={create.error} />
      <div className="content-columns">
        <section className="surface form-surface">
          <h2>Add a staff member</h2>
          <form
            className="stack-form"
            inert={create.isPending || undefined}
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Full name">
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Username">
              <input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </Field>
            <Field
              label="Temporary password"
              hint="At least 12 characters. They will change it at first sign in."
            >
              <input
                type="password"
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Field label="Discount limit (%)">
              <input
                type="number"
                min="0"
                max="100"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Button loading={create.isPending}>Create staff account</Button>
          </form>
        </section>
        <section className="surface table-surface">
          <h2>Team members</h2>
          <DataTable
            headers={["Name", "Username", "Status", "Access"]}
            rows={(data?.staff ?? []).map((staff) => [
              staff.name,
              staff.username,
              <StatusPill value={staff.active === false ? "inactive" : "active"} />,
              <button
                className="text-button"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: staff.id, active: staff.active === false })}
              >
                {staff.active === false ? "Reactivate" : "Deactivate"}
              </button>,
            ])}
            empty="No staff accounts yet."
          />
        </section>
      </div>
    </>
  );
}

function DocumentSettingsPage() {
  const client = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["document-settings"],
    queryFn: () => api<{ settings: DocumentSettings }>("/sales/documents/settings"),
  });
  const [form, setForm] = useState<DocumentSettings | null>(null);
  const preview = form ?? data?.settings;
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const save = useMutation({
    mutationFn: () =>
      api("/sales/documents/settings", {
        method: "PATCH",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      setMessage("Receipt and invoice settings saved.");
      void client.invalidateQueries({ queryKey: ["document-settings"] });
      void client.invalidateQueries({ queryKey: ["brand"] });
      void client.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
  const update = <K extends keyof DocumentSettings>(key: K, value: DocumentSettings[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };
  if (isPending) return <FormSkeleton />;
  return (
    <>
      <PageHeader
        eyebrow="DOCUMENTS"
        title="Receipts & invoices"
        detail="Edit the shop details and reusable text printed on receipts and invoices."
      />
      {message && <Notice tone="success">{message}</Notice>}
      {error && <FormError value={error} />}
      <FormError value={save.error} />
      <section className="surface form-surface document-settings-surface">
        <form
          className="catalog-form"
          inert={save.isPending || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Business name">
            <input value={form?.name ?? ""} onChange={(event) => update("name", event.target.value)} required />
          </Field>
          <Field label="Logo URL" hint="Use a logo URL saved in this shop's settings.">
            <input type="url" value={form?.logoUrl ?? ""} onChange={(event) => update("logoUrl", event.target.value)} />
          </Field>
          <Field label="Business phone">
            <input value={form?.phone ?? ""} onChange={(event) => update("phone", event.target.value)} />
          </Field>
          <Field label="Business address">
            <textarea rows={2} value={form?.address ?? ""} onChange={(event) => update("address", event.target.value)} />
          </Field>
          <Field label="Business PIN">
            <input value={form?.kraPin ?? ""} onChange={(event) => update("kraPin", event.target.value)} />
          </Field>
          <Field label="Receipt number prefix">
            <input value={form?.receiptPrefix ?? ""} maxLength={12} onChange={(event) => update("receiptPrefix", event.target.value)} required />
          </Field>
          <Field label="Receipt footer" hint="Short message printed at the bottom of receipts.">
            <textarea rows={3} maxLength={300} value={form?.receiptFooter ?? ""} onChange={(event) => update("receiptFooter", event.target.value)} />
          </Field>
          <Field label="Invoice terms or notes" hint="This text appears on sales invoice PDFs.">
            <textarea rows={3} maxLength={800} value={form?.invoiceTerms ?? ""} onChange={(event) => update("invoiceTerms", event.target.value)} />
          </Field>
          <Field label="Tax enabled">
            <select value={String(form?.taxEnabled ?? false)} onChange={(event) => update("taxEnabled", event.target.value === "true")}>
              <option value="false">Off</option>
              <option value="true">On</option>
            </select>
          </Field>
          <Field label="Tax rate (%)">
            <input type="number" min="0" max="100" step="0.01" value={((form?.taxRateBps ?? 0) / 100).toString()} onChange={(event) => update("taxRateBps", Math.round(Number(event.target.value) * 100))} />
          </Field>
          <Field label="Tax price mode">
            <select value={String(form?.taxInclusive ?? false)} onChange={(event) => update("taxInclusive", event.target.value === "true")}>
              <option value="false">Add tax to prices</option>
              <option value="true">Prices include tax</option>
            </select>
          </Field>
          <p className="document-settings-note">
            Printed totals, products, and quantities always come from the saved sale. Updating these settings changes the document header and reusable text.
          </p>
          <div className="catalog-submit">
            <Button loading={save.isPending} disabled={!form}>Save document settings</Button>
          </div>
        </form>
      </section>
      <section className="document-preview-grid section-spaced" aria-label="Live document previews">
        <article className="surface document-preview-card">
          <div className="section-title-row">
            <div>
              <span className="eyebrow">THERMAL RECEIPT</span>
              <h2>Receipt preview</h2>
            </div>
            <span className="preview-size-label">80 mm</span>
          </div>
          <div className="receipt-preview-paper">
            <b>{preview?.name || "Your business name"}</b>
            <small>{preview?.address || "Business address"}</small>
            <small>{preview?.phone || "Business phone"}</small>
            {preview?.kraPin && <small>PIN: {preview.kraPin}</small>}
            <hr />
            <div className="preview-receipt-row"><span>Receipt</span><span>EJ-000042</span></div>
            <div className="preview-receipt-row"><span>Amber Woods Eau de Parfum × 1</span><span>Ksh 8,500.00</span></div>
            <hr />
            <div className="preview-receipt-row preview-receipt-total"><span>Total</span><span>Ksh 8,500.00</span></div>
            <small className="preview-receipt-footer">{preview?.receiptFooter || "Receipt footer message"}</small>
          </div>
        </article>
        <article className="surface document-preview-card">
          <div className="section-title-row">
            <div>
              <span className="eyebrow">A4 SALES DOCUMENT</span>
              <h2>Invoice preview</h2>
            </div>
            <span className="preview-size-label">A4</span>
          </div>
          <div className="invoice-preview-paper">
            <header className="invoice-preview-head">
              <div><b>{preview?.name || "Your business name"}</b><small>{preview?.address || "Business address"}</small><small>{preview?.phone || "Business phone"}</small></div>
              <div><strong>INVOICE</strong><small>INV-EJ-000042</small><small>24 Nov 2026</small></div>
            </header>
            {preview?.kraPin && <small className="invoice-preview-pin">Business PIN: {preview.kraPin}</small>}
            <div className="invoice-preview-customer"><small>BILLED TO</small><b>Walk-in customer</b></div>
            <div className="invoice-preview-line"><b>Amber Woods Eau de Parfum</b><span>1 × Ksh 8,500.00</span><strong>Ksh 8,500.00</strong></div>
            <div className="invoice-preview-totals"><span>Total</span><b>Ksh 8,500.00</b></div>
            <p className="invoice-preview-terms">{preview?.invoiceTerms || "Invoice terms and notes appear here."}</p>
            <p className="invoice-preview-footer">{preview?.receiptFooter || "Receipt footer message"}</p>
          </div>
        </article>
      </section>
    </>
  );
}

function CatalogAdminPage() {
  const { data, isPending } = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<Catalog>("/catalog"),
  });
  const showLoading = useDelayedLoading(isPending);
  const client = useQueryClient();
  const [departmentId, setDepartmentId] = useState("");
  const [productTypeId, setProductTypeId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const imageFileInput = useRef<HTMLInputElement>(null);
  const cameraFileInput = useRef<HTMLInputElement>(null);
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("0");
  const [attrs, setAttrs] = useState("{}");
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      await api("/catalog/products", {
        method: "POST",
        body: JSON.stringify({
          departmentId,
          productTypeId,
          brandId: brandId || null,
          name,
          imageUrl: imageUrl.trim() || null,
          attributes: {},
          variants: [
            {
              sku,
              priceCents: cents(price),
              costCents: cents(cost),
              attributes: JSON.parse(attrs),
              reorderLevel: 0,
              isBulk: false,
              isTester: false,
              isTesterAllowed: false,
            },
          ],
        }),
      });
      const created = await api<Catalog>("/catalog");
      const variant = created.products
        .flatMap((row) => row.variants)
        .find((row) => row.sku === sku);
      if (!variant) throw new Error("Product was saved but its variant could not be loaded");
      if (Number(stock) > 0)
        await api("/stock/movements", {
          method: "POST",
          body: JSON.stringify({
            movements: [
              {
                variantId: variant.id,
                type: "purchase",
                quantityDelta: Number(stock),
                costPerUnitCents: cents(cost),
                reason: "Opening stock",
              },
            ],
          }),
        });
    },
    onSuccess: () => {
      setMessage("Product and opening stock created.");
      setName("");
      setImageUrl("");
      setImageError("");
      setSku("");
      setPrice("");
      setCost("");
      setStock("0");
      void client.invalidateQueries({ queryKey: ["catalog"] });
      void client.invalidateQueries({ queryKey: ["stock"] });
    },
  });
  if (isPending) return showLoading ? <FormSkeleton /> : <div className="loading-reserve" aria-hidden="true" />;
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Catalog"
        detail="Add a product with one sellable variant and opening stock."
      />
      {message && <Notice tone="success">{message}</Notice>}
      <FormError value={create.error} />
      <section className="surface form-surface">
        <form
          className="catalog-form"
          inert={create.isPending || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Product name">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Product picture URL" hint="Use a direct link to a publicly accessible product photo.">
            <input
              autoComplete="url"
              inputMode="url"
              placeholder="https://example.com/product.jpg"
              type="url"
              value={imageUrl.startsWith("data:") ? "" : imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                setImageError("");
              }}
            />
          </Field>
          <div className="catalog-photo-controls">
            <span>Add a product photo</span>
            <div className="action-row">
              <button type="button" className="button button-secondary" onClick={() => imageFileInput.current?.click()}>
                Upload photo
              </button>
              <button type="button" className="button button-secondary" onClick={() => cameraFileInput.current?.click()}>
                Take photo
              </button>
            </div>
            <input
              ref={imageFileInput}
              className="photo-file-input"
              type="file"
              accept="image/*"
              aria-label="Upload product photo"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                void encodeProductImage(file).then(setImageUrl).catch((error) => {
                  setImageError(error instanceof Error ? error.message : "Could not process photo");
                });
              }}
            />
            <input
              ref={cameraFileInput}
              className="photo-file-input"
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Take product photo with camera"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                void encodeProductImage(file).then(setImageUrl).catch((error) => {
                  setImageError(error instanceof Error ? error.message : "Could not process photo");
                });
              }}
            />
            {imageError && <p className="field-hint">{imageError}</p>}
            {imageUrl && (
              <div className="catalog-image-preview">
                <span>Photo preview</span>
                <ProgressiveImage
                  className="product-photo-preview"
                  src={imageUrl}
                  alt={`${name || "Product"} preview`}
                  width={240}
                  height={240}
                />
                <button type="button" className="text-button" onClick={() => setImageUrl("")}>Remove photo</button>
              </div>
            )}
          </div>
          <Field label="SKU">
            <input value={sku} onChange={(e) => setSku(e.target.value)} required />
          </Field>
          <Field label="Department">
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
              <option value="">Select department</option>
              {data?.departments.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product type">
            <select
              value={productTypeId}
              onChange={(e) => setProductTypeId(e.target.value)}
              required
            >
              <option value="">Select type</option>
              {data?.productTypes.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Brand">
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">No brand</option>
              {data?.brands.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Selling price (KES)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </Field>
          <Field label="Cost price (KES)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              required
            />
          </Field>
          <Field label="Opening quantity">
            <input
              type="number"
              min="0"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Variant attributes (JSON)"
            hint='For example: {"size_ml": 50, "concentration": "EDP"}'
          >
            <input value={attrs} onChange={(e) => setAttrs(e.target.value)} />
          </Field>
          <div className="catalog-submit">
            <Button loading={create.isPending}>Save product</Button>
          </div>
        </form>
      </section>
      <section className="surface table-surface section-spaced">
        <h2>Products</h2>
        <DataTable
          headers={["Product", "Department", "Type", "Variants"]}
          rows={(data?.products ?? []).map((product) => [
            product.name,
            product.department.name,
            product.productType.name,
            product.variants.length,
          ])}
          empty="No products in the catalog."
        />
      </section>
    </>
  );
}

function DesignPage() {
  return (
    <main className="design-page">
      <Link to="/">Back to point of sale</Link>
      <PageHeader
        eyebrow="DEVELOPMENT PREVIEW"
        title="Design system"
        detail="Shop colors, type, components and interface states."
      />
      <div className="design-grid">
        <section className="surface form-surface">
          <h2>Colors</h2>
          <div className="swatch-grid">
            {[
              "black",
              "charcoal",
              "blue",
              "blue-soft",
              "blue-deep",
              "blue-wash",
              "yellow",
              "yellow-soft",
              "yellow-deep",
              "yellow-wash",
              "paper",
              "muted",
              "success",
              "warning",
              "danger",
            ].map((color) => (
              <div className="swatch" key={color}>
                <span className={`swatch-color swatch-${color}`} />
                <small>{color}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="surface form-surface">
          <h2>Buttons</h2>
          <div className="design-row">
            <Button>Primary action</Button>
            <Button className="button-secondary">Secondary</Button>
            <Button className="button-danger">Danger</Button>
            <button className="text-button">Text action</button>
          </div>
          <div className="design-row">
            <Button disabled>Disabled</Button>
            <Loading label="Loading state" />
          </div>
        </section>
        <section className="surface form-surface">
          <h2>Status</h2>
          <div className="design-row">
            <StatusPill value="completed" />
            <StatusPill value="pending_verification" />
            <StatusPill value="failed" />
          </div>
        </section>
        <section className="surface form-surface">
          <h2>Inputs and surfaces</h2>
          <Field label="Text input">
            <input placeholder="Type something" />
          </Field>
          <div className="metric-card">
            <span>Stat card</span>
            <b>KES 12,450</b>
            <small>Today's sales</small>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function App() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: brand } = useQuery({
    queryKey: ["brand"],
    queryFn: () => api<BrandSettings>("/brand"),
    staleTime: 60_000,
    retry: false,
  });
  const brandSettings = brand ?? { brandName: "Shop", logoUrl: null };
  const { data, isPending } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: AppUser }>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
  useEffect(() => {
    const route = location.pathname;
    document.title = `${APP_ROUTE_TITLES[route] ?? "Page not found"} | ${brandSettings.brandName}`;
  }, [location.pathname, brandSettings.brandName]);
  if (import.meta.env.DEV && window.location.pathname === "/design") return <DesignPage />;
  if (isPending) return <div className="app-loading auth-bootstrap-reserve" aria-hidden="true"><span className="skeleton auth-bootstrap-mark" /><span className="skeleton auth-bootstrap-line" /></div>;
  const user = data?.user;
  if (!user)
    return (
      <LoginPage brand={brandSettings} onLogin={(nextUser) => {
        queryClient.setQueryData(["me"], { user: nextUser });
        void queryClient.prefetchQuery({ queryKey: ["catalog"], queryFn: async () => { const fresh = await api<Catalog>("/catalog"); void writeLocal("catalog", fresh).catch(() => undefined); return fresh; } });
      }} />
    );
  if (user.mustChangePassword)
    return (
      <PasswordChange
        brand={brandSettings}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ["me"] });
        }}
      />
    );
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
    } finally {
      queryClient.clear();
      window.location.assign("/");
    }
  }
  return (
    <UserContext.Provider value={user}>
      <AppShell brand={brandSettings} onLogout={() => void logout()} />
    </UserContext.Provider>
  );
}
