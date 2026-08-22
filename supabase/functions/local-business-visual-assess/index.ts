import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type VisualAssessRequest = {
  candidate_id?: string;
  lead_id?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  source?: "google_street_view";
};

type ResolvedSubject = {
  candidateId: string | null;
  leadId: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function resolveSubject(
  supabase: ReturnType<typeof createClient>,
  input: VisualAssessRequest,
): Promise<ResolvedSubject> {
  const explicitLat = asNumber(input.latitude);
  const explicitLng = asNumber(input.longitude);

  if (input.candidate_id) {
    const { data, error } = await supabase
      .from("opportunity_discovery_candidates")
      .select(
        "id, imported_lead_id, address, location, source_payload",
      )
      .eq("id", input.candidate_id)
      .single();

    if (error || !data) {
      throw new Error(
        `candidate_not_found: ${error?.message ?? input.candidate_id}`,
      );
    }

    const sourcePayload =
      data.source_payload && typeof data.source_payload === "object"
        ? data.source_payload as Record<string, unknown>
        : {};

    const geometry =
      sourcePayload.geometry && typeof sourcePayload.geometry === "object"
        ? sourcePayload.geometry as Record<string, unknown>
        : {};

    const location =
      geometry.location && typeof geometry.location === "object"
        ? geometry.location as Record<string, unknown>
        : {};

    return {
      candidateId: data.id,
      leadId: input.lead_id ?? data.imported_lead_id ?? null,
      address: input.address ?? data.address ?? data.location ?? null,
      latitude: explicitLat ?? asNumber(location.lat),
      longitude: explicitLng ?? asNumber(location.lng),
    };
  }

  if (input.lead_id) {
    const { data, error } = await supabase
      .from("local_business_leads")
      .select("id, address, suburb, region")
      .eq("id", input.lead_id)
      .single();

    if (error || !data) {
      throw new Error(
        `lead_not_found: ${error?.message ?? input.lead_id}`,
      );
    }

    return {
      candidateId: null,
      leadId: data.id,
      address:
        input.address ??
        data.address ??
        [data.suburb, data.region].filter(Boolean).join(", ") ??
        null,
      latitude: explicitLat,
      longitude: explicitLng,
    };
  }

  if (explicitLat !== null && explicitLng !== null) {
    return {
      candidateId: null,
      leadId: null,
      address: input.address ?? null,
      latitude: explicitLat,
      longitude: explicitLng,
    };
  }

  throw new Error(
    "candidate_id, lead_id, or explicit latitude/longitude is required",
  );
}

async function resolveCoordinatesFromPlaces(
  address: string,
  googleApiKey: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleApiKey,
        "X-Goog-FieldMask": "places.location,places.formattedAddress",
      },
      body: JSON.stringify({
        textQuery: address,
        maxResultCount: 1,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `google_places_http_${response.status}: ${detail}`,
    );
  }

  const payload = await response.json();

  const place = Array.isArray(payload.places)
    ? payload.places[0]
    : null;

  const latitude = asNumber(place?.location?.latitude);
  const longitude = asNumber(place?.location?.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}
async function getStreetViewMetadata(
  latitude: number,
  longitude: number,
  googleApiKey: string,
) {
  const url = new URL(
    "https://maps.googleapis.com/maps/api/streetview/metadata",
  );

  url.searchParams.set("location", `${latitude},${longitude}`);
  url.searchParams.set("key", googleApiKey);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `street_view_metadata_http_${response.status}`,
    );
  }

  const payload = await response.json();

  if (payload.status === "ZERO_RESULTS") {
    return {
      available: false,
      status: payload.status,
      raw: payload,
    };
  }

  if (payload.status !== "OK") {
    throw new Error(
      `street_view_metadata_failed: ${payload.status ?? "unknown_status"}`,
    );
  }

  return {
    available: true,
    status: payload.status,
    panoId:
      typeof payload.pano_id === "string"
        ? payload.pano_id
        : null,
    captureDate:
      typeof payload.date === "string"
        ? payload.date
        : null,
    latitude: asNumber(payload.location?.lat),
    longitude: asNumber(payload.location?.lng),
    raw: payload,
  };
}

