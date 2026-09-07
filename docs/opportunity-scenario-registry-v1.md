# Opportunity Scenario Registry v1

The Opportunity Engine owns prospecting through first outbound send. A scenario defines the commercial problem being sought and the rules that govern discovery, assessment, reporting, outreach and calls to action.

## Ownership

- Opportunity Engine: scenario selection, discovery, enrichment, assessment, report generation, human review, outreach draft/approval, first send.
- Cockpit: canonical relationship state from successful first outbound contact onward.
- Billing: canonical offer, published price, tax treatment and purchase execution.
- Scenario Registry: references Billing offer IDs but never stores canonical prices.

## Scenario versus run

A scenario answers: "What opportunity are we looking for?"

A discovery run answers: "Where and for whom are we looking today?"

Run parameters such as location, industry, keywords, radius and result limit remain operator-controlled. Each run stores both the selected scenario ID/version and an immutable scenario snapshot so historical results remain reproducible if the scenario changes later.

## V1 default scenario

`local-digital-presence`, version `1`, represents the behaviour that existed before the registry was introduced.

It uses Google Places discovery and the existing four assessment dimensions:

- demand signal
- trust leakage
- conversion maturity
- AI readiness

The existing scoring and audit implementation remains unchanged in the first migration. The registry turns that implementation into an explicit assessment/report profile rather than replacing it.

## Operator selector

The Discovery screen loads active scenarios through the read-only `opportunity-scenarios` Edge Function and requires the operator to choose a scenario before starting discovery.

The selected scenario supplies discovery defaults such as result limit and radius. The client also includes `scenario_id` in the discovery request payload.

At this V1 compatibility point, the existing `opportunities` discovery handler does not yet consume arbitrary `scenario_id` values. Because only the seeded Local Digital Presence scenario is active, the database compatibility trigger records the same scenario and immutable snapshot on every new run.

Before a second scenario is activated, the existing discovery handler must validate the requested active scenario and persist the selected scenario explicitly. This keeps the UI honest: scenario selection exists now, but multi-scenario execution is not claimed until routing is implemented.

The new `opportunity-scenarios` function must be deployed with the same operator-token/CORS configuration as the existing `opportunities` function. No production deployment is part of this branch.

## Commercial CTA rules

Scenario commercial configuration may contain one or more CTAs. A CTA can point to:

- `billing_offer`: resolve a canonical Billing Catalogue offer at runtime.
- `cockpit_case`: create or request a Cockpit workflow/case rather than a direct purchase.

A scenario must not duplicate a dollar price. The Billing Catalogue remains authoritative for offer versions and price resolution.

## Handoff boundary

Before assessment, Opp Engine will call the Cockpit commercial eligibility boundary to exclude existing customers, existing leads, previously contacted records, nurture/suppressed records and possible matches requiring human review.

After successful SMTP send, Opp Engine will idempotently hand the prospect to Cockpit as a canonical Contact with lead status `contacted`. A successful send followed by a Cockpit handoff failure must never cause a second email send; only the handoff is retried.

## Next wiring steps

1. Add explicit scenario routing to the existing discovery handler before a second scenario is activated.
2. Pass scenario provenance through assessment, report and outreach writes rather than relying on compatibility defaults.
3. Add Cockpit pre-assessment eligibility and post-send handoff contracts.
4. Render scenario CTAs in the customer-ready report and resolve Billing offer references.
