import { isAuthorizedNamedServiceRequest } from "../_shared/namedServiceAuth.ts";

export function authorizeVisualAssessRequest(request: Request): boolean {
  return isAuthorizedNamedServiceRequest(request, "opps_engine");
}
