# Deployment

The Render web service serves both the Vite app and Express API from the same HTTPS origin. PostgreSQL stays in the linked Supabase project. The public repo is [kirui65/jaypos](https://github.com/kirui65/jaypos); the primary custom domain is https://liz.jaypos.co.ke, with https://jaypos-oqmo.onrender.com as a fallback. `WEB_ORIGIN` accepts a comma-separated list of allowed origins.

## Initial setup

1. The public GitHub repository and Render service are already created.
2. Add `DATABASE_URL` and `DIRECT_URL` to the Render service environment. The linked Supabase project reports pooler host `aws-1-eu-west-1.pooler.supabase.com` and username `postgres.himlzgngxdexksnjycno`; use port 6543 for `DATABASE_URL` and port 5432 for `DIRECT_URL`. Keep the database password URL-encoded, add `sslmode=require`, and include `pgbouncer=true&connection_limit=5` on the transaction URL.
3. Add `ADMIN_SEED_EMAIL` and a unique `ADMIN_SEED_PASSWORD` in Render. Each build applies Prisma migrations; the first build seeds the initial shop/admin account only when the shop is absent. The linked Supabase database currently has no application tables.

The service binds to Render's `PORT`, serves static assets and SPA routes, and checks health at `/health`. Production API requests use same-origin relative URLs.

## Current limits

The Blueprint uses Render's free web plan to avoid creating a recurring charge. Free web services can sleep after 15 minutes idle and have an ephemeral filesystem. Product photos uploaded to this service can disappear after restarts, sleeps, or deploys; use remote image URLs until durable object storage or a paid persistent disk is configured. The shop database remains durable in Supabase.

Lipwa is selected as the payment provider, but STK payments need the shop's Lipwa API key and channel ID in Render. Cash checkout does not depend on those credentials.
