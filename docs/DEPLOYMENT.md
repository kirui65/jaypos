# Deployment

The Render web service serves both the Vite app and Express API from the same HTTPS origin. PostgreSQL stays in the linked Supabase project. `render.yaml` is the service configuration; database URLs and the initial admin password are set as Render secrets.

## Initial setup

1. Create the public GitHub repository `kirui65/jaypos` and push the `main` branch.
2. Create the Render service from that repository using `render.yaml`.
3. In the Supabase project Connect dialog, copy the session pooler URL for `DIRECT_URL` (port 5432) and transaction pooler URL for `DATABASE_URL` (port 6543). Keep the project password encoded in the URL, include `sslmode=require`, and include `pgbouncer=true&connection_limit=1` on the transaction URL.
4. Set both URLs, `ADMIN_SEED_EMAIL`, and a unique `ADMIN_SEED_PASSWORD` in the Render service environment. Each build applies Prisma migrations; the first build seeds the initial shop/admin account only when the shop is absent.

The service binds to Render's `PORT`, serves static assets and SPA routes, and checks health at `/health`. Production API requests use same-origin relative URLs.

## Current limits

The Blueprint uses Render's free web plan to avoid creating a recurring charge. Free web services can sleep after 15 minutes idle and have an ephemeral filesystem. Product photos uploaded to this service can disappear after restarts, sleeps, or deploys; use remote image URLs until durable object storage or a paid persistent disk is configured. The shop database remains durable in Supabase.

Lipwa is selected as the payment provider, but STK payments need the shop's Lipwa API key and channel ID in Render. Cash checkout does not depend on those credentials.
