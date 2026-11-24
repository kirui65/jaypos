import { useDelayedLoading } from "./useDelayedLoading.js";

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

export function ProductCardSkeleton() {
  return (
    <div className="product-card-skeleton" aria-hidden="true">
      <Skeleton className="product-art-skeleton" />
      <div className="product-card-skeleton-body"><Skeleton className="skeleton-line skeleton-line-short" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line skeleton-line-chips" /><Skeleton className="skeleton-line skeleton-line-price" /></div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return <div className="product-grid-skeleton" aria-label="Loading products">{Array.from({ length: count }, (_, i) => <ProductCardSkeleton key={i} />)}</div>;
}

export function TableSkeleton({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  return <div className="table-skeleton" aria-label="Loading rows"><div className="table-skeleton-header">{Array.from({ length: columns }, (_, i) => <Skeleton key={i} />)}</div>{Array.from({ length: rows }, (_, row) => <div className="table-skeleton-row" key={row}>{Array.from({ length: columns }, (_, col) => <Skeleton key={col} />)}</div>)}</div>;
}

export function StatCardSkeleton() {
  return <article className="metric-card stat-card-skeleton" aria-hidden="true"><Skeleton className="skeleton-line skeleton-line-short" /><Skeleton className="skeleton-line skeleton-line-number" /><Skeleton className="skeleton-line skeleton-line-detail" /></article>;
}

export function CartPanelSkeleton() {
  return <aside className="cart-panel cart-panel-skeleton" aria-label="Loading cart"><Skeleton className="skeleton-line skeleton-line-short" /><Skeleton className="cart-skeleton-row" /><Skeleton className="cart-skeleton-row" /><Skeleton className="cart-skeleton-footer" /></aside>;
}

export function FormSkeleton() {
  return <section className="surface form-skeleton" aria-label="Loading form">{Array.from({ length: 5 }, (_, i) => <div className="form-skeleton-field" key={i}><Skeleton className="skeleton-line skeleton-line-short" /><Skeleton className="form-skeleton-input" /></div>)}<Skeleton className="form-skeleton-save" /></section>;
}

export function DelayedSkeleton({ loading, children, fallback = null }: { loading: boolean; children: React.ReactNode; fallback?: React.ReactNode }) {
  const visible = useDelayedLoading(loading);
  return visible ? <>{children}</> : <>{fallback}</>;
}
