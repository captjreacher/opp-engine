// Structured discovery locations.
//
// A location is a human-readable label (what the operator sees and what legacy
// runs stored) plus, when the operator picked a Google suggestion, a stable
// place id and coordinates. Coordinates let a run apply a radius restriction;
// the place id keeps the location identifiable without re-parsing free text.
//
// The Google provider credential is server-side only: the browser receives
// place ids and display labels from the `opportunities` Edge Function.

export interface LocationSuggestion {
  place_id: string;
  label: string;
  primary_text: string | null;
  secondary_text: string | null;
  types: string[];
}

export interface StructuredLocation {
  /** Human-readable label — also the legacy `runs.location` value. */
  label: string;
  /** Google place id, null when the operator typed free text. */
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  locality: string | null;
  region: string | null;
  country: string | null;
}

export const EMPTY_LOCATION: StructuredLocation = {
  label: "",
  place_id: null,
  latitude: null,
  longitude: null,
  locality: null,
  region: null,
  country: null,
};

function toText(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, max) : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function normalizeLocationSuggestion(
  raw: unknown,
): LocationSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const placeId = toText(row.place_id, 300);
  const label = toText(row.label, 200);
  if (!placeId || !label) return null;
  return {
    place_id: placeId,
    label,
    primary_text: toText(row.primary_text, 160),
    secondary_text: toText(row.secondary_text, 160),
    types: Array.isArray(row.types)
      ? row.types.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function locationSuggestions(raw: unknown): LocationSuggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeLocationSuggestion)
    .filter((item): item is LocationSuggestion => item !== null);
}

/** Selecting a suggestion records the label and the stable place id immediately. */
export function mergeLocationSuggestion(
  current: StructuredLocation,
  suggestion: LocationSuggestion,
): StructuredLocation {
  return {
    ...current,
    label: suggestion.label,
    place_id: suggestion.place_id,
    // Coordinates arrive from the details call; never carry them across a change.
    latitude: null,
    longitude: null,
  };
}

/** Operator edited the text by hand → the previous place id no longer applies. */
export function withFreeTextLocation(
  current: StructuredLocation,
  label: string,
): StructuredLocation {
  return {
    ...current,
    label,
    place_id: null,
    latitude: null,
    longitude: null,
    locality: null,
    region: null,
    country: null,
  };
}

/**
 * Applies a resolved location only when it belongs to the currently selected
 * place id, so a slow response can never overwrite a newer selection.
 */
export function applyResolvedLocation(
  current: StructuredLocation,
  resolved: unknown,
): StructuredLocation {
  if (!resolved || typeof resolved !== "object") return current;
  const row = resolved as Record<string, unknown>;
  const placeId = toText(row.place_id, 300);
  if (!placeId || placeId !== current.place_id) return current;
  return {
    ...current,
    label: toText(row.label, 200) ?? current.label,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    locality: toText(row.locality, 120),
    region: toText(row.region, 120),
    country: toText(row.country, 120),
  };
}

/** True when the location carries a provider-stable identifier. */
export function locationIsStructured(location: StructuredLocation): boolean {
  return Boolean(location.place_id);
}

export function locationHasCoordinates(location: StructuredLocation): boolean {
  return location.latitude !== null && location.longitude !== null;
}

/** Short operator-facing summary of what will actually be persisted. */
export function describeLocation(location: StructuredLocation): string {
  if (!location.label) return "No location selected.";
  if (!location.place_id) return `${location.label} · free text`;
  const place = location.locality ?? location.region ?? location.country;
  return place ? `${location.label} · Google place · ${place}` : `${location.label} · Google place`;
}
