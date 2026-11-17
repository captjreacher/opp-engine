import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { representation, validAddress, validAttributes } from "./contract.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const secret = typeof secretKeys.opps_engine === "string" ? secretKeys.opps_engine : "";
const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ??
  Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
const db = url && secret
  ? createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

const headers = {
  "content-type": "application/json",
  "cache-control": "no-store",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
function error(code: string, status: number): Response {
  return json({ error: { code } }, status);
}
function isAuthorized(req: Request): boolean {
  const bearer = req.headers.get("authorization") ?? "";
  return secret.length > 0 && bearer === `Bearer ${secret}`;
}
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function providerErrorCode(response: Response): string {
  return response.status === 429 ? "provider_rate_limited" : "provider_error";
}

type ImageryResult = {
  imagery_status: "reference_available" | "unavailable" | "provider_error";
  provider: "google_street_view" | null;
  provider_reference: string | null;
  capture_date: string | null;
  capture_date_precision: "month" | "year" | null;
  latitude: number | null;
  longitude: number | null;
  panorama_latitude: number | null;
  panorama_longitude: number | null;
  provenance: Record<string, unknown>;
  limitations: string[];
};

async function resolveReference(address: string): Promise<ImageryResult> {
  const empty: ImageryResult = {
    imagery_status: "unavailable",
    provider: null,
    provider_reference: null,
    capture_date: null,
    capture_date_precision: null,
    latitude: null,
    longitude: null,
    panorama_latitude: null,
    panorama_longitude: null,
    provenance: {},
    limitations: [],
  };
  if (!googleKey) {
    return {
      ...empty,
      imagery_status: "provider_error",
      limitations: ["provider_not_configured"],
    };
  }

  try {
    const places = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": googleKey,
          "X-Goog-FieldMask": "places.location,places.formattedAddress",
        },
        body: JSON.stringify({ textQuery: address, maxResultCount: 1 }),
      },
    );
    if (!places.ok) {
      return {
        ...empty,
        imagery_status: "provider_error",
        limitations: [providerErrorCode(places)],
      };
    }
    const place = (await places.json()).places?.[0];
    const latitude = numberOrNull(place?.location?.latitude);
    const longitude = numberOrNull(place?.location?.longitude);
    if (latitude === null || longitude === null) {
      return { ...empty, limitations: ["address_unresolved"] };
    }

    const metadataUrl = new URL(
      "https://maps.googleapis.com/maps/api/streetview/metadata",
    );
    metadataUrl.searchParams.set("location", `${latitude},${longitude}`);
    metadataUrl.searchParams.set("key", googleKey);
    const metadata = await fetch(metadataUrl);
    if (!metadata.ok) {
      return {
        ...empty,
        imagery_status: "provider_error",
        latitude,
        longitude,
        limitations: [providerErrorCode(metadata)],
      };
    }
    const payload = await metadata.json();
    if (payload.status === "ZERO_RESULTS") {
      return {
        ...empty,
        latitude,
        longitude,
        limitations: ["panorama_unavailable"],
        provenance: {
          address_match: "first_places_text_result",
          formatted_address: place?.formattedAddress ?? null,
        },
      };
    }
    if (payload.status !== "OK") {
      return {
        ...empty,
        imagery_status: "provider_error",
        latitude,
        longitude,
        limitations: ["provider_error"],
      };
    }
    const date =
      typeof payload.date === "string" && /^\d{4}(-\d{2})?$/.test(payload.date)
        ? payload.date
        : null;
    return {
      imagery_status: "reference_available",
      provider: "google_street_view",
      provider_reference: typeof payload.pano_id === "string"
        ? payload.pano_id
        : null,
      capture_date: date,
      capture_date_precision: date
        ? (date.length === 7 ? "month" : "year")
        : null,
      latitude,
      longitude,
      panorama_latitude: numberOrNull(payload.location?.lat),
      panorama_longitude: numberOrNull(payload.location?.lng),
      provenance: {
        source: "google_street_view_metadata",
        address_match: "first_places_text_result",
        formatted_address: place?.formattedAddress ?? null,
        provider_status: payload.status,
        analysis_allowed: false,
        storage_mode: "reference_only",
      },
      limitations: [
        "reference_only",
        "property_match_unverified",
        "analysis_not_implemented",
      ],
    };
  } catch {
    return {
      ...empty,
      imagery_status: "provider_error",
      limitations: ["provider_error"],
    };
  }
}

Deno.serve(async (req) => {
  if (!db) return error("service_not_configured", 503);
  if (!isAuthorized(req)) return error("unauthorized", 401);
  const path = new URL(req.url).pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/visual-evidence/, "");

  if (req.method === "GET" && path === "/v1/attributes") {
    const { data, error: dbError } = await db.from("visual_evidence_attributes")
      .select("slug,label").eq("enabled", true).order("slug");
    return dbError ? error("database_error", 500) : json({ attributes: data });
  }

  if (req.method === "GET" && /^\/v1\/inspections\/[0-9a-f-]{36}$/.test(path)) {
    const id = path.split("/").pop();
    const { data, error: dbError } = await db.from("visual_evidence_inspections").select("*")
      .eq("id", id).maybeSingle();
    if (dbError) return error("database_error", 500);
    return data ? json(representation(data)) : error("not_found", 404);
  }

  if (req.method === "POST" && path === "/v1/inspections") {
    let input: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return error("validation_failed", 422);
      }
      input = parsed;
    } catch {
      return error("invalid_json", 400);
    }
    if (!validAddress(input.address) || !validAttributes(input.attributes)) {
      return error("validation_failed", 422);
    }
    const address = input.address.trim();
    const attributes = input.attributes;
    const key = req.headers.get("idempotency-key")?.trim() ?? "";
    if (key && (key.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(key))) {
      return error("invalid_idempotency_key", 422);
    }

    const { data: enabled, error: registryError } = await db.from(
      "visual_evidence_attributes",
    )
      .select("slug").eq("enabled", true).in("slug", attributes);
    if (registryError) return error("database_error", 500);
    if (enabled?.length !== attributes.length) {
      return error("attribute_unavailable", 422);
    }

    if (key) {
      const { data: prior, error: lookupError } = await db.from("visual_evidence_inspections")
        .select("*").eq("idempotency_key", key).maybeSingle();
      if (lookupError) return error("database_error", 500);
      if (prior) {
        if (
          prior.address !== address ||
          JSON.stringify(prior.requested_attributes) !==
            JSON.stringify(attributes)
        ) {
          return error("idempotency_conflict", 409);
        }
        return json(representation(prior));
      }
    }
    const { data: created, error: createError } = await db.from("visual_evidence_inspections")
      .insert({
        address,
        requested_attributes: attributes,
        idempotency_key: key || null,
      })
      .select("*").single();
    if (createError || !created) {
      return error(
        createError?.code === "23505"
          ? "idempotency_conflict"
          : "database_error",
        createError?.code === "23505" ? 409 : 500,
      );
    }
    const result = await resolveReference(address);
    const { data: completed, error: completeError } = await db.from(
      "visual_evidence_inspections",
    )
      .update({
        ...result,
        status: result.imagery_status === "provider_error"
          ? "failed"
          : "completed",
        error_code: result.imagery_status === "provider_error"
          ? result.limitations[0]
          : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", created.id).select("*").single();
    if (completeError || !completed) return error("database_error", 500);
    return json(representation(completed), 201);
  }
  return error("not_found", 404);
});


