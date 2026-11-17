import { isAuthorizedNamedServiceRequest } from "../_shared/namedServiceAuth.ts";

export function isAuthorizedVisualEvidenceRequest(req: Request): boolean {
  return isAuthorizedNamedServiceRequest(req, "opps_engine");
}
