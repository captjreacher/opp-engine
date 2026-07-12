# Opportunity Engine

Standalone operator console that turns **existing** AI-discovered local-business opportunities
(already scored and audited in Supabase) into reviewed audits and outbound conversations.

> Standalone by design. No MGRNZ Cockpit / event-routing / CRM / FMF / FYV coupling.
> It **consumes** the existing intelligence layer — it does not rebuild discovery, scoring, or auditing.

## Architecture

```
React / Vite frontend
        │  (operator bearer token)
        ▼
Supabase Edge Function  (service role)   ← the ONLY privileged boundary
        │
        ▼
Existing Supabase tables (local_business_*)
```

The browser never receives privileged database access. All reads/writes go through the
`opportunities` Edge Function, which uses the service role server-side.

## Phase 1 — API layer (DEPLOYED)

Edge Function `opportunities` (Supabase project `mgrnz-web`):

| Method | Route | Purpose |
|---|---|---|
| GET | `/opportunities/health` | Unauthenticated liveness (no data) |
| GET | `/opportunities` | Board list (via `v_opportunity_list` view) |
| GET | `/opportunities/:id` | Full detail: lead, assessments, audit report, event history, drafts |
| POST | `/opportunities/:id/outreach` | Generate + **store** an outreach draft — **never sends** |

Data sources (existing, unchanged): `local_business_leads`, `local_business_lead_assessments`,
`local_business_audit_reports`, `local_business_lead_events`, `local_business_outreach_drafts`.

### Additive DB objects (this app only)
- `v_opportunity_list` — read-only board view (revoked from `anon`/`authenticated`).
- `opportunity_console_audit_log` — app-owned operator action log (RLS on, service-role only).
  Deliberately **not** wired into the canonical `events` system.

See `supabase/migrations/`. `supabase/security/rls_hardening_optional.sql` is an **optional,
un-applied** project-wide hardening for 19 unrelated exposed tables — not required by this app.

## Auth

Phase 1 uses a shared operator bearer token; the function fails closed if it is unset:

```bash
supabase secrets set OPERATOR_TOKEN=$(openssl rand -hex 24) --project-ref jqfodlzcsgfocyuawzyx
```

Call the API with `Authorization: Bearer <OPERATOR_TOKEN>`. Migration path to a Supabase Auth
operator role is documented in [`docs/auth-migration.md`](docs/auth-migration.md).

## Deploy

```bash
# Edge Function
supabase functions deploy opportunities --project-ref jqfodlzcsgfocyuawzyx --no-verify-jwt

# Migrations (already applied to mgrnz-web; here for reproducibility)
supabase db push
```

## Console (Phase 2) — standalone operator UI

A React + Vite + TypeScript + Tailwind SPA that consumes the `opportunities` API.
Routes: `/opportunities` (board) and `/opportunities/:id` (detail with the operator
review workflow + outreach draft editing). The browser never touches Supabase directly.

The API gained two console-owned routes in Phase 2 (both write only to the app-owned
`opportunity_console_audit_log` — the intelligence backend is untouched):
- `PATCH /opportunities/:id/outreach/:draftId` — edit/save or **approve** a draft (never sends)
- `POST  /opportunities/:id/review` — record a review-state transition
  (`reviewed` → `approved` → `contact_ready`)

### Local development
```bash
cp .env.example .env     # set VITE_API_BASE and VITE_OPERATOR_TOKEN
npm install
npm run dev              # http://localhost:5173
```
```
VITE_API_BASE=https://jqfodlzcsgfocyuawzyx.functions.supabase.co/opportunities
VITE_OPERATOR_TOKEN=<the OPERATOR_TOKEN you set on the Edge Function>
```

### Build & deploy (staging only)
```bash
npm run build            # -> dist/
```
Serve `dist/` as a static site under `staging.maximisedai.com/<slug>/` (per CONTEXT governance).
Set the Edge Function `ALLOWED_ORIGIN` secret to the console origin (defaults to `*`).
The operator token ships in the client build, so keep the deployment access-restricted
(internal / staging only) until the Supabase Auth migration (`docs/auth-migration.md`).

## Roadmap
- **Phase 1 — API layer** ✅ deployed
- **Phase 2 — Operator console** ✅ built (board + detail + review workflow + outreach review→approve)
- **Phase 3 — Email**: Resend send on approved draft (reuse Swanson worker pattern) + emit events
