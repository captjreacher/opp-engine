import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const source = ts.createSourceFile(
  "local-business-enrich/index.ts",
  readFileSync("supabase/functions/local-business-enrich/index.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);

describe("enrichment worker entrypoint", () => {
  it("registers the request handler exactly once, unconditionally at module scope", () => {
    const registrations: ts.CallExpression[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Deno"
        && node.expression.name.text === "serve") registrations.push(node);
      ts.forEachChild(node, visit);
    }
    visit(source);

    expect(registrations).toHaveLength(1);
    const registration = registrations[0];
    expect(ts.isExpressionStatement(registration.parent)).toBe(true);
    // Reject nesting in a handler, callback, conditional or other startup guard.
    expect(registration.parent.parent === source).toBe(true);
    expect(registration.arguments).toHaveLength(1);
    expect(ts.isIdentifier(registration.arguments[0])).toBe(true);
    expect(registration.arguments[0].getText(source)).toBe("handler");

    const handler = source.statements.find((statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "handler");
    expect(handler).toBeDefined();
    expect(handler!.end).toBeLessThan(registration.getStart(source));
  });
});
