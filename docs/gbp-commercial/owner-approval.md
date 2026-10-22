# GBP commercial offers — owner approval pack

> **Owner business approval recorded 22 October 2026.** The owner approved the two packages, four tier prices, scope and the revised seven-paragraph payment and cancellation wording for GBP Setup and GBP Improvement. Independent legal review of that wording is not yet evidenced. Production activation, deployment, catalogue publication, payment activation and outreach remain unauthorized. The exact approved wording is recorded in [the release blocker review](../release-blocker-review.md#approved-gbp-payment-and-cancellation-wording). The implementation request supersedes the proposed landing paths below with `/products/gbp-setup/` and `/products/gbp-improvement/`.

**Status:** proposal for owner decision, 22 October 2026. No offer in this document is approved, published or sendable. Amounts and scope below are proposed, not a statement of the live Billing catalogue.

## 1. Reconciliation and decision

The current MaximisedAI site describes Google Business Profile (GBP) work only as an *applicable* part of a broader Digital Trust Foundation. It has no dedicated GBP page or approved GBP price. The Billing seed defines Digital Trust Foundation as an **annual** programme with a POA price, and the prior catalogue review found that offer unavailable. It cannot stand in for either proposed one-off offer. Historical Billing `1 Service` and `3 Services` plans are for **website service pages**, have POA placeholders and were absent from the then-current sellable set. Their service counts do not define GBP service entries or authorize these prices. The existing site reads published Billing prices for its website offers and must continue to do so. See [ecosystem search](../existing-website-gbp-offer-pages-search.md), Billing `packages/commercial-catalogue/src/seed-data.ts`, and site `src/data/approved-pages.js`, `src/server/billing-catalogue.js`.

**Approval sought:** two new MaximisedAI GBP product/offer identities with two mutually exclusive one-off plan variants each. Do not reactivate, rename or reuse the annual Digital Trust Foundation or website package plans.

| Proposed offer / variant | Service entries on one profile | NZD excl. GST | Billing fixed `amountMinor` | Proposed identity |
|---|---:|---:|---:|---|
| GBP Setup — 1–3 services | 1–3 | 249 | 24900 | `product-maximisedai-gbp-setup` / `plan-maximisedai-gbp-setup-1-3-services` |
| GBP Setup — 4–5 services | 4–5 | 349 | 34900 | same product / `plan-maximisedai-gbp-setup-4-5-services` |
| GBP Improvement — 1–3 services | 1–3 | 199 | 19900 | `product-maximisedai-gbp-improvement` / `plan-maximisedai-gbp-improvement-1-3-services` |
| GBP Improvement — 4–5 services | 4–5 | 299 | 29900 | same product / `plan-maximisedai-gbp-improvement-4-5-services` |

Each plan: `brand-maximisedai`, `billingType: one-off`, fixed NZD price, `taxTreatment: exclusive`; record the applicable GST rate in Billing. Price versions start as drafts and require a separate owner-approved publish step. One engagement covers one eligible business profile for one real-world location or service-area business. A "service" is one distinct, real service the business provides, agreed in the intake list for that profile. It is **not** a website page, keyword, location, category or service area. Count the full agreed list, including services already present on the profile. Zero, more than five, or an uncertain count requires scoping before a tier is chosen. No automatic fifth-service upsell or silent tier substitution.

## 2. Exact proposed scope

### GBP Setup

**Eligible:** a GBP-eligible business with no controlled, verified profile for the relevant business/location. This can be a new profile or a claim of an existing unclaimed profile. Existing verified profiles requiring edits belong to Improvement. A profile controlled by another party requires ownership resolution before fixed-price work is accepted.

**Included:** (1) one intake and eligibility/duplicate check; (2) create or claim one profile with the customer's express authorization; (3) enter or correct the supplied business name, primary category, contact details, website link if supplied, business description, hours and address/service-area presentation as applicable and permitted; (4) add or update the agreed 1–3 or 4–5 genuine service entries, using available GBP fields; (5) guide the customer through the verification method Google offers, including one assistance session and review of the submitted status; (6) one customer review/correction round for the submitted details; (7) a handover record listing submitted fields, profile URL if available, verification/approval status and any Google-pending items. Customer retains ownership; MaximisedAI receives only the access needed for the work.

**Completion boundary:** deliver the submission and handover record. Verification, appearance and approval are controlled by Google and are not included as guaranteed outcomes. If verification remains pending or a feature is unavailable, handover identifies the dependency and the work completed; further cycles or an ownership dispute are separately scoped.

### GBP Improvement

**Eligible:** one existing profile that the customer controls and can authorize MaximisedAI to manage, with verification complete and no unresolved suspension/ownership dispute. Intake confirms the same service-count rule.

**Included:** (1) one review of the live profile against the customer's confirmed business facts; (2) a prioritized change list; (3) update applicable core information (business description, hours, contact details, website link, category and address/service-area settings) only where justified and approved; (4) add, correct or organize the agreed 1–3 or 4–5 genuine service entries using available fields; (5) one customer review/correction round; (6) before/after or submitted/pending change record, with links or screenshots where permitted.

**Completion boundary:** submit the approved changes and hand over the change record. Google may reject, modify or delay edits; acceptance, ranking and traffic are not guaranteed.

### Shared exclusions and commercial terms

- One-off fee only; no subscription, retainer or ongoing monitoring. No Google fee is being charged: GBP itself is available without charge; the fee pays MaximisedAI for the defined work. Third-party paid services require separate agreement.
- No website build or service pages, Search Console/Analytics setup, technical SEO, ads, review generation or replies, photography, copy campaign, recurring posts, reinstatement, appeal, duplicate merge, multi-location rollout or profile ownership dispute resolution.
- Customer supplies accurate business facts, service list, website/phone/hours, any required images and prompt verification participation. Customer approves content and keeps profile ownership. No shared passwords or verification codes are requested.
- Eligibility, profile access, count and tier are confirmed **before** accepting the fixed-price engagement. More than five services, multiple profiles, unusual remediation or blocked access require a separate written scope and price; do not present one of these tiers as covering that work.
- The displayed fee is NZD excluding GST; GST is added as applicable. Billing cadence is one-off. Invoice due date, cancellation/refund terms, and any quote-validity period must follow the owner's approved terms before sale; this pack does not invent them.

Google determines available verification methods and may require additional steps; profile ownership and third-party management require customer authorization. Google may reject or delay edits, and service fields depend on category. These are delivery dependencies, not promised results. Sources: [verification](https://support.google.com/business/answer/7107242), [ownership](https://support.google.com/business/answer/4566671), [services](https://support.google.com/business/answer/9455399), [eligibility](https://support.google.com/business/answer/3038177), [third-party policy](https://support.google.com/business/answer/7353941).

## 3. Commercial approval matrix

| Decision | Proposed answer | Owner action before implementation |
|---|---|---|
| Two distinct offers | Setup for no controlled verified profile; Improvement for controlled verified profile | Approve or amend eligibility split |
| Four prices and tiers | Matrix in §1, one profile and agreed 1–5 real services | Approve amounts, count rule and GST-exclusive display |
| Scope | §2 inclusions, one correction round and written handover | Approve delivery boundary and exclusions |
| Google dependencies | Owner-controlled profile, consent, verification and Google review; no outcome promise | Approve wording and handling of pending/failed verification |
| Billing identity | Two new products, two one-off plans each; draft fixed price versions | Approve IDs and catalogue grouping; authorize later publication separately |
| Destinations | Dedicated drafts at `/gbp-setup/` and `/gbp-improvement/`; contact CTA only after release | Approve slugs, copy and contact path |
| G01 / G02 | §4 mappings, initially inactive | Approve scenario meaning and evidence gates |
| Legal/payment terms | Owner approved the revised seven-paragraph GBP payment and cancellation wording on 22 October 2026; independent legal review is not yet evidenced | Obtain independent legal review evidence before release |
| Release | No public price or outreach until Billing, page and scenario gates pass together | Separate implementation/release authorization |

## 4. Proposed G01/G02 mapping and shared commercial contract

`G01` = **GBP Setup**. Outreach template `gbp_setup_v1`, proposed destination `/gbp-setup/`, Billing product `product-maximisedai-gbp-setup`. Discovery trigger: an attempted, documented profile search and human review could not confirm a matching profile; "not found" is not proof of absence. Fixed-price eligibility requires later customer confirmation that no controlled verified profile exists. An existing unclaimed profile may still be Setup after human ownership review. `G02` = **GBP Improvement**. Outreach template `gbp_improvement_v1`, proposed destination `/gbp-improvement/`, Billing product `product-maximisedai-gbp-improvement`. Trigger only when the profile URL and a visible, relevant improvement observation are recorded; verification and management access remain intake prerequisites, not facts inferable from a public listing. Neither G01 nor G02 is an executable scenario identifier in the current code; both are proposed labels.

Both templates use only the facts actually recorded for that prospect. Example G01 email **after customer-confirmed service count and eligibility**: "Kia ora {{business_name}}, we reviewed the public business information we could locate and could not confirm a Business Profile for {{business_name}}. If you don't already manage one, we can help set up an eligible profile. Our one-off GBP Setup service is {{tier_price}} for {{service_count_band}} services, excluding GST, subject to confirming access and Google's requirements. Details: {{destination}}. Would you like us to check the fit with you?" **Do not use the first sentence unless the search attempt and result are logged. Before customer confirmation, use a discovery-only email without a tier or price.**

Example G02 email **after customer-confirmed service count and eligibility**: "Kia ora {{business_name}}, we reviewed your public Business Profile at {{profile_url}} and observed {{specific_observation}}. Our one-off GBP Improvement service is {{tier_price}} for {{service_count_band}} services, excluding GST, subject to confirming access and Google's requirements. Details: {{destination}}. Would you like us to review the fit with you?" No ranking, traffic, review or conversion claim is allowed. Before customer confirmation, use a discovery-only email without a tier or price. These are future templates; they cannot be sent until the offer, prices and pages are approved and published.

**Single source of commercial facts:** on report/draft creation resolve the chosen Billing plan and current published/effective price version, then persist an immutable commercial snapshot containing scenario ID/version, product ID, plan ID, price-version ID, currency, amount minor, tax treatment/rate, one-off cadence, service-count band, scope version and destination. Render both Scenario Report and outreach from that snapshot and the same approved scope copy. Revalidate availability/price before approving or sending; a mismatch blocks send and requires regeneration/reapproval. Manual email edits must not change price, tier, tax, cadence, inclusion or destination independently of the report. If count is unknown, no tier or price is rendered in either artifact. Fail closed on missing Billing result, archived offer, POA, unpublished/non-effective price, mismatch or inactive page. The existing generic audit/report and email flow does not yet provide this contract.

## 5. Evidence and claim rules

| Claim | Minimum evidence | If missing/conflicting |
|---|---|---|
| No GBP found | Logged Google Places/Maps search attempts with query, location, time and candidate review; human checks plausible variants | Say "we could not confirm" only with logged search; never say "you have no profile". No G01 priced CTA until intake confirms status |
| Profile exists | Matching profile URL plus business identity/location check | Human review; do not attach another business's listing |
| Profile needs improvement | Specific observable field or inconsistency with source URL/time and corroborating official business information where possible | Describe only the observable fact; do not infer ownership, verification or business impact |
| Service count | Customer-confirmed list of distinct genuine services, 1–5 | No variant selection or amount |
| Ranking/traffic/leads | First-party authorized performance data and a defensible comparison | Omit numeric or causal claim entirely; no guaranteed outcome |

The current enrichment code removes `missing_google_profile` when a Google Places search was not attempted. Preserve that rule, and treat failed/incomplete searches, name ambiguity and duplicate profiles as `unknown` requiring review. Public Places data cannot establish verification or management access. The audit model currently carries evidence and risk flags, while the default outreach body is generic; scenario-specific commercial rendering is future implementation, not an existing safeguard. See `supabase/functions/local-business-enrich/index.ts` and `supabase/functions/opportunities/index.ts`.

## 6. Implementation plan after separate approval

1. Finalize owner decisions in §3 and lock a versioned scope/terms copy shared by website and Opportunity Engine.
2. Create the two Billing products and four plan identities in a non-production rehearsal. Create fixed NZD, GST-exclusive **draft** price versions and verify relationships, cadence and minor units. Publish only under a later authorized release gate.
3. Build dedicated Astro pages from the two page drafts in this folder. Resolve all displayed amounts and availability from Billing by exact plan ID; no fallback hardcoded public price. Keep current website offers untouched. Preview and review copy, links, metadata and responsive layout.
4. Add G01/G02 scenario configs, evidence predicates, template references and page destinations as inactive. Implement service-count intake and selection, and the immutable Billing commercial snapshot for report and draft. Make draft approval/send check both artifacts against that snapshot.
5. Test: 1, 3, 4, 5 and 6 services; zero/unknown count; unclaimed/other-owned/verified/suspended profile; no search or failed search; ambiguous listing; missing/archived/unpublished/changed price; changed destination; manual email price edit; Google-pending edit. Confirm neither report nor email can quote when a gate fails.
6. Review the four rendered amounts, tax wording, scope and page destinations against the approved matrix. Obtain separate owner authorization before any catalogue publication, production change, deployment or outreach.

The only artifacts prepared now are this approval pack and two page-copy drafts. No runtime, Billing catalogue, migration or public website offer has been changed by this pack.
