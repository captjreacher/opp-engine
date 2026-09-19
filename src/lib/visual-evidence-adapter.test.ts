import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const edgeSource = readFileSync(
  resolve("supabase/functions/opportunities/index.ts"),
  "utf8",
);

function adapterBlock(): string {
  const start = edgeSource.indexOf("async function requestVisualInspection(");
  const end = edgeSource.indexOf("// ---- Router", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return edgeSource.slice(start, end);
}

function routerBlock(): string {
  const start = edgeSource.indexOf("Deno.serve(");
  expect(start).toBeGreaterThan(-1);
  return edgeSource.slice(start);
}

describe("POST /:id/inspection Gate 1 adapter contract", () => {
  it("documents and routes the inspection boundary", () => {
    expect(edgeSource).toContain(
      "POST  /opportunities/:id/inspection               -> request metadata-only Visual Evidence inspection",
    );
    expect(routerBlock()).toMatch(
      /req\.method === "POST"[\s\S]{0,100}parts\.length === 2[\s\S]{0,100}parts\[1\] === "inspection"/,
    );
    expect(routerBlock()).toContain("requestVisualInspection(");
    expect(routerBlock()).toContain('req.headers.get("idempotency-key")');
  });

  it("resolves and validates the opportunity address server-side", () => {
    const adapter = adapterBlock();
    expect(adapter).toContain('.from("local_business_leads")');
    expect(adapter).toContain('.select("id,address")');
    expect(adapter).toContain('.eq("id", id)');
    expect(adapter).toContain("const address = cleanText(lead.address, 500)");
    expect(adapter).toContain('json({ error: "not_found" }, 404)');
    expect(adapter).toContain('json({ error: "address_unavailable" }, 422)');
  });

  it("forwards the resolved address and requested attributes only", () => {
    const adapter = adapterBlock();
    expect(adapter).toContain("Array.isArray(payload.attributes)");
    expect(adapter).toContain('json({ error: "attributes_required" }, 422)');
    expect(adapter).toContain(
      "body: JSON.stringify({ address, attributes: payload.attributes })",
    );
    expect(adapter).not.toMatch(/JSON\.stringify\([^)]*\bid\b/);
  });

  it("authenticates with the service role and forwards idempotency", () => {
    const adapter = adapterBlock();
    expect(adapter).toContain("authorization: `Bearer ${SERVICE_ROLE_KEY}`");
    expect(adapter).toContain("apikey: SERVICE_ROLE_KEY");
    expect(adapter).toContain(
      'if (idempotencyKey) headers["idempotency-key"] = idempotencyKey',
    );
    expect(adapter).toContain(
      "`${SUPABASE_URL}/functions/v1/visual-evidence/v1/inspections`",
    );
  });

  it("propagates a successful service representation and maps failures", () => {
    const adapter = adapterBlock();
    expect(adapter).toContain("const body = await response.json().catch(() => null)");
    expect(adapter).toContain("return json({ inspection: body }, response.status)");
    expect(adapter).toContain('json({ error: "database_error" }, 500)');
    expect(adapter).toContain('json({ error: "visual_evidence_unavailable" }, 502)');
    expect(adapter).toContain(
      'json({ error: "visual_evidence_request_failed", status: response.status }, 502)',
    );
  });

  it("does not write legacy evidence or implement imagery analysis", () => {
    const adapter = adapterBlock();
    expect(adapter).not.toContain("local_business_visual_evidence");
    expect(adapter).not.toMatch(/\.insert\(|\.upsert\(|\.update\(/);
    expect(adapter).not.toMatch(
      /GOOGLE_|analysis_allowed|storage_mode|evidence_confidence|attribute_opportunity|image/i,
    );
  });
});
