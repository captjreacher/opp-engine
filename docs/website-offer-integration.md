# Website scenario → offer integration

Prepared 27 October 2026. This change is website-only; GBP scenarios, offers,
templates and release status are untouched. No Billing, MaximisedAI or Workspace
repository was modified, and no production migration, purchase or outreach was
initiated.

## Implementation inventory and dependency order

1. Draft PR #10 (`codex/company-scenario-offers`) supplies the company scenario,
   category compatibility, reviewed-template registry, eligibility checks and
   company-level send claim foundation.
2. Draft PR #17 (`codex/scenario-reports`) adds immutable scenario reports,
   runtime Billing resolution, exact price/GST snapshots, report idempotency,
   constrained edits, review/approval/send gates and regression coverage. This
   branch is based on that implementation.
3. Draft PR #11 is dashboard-only and is not required. Draft PRs #18/#19 are
   GBP-only and are deliberately excluded.
4. `20261027090000_website_scenario_offer_mappings.sql` is the only new
   website configuration migration. It activates the existing
   `website-improvement` registry identity under the operator label `New
   Website`, adds the blocked `website-replacement` decision record, and seeds
   three explicit reviewed templates.

## Final mapping matrix

| Scenario | Billing product | Billing plan/offer | Destination | Outreach status |
| --- | --- | --- | --- | --- |
| New Website | `product-maximisedai-landing-page` | `plan-maximisedai-landing-page` | `https://maximisedai.com/products/website-packages/landing-page/` | Enabled; explicit template selection required |
| New Website | `product-maximisedai-small-business-website` | `plan-maximisedai-small-business-website` | `https://maximisedai.com/products/website-packages/small-business/` | Enabled; explicit template selection required |
| New Website | `product-maximisedai-tradie-website` | `plan-maximisedai-tradie-website` | `https://maximisedai.com/products/website-packages/tradie/` | Enabled; explicit template selection required |
| Website Replacement | `product-maximisedai-website-refresh` | `plan-maximisedai-website-refresh` | None approved | Blocked: archived and non-sellable |

The package overview route is context only; it is not substituted for a
dedicated offer destination. A message carries one selected plan and its exact
destination. With three compatible New Website templates, omission of an
explicit selection fails closed.

## Website Replacement decision

No commercial mapping is approved. The inspected Website Refresh identity is
historical (`product-maximisedai-website-refresh` /
`plan-maximisedai-website-refresh`), archived and non-sellable. The scenario is
therefore draft/blocked and has no template or destination. An owner must
approve a current sellable replacement product/plan, scope, terms and dedicated
landing page before this scenario can be activated.

## Safety retained

Billing remains authoritative at runtime: exact plan identity, expected product
identity, published product, sellability, archive state, current price version,
effective dates, currency, price kind and GST are revalidated. Missing,
withdrawn, unpublished, non-sellable or incomplete offers block reports and
outreach. Existing-contact, duplicate, suppression and possible-match
acknowledgement checks remain in place. Reports are append-only and retain their
scenario/template/offer/destination snapshots; review, approval and send remain
separate gates. Sending remains disabled for this task.
