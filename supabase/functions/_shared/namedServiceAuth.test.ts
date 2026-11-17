import { describe, expect, it, vi } from "vitest";
import { isAuthorizedNamedServiceRequest, namedServiceHeaders } from "./namedServiceAuth.ts";
import { authorizeVisualAssessRequest } from "../local-business-visual-assess/auth.ts";
import { enrichmentServiceHeaders } from "../opportunities/auth.ts";

function configureSecrets(value: unknown) {
  vi.stubGlobal("Deno", { env: { get: () => JSON.stringify(value) } });
}

describe("named service authentication boundaries", () => {
  it("rejects missing and wrong callers before visual assessment access", () => {
    configureSecrets({ opps_engine: "opps-secret" });
    expect(authorizeVisualAssessRequest(new Request("https://example.test", { method: "POST" }))).toBe(false);
    expect(authorizeVisualAssessRequest(new Request("https://example.test", { method: "POST", headers: { apikey: "wrong" } }))).toBe(false);
    expect(authorizeVisualAssessRequest(new Request("https://example.test", { method: "POST", headers: { apikey: "opps-secret" } }))).toBe(true);
  });

  it("accepts only the apikey form for modern secret-key service callers", () => {
    configureSecrets({ opps_engine: "opps-secret" });
    expect(isAuthorizedNamedServiceRequest(new Request("https://example.test", { headers: { apikey: "opps-secret" } }), "opps_engine")).toBe(true);
    expect(isAuthorizedNamedServiceRequest(new Request("https://example.test", { headers: { Authorization: "Bearer opps-secret" } }), "opps_engine")).toBe(false);
  });

  it("makes the enrichment contract use the MGRNZ named key, not the Opps key", () => {
    configureSecrets({ mgrnz_backend: "mgrnz-secret", opps_engine: "opps-secret" });
    const headers = enrichmentServiceHeaders({ mgrnz_backend: "mgrnz-secret", opps_engine: "opps-secret" });
    expect(headers.apikey).toBe("mgrnz-secret");
    expect(isAuthorizedNamedServiceRequest(new Request("https://example.test", { headers }), "mgrnz_backend")).toBe(true);
    expect(isAuthorizedNamedServiceRequest(new Request("https://example.test", { headers: namedServiceHeaders("opps-secret") }), "mgrnz_backend")).toBe(false);
  });
});
