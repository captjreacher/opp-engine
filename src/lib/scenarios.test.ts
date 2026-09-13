import { describe, expect, it } from "vitest";
import {
  scenarioDefaultRadius,
  scenarioDefaultResultLimit,
  type OpportunityScenario,
} from "./scenarios";

const scenario: OpportunityScenario = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "local-digital-presence",
  name: "Local Digital Presence",
  description: null,
  version: 1,
  discovery_config: {
    default_result_limit: 12,
    radius_m: 5000,
  },
  assessment_config: {},
  report_config: {},
  outreach_config: {},
  commercial_config: {},
};

describe("opportunity scenarios", () => {
  it("reads discovery defaults from scenario config", () => {
    expect(scenarioDefaultResultLimit(scenario)).toBe(12);
    expect(scenarioDefaultRadius(scenario)).toBe(5000);
  });

  it("returns null when discovery defaults are absent or invalid", () => {
    const withoutDefaults: OpportunityScenario = {
      ...scenario,
      discovery_config: {
        default_result_limit: "12",
        radius_m: "5000",
      },
    };

    expect(scenarioDefaultResultLimit(withoutDefaults)).toBeNull();
    expect(scenarioDefaultRadius(withoutDefaults)).toBeNull();
  });
});
