# Deployment and infrastructure preparation

**Not yet deployed.** Do not enable payment collection or publishing in production before completing the release gates.

## Suggested deployment topology

1. Static web assets: Vercel static hosting or equivalent. Static browser UI currently calls relative `/api`; if web and API hosts differ, build a same-origin proxy, or change the API base and CORS/CSRF policies deliberately.
2. Node API: persistent Node host initially, or refactor Express to a compatible Vercel serverless function entrypoint, verifying all response limits and OAuth/webhook callbacks.
3. Worker: a continuously running Node process on a worker-compatible host.
4. Redis: managed Redis or durable local Redis for development; use secure network rules and secrets.
5. Supabase: Auth, PostgreSQL with the 3 migrations, and a private Storage bucket `socialorbit-media` (100 MiB size cap needs an eligible Supabase plan or alternative storage).
6. FFmpeg and FFprobe binaries available on the worker host.

## Configurations

- Copy `.env.example`, replace placeholders, generate stable encryption key.
- Configure provider OAuth redirect URIs: `<PUBLIC_BASE_URL>/api/oauth/callback/facebook`, `/youtube`, `/linkedin`.
- Configure Supabase Auth redirect URLs for the web application.
- Configure Brevo SMTP in Supabase Auth. Securely manage an email template, authentication sender, SPF/DKIM as appropriate.
- Configure M-Pesa/Pesapal callbacks and independently verify sandbox flows before live keys.
- Set a real hostname and generate `sitemap.xml` and `robots.txt`: `node scripts/generate-sitemap.mjs https://your-actual-domain.com`.
- Enable `ENABLE_SOCIAL_SYNC` or `ENABLE_PUBLISHING` **only after** appropriate provider approvals, test accounts, platform compliance reviews, and integration testing.

## Checks

```bash
npm install
npm run check
npm run dev           # API
npm run dev:worker    # separately; Redis + FFmpeg required
curl http://localhost:3000/api/health
```

A `health` status of `ok` only means the API process is responding; it is **not** a database/worker/provider integration readiness check. Verify these separately.

## Mobile

`apps/mobile/capacitor.config.ts` is a preliminary configuration. Generate and test Android/iOS platform projects using a machine with the required SDKs, compatible Capacitor versions, and actual device/simulator access. Apple builds and testing require an appropriate Mac and Xcode setup. Do not distribute until app-specific store compliance and purchase rules are implemented.

## Rollback and monitoring

Keep migration backups, environment snapshots, signed deployment revisions and worker queue telemetry. Before release, define automated alerts and an incident escalation path for duplicate publications, credit inconsistencies, payment reconciliation failures, OAuth failures and expired media cleanup. A production operational runbook is not yet complete.

## Node.js version (Vercel)

- Target runtime: **Node.js 26.x**. Vercel lists 26.x (default) and 24.x as available, and only major versions can be selected; minor/patch updates roll out automatically. `engines.node` is `26.x` and `.nvmrc` is `26`.
- Node 26's built-in `fetch` negotiates HTTP/2 on Vercel Functions. The payment, OAuth and social-provider calls use `fetch`, so test them in staging. To fall back to HTTP/1.1 set `VERCEL_FETCH_DISABLE_H2=1` and redeploy.
- Vercel only hosts the static site and (after a serverless adapter is written) the API. The BullMQ worker must run on a separate long-lived host using the same Node major version.
- `npm test` runs `node --test` without `--experimental-strip-types`, which relies on Node's default TypeScript type stripping (Node 22.18+ and 26). It passed on v22.23.4 here and has NOT yet been run on Node 26.
