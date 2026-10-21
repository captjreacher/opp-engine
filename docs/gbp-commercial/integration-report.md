# GBP commercial offers — draft integration report

**Review state, 22 October 2026:** local code and draft PRs only. Owner approval covers package scope and prices, with the supplied payment and cancellation wording subject to final legal review. No production Billing seed, migration, catalogue publication, payment activation, site deployment or outreach was performed.

## Coordinated changes

| Repository | Draft change | Release gate |
|---|---|---|
| Billing Kernel | Two draft MaximisedAI products, four one-off non-sellable plans and four draft NZD fixed price versions at 15% GST | Separate owner approval to publish prices and make plans sellable |
| MaximisedAI site | `/products/gbp-setup/` and `/products/gbp-improvement/`, with exact-plan Billing resolution and unavailable state | Publish only after Billing prices are current and approved; legal copy review |
| Opportunity Engine | G01/G02 draft scenario rows and disabled outreach templates; documented qualification, current Billing lookup, a Scenario Report and email selection from one immutable commercial snapshot | Local draft flag and current assessment required; GBP send remains blocked in code |

The Opportunity Engine PR targets the existing `codex/scenario-reports` branch because that branch contains the approved Scenario Report and commercial selection architecture. Its merge to `main` is a prerequisite for any GBP merge. The Billing and site PRs target `main`.

Draft PRs: [Billing #52](https://github.com/captjreacher/BILLING/pull/52), [site #19](https://github.com/captjreacher/maximisedai-site/pull/19), and [Opportunity Engine #18](https://github.com/captjreacher/opp-engine/pull/18).

## Approved commercial matrix

| Scenario | Product | Services | NZD before GST | GST at 15% | NZD including GST | Template | Destination |
|---|---|---:|---:|---:|---:|---|---|
| G01 | GBP Setup | 1–3 | $249.00 | $37.35 | $286.35 | `gbp_setup_v1` | `/products/gbp-setup/` |
| G01 | GBP Setup | 4–5 | $349.00 | $52.35 | $401.35 | `gbp_setup_v1` | `/products/gbp-setup/` |
| G02 | GBP Improvement | 1–3 | $199.00 | $29.85 | $228.85 | `gbp_improvement_v1` | `/products/gbp-improvement/` |
| G02 | GBP Improvement | 4–5 | $299.00 | $44.85 | $343.85 | `gbp_improvement_v1` | `/products/gbp-improvement/` |

Each tier covers one profile and one agreed list of genuine services. The customer confirms the count, profile control and status before a fixed-price draft. Setup requires a documented search query, location, candidate review and observed time; an unclaimed listing needs its URL. Improvement requires the matching profile URL and a specific observable finding. Both require human review, a current assessment, contact-ready state and the existing Cockpit eligibility gate. Google verification, approval, timing, rankings and lead outcomes are not promised. More than five services or ownership, suspension or unusual remediation issues require separate scope.

The same Billing plan and price version, tax treatment, service band, scope version, inclusions, exclusions, terms and destination are captured in the GBP snapshot. The Scenario Report stores that snapshot and renders its offer details. The locked outreach body uses the same snapshot text. Approval rechecks the stored report, exact email, template and current Billing price. The send endpoint rejects every GBP snapshot draft regardless of approval. A partial unique index prevents two GBP drafts for one lead; the preparation endpoint also rejects any existing outreach draft.

## Verification evidence

| Check | Result |
|---|---|
| Billing focused catalogue, admin API and invoice tests | 150 passed after rebasing on current `main`; the invoice contract calculates all four GST totals above |
| Billing build and typecheck | Passed on current `main` plus draft commit |
| Billing GitHub CI | Passed on the final draft branch: dependency audit, build, lint, unit and isolated PostgreSQL integration tests, typecheck, whitespace check, Docker image checks and local release smoke test. A patched Vite 7.3.7 override resolved the pre-existing audit failure. |
| Site suite | 496 passed |
| Site fixture build | Passed; both routes rendered the four Billing fixture amounts, with inactive offer states suppressing purchase CTA |
| Site GitHub CI | Passed for active, withdrawn, archived and omitted offer states, including the updated 30-route typography audit and editorial, HTTPS and retired-route checks. |
| Opportunity Engine suite on scenario-report branch | 353 passed, 12 skipped |
| Opportunity Engine frontend build | Passed |
| Opportunity Engine Deno check | Passed for `supabase/functions/opportunities/index.ts` and imported GBP modules |
| Site typecheck | Two existing errors remain in untouched `Footer.astro` and `[slug].astro`; no new GBP diagnostics |
| Billing full suite on local shared PostgreSQL | Earlier run had 1,165 passes and local schema/fixture failures; the focused changed areas passed after rebase. GitHub CI then passed against its isolated PostgreSQL service. |

### Page screenshots

Screenshots below are from the local Billing fixture build at a narrow mobile viewport. The live catalogue still has no published GBP prices.

- [GBP Setup hero](screenshots/gbp-setup-mobile.png)
- [GBP Setup pricing](screenshots/gbp-setup-pricing-mobile.png)
- [GBP Improvement hero](screenshots/gbp-improvement-mobile.png)
- [GBP Improvement pricing](screenshots/gbp-improvement-pricing-mobile.png)

## Branch push safety check

Cloudflare dashboard Builds settings were read before pushing. `maxai` has **no connected Git repository**; its production deployment is manual Wrangler. `billing-maximisedai` uses `main` as production branch and **Builds for Preview branches** is off. `opp-engine` uses `main` as production branch; nonproduction builds are enabled with a Version command of `npx wrangler versions upload`. Its dashboard shows recent `codex/*` build versions with no active traffic while the `main` deployment carries 100% traffic. The site GitHub deployment workflow runs only on `main`, repository dispatch or manual invocation; its `codex/**` workflow runs checks. Branch pushes therefore cannot promote these draft branches to production under the observed configuration. This check is time-sensitive and should be repeated if Cloudflare or workflow settings change.

## Remaining release requirements

1. Owner reviews the three draft PRs, page screenshots, exact scope and cancellation text. Legal review finalizes the payment/cancellation wording before any publication or purchase flow.
2. Merge the Scenario Report prerequisite branch, then reconcile the GBP Opportunity Engine PR with `main`; rerun its tests and Deno check.
3. Rehearse the draft seed and migration in a nonproduction database; verify four versions, GST and that existing Digital Trust Foundation and website packages remain unchanged.
4. Confirm the two final public routes and links. Configure Billing access for site and Opportunity Engine; publish the four Billing price versions and enable the plans only under separate release approval.
5. Deploy the site separately, verify both pages and all terms at desktop and mobile widths, then record destination verification. Enable the two scenario/template mappings only after the pages and Billing catalogue are live.
6. Exercise current assessment, Cockpit eligibility, profile ownership, missing/ambiguous evidence, count boundaries, withdrawn prices, report/email drift and duplicate draft cases in a staging environment. A separate reviewed change must remove the GBP send block before any live outreach.

No release action in this list is authorized by the present implementation approval.
