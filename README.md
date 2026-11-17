# SocialOrbit by ELIAHTECH

**Create • Automate • Grow.**

A substantial *pre-production engineering build* of a multi-tenant social-content SaaS. Includes the official SocialOrbit logo, favicon, branded responsive website, creator workspace, administration, Supabase schema, API modules, quota-ledger SQL, AI text gateway, payment checkout adapters, social OAuth foundations, guarded publisher, queued FFmpeg video clipping, and test suite.

> **Release status: PRE-PRODUCTION / NOT COMPLETE.** This is not a live, fully verified six-platform publishing service. Consult [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) before deployment. Unimplemented social features are deliberately not faked. Credentials and social provider app approvals are **not** included.

## Quick start

## Latest upgrade attempt — blocked at Phase 0

The 2026-11-16 upgrade request specifies **Pesapal + PayPal with KES/USD and removal of direct Daraja M-Pesa**. These changes are **not shipped here** because the specified `npm ci && npm run typecheck && npm test && npm run test:syntax` gate is not green: this environment cannot reach the npm registry, the existing archive lacks `package-lock.json`, and dependencies are absent. The repo now pins Node and npm and CI requires `npm ci`, but CI cannot succeed until a real lockfile is generated and tested. See [Upgrade gate report](docs/UPGRADE_GATE_REPORT.md). Do not accept payments with the old provider implementation as if it fulfills the new design.

### Requirements

- Node.js 26.x (the latest LTS supported by Vercel; see `.nvmrc`) and the npm that ships with it. Vercel only offers major versions, so `engines.node` is `26.x`.
- Supabase project (PostgreSQL, Auth and Storage). Set its media bucket upload limit to at least 100 MiB; actual provider limits apply.
- Redis (managed or local). FFmpeg and FFprobe installed and available on the worker's `PATH` for clip processing.
- Provider credentials to test optional OAuth, AI, M-Pesa and Pesapal operations.

```bash
# Unzip and open the SocialOrbit directory.
cp .env.example .env
# Edit .env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY_HEX.
# Create encryption key: openssl rand -hex 32
npm install
```

1. Open your Supabase project **SQL Editor**, apply the following migrations in order on a *new* project: `supabase/migrations/001_initial.sql`, `002_payment_fulfillment.sql`, `003_extended_features.sql`.
2. In Supabase Auth configuration, enable desired email/password and/or Google sign-in and set appropriate redirect URLs (`http://localhost:3000/app.html` locally).
3. Set `ENCRYPTION_KEY_HEX` to a stable, secret 64-character hexadecimal string; losing it prevents decrypting existing provider credentials.
4. Configure Brevo SMTP within Supabase Auth SMTP settings if using Brevo for authentication emails. The `.env` values by themselves do not configure Supabase SMTP.
5. Run the API: `npm run dev`. Visit `http://localhost:3000` (landing page), `http://localhost:3000/app.html` (creator workspace), or `http://localhost:3000/admin.html` (restricted admin).
6. Run `npm run dev:worker` in a separate process after Redis and FFmpeg/FFprobe are configured.

**All external publishing and social synchronization are disabled by default** (`ENABLE_PUBLISHING=false`, `ENABLE_SOCIAL_SYNC=false`). The enabled flags must only be set after real test-account validation, required scopes, approved social applications and operational review. Turning on a flag does not magically enable missing social adapters.

### Admin bootstrap

After a real user registers, a trusted Supabase administrator may manually assign the role using the SQL Editor (do not expose this statement as a public API):

```sql
insert into public.admin_roles (user_id, role)
values ('REPLACE_WITH_REAL_AUTH_USERS_UUID', 'super_admin')
on conflict (user_id) do update set role = excluded.role;
```

Use MFA for privileged accounts before production deployment.

### Tests

```bash
npm test               # dependency-free core business tests; Node test discovery
npm run test:syntax    # TypeScript parser check
npm run typecheck      # full TypeScript type check; needs npm install
npm run check          # typecheck + tests + syntax
```

CI configuration is at `.github/workflows/ci.yml` and now uses `npm ci`. This checkout has **no generated npm lockfile** because npm registry access is blocked here. Generate and commit it after `npm install`, then run the full gate. The workflow will fail without it by design.

### Deploying

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Express server runs as a long-lived Node process locally; Vercel requires a separate suitable serverless entrypoint/adapter before deploying the API as-is. Keep workers on persistent worker hosting, not Vercel request handlers. No live deployment has been carried out.

### Mobile

`apps/mobile/capacitor.config.ts` is an initial Capacitor configuration pointing to the shared browser assets. Native Android and iOS project files and builds are **not yet generated/tested**. Do not claim an APK or App Store-ready app exists.

### Branding

Official generated SocialOrbit brand-board artwork, logo, icon and favicon are bundled in `apps/web/public/assets/` and `apps/web/public/favicon.ico`; used across the website and application.

### Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API surface](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Feature implementation matrix](docs/IMPLEMENTATION_STATUS.md)
- [Release test results](docs/TEST_REPORT.md)
- [Security and prelaunch checklist](docs/SECURITY.md)
- [Original user-approved master specification](docs/MASTER_SPECIFICATION.txt)
- [Latest upgrade specification](docs/UPGRADE_SPECIFICATION.txt)
- [Latest upgrade phase gate / blockers](docs/UPGRADE_GATE_REPORT.md)

## Core safety design

- Service-role credentials remain server-side; workspaces enforce membership and role checks; PostgreSQL RLS is enabled for tenant data.
- Social OAuth uses a signed state and encrypted tokens; no unsupported automated scraping is provided.
- A successful checkout redirect does **not** activate a subscription. Only independently verified provider status can fulfill a payment.
- Credit quotas are transactionally reserved, settled or released by PostgreSQL stored functions.
- Uploaded media is limited to 100 MiB and has a seven-day expiry, with worker cleanup.
- Unknown publishing outcomes are held for manual reconciliation, not blindly retried.

## Important legal and platform notes

- `privacy.html` and `terms.html` are **prelaunch drafts** and require proper business/legal review, actual support information, and policies before public launch.
- Social platform APIs require app approvals and may prohibit certain actions or lack media reuse access.
- Subscription prices in the UI and seed data are **proposed** and are editable by Super Admin.

This package is intended for continued implementation and independent professional verification, **not** to be passed off as a completed commercial launch.
