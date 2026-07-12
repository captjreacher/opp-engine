// Supabase Edge Function: `opportunities`
// Standalone Local Business Opportunity Engine — the API boundary (Phase 1 + 2 + 3).
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
// Email transport = the shared internal MGRNZ SMTP mailer (raw SMTP over Deno TLS), the same
// approach used by the supercity-contact / painted-by-jess-contact Edge Functions. No third-party
// email provider.
//
// Routes (an optional `/api` prefix is tolerated):
//   GET   /opportunities/health                       -> unauthenticated liveness (no data)
//   GET   /opportunities                              -> board list
//   GET   /opportunities/:id                          -> full detail (+ review_state + console_events)
//   POST  /opportunities/:id/outreach                 -> generate + store a draft (never sends)
//   PATCH /opportunities/:id/outreach/:draftId        -> edit/save or approve a draft (never sends)
//   POST  /opportunities/:id/outreach/:draftId/send   -> send an APPROVED draft via SMTP (operator-gated)
//   POST  /opportunities/:id/review                   -> record an operator review-state transition
//
// Auth: `Authorization: Bearer <OPERATOR_TOKEN>` (or `x-operator-token`). Fails closed if unset.

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
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function authorized(req: Request): boolean {
  if (!OPERATOR_TOKEN) return false; // fail closed
  const h = req.headers.get("authorization") ?? "";
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const alt = req.headers.get("x-operator-token") ?? "";
  return (bearer.length > 0 && bearer === OPERATOR_TOKEN) || (alt.length > 0 && alt === OPERATOR_TOKEN);
}

// ---- Operator review workflow (app-owned; derived from the audit log) -------
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
    .limit(1).maybeSingle();
  return data ? (REVIEW_EVENT_TO_STATE[data.action as string] ?? "detected") : "detected";
}

async function consoleEvents(leadId: string) {
  const { data } = await supabase
    .from("opportunity_console_audit_log")
    .select("id, action, draft_id, actor, metadata, created_at")
    .eq("lead_id", leadId).order("created_at", { ascending: false });
  return data ?? [];
}

// ---- Email helpers ----------------------------------------------------------
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const EHLO_DOMAIN = Deno.env.get("OUTREACH_EHLO_DOMAIN") ?? "opp-engine.staging.maximisedai.com";

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function htmlFromBody(body: string): string {
  const paras = esc(body).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#111">${paras}</div>`;
}
function isValidEmailAddress(v: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? "").trim());
}

// ---- Internal SMTP mailer (raw SMTP over Deno TLS) --------------------------
// Ported faithfully from the MGRNZ supercity-contact / painted-by-jess-contact pattern.
interface SmtpConfig { host: string; port: number; username: string; password: string; fromEmail: string; fromName: string; }

function getSmtpConfig(): SmtpConfig {
  const host = Deno.env.get("MGRNZ_SMTP_HOST") || "";
  const port = Number(Deno.env.get("MGRNZ_SMTP_PORT") || "465");
  const username = Deno.env.get("MGRNZ_SMTP_USERNAME") || "";
  const password = Deno.env.get("MGRNZ_SMTP_PASSWORD") || "";
  const fromEmail = username; // shared MGRNZ sender identity
  const fromName = Deno.env.get("OUTREACH_FROM_NAME") || "Maximised AI";
  if (!host || !Number.isFinite(port) || port <= 0) throw new Error("MGRNZ SMTP configuration is invalid.");
  if (!username || !password) throw new Error("MGRNZ_SMTP_USERNAME and MGRNZ_SMTP_PASSWORD are required.");
  return { host, port, username, password, fromEmail, fromName };
}

