// Supabase Edge Function: `opportunities`
// Standalone Local Business Opportunity Engine — the API boundary (Phase 1 + Phase 2).
//
// Architecture:  Browser (React/Vite)  ->  THIS function (service role)  ->  existing local_business_* tables
//
// The browser NEVER receives privileged database access. It calls these endpoints with an
// operator bearer token; the function uses the Supabase service role (auto-injected).
//
// Standalone only: touches ONLY the local_business_* family + the app-owned
// opportunity_console_audit_log. No MGRNZ cockpit / event-routing / auth / CRM / FMF / FYV.
// The opportunity-intelligence backend (discovery/scoring/audit) is NOT modified.
//
// Routes (an optional `/api` prefix is tolerated):
//   GET   /opportunities/health                  -> unauthenticated liveness (no data)
//   GET   /opportunities                         -> board list
//   GET   /opportunities/:id                     -> full detail (+ review_state + console_events)
//   POST  /opportunities/:id/outreach            -> generate + store a draft (never sends)
//   PATCH /opportunities/:id/outreach/:draftId   -> edit/save or approve a draft (never sends)
//   POST  /opportunities/:id/review              -> record an operator review-state transition
//
// Auth: `Authorization: Bearer <OPERATOR_TOKEN>` (or `x-operator-token`). Fails closed if unset.
// See docs/auth-migration.md for the Phase-2 migration path to a Supabase Auth operator role.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPERATOR_TOKEN = Deno.env.get("OPERATOR_TOKEN") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-operator-token, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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
  if (!OPERATOR_TOKEN) return false; // fail closed
  const h = req.headers.get("authorization") ?? "";
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const alt = req.headers.get("x-operator-token") ?? "";
  return (bearer.length > 0 && bearer === OPERATOR_TOKEN) ||
    (alt.length > 0 && alt === OPERATOR_TOKEN);
}

// ---- Operator review workflow (app-owned; derived from the audit log) -------
// Detected -> Reviewed -> Approved -> Contact Ready
const REVIEW_EVENT_TO_STATE: Record<string, string> = {
  opportunity_review_started: "reviewed",
  opportunity_review_completed: "approved",
  opportunity_contact_ready: "contact_ready",
};
const STATE_TO_REVIEW_EVENT: Record<string, string> = {
  reviewed: "opportunity_review_started",
  approved: "opportunity_review_completed",
  contact_ready: "opportunity_contact_ready",
};

async function deriveReviewState(leadId: string): Promise<string> {
  const { data } = await supabase
    .from("opportunity_console_audit_log")
    .select("action, created_at")
    .eq("lead_id", leadId)
    .in("action", Object.keys(REVIEW_EVENT_TO_STATE))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? (REVIEW_EVENT_TO_STATE[data.action as string] ?? "detected") : "detected";
}

