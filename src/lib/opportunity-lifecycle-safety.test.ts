import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
const migration = readFileSync("supabase/migrations/20261018144011_opportunity_archive_restore_governance.sql", "utf8");
const discovery = readFileSync("supabase/migrations/20260913120000_opportunity_possible_match_acknowledgement.sql", "utf8");
const worker = readFileSync("supabase/functions/local-business-enrich/index.ts", "utf8");

describe("archive database safety contracts (integration suite is review-gated)", () => {
  it("preserves identity and all existing evidence without adding cascade deletes", () => {
    const sql = migration.replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\bdelete\s+from|\btruncate\b|\bdrop\s+table|on\s+delete\s+cascade/i);
    expect(sql).toMatch(/before insert or update or delete on public\.local_business_leads/i);
    expect(sql).toContain("permanent_deletion_unavailable");
  });
  it("serializes lifecycle changes and related writes on the same parent", () => {
    expect(migration).toMatch(/where id = p_lead_id for update/i);
    expect(migration).toMatch(/where id in \(v_old, v_new\) order by id for update/i);
    expect(migration).toContain("old.enrichment_status = 'enriching'");
    expect(migration).toContain("status = 'approved'");
  });
  it("keeps audit insertion in the transaction and avoids duplicate idempotent events", () => {
    expect(migration).toMatch(/after update of archived_at on public\.local_business_leads/i);
    expect(migration).toContain("insert into public.opportunity_console_audit_log");
    expect(migration).toContain("'opportunity_restored' else 'opportunity_archived'");
    expect(migration).toContain("'idempotent', true");
    expect(migration).not.toMatch(/exception when others/i);
  });
  it("protects lifecycle history and fences concurrent workflow-only event writes", () => {
    expect(migration).toContain("lifecycle_history_immutable");
    for (const action of ["opportunity_review_started", "opportunity_review_completed", "opportunity_contact_ready", "outreach_awaiting_response", "outreach_replied", "meeting_booked", "opportunity_converted", "opportunity_closed"]) expect(migration).toContain(`'${action}'`);
    expect(migration).toContain("before insert or update or delete on public.opportunity_console_audit_log");
  });
  it("retains existing RLS and limits the RPC to the service role", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.set_opportunity_archived(uuid,boolean,text) to service_role");
    expect(migration).not.toMatch(/security definer|disable row level security/i);
    expect(migration).toContain("current_user not in ('service_role', 'postgres')");
  });
  it("retains archived identities in discovery matching", () => {
    const start = discovery.indexOf("select l.id into v_lead_id");
    const matchQuery = discovery.slice(start, discovery.indexOf("if v_lead_id is null", start));
    expect(matchQuery).toContain("l.google_maps_url"); expect(matchQuery).toContain("l.website_url"); expect(matchQuery).toContain("l.business_name");
    expect(matchQuery).not.toMatch(/archived_at|status\s*(?:<>|!=|=)/i);
  });
  it("permits only sent-outreach handoff metadata after archival", () => {
    expect(migration).toContain("old.status = 'sent'");
    expect(migration).toContain("'cockpit_handoff_status','cockpit_contact_id','cockpit_handoff_error','cockpit_handed_off_at','updated_at'");
    // CRM relationship tables are deliberately not frozen by the intelligence archive.
    expect(migration).not.toContain("'lead_contacts'");
  });
  it("blocks direct enrichment before the claim/provider path and checks the race fence", () => {
    const guard = worker.indexOf("if (resolved.lead.archived_at)");
    expect(guard).toBeGreaterThan(0); expect(guard).toBeLessThan(worker.indexOf("const claim = resolveEnrichmentClaim", guard));
    expect(worker).toContain("if (claimWriteError)");
    expect(worker).toContain('claimWriteError.message.includes("opportunity_archived")');
  });
});

describe("frontend lifecycle API", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
  it("sends confirmed archive and restore through the existing authenticated request client", async () => {
    vi.stubEnv("VITE_API_BASE", "https://api.example/opportunities"); vi.stubEnv("VITE_OPERATOR_TOKEN", "operator-test");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, id: "lead", archived_at: null, idempotent: false })));
    // Return a fresh response for every call.
    fetch.mockImplementation(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetch);
    const api = await import("./api");
    await api.setOpportunityArchived("lead", true, "No active campaign"); await api.setOpportunityArchived("lead", false);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(["https://api.example/opportunities/lead/archive", "https://api.example/opportunities/lead/restore"]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ confirm: true, reason: "No active campaign" });
    expect(new Headers(fetch.mock.calls[0][1].headers).get("authorization")).toBe("Bearer operator-test");
  });
  it("fetches archived and all views without changing the existing default endpoint", async () => {
    vi.stubEnv("VITE_API_BASE", "https://api.example/opportunities"); vi.stubEnv("VITE_OPERATOR_TOKEN", "operator-test");
    const fetch = vi.fn().mockImplementation(async () => new Response('{"opportunities":[]}')); vi.stubGlobal("fetch", fetch);
    const api = await import("./api");
    await api.fetchOpportunities(); await api.fetchOpportunities("archived"); await api.fetchOpportunities("all");
    expect(fetch.mock.calls.map(call => call[0])).toEqual(["https://api.example/opportunities", "https://api.example/opportunities?lifecycle=archived", "https://api.example/opportunities?lifecycle=all"]);
  });
});
