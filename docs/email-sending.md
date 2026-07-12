# Outreach email sending (Phase 3)

Approved outreach drafts are sent via **Resend**, reusing the Swanson Worx worker pattern
(`POST https://api.resend.com/emails`, bearer key, throw-on-failure, never mark sent on failure).
Sending lives in the `opportunities` Edge Function:

```
POST /opportunities/:id/outreach/:draftId/send
```

## Guarantees
- **Operator-gated, no auto-send.** Only a draft with `status = 'approved'` can be sent, and only
  when the operator explicitly confirms in the console. Nothing is ever sent automatically.
- **Idempotent.** A draft already `sent` (or carrying `sent_at`) returns `409`; it cannot be re-sent.
- **Never false success.** The draft is marked `sent` (status + `sent_at`) and an `outreach_sent`
  event is logged to `opportunity_console_audit_log` **only after** Resend returns 2xx. On failure the
  draft stays `approved` and an `outreach_send_failed` event is logged.
- **Standalone.** Writes only `local_business_outreach_drafts` + the app-owned audit log. No canonical
  `events`, cockpit, or CRM coupling.

## Secrets (set on the Edge Function; none are committed)
```bash
supabase secrets set RESEND_API_KEY=...                              --project-ref jqfodlzcsgfocyuawzyx
supabase secrets set OUTREACH_EMAIL_FROM="MGRNZ <outreach@your-domain>" --project-ref jqfodlzcsgfocyuawzyx
```

**Staging safety (recommended)** — route ALL sends to a test inbox until you go live:
```bash
supabase secrets set OUTREACH_OVERRIDE_TO="mike@mgrnz.com" --project-ref jqfodlzcsgfocyuawzyx
```

**Going live** (emails the prospect's actual `local_business_leads.email`):
```bash
supabase secrets set OUTREACH_SEND_MODE=live --project-ref jqfodlzcsgfocyuawzyx
# and clear OUTREACH_OVERRIDE_TO
```

### Recipient resolution
| `OUTREACH_OVERRIDE_TO` | `OUTREACH_SEND_MODE` | Recipient |
|---|---|---|
| set | (any) | the override inbox — email is tagged as a TEST send |
| unset | `live` | the prospect's `email` |
| unset | not `live` | **refused (409)** — safe default, nothing sent |

If `RESEND_API_KEY` or `OUTREACH_EMAIL_FROM` is missing, the route returns `503` and sends nothing.

## Events (app-owned audit log)
`outreach_draft_created` → `outreach_draft_updated` / `outreach_draft_approved` → `outreach_sent`
(or `outreach_send_failed`). These render in the console's event-history panel.
