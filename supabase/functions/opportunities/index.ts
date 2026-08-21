// Supabase Edge Function: `opportunities`
// Standalone Local Business Opportunity Engine — the API boundary (Phase 1-5).
//
// Architecture:  Browser (React/Vite)  ->  THIS function (service role)  ->  existing local_business_* tables
//
// The browser NEVER receives privileged database access. It calls these endpoints with an
// operator bearer token; the function uses the Supabase service role (auto-injected).
//
// Standalone only: no MGRNZ Cockpit / CRM / FMF / FYV UI integration. Phase 5
// orchestrates Google Places plus the canonical local-business-enrich scorer.
//
// Email transport = the shared internal MGRNZ SMTP mailer (raw SMTP over Deno TLS).
//
// Routes (an optional `/api` prefix is tolerated):
//   GET   /opportunities/health                       -> unauthenticated liveness (no data)
//   GET   /opportunities                              -> board list
//   GET   /opportunities/pipeline                     -> outcome pipeline buckets + summary metrics
//   GET   /opportunities/:id                          -> full detail (+ review_state + outcome_state + console_events)
//   POST  /opportunities/discovery-runs               -> queue provider discovery
//   GET   /opportunities/discovery-runs/:runId        -> durable run status
//   GET   /opportunities/discovery-runs/:runId/candidates
//   POST  /opportunities/discovery-runs/:runId/candidates/{import|assess|audit}
//   POST  /opportunities/:id/{assess|audit}           -> canonical single-record intelligence action
//   POST  /opportunities/:id/outreach                 -> generate + store a draft (never sends)
//   PATCH /opportunities/:id/outreach/:draftId        -> edit/save or approve a draft (never sends)
//   POST  /opportunities/:id/outreach/:draftId/send   -> send an APPROVED draft via SMTP (operator-gated)
//   POST  /opportunities/:id/review                   -> record an operator review-state transition
//   POST  /opportunities/:id/outcome                  -> record an outcome-state transition (post-send)
//
// Auth: `Authorization: Bearer <OPERATOR_TOKEN>` (or `x-operator-token`). Fails closed if unset.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPERATOR_TOKEN = Deno.env.get("OPERATOR_TOKEN") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
const MAX_DISCOVERY_RESULTS = 20;
const MAX_BATCH_SIZE = 25;
const AUDIT_REPORT_VERSION = "opportunity-engine-v1";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-operator-token, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  Vary: "Origin",
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
  return (
    (bearer.length > 0 && bearer === OPERATOR_TOKEN) ||
    (alt.length > 0 && alt === OPERATOR_TOKEN)
  );
}

type JsonObject = Record<string, unknown>;

type AssessmentRecord = {
  id: string;
  lead_id?: string | null;
  opportunity_score: string | number | null;
  demand_signal_score: number;
  trust_leakage_score: number;
  conversion_maturity_score: number;
  ai_readiness_score: number;
  recommended_outreach_angle: string | null;
  assessment_summary: string | null;
  assessed_at: string;
  assessed_by?: string | null;
};

type AuditReportRecord = {
  id: string;
  assessment_id: string | null;
  generated_at: string;
  report_version: string;
  pdf_url: string | null;
  metadata_json: JsonObject | null;
};

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, max) : null;
}

function normalizeBusinessIdentity(
  name: string,
  location: string | null,
): string {
  const part = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
  return `${part(name)}|${part(location ?? "")}`;
}

function uuidList(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_BATCH_SIZE
  )
    return null;
  const ids = [...new Set(value.map(String))];
  return ids.every((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    ),
  )
    ? ids
    : null;
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function currentAssessmentFields(lead: Record<string, unknown>) {
  return {
    website_url: cleanText(lead.website_url, 500),
    facebook_url: cleanText(lead.facebook_url, 500),
    google_maps_url: cleanText(lead.google_maps_url, 500),
    phone: cleanText(lead.phone, 80),
    email: cleanText(lead.email, 200),
    address: cleanText(lead.address, 500),
    suburb: cleanText(lead.suburb, 120),
    country: cleanText(lead.country, 80),
    category: cleanText(lead.category, 120),
  };
}

function latestByLead<T extends { lead_id: string; created_at: string }>(
  rows: T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!map.has(row.lead_id)) map.set(row.lead_id, row);
  }
  return map;
}

function resolveVisibleAssessment(
  assessments: AssessmentRecord[],
  consoleEvents: Array<{
    action: string;
    metadata?: JsonObject | null;
    created_at: string;
  }>,
): AssessmentRecord | null {
  const latestAnalysisEvent = consoleEvents.find(
    (event) => event.action === "analysis_completed",
  );
  const assessmentId = cleanText(
    latestAnalysisEvent?.metadata?.assessment_id,
    80,
  );
  if (!assessmentId) return null;
  return (
    assessments.find((assessment) => assessment.id === assessmentId) ?? null
  );
}

function buildAnalysisScoring(
  lead: Record<string, unknown>,
  enrichmentResult: JsonObject,
) {
  const fields = currentAssessmentFields(lead);
  const websitePresent = hasText(fields.website_url);
  const mapsPresent = hasText(fields.google_maps_url);
  const socialPresent = hasText(fields.facebook_url) || mapsPresent;
  const trustScore = parseNumber(enrichmentResult.trust_score, 0);
  const confidenceScore = parseNumber(enrichmentResult.confidence_score, 0);
  const trustSignals = Array.isArray(enrichmentResult.trust_signals)
    ? enrichmentResult.trust_signals.map(String)
    : [];
  const dataAlignmentStatus =
    cleanText(enrichmentResult.data_alignment_status, 80) ??
    "insufficient_evidence";
  const signals = [
    fields.website_url,
    fields.google_maps_url,
    fields.phone,
    fields.email,
    fields.address,
  ].filter((value) => hasText(value)).length;
  const demand = fields.category ? 72 : 52;
  const trustLeakage = Math.max(
    10,
    Math.min(
      90,
      100 -
        trustScore +
        (websitePresent && String(fields.website_url).startsWith("https://")
          ? 0
          : 6),
    ),
  );
  const conversion = websitePresent
    ? trustSignals.includes("clear_contact_pathway")
      ? 74
      : 62
    : socialPresent
      ? 48
      : 34;
  const aiReadiness = websitePresent
    ? confidenceScore >= 75
      ? 70
      : 60
    : socialPresent
      ? 48
      : 32;
  return {
    demand_signal_score: demand,
    trust_leakage_score: trustLeakage,
    conversion_maturity_score: conversion,
    ai_readiness_score: aiReadiness,
    recommended_outreach_angle:
      trustLeakage > 50
        ? "Fix trust leakage: profile + proof + conversion path"
        : "Scale demand capture from current trust base",
    assessment_summary: `Assessed after enrichment found ${signals} operational signal(s). Alignment ${dataAlignmentStatus}; trust ${trustScore}; website ${websitePresent ? "present" : "missing"}; maps ${mapsPresent ? "present" : "missing"}.`,
  };
}