function base64(value: string): string { return btoa(String.fromCharCode(...textEncoder.encode(value))); }
function encodeHeader(value: string): string { return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${base64(value)}?=`; }
function normalizeEmailBody(value: string): string { return value.replace(/\r?\n/g, "\r\n"); }
function dotStuff(value: string): string { return normalizeEmailBody(value).replace(/^\./gm, ".."); }
function smtpAddress(email: string): string { return `<${String(email ?? "").replace(/[<>\r\n]/g, "")}>`; }

function buildOutreachMessage(subject: string, text: string, html: string, tag: string, cfg: SmtpConfig, recipient: string): string {
  const boundary = `oppengine-${tag}`;
  const headers = [
    `From: ${encodeHeader(cfg.fromName)} ${smtpAddress(cfg.fromEmail)}`,
    `To: ${smtpAddress(recipient)}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${tag.toLowerCase()}-outreach@${EHLO_DOMAIN}>`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join("\r\n");
  return [
    headers, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", text, "",
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", html, "",
    `--${boundary}--`, "",
  ].join("\r\n");
}

async function readSmtpResponse(conn: Deno.Conn | Deno.TlsConn): Promise<string> {
  const chunks: string[] = [];
  const buffer = new Uint8Array(2048);
  while (true) {
    const size = await conn.read(buffer);
    if (size === null) throw new Error("SMTP connection closed unexpectedly.");
    chunks.push(textDecoder.decode(buffer.subarray(0, size)));
    const response = chunks.join("");
    const lines = response.trimEnd().split(/\r?\n/);
    if (/^\d{3} /.test(lines[lines.length - 1] || "")) return response;
  }
}
function smtpStatus(response: string): number { return Number(response.slice(0, 3)); }
async function writeSmtp(conn: Deno.Conn | Deno.TlsConn, value: string): Promise<void> { await conn.write(textEncoder.encode(value)); }
async function smtpCommand(conn: Deno.Conn | Deno.TlsConn, command: string, expected: number[]): Promise<string> {
  await writeSmtp(conn, `${command}\r\n`);
  const response = await readSmtpResponse(conn);
  if (!expected.includes(smtpStatus(response))) throw new Error(`SMTP command failed (${command.split(" ")[0]}): ${response.trim()}`);
  return response;
}
async function readSmtpGreeting(conn: Deno.Conn | Deno.TlsConn): Promise<void> {
  const response = await readSmtpResponse(conn);
  if (smtpStatus(response) !== 220) throw new Error(`SMTP greeting failed: ${response.trim()}`);
}
async function connectSmtp(host: string, port: number): Promise<Deno.Conn | Deno.TlsConn> {
  if (port === 465) { const conn = await Deno.connectTls({ hostname: host, port }); await readSmtpGreeting(conn); return conn; }
  let conn: Deno.Conn | Deno.TlsConn = await Deno.connect({ hostname: host, port });
  await readSmtpGreeting(conn);
  await smtpCommand(conn, `EHLO ${EHLO_DOMAIN}`, [250]);
  await smtpCommand(conn, "STARTTLS", [220]);
  conn = await Deno.startTls(conn, { hostname: host });
  return conn;
}
async function sendSmtpEmail(cfg: SmtpConfig, email: { subject: string; text: string; html: string }, tag: string, recipient: string): Promise<void> {
  if (!isValidEmailAddress(recipient)) throw new Error("Recipient email is invalid.");
  let conn: Deno.Conn | Deno.TlsConn | undefined;
  try {
    conn = await connectSmtp(cfg.host, cfg.port);
    await smtpCommand(conn, `EHLO ${EHLO_DOMAIN}`, [250]);
    await smtpCommand(conn, "AUTH LOGIN", [334]);
    await smtpCommand(conn, base64(cfg.username), [334]);
    await smtpCommand(conn, base64(cfg.password), [235]);
    await smtpCommand(conn, `MAIL FROM:${smtpAddress(cfg.fromEmail)}`, [250]);
    await smtpCommand(conn, `RCPT TO:${smtpAddress(recipient)}`, [250, 251]);
    await smtpCommand(conn, "DATA", [354]);
    const message = buildOutreachMessage(email.subject, email.text, email.html, tag, cfg, recipient);
    await writeSmtp(conn, `${dotStuff(message)}\r\n.\r\n`);
    const response = await readSmtpResponse(conn);
    if (smtpStatus(response) !== 250) throw new Error(`SMTP DATA failed: ${response.trim()}`);
    await smtpCommand(conn, "QUIT", [221]);
  } catch (error) {
    throw new Error(`SMTP email failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try { conn?.close(); } catch (_e) { /* already closed */ }
  }
}

