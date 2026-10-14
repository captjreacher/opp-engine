# PR B recovery inventory

Base: `origin/main` at `63748e53fea33d63ac352cf0dc9d80158c7320cc`, verified after fetching origin. PR #9 merged on 6 October 2026 at that commit. No subsequent mainline changes exist at recovery time. The new, initially clean worktree is `C:/DEV_LOCAL/opp-engine-batch-pipeline` on `feat/batch-pipeline-dashboard`.

All ten existing worktrees were inspected and preserved. The recovery checkout and cutover checkout have uncommitted work; the other eight were clean. No existing worktree was reset, stashed, cleaned, rebased or deleted.

| File | Included hunks / decision |
| --- | --- |
| `src/lib/batch-pipeline.ts` | New shared classification of fixed imported members; recovered corrected upstream and inactive semantics. Uses canonical API readiness and current assessment projection. |
| `src/lib/batch-pipeline.test.ts` | Recovered stage, mixed membership and filter independence fixtures; added assessment currency coverage using the existing API helper. |
| `src/components/BatchPipelineOverview.tsx` | New shared five-stage overview, selectable operational stages, detail cards and inactive section. |
| `src/components/BatchPipelineOverview.test.tsx` | Recovered presentation/navigation tests; added behavioral clear-filter assertions and existing opportunity view coverage. |
| `src/components/BatchWorkspace.tsx` | New read-only workload loading and Dashboard view selection. Adapted Individual to include the existing OpportunityList and its controls; view selection remains available after a loading error. |
| `src/routes/Dashboard.tsx` | New Dashboard entry reusing BatchWorkspace. |
| `src/App.tsx` | Only root Dashboard route and `/batches` overview route/imports; all detail and operational routes retained. |
| `src/components/TopBar.tsx` | Dashboard navigation plus wrapping for narrow screens. |
| `src/routes/OpportunityBatches.tsx` | Only approved search placeholder and conditional Clear text filter button; recovered file differs from main only in these two hunks. |
| `docs/opportunity-batches.md` | Only pipeline navigation documentation added; main's corrected deployment/migration guidance retained. |

Already in main: Batch tables/RPC and migration `20261002044415`, fixed membership creation and tags, APIs, detail processing, saved filtering, bulk enrichment, readiness and assessment currency enforcement. None is reimplemented.

Excluded: recovery API/type/backend edits; enrichment queue, assessment, eligibility, outreach, billing, discovery, handoff and authentication changes; recovery migrations; stale documentation instructing application of migration `20261002024438`; unrelated opportunity detail/list, filters, guided workflow, draft editor and README edits. No Supabase files change in this PR.

No conflicts with newer mainline work were found. The recovery prototype's batch-only Individual view was adapted to preserve individual opportunity analysis. Commercial eligibility cannot be determined from this list projection; classification only excludes explicit disqualification and does not claim eligibility approval.

Validation uses unit/component element and event tests, the production TypeScript/Vite build, and diff checks. Four existing admin/enrichment source-contract test failures were reproduced on the unchanged foundation commit `54eeea2`, whose tree matches main. No production deployment or data changes were performed.