async function emitWorkflowEvent(args: {
  eventType: string;
  entityType: string;
  entityId: string;
  entityRef?: string | null;
  status: string;
  payload?: JsonObject;
}): Promise<void> {
  const { error } = await supabase.from("events").insert({
    source_system: "opportunity-engine",
    event_type: args.eventType,
    entity_type: args.entityType,
    entity_id: args.entityId,
    entity_ref: args.entityRef ?? null,
    status: args.status,
    payload: args.payload ?? {},
    risk_category: "business_process",
    risk_assertions: ["processing"],
    risk_version: "risk-map-v1",
  });
  if (error) throw new Error(`event_insert_failed: ${error.message}`);
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

// ---- Outcome lifecycle (Phase 4; app-owned; derived from the audit log) -----
// sent -> awaiting_response -> replied -> meeting_booked -> converted -> closed
// "sent" is derived from a sent outreach draft; the rest are derived from these events.
const OUTCOME_EVENT_TO_STATE: Record<string, string> = {
  outreach_awaiting_response: "awaiting_response",
  outreach_replied: "replied",
  meeting_booked: "meeting_booked",
  opportunity_converted: "converted",
  opportunity_closed: "closed",
};
const STATE_TO_OUTCOME_EVENT: Record<string, string> = {
  awaiting_response: "outreach_awaiting_response",
  replied: "outreach_replied",
  meeting_booked: "meeting_booked",
  converted: "opportunity_converted",
  closed: "opportunity_closed",
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
  return data
    ? (REVIEW_EVENT_TO_STATE[data.action as string] ?? "detected")
    : "detected";
}

async function consoleEvents(leadId: string) {
  const { data } = await supabase
    .from("opportunity_console_audit_log")
    .select("id, action, draft_id, actor, metadata, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

// ---- Email helpers ----------------------------------------------------------
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const EHLO_DOMAIN =
  Deno.env.get("OUTREACH_EHLO_DOMAIN") ?? "opp-engine.staging.maximisedai.com";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function htmlFromBody(body: string): string {
  const paras = esc(body)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#111">${paras}</div>`;
}
function isValidEmailAddress(v: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? "").trim());
}

// ---- Internal SMTP mailer (raw SMTP over Deno TLS) --------------------------
// Ported faithfully from the MGRNZ supercity-contact / painted-by-jess-contact pattern.
interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

function getSmtpConfig(): SmtpConfig {
  const host = Deno.env.get("MGRNZ_SMTP_HOST") || "";
  const port = Number(Deno.env.get("MGRNZ_SMTP_PORT") || "465");
  const username = Deno.env.get("MGRNZ_SMTP_USERNAME") || "";
  const password = Deno.env.get("MGRNZ_SMTP_PASSWORD") || "";
  const fromEmail = username;
  const fromName = Deno.env.get("OUTREACH_FROM_NAME") || "Maximised AI";
  if (!host || !Number.isFinite(port) || port <= 0)
    throw new Error("MGRNZ SMTP configuration is invalid.");
  if (!username || !password)
    throw new Error(
      "MGRNZ_SMTP_USERNAME and MGRNZ_SMTP_PASSWORD are required.",
    );
  return { host, port, username, password, fromEmail, fromName };
}

function base64(value: string): string {
  return btoa(String.fromCharCode(...textEncoder.encode(value)));
}
function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${base64(value)}?=`;
}
function normalizeEmailBody(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}
function dotStuff(value: string): string {
  return normalizeEmailBody(value).replace(/^\./gm, "..");
}
function smtpAddress(email: string): string {
  return `<${String(email ?? "").replace(/[<>\r\n]/g, "")}>`;
}

function buildOutreachMessage(
  subject: string,
  text: string,
  html: string,
  tag: string,
  cfg: SmtpConfig,
  recipient: string,
): string {
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
    headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function readSmtpResponse(
  conn: Deno.Conn | Deno.TlsConn,
): Promise<string> {
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
function smtpStatus(response: string): number {
  return Number(response.slice(0, 3));
}
async function writeSmtp(
  conn: Deno.Conn | Deno.TlsConn,
  value: string,
): Promise<void> {
  await conn.write(textEncoder.encode(value));
}
async function smtpCommand(
  conn: Deno.Conn | Deno.TlsConn,
  command: string,
  expected: number[],
): Promise<string> {
  await writeSmtp(conn, `${command}\r\n`);
  const response = await readSmtpResponse(conn);
  if (!expected.includes(smtpStatus(response)))
    throw new Error(
      `SMTP command failed (${command.split(" ")[0]}): ${response.trim()}`,
    );
  return response;
}
async function readSmtpGreeting(conn: Deno.Conn | Deno.TlsConn): Promise<void> {
  const response = await readSmtpResponse(conn);
  if (smtpStatus(response) !== 220)
    throw new Error(`SMTP greeting failed: ${response.trim()}`);
}
async function connectSmtp(
  host: string,
  port: number,
): Promise<Deno.Conn | Deno.TlsConn> {
  if (port === 465) {
    const conn = await Deno.connectTls({ hostname: host, port });
    await readSmtpGreeting(conn);
    return conn;
  }
  let conn: Deno.Conn | Deno.TlsConn = await Deno.connect({
    hostname: host,
    port,
  });
  await readSmtpGreeting(conn);
  await smtpCommand(conn, `EHLO ${EHLO_DOMAIN}`, [250]);
  await smtpCommand(conn, "STARTTLS", [220]);
  conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });
  return conn;
}
async function sendSmtpEmail(
  cfg: SmtpConfig,
  email: { subject: string; text: string; html: string },
  tag: string,
  recipient: string,
): Promise<void> {
  if (!isValidEmailAddress(recipient))
    throw new Error("Recipient email is invalid.");
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
    const message = buildOutreachMessage(
      email.subject,
      email.text,
      email.html,
      tag,
      cfg,
      recipient,
    );
    await writeSmtp(conn, `${dotStuff(message)}\r\n.\r\n`);
    const response = await readSmtpResponse(conn);
    if (smtpStatus(response) !== 250)
      throw new Error(`SMTP DATA failed: ${response.trim()}`);
    await smtpCommand(conn, "QUIT", [221]);
  } catch (error) {
    throw new Error(
      `SMTP email failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    try {
      conn?.close();
    } catch (_e) {
      /* already closed */
    }
  }
}

// ---- Discovery / intelligence orchestration (Phase 5) ----------------------

interface PlacesResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
}

async function refreshRunCounts(runId: string): Promise<void> {
  const { data, error } = await supabase
    .from("opportunity_discovery_candidates")
    .select("enrichment_status, assessment_status, audit_status, error_info")
    .eq("run_id", runId);
  if (error)
    throw new Error(`candidate_count_refresh_failed: ${error.message}`);

  const rows = data ?? [];
  const failures = rows.filter(
    (row) =>
      row.enrichment_status === "failed" ||
      row.assessment_status === "failed" ||
      row.audit_status === "failed" ||
      Object.keys((row.error_info as JsonObject | null) ?? {}).length > 0,
  ).length;
  const activeStatuses = new Set([
    "queued",
    "enriching",
    "scoring",
    "auditing",
  ]);
  const terminal = rows.every(
    (row) =>
      !activeStatuses.has(String(row.enrichment_status ?? "")) &&
      !activeStatuses.has(String(row.assessment_status ?? "")) &&
      !activeStatuses.has(String(row.audit_status ?? "")),
  );

  const { error: updateError } = await supabase
    .from("opportunity_discovery_runs")
    .update({
      businesses_discovered: rows.length,
      candidates_enriched: rows.filter((r) =>
        ["enriched", "partial"].includes(r.enrichment_status),
      ).length,
      candidates_scored: rows.filter((r) => r.assessment_status === "scored")
        .length,
      audits_generated: rows.filter((r) => r.audit_status === "audited").length,
      failures,
      ...(terminal && failures > 0 ? { status: "partially_completed" } : {}),
    })
    .eq("id", runId);
  if (updateError)
    throw new Error(`run_count_update_failed: ${updateError.message}`);
}

