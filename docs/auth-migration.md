# Operator Auth — Phase 1 token & the migration path to Supabase Auth

## Phase 1 (current): shared operator token
- The `opportunities` Edge Function is deployed with `verify_jwt = false` and implements
  its **own** check: every data route requires `Authorization: Bearer <OPERATOR_TOKEN>`
  (or `x-operator-token`). `GET /opportunities/health` is unauthenticated (returns no data).
- `OPERATOR_TOKEN` is a Supabase Edge Function secret:
  `supabase secrets set OPERATOR_TOKEN=<random>` (or Dashboard → Edge Functions → Manage secrets).
  **The function fails closed if it is unset** (every data route returns 401).
- The browser holds the token (build-time env, or entered once by the operator). It is a
  single **shared** operator credential — fine for a single-operator internal tool, but it is
  not per-user and cannot be revoked individually.

## Phase 2 (migration): Supabase Auth operator role
Trigger this when you need multi-operator access, per-user audit, or revocation.

1. Enable Supabase Auth (magic-link or email+password). **No public sign-up** — invite operators only.
2. Model an operator role: set `app_metadata.role = 'operator'` on invited users (admin API),
   or a dedicated `operator_users` table keyed by `auth.uid()`.
3. Redeploy the function with `verify_jwt = true`. Replace the `authorized()` token check with a
   verified-claim check: require `app_metadata.role = 'operator'`; reject otherwise.
4. (Optional) Only if you later move reads to the browser with the anon key, add RLS policies keyed
   to the operator role, e.g. `USING (auth.jwt()->'app_metadata'->>'role' = 'operator')`.
   Until then, keep **all** DB access server-side via the service role in the function.
5. Switch `opportunity_console_audit_log.actor` from the constant `'operator-console'` to the
   authenticated `auth.uid()` / email.
6. Remove the `OPERATOR_TOKEN` secret after cutover.

The migration is isolated to `authorized()`, the deploy flag, and (optionally) new RLS policies —
**no data-model change required.**
