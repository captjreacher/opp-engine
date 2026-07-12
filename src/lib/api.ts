// Typed API client for the opp-engine frontend.
//
// The SPA NEVER talks to Supabase directly — every call goes through the
// `opportunities` Edge Function, authenticated with a shared operator bearer
// token. This module is the only place that knows the wire format.

import type {
  ApiErrorBody,
  Draft,
  DraftResponse,
  DraftStatus,
  OppDetail,
  OppListResponse,
  ReviewResponse,
  ReviewState,
  SendResponse,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").trim();
const OPERATOR_TOKEN = (import.meta.env.VITE_OPERATOR_TOKEN ?? "").trim();

/** True when both required env vars are present. Used to drive the in-app config banner. */
export const isApiConfigured: boolean = API_BASE.length > 0 && OPERATOR_TOKEN.length > 0;

export const envStatus = {
  hasApiBase: API_BASE.length > 0,
  hasOperatorToken: OPERATOR_TOKEN.length > 0,
  apiBase: API_BASE,
};

/** Thrown for any non-2xx API response. Carries status + parsed body when available. */
export class ApiError extends Error {
  status: number;
  body: ApiErrorBody | null;

  constructor(message: string, status: number, body: ApiErrorBody | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Raised when a request is attempted while env configuration is incomplete. */
export class ApiNotConfiguredError extends Error {
  constructor() {
    super(
      "opp-engine is not configured: VITE_API_BASE and/or VITE_OPERATOR_TOKEN are missing.",
    );
    this.name = "ApiNotConfiguredError";
  }
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return trimmedPath ? `${trimmedBase}/${trimmedPath}` : trimmedBase;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isApiConfigured) {
    throw new ApiNotConfiguredError();
  }

  const url = joinUrl(API_BASE, path);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (networkErr) {
    throw new ApiError(
      `Network error calling ${url}: ${
        networkErr instanceof Error ? networkErr.message : String(networkErr)
      }`,
      0,
      null,
    );
  }

  if (!res.ok) {
    let parsedBody: ApiErrorBody | null = null;
    try {
      parsedBody = (await res.json()) as ApiErrorBody;
    } catch {
      // Response body was not JSON (or empty) — fall through with parsedBody = null.
    }
    const message =
      parsedBody?.detail ??
      parsedBody?.error ??
      `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, parsedBody);
  }

  // Some future endpoints may return 204/empty bodies; guard against JSON parse errors.
  const text = await res.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

/** GET {VITE_API_BASE} -> { opportunities: OppRow[] } */
export function fetchOpportunities(): Promise<OppListResponse> {
  return request<OppListResponse>("");
}

/** GET {VITE_API_BASE}/{id} -> OppDetail */
export function fetchOpportunityDetail(id: string): Promise<OppDetail> {
  return request<OppDetail>(`/${encodeURIComponent(id)}`);
}

/** POST {VITE_API_BASE}/{id}/outreach -> { draft } (201) */
export function createOutreachDraft(
  id: string,
  payload?: { subject?: string; body?: string },
): Promise<DraftResponse> {
  return request<DraftResponse>(`/${encodeURIComponent(id)}/outreach`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

/**
 * PATCH {VITE_API_BASE}/{id}/outreach/{draftId} -> { draft }
 * NOTE: the API rejects status "sent" with a 400 — sending is not implemented.
 * Callers in this app must never pass "sent".
 */
export function updateOutreachDraft(
  id: string,
  draftId: string,
  payload: { subject?: string; body?: string; status?: Exclude<DraftStatus, "sent"> },
): Promise<DraftResponse> {
  return request<DraftResponse>(
    `/${encodeURIComponent(id)}/outreach/${encodeURIComponent(draftId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

/**
 * POST {VITE_API_BASE}/{id}/outreach/{draftId}/send -> { draft, sent_to, overridden }
 * Sends an APPROVED draft via the internal SMTP mailer (operator-gated, no auto-send). Returns 409
 * if the draft is not approved or already sent, 422 for a bad recipient, 502 on SMTP failure
 * (draft stays approved → retryable), and 503 if SMTP is not configured.
 */
export function sendOutreachDraft(id: string, draftId: string): Promise<SendResponse> {
  return request<SendResponse>(
    `/${encodeURIComponent(id)}/outreach/${encodeURIComponent(draftId)}/send`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

/** POST {VITE_API_BASE}/{id}/review -> { review_state, event } (201) */
export function setReviewState(
  id: string,
  toState: Exclude<ReviewState, "detected">,
): Promise<ReviewResponse> {
  return request<ReviewResponse>(`/${encodeURIComponent(id)}/review`, {
    method: "POST",
    body: JSON.stringify({ to_state: toState }),
  });
}

/** Re-exported for convenience so components can type draft state without importing types directly. */
export type { Draft };