function normaliseCaptureDate(
  value: string | null,
): {
  capturedAt: string | null;
  precision: "month" | "year" | "unknown";
} {
  if (!value) {
    return {
      capturedAt: null,
      precision: "unknown",
    };
  }

  if (/^\d{4}-\d{2}$/.test(value)) {
    return {
      capturedAt: `${value}-01T00:00:00.000Z`,
      precision: "month",
    };
  }

  if (/^\d{4}$/.test(value)) {
    return {
      capturedAt: `${value}-01-01T00:00:00.000Z`,
      precision: "year",
    };
  }

  return {
    capturedAt: null,
    precision: "unknown",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const googleApiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");

    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL is not configured");
    }

    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    }

    if (!googleApiKey) {
      throw new Error("GOOGLE_PLACES_API_KEY is not configured");
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const input = await req.json() as VisualAssessRequest;

    if (
      input.source &&
      input.source !== "google_street_view"
    ) {
      return json(
        { error: "unsupported_source" },
        400,
      );
    }

    const subject = await resolveSubject(
      supabase,
      input,
    );

    let latitude = subject.latitude;
    let longitude = subject.longitude;

    if (
      (latitude === null || longitude === null) &&
      subject.address
    ) {
      const geocoded = await resolveCoordinatesFromPlaces(
        subject.address,
        googleApiKey,
      );

      if (geocoded) {
        latitude = geocoded.latitude;
        longitude = geocoded.longitude;
      }
    }

    if (latitude === null || longitude === null) {
      if (subject.candidateId) {
        await supabase
          .from("opportunity_discovery_candidates")
          .update({
            visual_status: "no_evidence",
          })
          .eq("id", subject.candidateId);
      }

      return json({
        ok: true,
        panorama_available: false,
        reason: "coordinates_unavailable",
      });
    }

    if (subject.candidateId) {
      await supabase
        .from("opportunity_discovery_candidates")
        .update({
          visual_status: "discovering",
        })
        .eq("id", subject.candidateId);
    }

    const streetView = await getStreetViewMetadata(
      latitude,
      longitude,
      googleApiKey,
    );

    if (!streetView.available) {
      const { data: evidence, error: evidenceError } =
        await supabase
          .from("local_business_visual_evidence")
          .insert({
            candidate_id: subject.candidateId,
            lead_id: subject.leadId,
            source: "google_street_view",
            media_type: "panorama",
            latitude,
            longitude,
            analysis_allowed: false,
            storage_mode: "reference_only",
            status: "unavailable",
            metadata: {
              provider_status: streetView.status,
              address: subject.address,
            },
          })
          .select("id")
          .single();

      if (evidenceError) {
        throw new Error(
          `visual_evidence_insert_failed: ${evidenceError.message}`,
        );
      }

      if (subject.candidateId) {
        await supabase
          .from("opportunity_discovery_candidates")
          .update({
            visual_status: "no_evidence",
          })
          .eq("id", subject.candidateId);
      }

      return json({
        ok: true,
        evidence_id: evidence.id,
        source: "google_street_view",
        panorama_available: false,
      });
    }

    const capture = normaliseCaptureDate(
      streetView.captureDate,
    );

    const { data: evidence, error: evidenceError } =
      await supabase
        .from("local_business_visual_evidence")
        .insert({
          candidate_id: subject.candidateId,
          lead_id: subject.leadId,
          source: "google_street_view",
          media_type: "panorama",
          provider_reference: streetView.panoId,
          latitude:
            streetView.latitude ?? latitude,
          longitude:
            streetView.longitude ?? longitude,
          captured_at: capture.capturedAt,
          capture_date_precision: capture.precision,
          analysis_allowed: false,
          storage_mode: "reference_only",
          status: "available",
          metadata: {
            provider_status: streetView.status,
            provider_capture_date: streetView.captureDate,
            requested_latitude: latitude,
            requested_longitude: longitude,
            address: subject.address,
          },
        })
        .select(
          "id, provider_reference, captured_at, capture_date_precision, latitude, longitude, analysis_allowed, storage_mode",
        )
        .single();

    if (evidenceError || !evidence) {
      throw new Error(
        `visual_evidence_insert_failed: ${
          evidenceError?.message ?? "no inserted row"
        }`,
      );
    }

    if (subject.candidateId) {
      const { error: statusError } = await supabase
        .from("opportunity_discovery_candidates")
        .update({
          visual_status: "evidence_available",
        })
        .eq("id", subject.candidateId);

      if (statusError) {
        throw new Error(
          `visual_status_update_failed: ${statusError.message}`,
        );
      }
    }

    return json({
      ok: true,
      evidence_id: evidence.id,
      source: "google_street_view",
      panorama_available: true,
      provider_reference: evidence.provider_reference,
      captured_at: evidence.captured_at,
      capture_date_precision:
        evidence.capture_date_precision,
      latitude: evidence.latitude,
      longitude: evidence.longitude,
      analysis_allowed: evidence.analysis_allowed,
      storage_mode: evidence.storage_mode,
    });
  } catch (error) {
    console.error("local-business-visual-assess failed", error);

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500,
    );
  }
});