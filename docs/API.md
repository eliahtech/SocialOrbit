# API inventory (implemented source routes, not live-certified)

The authenticated API expects `Authorization: Bearer <Supabase access token>`. Tenant routes use `:workspaceId` and the server verifies membership and role. Most responses are JSON; validation errors are standardized. Consult source route implementations for field-level contracts; a generated OpenAPI contract is still outstanding.

## Public and account

- `GET /api/health`, `/api/config`, `/api/plans`
- `GET /api/me`, `PATCH /api/me`
- `GET /api/workspaces`, `POST /api/workspaces`
- `GET /api/workspaces/:workspaceId/overview`, `GET/POST .../members`

## Creator workspace (prefix `/api/w/:workspaceId`)

- `/content` — list, create, update and delete content; drafts are genuine persisted data.
- `/media` — listing, request-upload, upload-completion validation.
- `/designs` — create and edit saved layered graphics.
- `/clips` — queue a clipped video and inspect result.
- `/ai` — submit supported text tasks to centrally configured AI provider.
- `/social` — list authorized accounts; `/oauth/:provider/start`, account disconnect.
- `/publishing/jobs` — independent destination jobs, cancellation and status.
- `/automation` — create/list inactive rules (no live end-to-end automation engine).
- `/analytics` — stored job and available metric data, without simulated counts.
- `/billing` — subscription and wallets, credit packs, checkout and history.
- `/support` — support tickets, replies, suggestions and votes.
- `/api/notifications` — account notifications.

## Server-to-provider

- `/api/oauth/callback/:provider` — signed OAuth state callback and credential storage.
- `/api/webhooks/pesapal`, `/api/webhooks/mpesa` — verification-first payment callbacks.

## Administrator

- `GET /api/admin/overview`, `/users`, `/workspaces`, `/tickets`, `/plans`, `/jobs`, `/features`
- `PATCH /api/admin/users/:id/status`, `/tickets/:id`, `/plans/:key`, `/features/:id`
- `POST /api/admin/publishing-pause`, `/tickets/:id/messages`

## Current provider-specific status

OAuth paths: Facebook Pages, YouTube channels, LinkedIn member authorization (require configured apps/permissions and have not been live tested).

External publication code paths: Facebook Page text, YouTube MP4 video only, **disabled by default**. No guarantee of live acceptance until provider approvals and sandbox/test-account verification. Instagram, TikTok, X, LinkedIn publishing, Facebook images/videos and other publishing features are not yet implemented.