async function findDuplicateLead(candidate: {
  businessName: string;
  location: string | null;
  website: string | null;
  mapsUrl: string | null;
}): Promise<string | null> {
  if (candidate.mapsUrl) {
    const { data } = await supabase
      .from("local_business_leads")
      .select("id")
      .eq("google_maps_url", candidate.mapsUrl)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  if (candidate.website) {
    const canonical = candidate.website.replace(/\/+$/, "");
    const { data } = await supabase
      .from("local_business_leads")
      .select("id,website_url")
      .ilike("website_url", `${canonical}%`)
      .limit(5);
    const match = (data ?? []).find(
      (lead) =>
        String(lead.website_url ?? "")
          .replace(/\/+$/, "")
          .toLowerCase() === canonical.toLowerCase(),
    );
    if (match?.id) return match.id;
  }
  const { data } = await supabase
    .from("local_business_leads")
    .select("id,business_name,suburb,region")
    .ilike("business_name", candidate.businessName)
    .limit(20);
  const identity = normalizeBusinessIdentity(
    candidate.businessName,
    candidate.location,
  );
  const match = (data ?? []).find(
    (lead) =>
      normalizeBusinessIdentity(
        String(lead.business_name),
        cleanText(lead.suburb) ?? cleanText(lead.region),
      ) === identity,
  );
  return match?.id ?? null;
}

async function executeDiscoveryRun(
  runId: string,
  input: {
    location: string;
    industry: string;
    keywords: string | null;
    resultLimit: number;
  },
): Promise<void> {
  const { location, industry, keywords, resultLimit } = input;
  try {
    const { error: startError } = await supabase
      .from("opportunity_discovery_runs")
      .update({
        status: "discovering",
        current_stage: "discovering",
        started_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (startError) throw startError;
    await emitWorkflowEvent({
      eventType: "opportunity.discovery.started",
      entityType: "opportunity_discovery_run",
      entityId: runId,
      entityRef: `${industry} in ${location}`,
      status: "started",
      payload: { ...input },
    });
    const response = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.primaryTypeDisplayName,places.types",
        },
        body: JSON.stringify({
          textQuery: [keywords, industry, location].filter(Boolean).join(" "),
          maxResultCount: resultLimit,
          languageCode: "en",
        }),
      },
    );
    const providerBody = (await response.json().catch(() => ({}))) as {
      places?: PlacesResult[];
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(
        `google_places_${response.status}: ${providerBody.error?.message ?? "request failed"}`,
      );
    const candidates = [];
    for (const place of providerBody.places ?? []) {
      const businessName = cleanText(place.displayName?.text, 200);
      const sourceIdentifier = cleanText(place.id, 200);
      if (!businessName || !sourceIdentifier) continue;
      const website = cleanText(place.websiteUri, 500);
      const mapsUrl = cleanText(place.googleMapsUri, 500);
      const phone = cleanText(place.nationalPhoneNumber, 80);
      const duplicateLeadId = await findDuplicateLead({
        businessName,
        location,
        website,
        mapsUrl,
      });
      candidates.push({
        run_id: runId,
        source: "google_places",
        source_identifier: sourceIdentifier,
        business_name: businessName,
        normalized_identity: normalizeBusinessIdentity(businessName, location),
        location,
        address: cleanText(place.formattedAddress, 500),
        industry:
          cleanText(place.primaryTypeDisplayName?.text, 120) ?? industry,
        website_url: website,
        phone,
        google_maps_url: mapsUrl,
        source_payload: place,
        preliminary_signals: [
          website ? "website_present" : "website_missing",
          phone ? "phone_present" : "phone_missing",
          mapsUrl ? "google_profile_present" : "google_profile_missing",
        ],
        duplicate_lead_id: duplicateLeadId,
        import_status: duplicateLeadId ? "existing" : "not_imported",
      });
    }
    if (candidates.length) {
      const { data: inserted, error } = await supabase
        .from("opportunity_discovery_candidates")
        .insert(candidates)
        .select("id,business_name");
      if (error) throw error;
      const { error: eventError } = await supabase.from("events").insert(
        (inserted ?? []).map((candidate) => ({
          source_system: "opportunity-engine",
          event_type: "opportunity.discovery_candidate.discovered",
          entity_type: "opportunity_discovery_candidate",
          entity_id: candidate.id,
          entity_ref: candidate.business_name,
          status: "completed",
          payload: { run_id: runId },
          risk_category: "business_process",
          risk_assertions: ["input"],
          risk_version: "risk-map-v1",
        })),
      );
      if (eventError)
        throw new Error(`candidate_event_insert_failed: ${eventError.message}`);
    }
    const { error } = await supabase
      .from("opportunity_discovery_runs")
      .update({
        status: "completed",
        current_stage: "discovery_complete",
        businesses_discovered: candidates.length,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (error) throw error;
    await emitWorkflowEvent({
      eventType: "opportunity.discovery.completed",
      entityType: "opportunity_discovery_run",
      entityId: runId,
      status: "completed",
      payload: { businesses_discovered: candidates.length },
    });
  } catch (error) {
    const detail = String((error as Error).message).slice(0, 500);
    await supabase
      .from("opportunity_discovery_runs")
      .update({
        status: "failed",
        current_stage: "discovery_failed",
        failures: 1,
        error_summary: [{ stage: "discovering", detail }],
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    await emitWorkflowEvent({
      eventType: "opportunity.discovery.failed",
      entityType: "opportunity_discovery_run",
      entityId: runId,
      status: "failed",
      payload: { detail },
    }).catch(() => undefined);
  }
}

async function createDiscoveryRun(payload: JsonObject): Promise<Response> {
  const location = cleanText(payload.location, 120);
  const industry = cleanText(payload.industry ?? payload.category, 120);
  const keywords = cleanText(payload.keywords, 200);
  const radius =
    payload.radius_m == null || payload.radius_m === ""
      ? null
      : Number(payload.radius_m);
  const resultLimit = Number(payload.result_limit ?? 20);
  const validation: Record<string, string> = {};
  if (!location) validation.location = "Location is required.";
  if (!industry) validation.industry = "Industry or category is required.";
  if (
    !Number.isInteger(resultLimit) ||
    resultLimit < 1 ||
    resultLimit > MAX_DISCOVERY_RESULTS
  )
    validation.result_limit = `Maximum results must be between 1 and ${MAX_DISCOVERY_RESULTS}.`;
  if (
    radius !== null &&
    (!Number.isInteger(radius) || radius < 100 || radius > 50000)
  )
    validation.radius_m = "Radius must be between 100 and 50,000 metres.";
  if (Object.keys(validation).length)
    return json({ error: "validation_failed", fields: validation }, 422);
  if (!GOOGLE_PLACES_API_KEY)
    return json(
      {
        error: "provider_not_configured",
        detail: "GOOGLE_PLACES_API_KEY is not configured server-side.",
      },
      503,
    );

  const { data: run, error: runError } = await supabase
    .from("opportunity_discovery_runs")
    .insert({
      location,
      industry,
      keywords,
      radius_m: radius,
      result_limit: resultLimit,
      status: "queued",
      current_stage: "queued",
    })
    .select("*")
    .single();
  if (runError) throw runError;
  const work = executeDiscoveryRun(run.id, {
    location: location!,
    industry: industry!,
    keywords,
    resultLimit,
  });
  const runtime = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  };
  if (runtime.EdgeRuntime) runtime.EdgeRuntime.waitUntil(work);
  else await work;
  return json({ run }, 202);
}

async function getDiscoveryRun(runId: string): Promise<Response> {
  const { data, error } = await supabase
    .from("opportunity_discovery_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return data ? json({ run: data }) : json({ error: "not_found" }, 404);
}

async function listDiscoveryCandidates(runId: string): Promise<Response> {
  const { data: run } = await supabase
    .from("opportunity_discovery_runs")
    .select("id")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return json({ error: "not_found" }, 404);
  const { data, error } = await supabase
    .from("opportunity_discovery_candidates")
    .select("*")
    .eq("run_id", runId)
    .order("created_at");
  if (error) throw error;
  const ids = (data ?? []).map((candidate) => candidate.id);
  const { data: events } = ids.length
    ? await supabase
        .from("events")
        .select("id,event_type,status,payload,created_at,entity_id")
        .eq("entity_type", "opportunity_discovery_candidate")
        .in("entity_id", ids)
        .order("created_at", { ascending: false })
    : { data: [] };
  return json({
    candidates: (data ?? []).map((candidate) => ({
      ...candidate,
      events: (events ?? []).filter(
        (event) => event.entity_id === candidate.id,
      ),
    })),
  });
}

async function importCandidates(
  runId: string,
  payload: JsonObject,
): Promise<Response> {
  const ids = uuidList(payload.candidate_ids);
  if (!ids)
    return json(
      {
        error: "validation_failed",
        detail: `candidate_ids must contain 1-${MAX_BATCH_SIZE} UUIDs.`,
      },
      422,
    );
  const { data: candidates, error } = await supabase
    .from("opportunity_discovery_candidates")
    .select("id,business_name,run_id")
    .eq("run_id", runId)
    .in("id", ids);
  if (error) throw error;
  if ((candidates ?? []).length !== ids.length)
    return json({ error: "candidate_scope_mismatch" }, 422);
  const results = [];
  for (const candidate of candidates ?? []) {
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "opportunity_import_discovery_candidate",
        { p_candidate_id: candidate.id },
      );
      if (rpcError) throw rpcError;
      results.push({
        candidate_id: candidate.id,
        ok: true,
        ...(data as JsonObject),
      });
    } catch (error) {
      const detail = String((error as Error).message).slice(0, 300);
      await supabase
        .from("opportunity_discovery_candidates")
        .update({
          import_status: "failed",
          error_info: { stage: "import", detail },
        })
        .eq("id", candidate.id);
      results.push({ candidate_id: candidate.id, ok: false, error: detail });
    }
  }
  await refreshRunCounts(runId);
  const failed = results.filter((r) => !r.ok).length;
  return json(
    {
      results,
      succeeded: results.length - failed,
      failed,
      partial: failed > 0,
    },
    failed === results.length ? 422 : 200,
  );
}

async function assessOpportunity(
  leadId: string,
  retry = false,
): Promise<{
  ok: boolean;
  assessment?: JsonObject;
  evidence?: unknown;
  error?: string;
  diagnostics?: JsonObject;
}> {
  const { data: existing, error: existingError } = await supabase
    .from("local_business_lead_assessments")
    .select("*")
    .eq("lead_id", leadId)
    .order("assessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    return {
      ok: false,
      error: `assessment_lookup_failed: ${existingError.message}`,
      diagnostics: { stage: "existing_assessment_lookup", lead_id: leadId },
    };
  }

  if (existing && !retry) {
    const { data: lead, error: leadError } = await supabase
      .from("local_business_leads")
      .select("enrichment_diagnostics")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) {
      return {
        ok: false,
        error: `lead_diagnostics_lookup_failed: ${leadError.message}`,
        diagnostics: {
          stage: "existing_assessment_evidence_lookup",
          lead_id: leadId,
        },
      };
    }
    return {
      ok: true,
      assessment: existing as JsonObject,
      evidence:
        (lead?.enrichment_diagnostics as JsonObject | null)
          ?.enrichment_result ?? {},
    };
  }

  const { error: requestedEventError } = await supabase.rpc(
    "emit_local_business_event",
    {
      p_lead_id: leadId,
      p_event_type: "local_business.assessment_requested",
      p_status: "started",
      p_payload: { source: "opportunity-engine", retry },
    },
  );
  if (requestedEventError) {
    return {
      ok: false,
      error: `assessment_requested_event_failed: ${requestedEventError.message}`,
      diagnostics: { stage: "assessment_requested_event", lead_id: leadId },
    };
  }

  let responseStatus: number | null = null;
  let responseBody: JsonObject = {};
  let responseText = "";

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/local-business-enrich`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lead_id: leadId,
          action: retry ? "reenrich" : "enrich",
          source: "opportunity-engine",
        }),
      },
    );

    responseStatus = response.status;
    responseText = await response.text();
    if (responseText) {
      try {
        responseBody = JSON.parse(responseText) as JsonObject;
      } catch {
        responseBody = { raw_response: responseText.slice(0, 1000) };
      }
    }

    if (!response.ok || responseBody.ok === false) {
      const providerDetail =
        cleanText(
          responseBody.detail ??
            responseBody.error ??
            responseBody.message ??
            responseBody.status,
          500,
        ) ?? `enrichment_http_${response.status}`;
      throw new Error(providerDetail);
    }

    const { data: assessment, error: assessmentError } = await supabase
      .from("local_business_lead_assessments")
      .select("*")
      .eq("lead_id", leadId)
      .order("assessed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (assessmentError) {
      throw new Error(
        `canonical_assessment_lookup_failed: ${assessmentError.message}`,
      );
    }
    if (!assessment) {
      throw new Error("canonical_assessment_missing_after_enrichment");
    }

    const { data: lead, error: leadError } = await supabase
      .from("local_business_leads")
      .select("enrichment_diagnostics")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError)
      throw new Error(`lead_diagnostics_lookup_failed: ${leadError.message}`);

    return {
      ok: true,
      assessment: assessment as JsonObject,
      evidence:
        (lead?.enrichment_diagnostics as JsonObject | null)
          ?.enrichment_result ?? {},
      diagnostics: {
        stage: "completed",
        lead_id: leadId,
        enrichment_http_status: responseStatus,
        enrichment_response: responseBody,
      },
    };
  } catch (error) {
    const detail = String(error instanceof Error ? error.message : error).slice(
      0,
      500,
    );
    const diagnostics: JsonObject = {
      stage: "assessment",
      lead_id: leadId,
      retry,
      enrichment_http_status: responseStatus,
      enrichment_response: responseBody,
      enrichment_raw_response: responseText
        ? responseText.slice(0, 1000)
        : null,
      detail,
    };

    const { error: eventError } = await supabase.rpc(
      "emit_local_business_event",
      {
        p_lead_id: leadId,
        p_event_type: "local_business.assessment_failed",
        p_status: "failed",
        p_payload: { source: "opportunity-engine", ...diagnostics },
      },
    );
    if (eventError) {
      console.error(
        "Failed to emit assessment_failed event for lead",
        leadId,
        eventError.message,
      );
    }

    return { ok: false, error: detail, diagnostics };
  }
}

async function runOpportunityEnrichment(
  leadId: string,
  retry = false,
): Promise<{
  ok: boolean;
  status?: string;
  evidence?: unknown;
  assessmentId?: string | null;
  error?: string;
}> {
  let responseBody: JsonObject = {};
  let responseText = "";
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/local-business-enrich`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lead_id: leadId,
          action: retry ? "reenrich" : "enrich",
          source: "opportunity-engine",
        }),
      },
    );
    responseText = await response.text();
    if (responseText) {
      try {
        responseBody = JSON.parse(responseText) as JsonObject;
      } catch {
        responseBody = {};
      }
    }
    if (!response.ok || responseBody.ok === false) {
      const detail =
        cleanText(
          responseBody.detail ??
            responseBody.error ??
            responseBody.message ??
            responseBody.status,
          500,
        ) ?? `enrichment_http_${response.status}`;
      await supabase.from("opportunity_console_audit_log").insert({
        action: "enrichment_failed",
        lead_id: leadId,
        actor: "operator-console",
        metadata: { retry, detail },
      });
      return { ok: false, error: detail };
    }
    const { data: lead, error: leadError } = await supabase
      .from("local_business_leads")
      .select("enrichment_diagnostics")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError)
      throw new Error(`lead_diagnostics_lookup_failed: ${leadError.message}`);
    const assessmentId =
      cleanText(responseBody.assessment_id, 80) ??
      cleanText(
        (responseBody.details as JsonObject | undefined)?.assessment_id,
        80,
      ) ??
      null;
    const status = cleanText(responseBody.status, 80) ?? "success";
    await supabase.from("opportunity_console_audit_log").insert({
      action: "enrichment_completed",
      lead_id: leadId,
      actor: "operator-console",
      metadata: { retry, status, assessment_id: assessmentId },
    });
    return {
      ok: true,
      status,
      assessmentId,
      evidence:
        ((lead?.enrichment_diagnostics as JsonObject | null)
          ?.enrichment_result as JsonObject | null) ?? {},
    };
  } catch (error) {
    const detail = String(error instanceof Error ? error.message : error).slice(
      0,
      500,
    );
    await supabase.from("opportunity_console_audit_log").insert({
      action: "enrichment_failed",
      lead_id: leadId,
      actor: "operator-console",
      metadata: { retry, detail, response_text: responseText.slice(0, 1000) },
    });
    return { ok: false, error: detail };
  }
}

