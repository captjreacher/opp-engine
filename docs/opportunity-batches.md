# Opportunity batches

Selecting two or more imported opportunities and clicking **Enrich selected** creates a persisted batch before any enrichment request is sent. A single selected record is enriched without creating a batch. Batch creation and tagging share one database transaction, and creation retries reuse the same batch identifier.

The batch captures the dashboard filters active at creation: minimum opportunity score, pipeline status, audit availability, and outreach status. Batch details allow editing the name, purpose, and these filters. Filters control the view and the records processed; editing them does not change membership. A record may belong to more than one batch, preserving previous groupings.

The Batches page lists saved groups. A batch's **Enrich matching records** action queues records that still need enrichment. **Assess enriched records** processes enriched records that do not have a current assessment. Running or unsuitable records are excluded. Per-record failures remain visible and can be retried through the same batch. Existing per-record endpoints enforce workflow prerequisites. Closing the browser stops queueing records not yet submitted; successfully queued enrichment continues on the server.

Batch tags link from the opportunity list and detail page to their batch. Deleting an opportunity cascades its membership rows without deleting the batch.

## Pipeline navigation

The home Dashboard and `/batches` share the same read-only pipeline overview. Dashboard defaults to Pipeline; Individual offers batch detail links alongside the existing individual opportunity analysis and operational controls. The five-stage journey keeps Discover and Import as non-selectable upstream context with no batch counts. Enrich, Assess and Outreach tiles filter the active list; counts and lists use the same classification. The default is the earliest active stage, falling back to Enrich when there is no active workload.

There is no canonical stored batch stage. Membership references existing leads only, so saved batches cannot occupy Discover or Import; Discovery candidates are not batch members. The overview uses the existing batch list and opportunity list (two API requests), including each opportunity's batch tags. No per-batch query or schema change is needed.

Classification uses all fixed members, independent of saved record filters. Ignore `pipeline_status === "disqualified"` for work classification. If any suitable member has `enrichment_running` or lacks `enrichment_ready`, classify Enrich. Otherwise, if any lacks the API's current `assessed_at`, classify Assess. Otherwise classify Outreach, regardless of whether outreach is absent, draft, approved or sent. The UI says “Assessment complete; outreach work is next or underway.” This is the final operational outreach stage, not proof of readiness, sending, completion or handoff. Those stronger claims need richer existing evidence than the current list projection supplies. Running re-enrichment remains Enrich; failed enrichment without readiness also remains Enrich. Readiness comes from the API, not the textual enrichment status.

Empty batches have no stage and are labeled Empty. Entirely disqualified batches also have no stage and are labeled Inactive / blocked. Both remain linked in the secondary “Inactive / blocked batches” section and in Dashboard Individual selection, and contribute to none of the five stage counts. Each active batch occupies exactly one operational tile. The current projection only exposes disqualification; it cannot identify separate commercial eligibility blocks, and the UI does not claim to have checked them. Record counts include all fixed members, including unsuitable members. A record belonging to two batches counts once in each batch; tile totals are membership counts, not unique business totals.

Existing processing actions, target selection, fixed membership and text filtering are unchanged. Stage classification is navigation-only.

## Deployment

The foundation schema is in `supabase/migrations/20261002044415_opportunity_batches.sql`. The shared Supabase project already records version `20261002044415` as applied under `opportunity_batches`, matching the Git migration identity. The completed read-only review confirmed that the recorded SQL is content-identical apart from non-material formatting and that the live Batch schema matches. No production migration execution or migration-history repair is required for the existing shared project; fresh environments can apply the migration normally. No migration or deployment was performed during recovery. The migration creates two service-role-only tables with RLS and a service-role-only transaction function using invoker privileges. No public browser access is granted. Do not run a blind database push against the linked project's broader migration history.

Batch creation does not retroactively group previous enrichment requests. No production schema or existing record memberships have been changed by local validation.
