const equalSecret = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

function configuredSecret(keyName: string): string {
  if (!keyName) return "";
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "");
    return keys && typeof keys === "object" && typeof keys[keyName] === "string" ? keys[keyName] : "";
  } catch {
    return "";
  }
}

/** Handler-level authentication for callers when platform JWT verification is disabled. */
export function isAuthorizedNamedServiceRequest(req: Request, keyName: string): boolean {
  const expected = configuredSecret(keyName);
  if (!expected) return false;
  const apikey = req.headers.get("apikey") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  return equalSecret(apikey, expected) || equalSecret(bearer, expected);
}

export function namedServiceHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}`, apikey: secret };
}