// ---- Handlers ---------------------------------------------------------------

async function listOpportunities(): Promise<Response> {
  const { data, error } = await supabase
    .from("v_opportunity_list").select("*")
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
    supabase.from("local_business_lead_assessments").select("*").eq("lead_id", id).order("assessed_at", { ascending: false }),
    supabase.from("local_business_audit_reports").select("*").eq("lead_id", id).order("generated_at", { ascending: false }),
    supabase.from("local_business_lead_events").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("local_business_outreach_drafts").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
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

async function createOutreach(id: string, payload: Record<string, unknown>): Promise<Response> {
  const { data: lead, error: leadErr } = await supabase
    .from("local_business_leads").select("id, business_name, email, website_url, category, suburb, region")
    .eq("id", id).maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return json({ error: "not_found" }, 404);

  const { data: assessment } = await supabase
    .from("local_business_lead_assessments").select("opportunity_score, recommended_outreach_angle")
    .eq("lead_id", id).order("assessed_at", { ascending: false }).limit(1).maybeSingle();

  const angle = (assessment?.recommended_outreach_angle ?? "").toString().trim();
  const biz = (lead.business_name ?? "your business").toString();
  const subject = (payload.subject as string | undefined)?.trim() || `Quick opportunity audit for ${biz}`;
  const body = (payload.body as string | undefined)?.trim() || [
    `Kia ora,`, ``,
    `We ran a quick online-visibility audit for ${biz}. ${angle ? angle + "." : "There are a few clear quick wins we can share."}`,
    ``, `Would you like the full audit summary — no obligation? Happy to walk you through the top three fixes.`,
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
    return json({ error: "use_send_endpoint", detail: "Approve the draft, then POST .../send. Status cannot be set to 'sent' directly." }, 400);
  }
  if (status === "approved") {
    fields.status = "approved"; fields.approved_by = "operator-console"; fields.approved_at = new Date().toISOString();
    action = "outreach_draft_approved";
  } else if (status === "draft") {
    fields.status = "draft";
  }

  const { data: draft, error } = await supabase
    .from("local_business_outreach_drafts").update(fields).eq("id", draftId).eq("lead_id", id).select("*").maybeSingle();
  if (error) throw error;
  if (!draft) return json({ error: "not_found" }, 404);

  await supabase.from("opportunity_console_audit_log").insert({
    action, lead_id: id, draft_id: draftId, actor: "operator-console", metadata: { status: draft.status },
  });
  return json({ draft });
}

// POST /:id/outreach/:draftId/send — send an APPROVED draft via internal SMTP. Operator-gated, no auto-send.
//
// Lifecycle note: the DB `status` CHECK allows only draft/pending_review/approved/rejected/sent/
// archived. So "sending" is a transient UI state and "failed" is DERIVED from the
// `outreach_send_failed` audit event — on failure the draft stays `approved`, so the operator can
// retry. Only a successful SMTP send flips the draft to `sent` (+ sent_at).
async function sendOutreach(id: string, draftId: string): Promise<Response> {
  let smtp: SmtpConfig;
  try {
    smtp = getSmtpConfig();
  } catch (e) {
    return json({ error: "sending_not_configured", detail: String((e as Error).message) }, 503);
  }
  const OVERRIDE_TO = (Deno.env.get("OUTREACH_TEST_EMAIL") ?? "").trim();
  const LIVE = (Deno.env.get("OUTREACH_SEND_MODE") ?? "test").toLowerCase() === "live";

  const { data: draft, error: dErr } = await supabase
    .from("local_business_outreach_drafts").select("*").eq("id", draftId).eq("lead_id", id).maybeSingle();
  if (dErr) throw dErr;
  if (!draft) return json({ error: "not_found" }, 404);

  // Operator-approval gate + idempotency.
  if (draft.status === "sent" || draft.sent_at) return json({ error: "already_sent", sent_at: draft.sent_at }, 409);
  if (draft.status !== "approved") {
    return json({ error: "not_approved", detail: "Only operator-approved drafts can be sent. Approve it first." }, 409);
  }

  const { data: lead } = await supabase.from("local_business_leads").select("business_name, email").eq("id", id).maybeSingle();
  const prospectEmail = (lead?.email ?? "").trim();

  // Staging safety: send to the override inbox unless explicitly in live mode.
  const recipient = OVERRIDE_TO || (LIVE ? prospectEmail : "");
  if (!recipient) {
    return json({
      error: "no_recipient",
      detail: "No send target. Set OUTREACH_TEST_EMAIL (recommended for staging) or OUTREACH_SEND_MODE=live to email the prospect directly.",
      prospect_email: prospectEmail || null,
    }, 409);
  }
  if (!isValidEmailAddress(recipient)) return json({ error: "invalid_recipient", recipient }, 422);
  const overridden = !!OVERRIDE_TO && recipient !== prospectEmail;

  const subject = (draft.subject ?? `Outreach — ${lead?.business_name ?? ""}`).toString();
  const banner = overridden ? `[TEST SEND — intended recipient: ${prospectEmail || "(none on file)"}]\n\n` : "";
  const text = banner + String(draft.body ?? "");
  const html = (overridden
    ? `<p style="background:#fef3c7;border:1px solid #f59e0b;padding:8px 10px;border-radius:6px;font-family:system-ui"><strong>TEST SEND</strong> — intended recipient: ${esc(prospectEmail || "(none on file)")}</p>`
    : "") + htmlFromBody(String(draft.body ?? ""));

  // Send via internal SMTP. On failure: do NOT mark sent; log failure; draft stays approved (retryable).
  try {
    await sendSmtpEmail(smtp, { subject, text, html }, draftId, recipient);
  } catch (e) {
    await supabase.from("opportunity_console_audit_log").insert({
      action: "outreach_send_failed", lead_id: id, draft_id: draftId, actor: "operator-console",
      metadata: { recipient, error: String((e as Error).message).slice(0, 300) },
    });
    return json({ error: "send_failed", detail: String((e as Error).message).slice(0, 300), retryable: true }, 502);
  }

  // Mark sent only after a successful send.
  const { data: updated, error: uErr } = await supabase
    .from("local_business_outreach_drafts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", draftId).eq("lead_id", id).select("*").single();
  if (uErr) throw uErr;

  await supabase.from("opportunity_console_audit_log").insert({
    action: "outreach_sent", lead_id: id, draft_id: draftId, actor: "operator-console",
    metadata: { recipient, overridden, transport: "smtp", live: LIVE },
  });

  return json({ draft: updated, sent_to: recipient, overridden });
}

async function setReview(id: string, payload: Record<string, unknown>): Promise<Response> {
  const to = String((payload.to_state ?? payload.state ?? "")).toLowerCase();
  const action = STATE_TO_REVIEW_EVENT[to];
  if (!action) return json({ error: "invalid_state", allowed: Object.keys(STATE_TO_REVIEW_EVENT) }, 400);
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
    return json({ ok: true, service: "opportunities", version: 4, transport: "smtp", ts: new Date().toISOString() });
  }

  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  try {
    if (req.method === "GET" && parts.length === 0) return await listOpportunities();
    if (req.method === "GET" && parts.length === 1) return await getOpportunity(parts[0]);

    if (req.method === "POST" && parts.length === 2 && parts[1] === "outreach") {
      return await createOutreach(parts[0], await req.json().catch(() => ({})));
    }
    if (req.method === "POST" && parts.length === 4 && parts[1] === "outreach" && parts[3] === "send") {
      return await sendOutreach(parts[0], parts[2]);
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
