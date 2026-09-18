import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const opportunitiesSource = readFileSync(
  resolve("supabase/functions/opportunities/index.ts"),
  "utf8",
);

const migrationSource = readFileSync(
  resolve("supabase/migrations/20260822171709_queue_opportunity_enrichment_pg_net.sql"),
  "utf8",
);

describe("async enrichment backend contract", () => {
  it("queues enrichment through a durable pg_net RPC instead of waitUntil", () => {
    const enrichRouteStart = opportunitiesSource.indexOf(
      'if (req.method === "POST" && parts.length === 2 && parts[1] === "enrich")',
    );
    const assessRouteStart = opportunitiesSource.indexOf(
      'if (req.method === "POST" && parts.length === 2 && parts[1] === "assess")',
      enrichRouteStart,
    );
    const routeBlock = opportunitiesSource.slice(
      enrichRouteStart,
      assessRouteStart,
    );

    expect(routeBlock).toContain("requestOpportunityEnrichment");
    expect(routeBlock).not.toContain("runOpportunityEnrichment");
    expect(routeBlock).not.toContain("waitUntil");
    expect(routeBlock).toContain(
      'return await requestOpportunityEnrichment(parts[0], payload.retry === true);',
    );

    expect(opportunitiesSource).toContain(
      'supabase.rpc("queue_local_business_enrichment"',
    );
    expect(opportunitiesSource).toContain("queueOpportunityEnrichment");
    expect(opportunitiesSource).toContain("p_project_url: SUPABASE_URL");
    expect(opportunitiesSource).toContain("p_operator_token: OPERATOR_TOKEN");
    expect(opportunitiesSource).toContain('status: "accepted"');
    expect(opportunitiesSource).toContain(
      'enrichment_status: result.enrichment_status ?? "enriching"',
    );
  });

  it("defines the durable pg_net queue in the migration without persisting secrets", () => {
    expect(migrationSource).toContain(
      "create extension if not exists pg_net with schema net",
    );
    expect(migrationSource).toContain("queue_local_business_enrichment");
    expect(migrationSource).toContain("net.http_post");
    expect(migrationSource).toContain("enrichment_requested");
    expect(migrationSource).toContain("enrichment_failed");
    expect(migrationSource).toContain("enrichment_in_progress");
    expect(migrationSource).toContain(
      "grant execute on function public.queue_local_business_enrichment",
    );
    expect(migrationSource).not.toContain("OPERATOR_TOKEN");
    expect(migrationSource).not.toContain("SERVICE_ROLE_KEY");
  });
});
