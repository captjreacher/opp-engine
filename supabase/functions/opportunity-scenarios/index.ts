import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPERATOR_TOKEN = Deno.env.get("OPERATOR_TOKEN") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-operator-token, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  Vary: "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function authorized(req: Request): boolean {
  if (!OPERATOR_TOKEN) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const alternate = req.headers.get("x-operator-token") ?? "";
  return bearer === OPERATOR_TOKEN || alternate === OPERATOR_TOKEN;
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const { data, error } = await supabase.rpc("opportunity_list_active_scenarios");
    if (error) throw error;
    return json({ scenarios: data ?? [] });
  } catch (error) {
    return json(
      {
        error: "scenario_list_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