async function runOpportunityAnalysis(
  leadId: string,
  retry = false,
): Promise<{
  ok: boolean;
  assessment?: JsonObject;
  evidence?: unknown;
  error?: string;
  promoted_existing?: boolean;
}> {
  const [
    { data: lead, error: leadError },
    { data: assessments, error: assessmentError },
  ] = await Promise.all([
    supabase
      .from("local_business_leads")
      .select("*")
      .eq("id", leadId)
      .maybeSingle(),
    supabase
      .from("local_business_lead_assessments")
      .select("*")
      .eq("lead_id", leadId)
      .order("assessed_at", { ascending: false }),
  ]);
  if (leadError)
    return { ok: false, error: `lead_lookup_failed: ${leadError.message}` };
  if (assessmentError) {
    return {
      ok: false,
      error: `assessment_lookup_failed: ${assessmentError.message}`,
    };
  }
  if (!lead) return { ok: false, error: "opportunity_not_found" };
  const enrichmentResult =
    ((lead.enrichment_diagnostics as JsonObject | null)
      ?.enrichment_result as JsonObject | null) ?? null;
  if (!enrichmentResult) {
    return { ok: false, error: "enrichment_required" };
  }
  await supabase.rpc("emit_local_business_event", {
    p_lead_id: leadId,
    p_event_type: "local_business.assessment_requested",
    p_status: "started",
    p_payload: { source: "opportunity-engine", retry },
  });
  let assessment = (assessments ?? [])[0] as AssessmentRecord | undefined;
  const leadUpdatedAt = Date.parse(String(lead.updated_at ?? ""));
  const assessmentUpdatedAt = Date.parse(String(assessment?.assessed_at ?? ""));
  const canPromoteExisting =
    !!assessment &&
    !retry &&
    Number.isFinite(leadUpdatedAt) &&
    Number.isFinite(assessmentUpdatedAt) &&
    leadUpdatedAt <= assessmentUpdatedAt;
  if (!canPromoteExisting) {
    const scoring = buildAnalysisScoring(
      lead as Record<string, unknown>,
      enrichmentResult,
    );
    const inserted = await supabase
      .from("local_business_lead_assessments")
      .insert({
        lead_id: leadId,
        demand_signal_score: scoring.demand_signal_score,
        trust_leakage_score: scoring.trust_leakage_score,
        conversion_maturity_score: scoring.conversion_maturity_score,
        ai_readiness_score: scoring.ai_readiness_score,
        assessment_summary: scoring.assessment_summary,
        recommended_outreach_angle: scoring.recommended_outreach_angle,
        assessed_by: "opportunity-engine-analysis",
        assessed_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (inserted.error || !inserted.data) {
      await supabase.rpc("emit_local_business_event", {
        p_lead_id: leadId,
        p_event_type: "local_business.assessment_failed",
        p_status: "failed",
        p_payload: {
          source: "opportunity-engine",
          retry,
          detail: inserted.error?.message ?? "analysis_insert_failed",
        },
      });
      return {
        ok: false,
        error: `analysis_insert_failed: ${inserted.error?.message ?? "no row returned"}`,
      };
    }
    assessment = inserted.data as AssessmentRecord;
  }
  await supabase.from("opportunity_console_audit_log").insert({
    action: "analysis_completed",
    lead_id: leadId,
    actor: "operator-console",
    metadata: {
      retry,
      promoted_existing: canPromoteExisting,
      assessment_id: assessment?.id ?? null,
    },
  });
  await supabase.rpc("emit_local_business_event", {
    p_lead_id: leadId,
    p_event_type: "local_business.assessment_completed",
    p_status: "completed",
    p_payload: {
      source: "opportunity-engine",
      retry,
      assessment_id: assessment?.id ?? null,
    },
  });
  return {
    ok: true,
    assessment: (assessment as JsonObject | undefined) ?? undefined,
    evidence: enrichmentResult,
    promoted_existing: canPromoteExisting,
  };
}

function reportBand(score: number): string {
  if (score >= 100) return "high";
  if (score >= 60) return "medium";
  return "low";
}

async function auditOpportunity(
  leadId: string,
  retry = false,
): Promise<{ ok: boolean; audit?: JsonObject; error?: string }> {
  const [{ data: lead }, { data: assessment }] = await Promise.all([
    supabase
      .from("local_business_leads")
      .select("*")
      .eq("id", leadId)
      .maybeSingle(),
    supabase
      .from("local_business_lead_assessments")
      .select("*")
      .eq("lead_id", leadId)
      .order("assessed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!lead) return { ok: false, error: "opportunity_not_found" };
  if (!assessment) return { ok: false, error: "assessment_required" };
  const { data: existing } = await supabase
    .from("local_business_audit_reports")
    .select("*")
    .eq("lead_id", leadId)
    .eq("assessment_id", assessment.id)
    .eq("report_version", AUDIT_REPORT_VERSION)
    .limit(1)
    .maybeSingle();
  if (existing && !retry) return { ok: true, audit: existing as JsonObject };
  await supabase.rpc("emit_local_business_event", {
    p_lead_id: leadId,
    p_event_type: "local_business.audit_generation_started",
    p_status: "started",
    p_payload: { assessment_id: assessment.id },
  });
  try {
    const score = Number(assessment.opportunity_score ?? 0);
    const enrichment = ((lead.enrichment_diagnostics as JsonObject | null)
      ?.enrichment_result ?? {}) as JsonObject;
    const reportModel = {
      business: {
        name: lead.business_name,
        category: lead.category,
        location: lead.suburb ?? lead.region,
        websiteUrl: lead.website_url,
        source: lead.source,
      },
      scoreBand: reportBand(score),
      metrics: [
        {
          id: "opportunity",
          label: "Opportunity",
          value: score,
          band: reportBand(score),
          sourceField: "opportunity_score",
        },
        {
          id: "demand",
          label: "Demand signal",
          value: assessment.demand_signal_score,
          band: reportBand(Number(assessment.demand_signal_score)),
          sourceField: "demand_signal_score",
        },
        {
          id: "trust",
          label: "Trust leakage",
          value: assessment.trust_leakage_score,
          band: reportBand(Number(assessment.trust_leakage_score)),
          sourceField: "trust_leakage_score",
        },
        {
          id: "conversion",
          label: "Conversion maturity",
          value: assessment.conversion_maturity_score,
          band: reportBand(Number(assessment.conversion_maturity_score)),
          sourceField: "conversion_maturity_score",
        },
        {
          id: "ai",
          label: "AI readiness",
          value: assessment.ai_readiness_score,
          band: reportBand(Number(assessment.ai_readiness_score)),
          sourceField: "ai_readiness_score",
        },
      ],
      summary: assessment.assessment_summary,
      sections: [
        {
          id: "evidence",
          title: "Observed evidence",
          summary: lead.trust_summary,
          items: Array.isArray(enrichment.evidence) ? enrichment.evidence : [],
        },
      ],
      riskFlags: enrichment.risk_flags ?? lead.risk_flags ?? [],
      metadata: {
        generatedAt: new Date().toISOString(),
        assessmentId: assessment.id,
        generatedBy: "opportunity-engine",
        scoringSource: assessment.assessed_by,
      },
    };
    const insert = {
      lead_id: leadId,
      assessment_id: assessment.id,
      report_version: AUDIT_REPORT_VERSION,
      generated_by: "opportunity-engine",
      generated_at: new Date().toISOString(),
      metadata_json: {
        report_model: reportModel,
        validation: { customer_ready: true },
      },
    };
    const { data: audit, error } = existing
      ? await supabase
          .from("local_business_audit_reports")
          .update(insert)
          .eq("id", existing.id)
          .select("*")
          .single()
      : await supabase
          .from("local_business_audit_reports")
          .insert(insert)
          .select("*")
          .single();
    if (error) throw error;
    await supabase.rpc("emit_local_business_event", {
      p_lead_id: leadId,
      p_event_type: "local_business.audit_generated",
      p_status: "completed",
      p_payload: {
        audit_report_id: audit.id,
        assessment_id: assessment.id,
        report_version: AUDIT_REPORT_VERSION,
      },
    });
    return { ok: true, audit: audit as JsonObject };
  } catch (error) {
    const detail = String((error as Error).message).slice(0, 300);
    await supabase.rpc("emit_local_business_event", {
      p_lead_id: leadId,
      p_event_type: "local_business.audit_generation_failed",
      p_status: "failed",
      p_payload: { assessment_id: assessment.id, detail },
    });
    return { ok: false, error: detail };
  }
}

async function processCandidateBatch(
  runId: string,
  payload: JsonObject,
  operation: "assess" | "audit",
): Promise<Response> {
  const ids = uuidList(payload.candidate_ids);
  if (!ids)
    return json(
      {
        error: "validation_failed",
        detail: `candidate_ids must contain 1-${MAX_BATCH_SIZE} UUIDs.`,
      },
      422,
    );

  const { data: candidates, error } = await supabase
    .from("opportunity_discovery_candidates")
    .select("*")
    .eq("run_id", runId)
    .in("id", ids);
  if (error) throw error;
  if ((candidates ?? []).length !== ids.length)
    return json({ error: "candidate_scope_mismatch" }, 422);

  const runPatch = {
    status: operation === "assess" ? "scoring" : "auditing",
    current_stage: operation === "assess" ? "scoring" : "auditing",
    completed_at: null,
  };
  const { error: runStartError } = await supabase
    .from("opportunity_discovery_runs")
    .update(runPatch)
    .eq("id", runId);
  if (runStartError)
    throw new Error(`run_start_update_failed: ${runStartError.message}`);

  const results: Array<Record<string, unknown>> = [];
  for (const candidate of candidates ?? []) {
    const leadId = candidate.imported_lead_id ?? candidate.duplicate_lead_id;
    if (!leadId) {
      const detail = "Import the candidate before processing.";
      const statusPatch =
        operation === "assess"
          ? { assessment_status: "failed" }
          : { audit_status: "failed" };
      const errorInfo = {
        stage: operation,
        detail,
        candidate_id: candidate.id,
        run_id: runId,
      };
      const { error: candidateError } = await supabase
        .from("opportunity_discovery_candidates")
        .update({ ...statusPatch, error_info: errorInfo })
        .eq("id", candidate.id);
      results.push({
        candidate_id: candidate.id,
        ok: false,
        error: candidateError
          ? `${detail} Candidate update also failed: ${candidateError.message}`
          : detail,
        diagnostics: errorInfo,
      });
      continue;
    }

    const runningPatch =
      operation === "assess"
        ? {
            enrichment_status: "enriching",
            assessment_status: "scoring",
            error_info: {},
          }
        : { audit_status: "auditing", error_info: {} };
    const { error: runningError } = await supabase
      .from("opportunity_discovery_candidates")
      .update(runningPatch)
      .eq("id", candidate.id);
    if (runningError) {
      results.push({
        candidate_id: candidate.id,
        lead_id: leadId,
        ok: false,
        error: `candidate_running_status_update_failed: ${runningError.message}`,
      });
      continue;
    }

    const result: {
      ok: boolean;
      assessment?: JsonObject;
      audit?: JsonObject;
      evidence?: unknown;
      error?: string;
      diagnostics?: JsonObject;
    } =
      operation === "assess"
        ? await assessOpportunity(leadId, payload.retry === true)
        : await auditOpportunity(leadId, payload.retry === true);

    const errorInfo = result.ok
      ? {}
      : {
          stage: operation,
          detail: result.error ?? `${operation}_failed`,
          lead_id: leadId,
          candidate_id: candidate.id,
          run_id: runId,
          diagnostics: result.diagnostics ?? {},
          failed_at: new Date().toISOString(),
        };
    const finalPatch = result.ok
      ? operation === "assess"
        ? {
            enrichment_status: "enriched",
            assessment_status: "scored",
            preliminary_score: result.assessment?.opportunity_score ?? null,
            enrichment_evidence: result.evidence ?? {},
            error_info: {},
          }
        : { audit_status: "audited", error_info: {} }
      : operation === "assess"
        ? {
            enrichment_status: "failed",
            assessment_status: "failed",
            error_info: errorInfo,
          }
        : { audit_status: "failed", error_info: errorInfo };

    const { error: finalUpdateError } = await supabase
      .from("opportunity_discovery_candidates")
      .update(finalPatch)
      .eq("id", candidate.id);

    const workflowPayload: JsonObject = {
      run_id: runId,
      lead_id: leadId,
      error: result.error ?? null,
      diagnostics: result.diagnostics ?? {},
      candidate_update_error: finalUpdateError?.message ?? null,
    };
    await emitWorkflowEvent({
      eventType: `opportunity.discovery_candidate.${operation}.${result.ok && !finalUpdateError ? "completed" : "failed"}`,
      entityType: "opportunity_discovery_candidate",
      entityId: candidate.id,
      entityRef: candidate.business_name,
      status: result.ok && !finalUpdateError ? "completed" : "failed",
      payload: workflowPayload,
    }).catch(() => undefined);

    results.push({
      candidate_id: candidate.id,
      lead_id: leadId,
      ...result,
      ok: result.ok && !finalUpdateError,
      error: finalUpdateError
        ? `candidate_final_status_update_failed: ${finalUpdateError.message}`
        : result.error,
    });
  }

  const failed = results.filter((result) => result.ok !== true).length;
  await refreshRunCounts(runId);
  const { error: runCompleteError } = await supabase
    .from("opportunity_discovery_runs")
    .update({
      status: failed ? "partially_completed" : "completed",
      current_stage:
        operation === "assess" ? "scoring_complete" : "auditing_complete",
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (runCompleteError)
    throw new Error(
      `run_completion_update_failed: ${runCompleteError.message}`,
    );

  return json(
    {
      results,
      succeeded: results.length - failed,
      failed,
      partial: failed > 0,
    },
    failed === results.length ? 422 : 200,
  );
}

async function singleIntelligenceAction(
  leadId: string,
  payload: JsonObject,
  operation: "assess" | "audit",
): Promise<Response> {
  const result =
    operation === "assess"
      ? await assessOpportunity(leadId, payload.retry === true)
      : await auditOpportunity(leadId, payload.retry === true);
  if (!result.ok)
    return json(
      { error: `${operation}_failed`, detail: result.error },
      result.error === "opportunity_not_found" ? 404 : 422,
    );
  return json(result);
}

// ---- Existing opportunity / outreach handlers ------------------------------

async function listOpportunities(): Promise<Response> {
  const [leadRes, draftRes, auditRes, analysisEventRes] = await Promise.all([
    supabase
      .from("local_business_leads")
      .select("id, business_name, suburb, region, category, status, updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("local_business_outreach_drafts")
      .select("lead_id, status, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("local_business_audit_reports").select("lead_id"),
    supabase
      .from("opportunity_console_audit_log")
      .select("lead_id, metadata, created_at")
      .eq("action", "analysis_completed")
      .order("created_at", { ascending: false }),
  ]);
  for (const result of [leadRes, draftRes, auditRes, analysisEventRes]) {
    if ((result as { error?: unknown }).error) {
      throw (result as { error: unknown }).error;
    }
  }
  const latestAnalysis = latestByLead(
    (analysisEventRes.data ?? []) as Array<{
      lead_id: string;
      metadata?: JsonObject | null;
      created_at: string;
    }>,
  );
  const assessmentIds = [...latestAnalysis.values()]
    .map((event) => cleanText(event.metadata?.assessment_id, 80))
    .filter((value): value is string => Boolean(value));
  const assessmentMap = new Map<string, AssessmentRecord>();
  if (assessmentIds.length > 0) {
    const { data: assessmentRows, error } = await supabase
      .from("local_business_lead_assessments")
      .select("*")
      .in("id", assessmentIds);
    if (error) throw error;
    for (const row of (assessmentRows ?? []) as AssessmentRecord[]) {
      assessmentMap.set(row.id, row);
    }
  }
  const latestDrafts = latestByLead(
    (draftRes.data ?? []) as Array<{
      lead_id: string;
      status: string;
      created_at: string;
    }>,
  );
  const auditLeadIds = new Set(
    (auditRes.data ?? []).map((row) =>
      String((row as { lead_id: string }).lead_id),
    ),
  );
  const opportunities = (
    (leadRes.data ?? []) as Array<Record<string, unknown>>
  ).map((lead) => {
    const analysisEvent = latestAnalysis.get(String(lead.id));
    const assessmentId = cleanText(analysisEvent?.metadata?.assessment_id, 80);
    const assessment = assessmentId
      ? (assessmentMap.get(assessmentId) ?? null)
      : null;
    return {
      id: lead.id,
      business_name: lead.business_name,
      location: lead.suburb ?? lead.region ?? null,
      industry: lead.category ?? null,
      pipeline_status: lead.status ?? null,
      opportunity_score: assessment?.opportunity_score ?? null,
      demand_signal_score: assessment?.demand_signal_score ?? 0,
      trust_leakage_score: assessment?.trust_leakage_score ?? 0,
      conversion_maturity_score: assessment?.conversion_maturity_score ?? 0,
      ai_readiness_score: assessment?.ai_readiness_score ?? 0,
      recommended_outreach_angle:
        assessment?.recommended_outreach_angle ?? null,
      assessed_at: assessment?.assessed_at ?? null,
      has_audit: auditLeadIds.has(String(lead.id)),
      outreach_status: latestDrafts.get(String(lead.id))?.status ?? null,
      updated_at: lead.updated_at,
    };
  });
  opportunities.sort(
    (a, b) =>
      parseNumber(b.opportunity_score, Number.NEGATIVE_INFINITY) -
      parseNumber(a.opportunity_score, Number.NEGATIVE_INFINITY),
  );
  return json({ opportunities });
}

async function getOpportunity(id: string): Promise<Response> {
  const { data: lead, error: leadErr } = await supabase
    .from("local_business_leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return json({ error: "not_found" }, 404);

  const [
    assessments,
    reports,
    events,
    drafts,
    visualEvidence,
    review_state,
    cEvents,
  ] = await Promise.all([
    supabase
      .from("local_business_lead_assessments")
      .select("*")
      .eq("lead_id", id)
      .order("assessed_at", { ascending: false }),
    supabase
      .from("local_business_audit_reports")
      .select("*")
      .eq("lead_id", id)
      .order("generated_at", { ascending: false }),
    supabase
      .from("local_business_lead_events")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("local_business_outreach_drafts")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("local_business_visual_evidence")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    deriveReviewState(id),
    consoleEvents(id),
  ]);
  for (const r of [assessments, reports, events, drafts, visualEvidence]) {
    if ((r as { error?: unknown }).error) throw (r as { error: unknown }).error;
  }

  // Outcome state derived from the app-owned audit log (latest outcome event),
  // falling back to "sent" when a sent outreach exists, else null (not in pipeline).
  const outcomeEvent = (cEvents as Array<{ action: string }>).find(
    (e) => OUTCOME_EVENT_TO_STATE[e.action],
  );
  const hasSentDraft = (drafts.data ?? []).some(
    (d: { status?: string }) => d.status === "sent",
  );
  const outcome_state = outcomeEvent
    ? OUTCOME_EVENT_TO_STATE[outcomeEvent.action]
    : hasSentDraft
      ? "sent"
      : null;
  const visibleAssessment = resolveVisibleAssessment(
    (assessments.data ?? []) as AssessmentRecord[],
    cEvents as Array<{
      action: string;
      metadata?: JsonObject | null;
      created_at: string;
    }>,
  );
  const visibleAudit = visibleAssessment
    ? (((reports.data ?? []) as AuditReportRecord[]).find(
        (report) => report.assessment_id === visibleAssessment.id,
      ) ?? null)
    : null;

  return json({
    lead,
    latest_assessment: visibleAssessment,
    assessments: assessments.data ?? [],
    audit_report: visibleAudit,
    audit_reports: reports.data ?? [],
    events: events.data ?? [],
    outreach_drafts: drafts.data ?? [],
    review_state,
    outcome_state,
    console_events: cEvents,
    visual_evidence: visualEvidence.data ?? [],
  });
}

// GET /opportunities/pipeline — outcome buckets + summary metrics (existing data only).
async function pipelineView(): Promise<Response> {
  const [listRes, draftsRes, eventsRes] = await Promise.all([
    supabase
      .from("v_opportunity_list")
      .select("id, business_name, industry, opportunity_score, has_audit"),
    supabase.from("local_business_outreach_drafts").select("lead_id, status"),
    supabase
      .from("opportunity_console_audit_log")
      .select("lead_id, action, created_at")
      .in("action", Object.keys(OUTCOME_EVENT_TO_STATE))
      .order("created_at", { ascending: false }),
  ]);
  for (const r of [listRes, draftsRes, eventsRes]) {
    if ((r as { error?: unknown }).error) throw (r as { error: unknown }).error;
  }
  const leads = (listRes.data ?? []) as Array<Record<string, unknown>>;
  const drafts = (draftsRes.data ?? []) as Array<{
    lead_id: string;
    status: string;
  }>;
  const events = (eventsRes.data ?? []) as Array<{
    lead_id: string;
    action: string;
  }>;

  const latestOutcome = new Map<string, string>();
  for (const e of events) {
    // ordered newest-first → first seen per lead is the latest
    if (!latestOutcome.has(e.lead_id))
      latestOutcome.set(e.lead_id, OUTCOME_EVENT_TO_STATE[e.action]);
  }
  const sentLeadIds = new Set(
    drafts.filter((d) => d.status === "sent").map((d) => d.lead_id),
  );

  const opportunities: Array<Record<string, unknown>> = [];
  for (const l of leads) {
    const id = l.id as string;
    const outcome =
      latestOutcome.get(id) ?? (sentLeadIds.has(id) ? "sent" : null);
    if (!outcome) continue; // only sent+ opportunities appear on the pipeline
    opportunities.push({
      id,
      business_name: l.business_name,
      industry: l.industry,
      opportunity_score: l.opportunity_score,
      outcome_state: outcome,
    });
  }

  const distinct = (act: string) =>
    new Set(events.filter((e) => e.action === act).map((e) => e.lead_id)).size;
  const metrics = {
    total_opportunities: leads.length,
    audited_opportunities: (leads as Array<{ has_audit?: boolean }>).filter(
      (l) => l.has_audit,
    ).length,
    drafts_created: drafts.length,
    emails_sent: drafts.filter((d) => d.status === "sent").length,
    replies: distinct("outreach_replied"),
    meetings: distinct("meeting_booked"),
    conversions: distinct("opportunity_converted"),
  };
  return json({ metrics, opportunities });
}

async function createOutreach(
  id: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const { data: lead, error: leadErr } = await supabase
    .from("local_business_leads")
    .select("id, business_name, email, website_url, category, suburb, region")
    .eq("id", id)
    .maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return json({ error: "not_found" }, 404);

  const { data: assessment } = await supabase
    .from("local_business_lead_assessments")
    .select("opportunity_score, recommended_outreach_angle")
    .eq("lead_id", id)
    .order("assessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const angle = (assessment?.recommended_outreach_angle ?? "")
    .toString()
    .trim();
  const biz = (lead.business_name ?? "your business").toString();
  const subject =
    (payload.subject as string | undefined)?.trim() ||
    `Quick opportunity audit for ${biz}`;
  const body =
    (payload.body as string | undefined)?.trim() ||
    [
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

  const { error: auditErr } = await supabase
    .from("opportunity_console_audit_log")
    .insert({
      action: "outreach_draft_created",
      lead_id: id,
      draft_id: draft.id,
      actor: "operator-console",
      metadata: { subject: draft.subject, channel: draft.channel },
    });
  return json({ draft, audit_logged: !auditErr }, 201);
}

// PATCH /:id/outreach/:draftId — edit/save or approve a draft. NEVER sends.
async function updateOutreach(
  id: string,
  draftId: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const fields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof payload.subject === "string") fields.subject = payload.subject;
  if (typeof payload.body === "string") fields.body = payload.body;

  let action = "outreach_draft_updated";
  const status = payload.status as string | undefined;
  if (status === "sent") {
    return json(
      {
        error: "use_send_endpoint",
        detail:
          "Approve the draft, then POST .../send. Status cannot be set to 'sent' directly.",
      },
      400,
    );
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
    .update(fields)
    .eq("id", draftId)
    .eq("lead_id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!draft) return json({ error: "not_found" }, 404);

  await supabase.from("opportunity_console_audit_log").insert({
    action,
    lead_id: id,
    draft_id: draftId,
    actor: "operator-console",
    metadata: { status: draft.status },
  });
  return json({ draft });
}

// POST /:id/outreach/:draftId/send — send an APPROVED draft via internal SMTP. Operator-gated, no auto-send.
async function sendOutreach(id: string, draftId: string): Promise<Response> {
  let smtp: SmtpConfig;
  try {
    smtp = getSmtpConfig();
  } catch (e) {
    return json(
      { error: "sending_not_configured", detail: String((e as Error).message) },
      503,
    );
  }
  const OVERRIDE_TO = (Deno.env.get("OUTREACH_TEST_EMAIL") ?? "").trim();
  const LIVE =
    (Deno.env.get("OUTREACH_SEND_MODE") ?? "test").toLowerCase() === "live";

  const { data: draft, error: dErr } = await supabase
    .from("local_business_outreach_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("lead_id", id)
    .maybeSingle();
  if (dErr) throw dErr;
  if (!draft) return json({ error: "not_found" }, 404);

  if (draft.status === "sent" || draft.sent_at)
    return json({ error: "already_sent", sent_at: draft.sent_at }, 409);
  if (draft.status !== "approved") {
    return json(
      {
        error: "not_approved",
        detail: "Only operator-approved drafts can be sent. Approve it first.",
      },
      409,
    );
  }

  const { data: lead } = await supabase
    .from("local_business_leads")
    .select("business_name, email")
    .eq("id", id)
    .maybeSingle();
  const prospectEmail = (lead?.email ?? "").trim();

  const recipient = OVERRIDE_TO || (LIVE ? prospectEmail : "");
  if (!recipient) {
    return json(
      {
        error: "no_recipient",
        detail:
          "No send target. Set OUTREACH_TEST_EMAIL (recommended for staging) or OUTREACH_SEND_MODE=live to email the prospect directly.",
        prospect_email: prospectEmail || null,
      },
      409,
    );
  }
  if (!isValidEmailAddress(recipient))
    return json({ error: "invalid_recipient", recipient }, 422);
  const overridden = !!OVERRIDE_TO && recipient !== prospectEmail;

  const subject = (
    draft.subject ?? `Outreach — ${lead?.business_name ?? ""}`
  ).toString();
  const banner = overridden
    ? `[TEST SEND — intended recipient: ${prospectEmail || "(none on file)"}]\n\n`
    : "";
  const text = banner + String(draft.body ?? "");
  const html =
    (overridden
      ? `<p style="background:#fef3c7;border:1px solid #f59e0b;padding:8px 10px;border-radius:6px;font-family:system-ui"><strong>TEST SEND</strong> — intended recipient: ${esc(prospectEmail || "(none on file)")}</p>`
      : "") + htmlFromBody(String(draft.body ?? ""));

  try {
    await sendSmtpEmail(smtp, { subject, text, html }, draftId, recipient);
  } catch (e) {
    await supabase.from("opportunity_console_audit_log").insert({
      action: "outreach_send_failed",
      lead_id: id,
      draft_id: draftId,
      actor: "operator-console",
      metadata: {
        recipient,
        error: String((e as Error).message).slice(0, 300),
      },
    });
    return json(
      {
        error: "send_failed",
        detail: String((e as Error).message).slice(0, 300),
        retryable: true,
      },
      502,
    );
  }

  const { data: updated, error: uErr } = await supabase
    .from("local_business_outreach_drafts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("lead_id", id)
    .select("*")
    .single();
  if (uErr) throw uErr;

  await supabase.from("opportunity_console_audit_log").insert({
    action: "outreach_sent",
    lead_id: id,
    draft_id: draftId,
    actor: "operator-console",
    metadata: { recipient, overridden, transport: "smtp", live: LIVE },
  });

  return json({ draft: updated, sent_to: recipient, overridden });
}

async function setReview(
  id: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const to = String(payload.to_state ?? payload.state ?? "").toLowerCase();
  const action = STATE_TO_REVIEW_EVENT[to];
  if (!action)
    return json(
      { error: "invalid_state", allowed: Object.keys(STATE_TO_REVIEW_EVENT) },
      400,
    );
  const { data: lead } = await supabase
    .from("local_business_leads")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return json({ error: "not_found" }, 404);
  const { error } = await supabase
    .from("opportunity_console_audit_log")
    .insert({
      action,
      lead_id: id,
      actor: "operator-console",
      metadata: { to_state: to },
    });
  if (error) throw error;
  return json({ review_state: to, event: action }, 201);
}

// POST /:id/outcome — record an outcome-state transition (post-send lifecycle).
async function setOutcome(
  id: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const to = String(payload.to_state ?? payload.state ?? "").toLowerCase();
  const action = STATE_TO_OUTCOME_EVENT[to];
  if (!action)
    return json(
      { error: "invalid_state", allowed: Object.keys(STATE_TO_OUTCOME_EVENT) },
      400,
    );

  const { data: lead } = await supabase
    .from("local_business_leads")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return json({ error: "not_found" }, 404);

  // The outcome lifecycle starts at "sent" — require at least one sent outreach.
  const { data: sentDraft } = await supabase
    .from("local_business_outreach_drafts")
    .select("id")
    .eq("lead_id", id)
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();
  if (!sentDraft)
    return json(
      {
        error: "not_sent",
        detail: "Send an approved outreach before tracking outcomes.",
      },
      409,
    );

  const { error } = await supabase
    .from("opportunity_console_audit_log")
    .insert({
      action,
      lead_id: id,
      actor: "operator-console",
      metadata: { to_state: to },
    });
  if (error) throw error;
  return json({ outcome_state: to, event: action }, 201);
}

// POST /:id/visual-evidence — operator entry point for analysable imagery.
//
// Google Street View evidence is reference-only and must NEVER be converted to
// analysable evidence here. This endpoint only creates NEW managed evidence
// rows (source = operator_upload | licensed_external) from an operator-supplied
// hosted image URL, explicitly flagged analysis_allowed = true and
// storage_mode = managed. No image bytes are uploaded, downloaded or proxied.
async function addVisualEvidence(
  id: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const { data: lead } = await supabase
    .from("local_business_leads")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return json({ error: "not_found" }, 404);

  const sourceUrl = cleanText(payload.source_url, 2000);
  if (!sourceUrl)
    return json(
      { error: "validation_failed", detail: "source_url is required." },
      422,
    );
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    return json(
      {
        error: "validation_failed",
        detail: "source_url must be a valid http(s) URL.",
      },
      422,
    );
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return json(
      {
        error: "validation_failed",
        detail: "source_url must be a valid http(s) URL.",
      },
      422,
    );
  }

  const source =
    payload.source === "licensed_external"
      ? "licensed_external"
      : "operator_upload";
  const mediaType =
    payload.media_type === "video"
      ? "video"
      : payload.media_type === "panorama"
        ? "panorama"
        : "image";
  const precision =
    payload.capture_date_precision === "exact" ||
    payload.capture_date_precision === "month" ||
    payload.capture_date_precision === "year"
      ? payload.capture_date_precision
      : null;
  const capturedAt =
    typeof payload.captured_at === "string" && payload.captured_at
      ? payload.captured_at
      : null;
  const latitude =
    typeof payload.latitude === "number" && Number.isFinite(payload.latitude)
      ? payload.latitude
      : null;
  const longitude =
    typeof payload.longitude === "number" && Number.isFinite(payload.longitude)
      ? payload.longitude
      : null;

  const { data: evidence, error } = await supabase
    .from("local_business_visual_evidence")
    .insert({
      lead_id: id,
      source,
      media_type: mediaType,
      source_url: sourceUrl,
      captured_at: capturedAt,
      capture_date_precision: precision,
      latitude,
      longitude,
      analysis_allowed: true,
      storage_mode: "managed",
      status: "available",
      metadata: {
        submitted_by: "operator-console",
        submitted_via: "opportunities-api",
      },
    })
    .select("*")
    .single();
  if (error) throw error;

  await supabase.from("opportunity_console_audit_log").insert({
    action: "visual_evidence_added",
    lead_id: id,
    actor: "operator-console",
    metadata: {
      evidence_id: evidence.id,
      source,
      source_url: sourceUrl,
      analysis_allowed: true,
      storage_mode: "managed",
    },
  });

  return json({ evidence }, 201);
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
    return json({
      ok: true,
      service: "opportunities",
      version: 5,
      transport: "smtp",
      ts: new Date().toISOString(),
    });
  }

  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  try {
    if (req.method === "GET" && parts.length === 0)
      return await listOpportunities();
    if (req.method === "GET" && parts.length === 1 && parts[0] === "pipeline")
      return await pipelineView();
    if (
      req.method === "POST" &&
      parts.length === 1 &&
      parts[0] === "discovery-runs"
    ) {
      return await createDiscoveryRun(await req.json().catch(() => ({})));
    }
    if (
      req.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "discovery-runs"
    ) {
      return await getDiscoveryRun(parts[1]);
    }
    if (
      req.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "discovery-runs" &&
      parts[2] === "candidates"
    ) {
      return await listDiscoveryCandidates(parts[1]);
    }
    if (
      req.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "discovery-runs" &&
      parts[2] === "candidates" &&
      parts[3] === "import"
    ) {
      return await importCandidates(
        parts[1],
        await req.json().catch(() => ({})),
      );
    }
    if (
      req.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "discovery-runs" &&
      parts[2] === "candidates" &&
      parts[3] === "assess"
    ) {
      return await processCandidateBatch(
        parts[1],
        await req.json().catch(() => ({})),
        "assess",
      );
    }
    if (
      req.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "discovery-runs" &&
      parts[2] === "candidates" &&
      parts[3] === "audit"
    ) {
      return await processCandidateBatch(
        parts[1],
        await req.json().catch(() => ({})),
        "audit",
      );
    }
    if (req.method === "GET" && parts.length === 1)
      return await getOpportunity(parts[0]);
    if (req.method === "PATCH" && parts.length === 1) {
      return await updateOpportunityLead(
        parts[0],
        await req.json().catch(() => ({})),
      );
    }
    if (req.method === "POST" && parts.length === 2 && parts[1] === "enrich") {
      const payload = (await req.json().catch(() => ({}))) as JsonObject;
      return json(
        await runOpportunityEnrichment(parts[0], payload.retry === true),
      );
    }
    if (req.method === "POST" && parts.length === 2 && parts[1] === "assess") {
      const payload = (await req.json().catch(() => ({}))) as JsonObject;
      return json(
        await runOpportunityAnalysis(parts[0], payload.retry === true),
      );
    }
    if (req.method === "POST" && parts.length === 2 && parts[1] === "audit") {
      return await singleIntelligenceAction(
        parts[0],
        await req.json().catch(() => ({})),
        "audit",
      );
    }
    if (
      req.method === "POST" &&
      parts.length === 2 &&
      parts[1] === "outreach"
    ) {
      return await createOutreach(parts[0], await req.json().catch(() => ({})));
    }
    if (
      req.method === "POST" &&
      parts.length === 4 &&
      parts[1] === "outreach" &&
      parts[3] === "send"
    ) {
      return await sendOutreach(parts[0], parts[2]);
    }
    if (
      req.method === "PATCH" &&
      parts.length === 3 &&
      parts[1] === "outreach"
    ) {
      return await updateOutreach(
        parts[0],
        parts[2],
        await req.json().catch(() => ({})),
      );
    }
    if (
      req.method === "POST" &&
      parts.length === 2 &&
      parts[1] === "visual-evidence"
    ) {
      return await addVisualEvidence(
        parts[0],
        await req.json().catch(() => ({})),
      );
    }
    if (req.method === "POST" && parts.length === 2 && parts[1] === "review") {
      return await setReview(parts[0], await req.json().catch(() => ({})));
    }
    if (req.method === "POST" && parts.length === 2 && parts[1] === "outcome") {
      return await setOutcome(parts[0], await req.json().catch(() => ({})));
    }
    return json({ error: "not_found", path, method: req.method }, 404);
  } catch (e) {
    return json(
      { error: "server_error", detail: String((e as Error)?.message ?? e) },
      500,
    );
  }
});
