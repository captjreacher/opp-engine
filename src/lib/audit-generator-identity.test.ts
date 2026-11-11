import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
const source = readFileSync(
  "supabase/functions/opportunities/index.ts",
  "utf8",
);
describe("retired audit and UUID regression", () => {
  it("removes the generator that cast the application label to an auth.users UUID", () => {
    expect(source).not.toContain('generated_by: "opportunity-engine"');
    expect(source).not.toContain("async function auditOpportunity");
    expect(source).not.toContain('from("auth.users")');
  });
  it("retains historical reports without an audit prerequisite", () => {
    expect(source).toContain("audit_reports: reports.data ?? []");
    expect(source).not.toContain("auditReady:");
    expect(source).not.toContain("audit_required");
  });
  it("returns 410 for retired audit routes before invoking shared services", async () => {
    const file = ts.createSourceFile(
      "api.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const blocks: ts.IfStatement[] = [];
    function visit(node: ts.Node) {
      if (
        ts.isIfStatement(node) &&
        node.expression.getText(file).includes('=== "audit"')
      )
        blocks.push(node);
      ts.forEachChild(node, visit);
    }
    visit(file);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const code = ts.transpileModule(block.thenStatement.getText(file), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const response = await new Function("json", code)(
        (body: unknown, status: number) =>
          new Response(JSON.stringify(body), { status }),
      );
      expect(response.status).toBe(410);
    }
  });
});
