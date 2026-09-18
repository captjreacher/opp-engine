import { describe, expect, it } from "vitest";
import {
  EMPTY_LOCATION,
  applyResolvedLocation,
  describeLocation,
  locationHasCoordinates,
  locationIsStructured,
  locationSuggestions,
  mergeLocationSuggestion,
  withFreeTextLocation,
} from "./location";

const helensvilleSuggestion = {
  place_id: "ChIJhelensville",
  label: "Helensville, Auckland, New Zealand",
  primary_text: "Helensville",
  secondary_text: "Auckland, New Zealand",
  types: ["locality", "political"],
};

const resolved = {
  place_id: "ChIJhelensville",
  label: "Helensville, Auckland 0800, New Zealand",
  locality: "Helensville",
  region: "Auckland",
  country: "NZ",
  latitude: -36.6769,
  longitude: 174.4503,
};

describe("location suggestions", () => {
  it("normalizes Google autocomplete suggestions", () => {
    const [suggestion] = locationSuggestions([helensvilleSuggestion]);
    expect(suggestion).toMatchObject({
      place_id: "ChIJhelensville",
      primary_text: "Helensville",
      secondary_text: "Auckland, New Zealand",
    });
  });

  it("drops unusable suggestions and non-array payloads", () => {
    expect(locationSuggestions([{ label: "No place id" }, { place_id: "x" }])).toEqual([]);
    expect(locationSuggestions(undefined)).toEqual([]);
  });
});

describe("location selection", () => {
  it("retains the label and the stable place id when a suggestion is selected", () => {
    const location = mergeLocationSuggestion(EMPTY_LOCATION, locationSuggestions([helensvilleSuggestion])[0]);
    expect(location.label).toBe("Helensville, Auckland, New Zealand");
    expect(location.place_id).toBe("ChIJhelensville");
    expect(locationIsStructured(location)).toBe(true);
    expect(locationHasCoordinates(location)).toBe(false);
  });

  it("clears the place id when the operator edits the text by hand", () => {
    const selected = mergeLocationSuggestion(EMPTY_LOCATION, locationSuggestions([helensvilleSuggestion])[0]);
    const edited = withFreeTextLocation(selected, "Helensville area");
    expect(edited).toMatchObject({ label: "Helensville area", place_id: null, latitude: null });
    expect(locationIsStructured(edited)).toBe(false);
  });

  it("applies coordinates only for the currently selected place id", () => {
    const selected = mergeLocationSuggestion(EMPTY_LOCATION, locationSuggestions([helensvilleSuggestion])[0]);
    const enriched = applyResolvedLocation(selected, resolved);
    expect(enriched).toMatchObject({
      latitude: -36.6769,
      longitude: 174.4503,
      locality: "Helensville",
      region: "Auckland",
      country: "NZ",
    });
    expect(locationHasCoordinates(enriched)).toBe(true);
  });

  it("ignores a stale resolved location for a superseded selection", () => {
    const selected = mergeLocationSuggestion(EMPTY_LOCATION, {
      place_id: "ChIJauckland",
      label: "Auckland, New Zealand",
      primary_text: "Auckland",
      secondary_text: null,
      types: [],
    });
    expect(applyResolvedLocation(selected, resolved)).toEqual(selected);
    expect(applyResolvedLocation(selected, null)).toEqual(selected);
  });

  it("describes whether the location is structured", () => {
    expect(describeLocation(EMPTY_LOCATION)).toBe("No location selected.");
    expect(describeLocation(withFreeTextLocation(EMPTY_LOCATION, "Helensville"))).toBe(
      "Helensville · free text",
    );
    expect(
      describeLocation(mergeLocationSuggestion(EMPTY_LOCATION, locationSuggestions([helensvilleSuggestion])[0])),
    ).toContain("Google place");
  });
});