async function consoleEvents(leadId: string) {
  const { data } = await supabase
    .from("opportunity_console_audit_log")
    .select("id, action, draft_id, actor, metadata, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

// ---- Handlers ---------------------------------------------------------------

async function listOpportunities(): Promise<Response> {
  const { data, error } = await supabase
    .from("v_opportunity_list")
    .select("*")
    .order("opportunity_score", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return json({ opportunities: data ?? [] });
}

async function getOpportunity(id: string): Promise<Response> {
  const { data: lead, error: leadErr } = await supabase
    .from("local_business_leads").select("*").eq("id", id).maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return json({ error: "not_found" }, 404);

  const [assessments, reports, events, drafts, review_state, cEvents] = await Promise.all([
    supabase.from("local_business_lead_assessments").select("*")
      .eq("lead_id", id).order("assessed_at", { ascending: false }),
    supabase.from("local_business_audit_reports").select("*")
      .eq("lead_id", id).order("generated_at", { ascending: false }),
    supabase.from("local_business_lead_events").select("*")
      .eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("local_business_outreach_drafts").select("*")
      .eq("lead_id", id).order("created_at", { ascending: false }),
    deriveReviewState(id),
    consoleEvents(id),
  ]);
  for (const r of [assessments, reports, events, drafts]) {
    if ((r as { error?: unknown }).error) throw (r as { error: unknown }).error;
  }

  return json({
    lead,
    latest_assessment: assessments.data?.[0] ?? null,
    assessments: assessments.data ?? [],
    audit_report: reports.data?.[0] ?? null,
    audit_reports: reports.data ?? [],
    events: events.data ?? [],
    outreach_drafts: drafts.data ?? [],
    review_state,
    console_events: cEvents,
  });
}

// POST /:id/outreach — generate + STORE a draft. Never sends.
async function createOutreach(id: string, payload: Record<string, unknown>): Promise<Response> {
  const { data: lead, error: leadErr } = await supabase
    .from("local_business_leads")
    .select("id, business_name, email, website_url, category, suburb, region")
    .eq("id", id).maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return json({ error: "not_found" }, 404);

  const { data: assessment } = await supabase
    .from("local_business_lead_assessments")
    .select("opportunity_score, recommended_outreach_angle")
    .eq("lead_id", id).order("assessed_at", { ascending: false }).limit(1).maybeSingle();

  const angle = (assessment?.recommended_outreach_angle ?? "").toString().trim();
  const biz = (lead.business_name ?? "your business").toString();
  const subject = (payload.subject as string | undefined)?.trim() ||
    `Quick opportunity audit for ${biz}`;
  const body = (payload.body as string | undefined)?.trim() || [
    `Kia ora,`, ``,
    `We ran a quick online-visibility audit for ${biz}. ${angle ? angle + "." : "There are a few clear quick wins we can share."}`,
    ``,
    `Would you like the full audit summary — no obligation? Happy to walk you through the top three fixes.`,
    ``, `Ngā mihi,`, `MGRNZ`,
  ].join("\n");

  const { data: draft, error: insErr } = await supabase
    .from("local_business_outreach_drafts")
    .insert({ lead_id: id, channel: "email", subject, body, status: "draft", created_by: "operator-console" })
    .select("*").single();
  if (insErr) throw insErr;

  const { error: auditErr } = await supabase.from("opportunity_console_audit_log").insert({
    action: "outreach_draft_created", lead_id: id, draft_id: draft.id,
    actor: "operator-console", metadata: { subject: draft.subject, channel: draft.channel },
  });
  return json({ draft, audit_logged: !auditErr }, 201);
}

// PATCH /:id/outreach/:draftId — edit/save or approve a draft. NEVER sends.
async function updateOutreach(id: string, draftId: string, payload: Record<string, unknown>): Promise<Response> {
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof payload.subject === "string") fields.subject = payload.subject;
  if (typeof payload.body === "string") fields.body = payload.body;

  let action = "outreach_draft_updated";
  const status = payload.status as string | undefined;
  if (status === "sent") {
    return json({ error: "sending_disabled", detail: "Phase 2 is draft-only; sending is not implemented." }, 400);
  }
  if (status === "approved") {
    fields.status = "approved";
    fields.approved_by = "operator-console";
    fields.approved_at = new Date().toISOString();
    action = "outreach_draft_approved";
  } else if (status === "draft") {
    fields.status = "draft";
  }

  const { data: draft, error } = await supabase
    .from("local_business_outreach_drafts")
    .update(fields).eq("id", draftId).eq("lead_id", id).select("*").maybeSingle();
  if (error) throw error;
  if (!draft) return json({ error: "not_found" }, 404);

  await supabase.from("opportunity_console_audit_log").insert({
    action, lead_id: id, draft_id: draftId, actor: "operator-console",
    metadata: { status: draft.status },
  });
  return json({ draft });
}

// POST /:id/review — record an operator review-state transition (app-owned event log).
async function setReview(id: string, payload: Record<string, unknown>): Promise<Response> {
  const to = String((payload.to_state ?? payload.state ?? "")).toLowerCase();
  const action = STATE_TO_REVIEW_EVENT[to];
  if (!action) {
    return json({ error: "invalid_state", allowed: Object.keys(STATE_TO_REVIEW_EVENT) }, 400);
  }
  const { data: lead } = await supabase.from("local_business_leads").select("id").eq("id", id).maybeSingle();
  if (!lead) return json({ error: "not_found" }, 404);

  const { error } = await supabase.from("opportunity_console_audit_log").insert({
    action, lead_id: id, actor: "operator-console", metadata: { to_state: to },
  });
  if (error) throw error;
  return json({ review_state: to, event: action }, 201);
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

  if (req.method === "GET" && parts.length === 1 && parts[0] === "health") {
    return json({ ok: true, service: "opportunities", ts: new Date().toISOString() });
  }

  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  try {
    if (req.method === "GET" && parts.length === 0) return await listOpportunities();
    if (req.method === "GET" && parts.length === 1) return await getOpportunity(parts[0]);

    if (req.method === "POST" && parts.length === 2 && parts[1] === "outreach") {
      return await createOutreach(parts[0], await req.json().catch(() => ({})));
    }
    if (req.method === "PATCH" && parts.length === 3 && parts[1] === "outreach") {
      return await updateOutreach(parts[0], parts[2], await req.json().catch(() => ({})));
    }
    if (req.method === "POST" && parts.length === 2 && parts[1] === "review") {
      return await setReview(parts[0], await req.json().catch(() => ({})));
    }
    return json({ error: "not_found", path, method: req.method }, 404);
  } catch (e) {
    return json({ error: "server_error", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
