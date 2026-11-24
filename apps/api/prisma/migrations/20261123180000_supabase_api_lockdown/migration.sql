-- The POS talks to PostgreSQL through the authenticated Express API.
-- Keep the Supabase Data API from exposing these tables to anon/authenticated roles.
-- RLS has no policies by design; the trusted API database connection owns authorization.
DO $$
DECLARE
  table_name text;
  app_tables text[] := ARRAY[
    'shops',
    'roles',
    'permissions',
    'role_permissions',
    'users',
    'auth_sessions',
    'login_attempts',
    'audit_logs',
    'departments',
    'product_types',
    'brands',
    'products',
    'product_variants',
    'bundle_items',
    'stock_levels',
    'damaged_stock_levels',
    'stock_movements',
    'stock_reports',
    'customers',
    'customer_preferences',
    'sales',
    'sale_items',
    'payments',
    'unmatched_payments',
    'refunds',
    'refund_items',
    'shifts',
    'held_carts',
    'receipt_counters',
    'cash_movements',
    'settings'
  ];
BEGIN
  FOREACH table_name IN ARRAY app_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', table_name);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', table_name);
    END IF;
  END LOOP;
END
$$;
