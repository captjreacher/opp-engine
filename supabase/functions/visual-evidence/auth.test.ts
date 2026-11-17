import { describe, expect, it, vi } from "vitest";
import { isAuthorizedVisualEvidenceRequest } from "./auth.ts";
import { namedServiceHeaders } from "../_shared/namedServiceAuth.ts";

function configureSecrets() {
  vi.stubGlobal("Deno", {
    env: {
      get: () => JSON.stringify({
        opps_engine: "opps-secret",
        mgrnz_backend: "mgrnz-secret",
      }),
    },
  });
}

describe("visual-evidence named-key boundary", () => {
  it("accepts the opportunities caller's apikey-only headers", () => {
    configureSecrets();
    const headers = namedServiceHeaders("opps-secret");
    expect(isAuthorizedVisualEvidenceRequest(new Request("https://example.test", { headers }))).toBe(true);
  });

  it.each([
    ["missing apikey", {}],
    ["incorrect apikey", { apikey: "wrong" }],
    ["bearer-only named secret", { authorization: "Bearer opps-secret" }],
    ["publishable key", { apikey: "sb_publishable_test" }],
  ])("rejects %s", (_label, headers) => {
    configureSecrets();
    expect(isAuthorizedVisualEvidenceRequest(new Request("https://example.test", { headers }))).toBe(false);
  });
});
