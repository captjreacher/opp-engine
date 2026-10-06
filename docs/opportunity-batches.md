# Opportunity batches

Selecting two or more imported opportunities and clicking **Enrich selected** creates a persisted batch before any enrichment request is sent. A single selected record is enriched without creating a batch. Batch creation and tagging share one database transaction, and creation retries reuse the same batch identifier.

The batch captures the dashboard filters active at creation: minimum opportunity score, pipeline status, audit availability, and outreach status. Batch details allow editing the name, purpose, and these filters. Filters control the view and the records processed; editing them does not change membership. A record may belong to more than one batch, preserving previous groupings.

The Batches page lists saved groups. A batch's **Enrich matching records** action queues records that still need enrichment. **Assess enriched records** processes enriched records that do not have a current assessment. Running or unsuitable records are excluded. Per-record failures remain visible and can be retried through the same batch. Existing per-record endpoints enforce workflow prerequisites. Closing the browser stops queueing records not yet submitted; successfully queued enrichment continues on the server.

Batch tags link from the opportunity list and detail page to their batch. Deleting an opportunity cascades its membership rows without deleting the batch.

## Deployment

The foundation schema is in `supabase/migrations/20261002044415_opportunity_batches.sql`. The shared project already records the Batch migration as `20261002044415_opportunity_batches`; do not reapply it or repair history automatically. Review this version mismatch before packaging/releasing. No migration or deployment was performed during recovery. The migration creates two service-role-only tables with RLS and a service-role-only transaction function using invoker privileges. No public browser access is granted. Do not run a blind database push against the linked project's broader migration history.

Batch creation does not retroactively group previous enrichment requests. No production schema or existing record memberships have been changed by local validation.
