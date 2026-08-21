import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const opportunityDetail = readFileSync(
  resolve("src/routes/OpportunityDetail.tsx"),
  "utf8",
);
const guidedWorkflow = readFileSync(
  resolve("src/components/GuidedWorkflow.tsx"),
  "utf8",
);
const executiveSummary = readFileSync(
  resolve("src/components/ExecutiveSummary.tsx"),
  "utf8",
);
const colorMeter = readFileSync(resolve("src/components/ColorMeter.tsx"), "utf8");
const eventTimeline = readFileSync(
  resolve("src/components/EventTimeline.tsx"),
  "utf8",
);
const tailwindConfig = readFileSync(resolve("tailwind.config.js"), "utf8");

describe("Opportunity detail responsive/UI contract", () => {
  it("uses supported responsive breakpoints only", () => {
    expect(tailwindConfig).not.toMatch(/xs:\s*["']?\d+/);
    expect(opportunityDetail).not.toMatch(/\bxs:/);
  });

  it("stacks detail rows cleanly on mobile", () => {
    expect(opportunityDetail).toMatch(/grid-cols-1 gap-x-3 gap-y-0\.5/);
    expect(opportunityDetail).toMatch(/sm:grid-cols-\[5rem_1fr\]/);
  });

  it("allows long contact summary values to wrap", () => {
    expect(opportunityDetail).toMatch(
      /text-xs text-slate-200 break-words"\s+title=\{info\.value\}/,
    );
  });

  it("shows an explicit Not assessed state instead of a fake zero score", () => {
    expect(opportunityDetail).toContain("Not assessed");
    expect(opportunityDetail).toContain(
      "Run enrichment, then trigger analysis when you want this opportunity scored.",
    );
  });

  it("keeps the score legend wrapping safely", () => {
    expect(colorMeter).toContain("flex-wrap");
    expect(colorMeter).toContain("justify-between");
    expect(colorMeter).toContain("gap-x-3");
    expect(colorMeter).toContain("gap-y-1");
  });

  it("uses clean severity badge lookups in ExecutiveSummary", () => {
    expect(executiveSummary).toContain(
      'badge: "bg-rose-500/15 text-rose-300 ring-rose-500/30"',
    );
    expect(executiveSummary).toContain(
      'badge: "bg-amber-500/15 text-amber-300 ring-amber-500/30"',
    );
    expect(executiveSummary).toContain(
      'badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"',
    );
    expect(executiveSummary).not.toMatch(/bg-\/15/);
  });
});

describe("GuidedWorkflow accessibility and terminal-state contract", () => {
  it("marks actionable current steps with aria-current=step", () => {
    expect(guidedWorkflow).toMatch(
      /aria-current=\{\s*step\.isCurrent\s*&&\s*step\.actionable\s*\?\s*"step"\s*:\s*undefined\s*\}/,
    );
  });

  it("uses a group role with a workflow aria-label", () => {
    expect(guidedWorkflow).toContain('role="group"');
    const labelMatch = guidedWorkflow.match(/aria-label="([^"]+)"/);
    expect(labelMatch?.[1]?.toLowerCase()).toContain("workflow");
  });

  it("keeps step buttons within mobile touch-target expectations", () => {
    expect(guidedWorkflow).toContain("min-h-[2.25rem]");
    expect(guidedWorkflow).toContain("py-2");
  });

  it("keeps the 9-step connector compact on mobile", () => {
    expect(guidedWorkflow).toContain("mx-1 h-px w-4 sm:w-8");
  });

  it("separates closed and converted terminal states", () => {
    expect(guidedWorkflow).toContain(
      'export type WorkflowTerminalState = "active" | "converted" | "closed"',
    );
    expect(guidedWorkflow).toContain(
      'const isClosed = outcomeState === "closed"',
    );
    expect(guidedWorkflow).toContain(
      'const isConverted = outcomeState === "converted"',
    );
    expect(guidedWorkflow).not.toMatch(/converted\s*\|\|\s*isClosed/);
  });

  it("drives the converted step from isConverted only", () => {
    expect(guidedWorkflow).toMatch(/isConverted,\s*\/\/\s*converted/i);
  });

  it("clamps terminal currentIndex to the last step", () => {
    expect(guidedWorkflow).toMatch(
      /const currentIndex =\s*terminalState !== "active"\s*\?\s*lastIndex/,
    );
  });

  it("declares and sets the closedTerminal marker only on the converted slot", () => {
    expect(guidedWorkflow).toMatch(/closedTerminal\?: boolean/);
    expect(guidedWorkflow).toContain(
      'const closedTerminal = def.id === "converted" && terminalState === "closed"',
    );
    expect(guidedWorkflow).toMatch(
      /label:\s*closedTerminal\s*\?\s*"Closed Lost"\s*:\s*def\.label/,
    );
  });

  it("renders closed-terminal steps in neutral slate styling", () => {
    expect(guidedWorkflow).toContain(
      '"bg-slate-800/60 text-slate-300 ring-slate-600/60"',
    );
    expect(guidedWorkflow).toContain('"bg-slate-600 text-slate-300"');
    expect(guidedWorkflow).toContain("if (next.closedTerminal)");
  });
});

describe("EventTimeline closed-terminal distinction", () => {
  it("separates closed and converted milestones", () => {
    expect(eventTimeline).toContain('const isClosed = outcomeState === "closed"');
    expect(eventTimeline).toContain(
      'const isConverted = outcomeState === "converted"',
    );
  });

  it("marks the final milestone as a closed terminal only for closed opportunities", () => {
    expect(eventTimeline).toMatch(/closedTerminal\?: boolean/);
    expect(eventTimeline).toMatch(/if \(i === 8\)[\s\S]{0,200}closedTerminal = true/);
    expect(eventTimeline).toMatch(
      /label:\s*closedTerminal\s*\?\s*"Opportunity closed"\s*:\s*m\.label/,
    );
  });

  it("renders closed-terminal milestones with slate styling instead of emerald", () => {
    expect(eventTimeline).toContain('"bg-slate-700/60 ring-slate-600/50"');
    expect(eventTimeline).toContain('"text-slate-300"');
  });
});
