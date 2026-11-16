import { namedServiceHeaders } from "../_shared/namedServiceAuth.ts";

export function enrichmentServiceHeaders(secretKeys: Record<string, unknown>): Record<string, string> {
  const key = secretKeys.mgrnz_backend;
  if (typeof key !== "string" || !key) {
    throw new Error("SUPABASE_SECRET_KEYS[mgrnz_backend] is not configured");
  }
  return namedServiceHeaders(key);
}
