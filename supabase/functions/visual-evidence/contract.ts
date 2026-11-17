export function validAddress(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 5 &&
    value.trim().length <= 500;
}

export function validAttributes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 20 && value.every(
    (item) => typeof item === "string" && /^[a-z][a-z0-9_]*$/.test(item),
  ) && new Set(value).size === value.length;
}

export function representation(row: Record<string, unknown>) {
  const attributes = Array.isArray(row.requested_attributes)
    ? row.requested_attributes as string[]
    : [];
  const limitations = Array.isArray(row.limitations)
    ? row.limitations as string[]
    : [];
  return {
    inspection_id: row.id,
    status: row.status,
    address: row.address,
    created_at: row.created_at,
    completed_at: row.completed_at,
    imagery: {
      status: row.imagery_status,
      provider: row.provider,
      provider_reference: row.provider_reference,
      capture_date: row.capture_date,
      capture_date_precision: row.capture_date_precision,
      coordinates: row.latitude == null || row.longitude == null ? null : {
        latitude: row.latitude,
        longitude: row.longitude,
      },
      panorama_coordinates:
        row.panorama_latitude == null || row.panorama_longitude == null
          ? null
          : {
            latitude: row.panorama_latitude,
            longitude: row.panorama_longitude,
          },
      provenance: row.provenance,
    },
    evidence_confidence: null,
    findings: attributes.map((attribute) => ({
      attribute,
      analysable: false,
      indicators: [],
      opportunity_score: null,
      evidence_confidence: null,
      limitations: ["analysis_not_implemented"],
      provenance: {
        imagery_provider: row.provider,
        provider_reference: row.provider_reference,
      },
    })),
    limitations,
    error_code: row.error_code,
  };
}


