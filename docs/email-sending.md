# Outreach email sending (Phase 3 — internal SMTP)

Approved outreach drafts are sent via the shared **internal MGRNZ SMTP mailer** (raw SMTP over
Deno TLS — `AUTH LOGIN`, `multipart/alternative`), the same transport used by the
`supercity-contact` / `painted-by-jess-contact` Edge Functions. **No third-party email provider.**

Route: `POST /opportunities/:id/outreach/:draftId/send`

## Lifecycle
```
draft → approved → (sending) → sent
                       └── failed → retry
```
- `sending` is a transient UI state (the in-flight request).
- The DB `status` column is constrained to `draft / pending_review / approved / rejected / sent /
  archived`, so there is **no persisted `sending`/`failed` status**. `failed` is **derived** from the
  `outreach_send_failed` audit event: a failed send leaves the draft `approved`, so the operator can
  retry. Only a successful send flips it to `sent` (+ `sent_at`).

## Controls
- Approved-only; explicit two-step confirm in the console; **no auto-send**.
- Idempotent — an already-`sent` draft returns 409.
- Never false success — draft becomes `sent` and `outreach_sent` is logged **only** after SMTP returns 250.
- Failure handling — logs `outreach_send_failed`, returns 502 (`retryable: true`), draft stays `approved`.
- Standalone — writes only `local_business_outreach_drafts` + the app-owned audit log.

## Secrets (set on the Edge Function; none committed)
Shared MGRNZ SMTP credentials (already configured for this Supabase project):
```
MGRNZ_SMTP_HOST
MGRNZ_SMTP_PORT        # default 465 (implicit TLS); other ports use STARTTLS
MGRNZ_SMTP_USERNAME    # also used as the From address
MGRNZ_SMTP_PASSWORD
```
opp-engine send routing / staging safety:
```
OUTREACH_TEST_EMAIL    # staging override — ALL sends go here, tagged [TEST SEND]
OUTREACH_SEND_MODE     # "test" (default) | "live" (emails the prospect's real address)
OUTREACH_FROM_NAME     # default "Maximised AI"
OUTREACH_EHLO_DOMAIN   # default "opp-engine.staging.maximisedai.com"
```

### Recipient resolution
| `OUTREACH_TEST_EMAIL` | `OUTREACH_SEND_MODE` | Recipient |
|---|---|---|
| set | (any) | the override inbox — email tagged as a TEST send |
| unset | `live` | the prospect's `email` |
| unset | not `live` | **refused (409)** — safe default, nothing sent |

If `MGRNZ_SMTP_*` is missing or invalid, the route returns `503` and sends nothing.

## Events (app-owned audit log)
`outreach_draft_created` → `outreach_draft_updated` / `outreach_draft_approved` →
`outreach_sent` (success) or `outreach_send_failed` (failure; retry available).
