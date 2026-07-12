// Supabase Edge Function: `opportunities`
// Standalone Local Business Opportunity Engine — the API boundary.
//
// Architecture:  Browser (React/Vite)  ->  THIS function (service role)  ->  existing local_business_* tables
//
// The browser NEVER receives privileged database access. It calls these
// endpoints with an operator bearer token; the function uses the Supabase
// service role (auto-injected) to read/write the canonical tables.
//
// Standalone only: reads/writes ONLY the local_business_* family + an app-owned
// audit log. No MGRNZ cockpit / event-routing / auth / CRM / FMF / FYV coupling.
//
// Routes (an optional `/api` prefix is tolerated):
//   GET  /opportunities/health             -> unauthenticated liveness check (no data)
//   GET  /opportunities                    -> board list
//   GET  /opportunities/:id                -> full opportunity detail
//   POST /opportunities/:id/outreach       -> generate + store an outreach DRAFT (never sends)
//
// Auth: `Authorization: Bearer <OPERATOR_TOKEN>` (or `x-operator-token`).
// Fails closed if OPERATOR_TOKEN is not configured. See docs/auth-migration.md
// for the Phase-2 migration path to a Supabase Auth operator role.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPERATOR_TOKEN = Deno.env.get("OPERATOR_TOKEN") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-operator-token, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function authorized(req: Request): boolean {
  if (!OPERATOR_TOKEN) return false; // fail closed: never run open if unconfigured
  const h = req.headers.get("authorization") ?? "";
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const alt = req.headers.get("x-operator-token") ?? "";
  return (bearer.length > 0 && bearer === OPERATOR_TOKEN) ||
    (alt.length > 0 && alt === OPERATOR_TOKEN);
}

// ---- Handlers ---------------------------------------------------------------

// GET /opportunities  — board list (one row per lead + latest assessment + flags)
async function listOpportunities(): Promise<Response> {
  const { data, error } = await supabase
    .from("v_opportunity_list")
    .select("*")
    .order("opportunity_score", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return json({ opportunities: data ?? [] });
}

// GET /opportunities/:id — full detail assembled from the canonical tables
async function getOpportunity(id: string): Promise<Response> {
  const { data: lead, error: leadErr } = await supabase
    .from("local_business_leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return json({ error: "not_found" }, 404);

  const [assessments, reports, events, drafts] = await Promise.all([
    supabase.from("local_business_lead_assessments").select("*")
      .eq("lead_id", id).order("assessed_at", { ascending: false }),
    supabase.from("local_business_audit_reports").select("*")
      .eq("lead_id", id).order("generated_at", { ascending: false }),
    supabase.from("local_business_lead_events").select("*")
      .eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("local_business_outreach_drafts").select("*")
      .eq("lead_id", id).order("created_at", { ascending: false }),
  ]);
  for (const r of [assessments, reports, events, drafts]) {
    if (r.error) throw r.error;
  }

  return json({
    lead,
    latest_assessment: assessments.data?.[0] ?? null,
    assessments: assessments.data ?? [],
    audit_report: reports.data?.[0] ?? null,
    audit_reports: reports.data ?? [],
    events: events.data ?? [],
    outreach_drafts: drafts.data ?? [],
  });
}

// POST /opportunities/:id/outreach — generate + STORE a draft. Never sends.
async function createOutreach(id: string, payload: Record<string, unknown>): Promise<Response> {
  const { data: lead, error: leadErr } = await supabase
    .from("local_business_leads")
    .select("id, business_name, email, website_url, category, suburb, region")
    .eq("id", id)
    .maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return json({ error: "not_found" }, 404);

  const { data: assessment } = await supabase
    .from("local_business_lead_assessments")
    .select("opportunity_score, recommended_outreach_angle, trust_leakage_score, conversion_maturity_score, ai_readiness_score")
    .eq("lead_id", id)
    .order("assessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Operator may override subject/body; otherwise generate a templated draft
  // grounded in the existing assessment (no LLM call, no invented facts).
  const angle = (assessment?.recommended_outreach_angle ?? "").toString().trim();
  const biz = (lead.business_name ?? "your business").toString();
  const subject = (payload.subject as string | undefined)?.trim() ||
    `Quick opportunity audit for ${biz}`;
  const body = (payload.body as string | undefined)?.trim() || [
    `Kia ora,`,
    ``,
    `We ran a quick online-visibility audit for ${biz}. ${angle ? angle + "." : "There are a few clear quick wins we can share."}`,
    ``,
    `Would you like the full audit summary — no obligation? Happy to walk you through the top three fixes.`,
    ``,
    `Ngā mihi,`,
    `MGRNZ`,
  ].join("\n");

  const { data: draft, error: insErr } = await supabase
    .from("local_business_outreach_drafts")
    .insert({
      lead_id: id,
      channel: "email",
      subject,
      body,
      status: "draft",
      created_by: "operator-console",
    })
    .select("*")
    .single();
  if (insErr) throw insErr;

  // Audit log — standalone, app-owned table. NOT the MGRNZ canonical event system.
  const { error: auditErr } = await supabase
    .from("opportunity_console_audit_log")
    .insert({
      action: "outreach_draft_created",
      lead_id: id,
      draft_id: draft.id,
      actor: "operator-console",
      metadata: { subject: draft.subject, channel: draft.channel },
    });

  // NOTE: canonical event emission + real sending (Resend) are Phase 3.
  return json({ draft, audit_logged: !auditErr }, 201);
}

// ---- Router -----------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/api\/opportunities/, "")
    .replace(/^\/opportunities/, "");
  const parts = path.split("/").filter(Boolean);

  // Unauthenticated liveness check — no data exposed. Used for deploy verification.
  if (req.method === "GET" && parts.length === 1 && parts[0] === "health") {
    return json({ ok: true, service: "opportunities", ts: new Date().toISOString() });
  }

  // Everything else requires the operator token (fails closed).
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  try {
    if (req.method === "GET" && parts.length === 0) return await listOpportunities();
    if (req.method === "GET" && parts.length === 1) return await getOpportunity(parts[0]);
    if (req.method === "POST" && parts.length === 2 && parts[1] === "outreach") {
      const payload = await req.json().catch(() => ({}));
      return await createOutreach(parts[0], payload as Record<string, unknown>);
    }
    return json({ error: "not_found", path, method: req.method }, 404);
  } catch (e) {
    return json({ error: "server_error", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
