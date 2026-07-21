import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const opportunityDetail = readFileSync(resolve("src/routes/OpportunityDetail.tsx"), "utf8");
const guidedWorkflow = readFileSync(resolve("src/components/GuidedWorkflow.tsx"), "utf8");
const executiveSummary = readFileSync(resolve("src/components/ExecutiveSummary.tsx"), "utf8");
const colorMeter = readFileSync(resolve("src/components/ColorMeter.tsx"), "utf8");
const evidencePanel = readFileSync(resolve("src/components/EvidencePanel.tsx"), "utf8");
const eventTimeline = readFileSync(resolve("src/components/EventTimeline.tsx"), "utf8");
const tailwindConfig = readFileSync(resolve("tailwind.config.js"), "utf8");

/**
 * Find every occurrence of an unknown Tailwind responsive-breakpoint prefix
 * used in actual className strings. Tailwind ships with these breakpoints:
 * sm, md, lg, xl, 2xl. A custom one (e.g. `xs:`) must be registered in
 * tailwind.config.js — otherwise it's a silent no-op.
 *
 * State variants (hover, focus, disabled, dark, etc.) are valid Tailwind
 * prefixes and are NOT considered breakpoints, so they're allowed.
 */
function findUnknownBreakpoints(source: string): string[] {
  const validCustomBreakpoints = new Set(["xs"]);
  // Built-in Tailwind responsive breakpoints
  const knownBreakpoints = new Set(["sm", "md", "lg", "xl", "2xl", "3xl"]);
  // Built-in Tailwind state / pseudo-class / dark-mode variants — not breakpoints
  const knownStateVariants = new Set([
    "hover", "focus", "active", "visited", "disabled", "checked",
    "first", "last", "odd", "even", "only",
    "group", "group-hover", "group-focus", "group-active",
    "peer", "peer-hover", "peer-focus", "peer-checked",
    "focus-within", "focus-visible",
    "placeholder", "before", "after", "first-letter", "first-line", "marker", "selection",
    "dark", "motion-safe", "motion-reduce", "print",
    "rtl", "ltr", "open", "indeterminate", "required", "valid", "invalid",
    "supports", "aria-checked", "aria-disabled", "aria-expanded", "aria-hidden", "aria-pressed", "aria-readonly", "aria-required", "aria-selected",
    "data", "has",
  ]);

  // Extract every className="..." string literal so we don't false-positive on
  // TypeScript object property syntax (e.g. `children:`, `label:`).
  const classNameRe = /className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
  const unknown = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = classNameRe.exec(source)) !== null) {
    const classes = (match[1] ?? match[2] ?? match[3] ?? "").split(/\s+/);
    for (const cls of classes) {
      const m = cls.match(/^([a-z0-9_-]+):/);
      if (!m) continue;
      const prefix = m[1];
      if (knownBreakpoints.has(prefix)) continue;
      if (knownStateVariants.has(prefix)) continue;
      if (validCustomBreakpoints.has(prefix)) {
        if (!tailwindConfig.includes(`"${prefix}":`)) unknown.add(prefix);
        continue;
      }
      unknown.add(prefix);
    }
  }
  return Array.from(unknown);
}

describe("Phase 6 visual / responsive fixes", () => {
  it("uses only valid Tailwind breakpoints (no silent no-op `xs:` etc.)", () => {
    const sources = [opportunityDetail, guidedWorkflow, executiveSummary, colorMeter, evidencePanel, eventTimeline];
    const allUnknown: string[] = [];
    for (const src of sources) {
      allUnknown.push(...findUnknownBreakpoints(src));
    }
    expect(allUnknown).toEqual([]);
  });

  it("Business Evidence grid uses sm: not xs:", () => {
    expect(opportunityDetail).not.toMatch(/\bxs:/);
    expect(opportunityDetail).toMatch(/grid grid-cols-1 gap-1\.5 sm:grid-cols-2/);
  });

  it("ExecutiveSummary severity badge no longer emits the invalid `bg-/15` class", () => {
    expect(executiveSummary).not.toMatch(/bg-\/15/);
    expect(executiveSummary).not.toMatch(/\.replace\("bg-", "bg-\/15/);
  });

  it("ExecutiveSummary severity badge uses a clean lookup map (no string-replace math)", () => {
    expect(executiveSummary).toMatch(/badge:\s*"bg-rose-500\/15 text-rose-300/);
    expect(executiveSummary).toMatch(/badge:\s*"bg-amber-500\/15 text-amber-300/);
    expect(executiveSummary).toMatch(/badge:\s*"bg-emerald-500\/15 text-emerald-300/);
    expect(executiveSummary).toMatch(/\{\s*sev\.badge\s*\}/);
  });

  it("DetailRow wraps long values on mobile and stacks label above value", () => {
    expect(opportunityDetail).toMatch(/break-words sm:truncate/);
    expect(opportunityDetail).toMatch(/grid-cols-1 gap-x-3 gap-y-0\.5/);
    expect(opportunityDetail).toMatch(/sm:grid-cols-\[5rem_1fr\]/);
  });

  it("Contact summary header allows wrap on long subjects", () => {
    expect(opportunityDetail).toMatch(/text-xs text-slate-200 break-words"\s+title=\{info\.value\}/);
  });

  it("ColorMeter legend row uses flex-wrap so it never collides with the percentage", () => {
    expect(colorMeter).toMatch(/flex-wrap/);
    expect(colorMeter).toMatch(/justify-between/);
    expect(colorMeter).toMatch(/gap-x-3/);
    expect(colorMeter).toMatch(/gap-y-1/);
  });

  it("GuidedWorkflow actionable step is marked with aria-current=step", () => {
    expect(guidedWorkflow).toMatch(/aria-current=\{step\.isCurrent && step\.actionable \? "step" : undefined\}/);
  });

  it("GuidedWorkflow uses role=group with a meaningful aria-label that mentions workflow", () => {
    expect(guidedWorkflow).toMatch(/role="group"/);
    const labelMatch = guidedWorkflow.match(/aria-label="([^"]+)"/);
    expect(labelMatch).not.toBeNull();
    expect(labelMatch?.[1]?.toLowerCase()).toContain("workflow");
  });

  it("GuidedWorkflow step buttons meet a minimum touch target on mobile", () => {
    expect(guidedWorkflow).toMatch(/min-h-\[2\.25rem\]/);
    expect(guidedWorkflow).toMatch(/py-2/);
  });

  it("GuidedWorkflow connector is narrower on mobile so 9 steps fit better", () => {
    expect(guidedWorkflow).toMatch(/mx-1 h-px w-4 sm:w-8 transition-colors duration-300/);
  });

  it("GuidedWorkflow actionable step uses stronger ring + glow to be obvious", () => {
    expect(guidedWorkflow).toMatch(/ring-2 ring-accent-400\/70/);
    expect(guidedWorkflow).toMatch(/ring-offset-1 ring-offset-slate-900/);
    expect(guidedWorkflow).toMatch(/shadow-\[0_0_8px_-1px_rgba\(72,182,255,0\.45\)\]/);
  });

  it("tailwind config does not define a custom xs breakpoint (so xs: stays a no-op)", () => {
    expect(tailwindConfig).not.toMatch(/xs:\s*["']?\d+/);
  });
});

describe("Workflow state correctness", () => {
  it("GuidedWorkflow never lets future steps be actionable", () => {
    expect(guidedWorkflow).toMatch(/isDisabled:\s*terminalState !== "active" \|\| isFuture \|\| isComplete/);
  });

  it("GuidedWorkflow actionable flag is restricted to active state on the current incomplete step", () => {
    // Actionable requires the workflow to be active (non-terminal) AND the step
    // is current AND incomplete.
    expect(guidedWorkflow).toMatch(/if \(terminalState === "active" && isCurrent && !isComplete\)/);
    expect(guidedWorkflow).toMatch(/actionable = true/);
  });
});

describe("Workflow closed vs converted terminal-state distinction", () => {
  // ─── GuidedWorkflow ──────────────────────────────────────────────────────────
  it("GuidedWorkflow derives isClosed and isConverted as separate flags (not collapsed)", () => {
    // Both flags must be derived independently — collapsing `closed` into
    // `converted` was the bug we're fixing.
    expect(guidedWorkflow).toMatch(/const isClosed = outcomeState === "closed"/);
    expect(guidedWorkflow).toMatch(/const isConverted = outcomeState === "converted"/);
    // The old broken aggregation must NOT exist in any form.
    expect(guidedWorkflow).not.toMatch(/converted\s*=\s*outcomeState\s*===\s*"converted"\s*\|\|\s*isClosed/);
    expect(guidedWorkflow).not.toMatch(/converted\s*\|\|\s*isClosed/);
  });

  it("GuidedWorkflow exposes a WorkflowTerminalState return field", () => {
    // Type alias defining the union "active" | "converted" | "closed".
    expect(guidedWorkflow).toMatch(/export type WorkflowTerminalState\s*=\s*"active"\s*\|\s*"converted"\s*\|\s*"closed"/);
    // The return type uses the alias.
    expect(guidedWorkflow).toMatch(/terminalState:\s*WorkflowTerminalState/);
    // And the derive function actually emits the field.
    expect(guidedWorkflow).toMatch(/return \{ steps, currentIndex, terminalState \}/);
  });

  it("GuidedWorkflow completes[8] depends ONLY on isConverted, not isClosed", () => {
    // The Converted step's completeness must be driven by isConverted alone.
    // Otherwise a closed opportunity would falsely appear as a successful conversion.
    expect(guidedWorkflow).toMatch(/isConverted,\s*\/\/\s*converted\b/);
    // And the OR-with-isClosed pattern must not appear at slot 8 (the Converted step).
    expect(guidedWorkflow).not.toMatch(/converted\s*\|\|\s*isClosed,\s*\/\/\s*converted\b/);
  });

  it("GuidedWorkflow closes with currentIndex clamped to the last step in a terminal state", () => {
    expect(guidedWorkflow).toMatch(/const currentIndex = terminalState !== "active"\s*\?\s*lastIndex/);
  });

  it("GuidedWorkflow WorkflowStep interface declares an optional closedTerminal flag", () => {
    expect(guidedWorkflow).toMatch(/closedTerminal\?: boolean/);
  });

  it("GuidedWorkflow sets closedTerminal on the Converted step ONLY when terminal is closed", () => {
    expect(guidedWorkflow).toMatch(/const closedTerminal = def\.id === "converted" && terminalState === "closed"/);
  });

  it("GuidedWorkflow relabels the converted step to \"Closed Lost\" when terminal is closed", () => {
    expect(guidedWorkflow).toMatch(/label:\s*closedTerminal\s*\?\s*"Closed Lost"\s*:\s*def\.label/);
  });

  it("GuidedWorkflow renders the closed-terminal step with slate/neutral styling (no emerald)", () => {
    // The JSX branches FIRST on step.closedTerminal, using muted slate styling
    // instead of the emerald success treatment used by isComplete.
    expect(guidedWorkflow).toMatch(/step\.closedTerminal\s*\?\s*"bg-slate-800\/60 text-slate-300 ring-slate-600\/60"/);
    // The dot uses slate too.
    expect(guidedWorkflow).toMatch(/step\.closedTerminal\s*\?\s*"bg-slate-600 text-slate-300"/);
  });

  it("GuidedWorkflow connector leading into a closed-terminal step is muted, not emerald", () => {
    // The connector colour helper branches on the *next* step's closedTerminal,
    // not just on a blanket emerald rule.
    expect(guidedWorkflow).toMatch(/if \(next\.closedTerminal\)/);
  });

  // ─── EventTimeline ──────────────────────────────────────────────────────────
  it("EventTimeline derives isClosed and isConverted as separate flags", () => {
    expect(eventTimeline).toMatch(/const isClosed = outcomeState === "closed"/);
    expect(eventTimeline).toMatch(/const isConverted = outcomeState === "converted"/);
    // The old collapsed form must not exist.
    expect(eventTimeline).not.toMatch(/if \(outcomeState === "closed"\)\s*\{\s*progress\s*=\s*9;\s*\}\s*else if \(outcomeState === "converted"\)/);
  });

  it("EventTimeline TimelineMilestone has an optional closedTerminal flag", () => {
    expect(eventTimeline).toMatch(/closedTerminal\?: boolean/);
  });

  it("EventTimeline sets closedTerminal on the converted milestone ONLY when state is closed", () => {
    expect(eventTimeline).toMatch(/if \(i === 8\)[\s\S]{0,200}closedTerminal = true/);
  });

  it("EventTimeline relabels the converted milestone to \"Opportunity closed\" in closed state", () => {
    expect(eventTimeline).toMatch(/label:\s*closedTerminal\s*\?\s*"Opportunity closed"\s*:\s*m\.label/);
  });

  it("EventTimeline renders the closed-terminal milestone with slate (not emerald) styling", () => {
    // The bgColor for closed-terminal uses slate, not emerald.
    expect(eventTimeline).toMatch(/m\.closedTerminal\s*\?\s*"bg-slate-700\/60 ring-slate-600\/50"/);
    // The text colour for closed-terminal is slate, not emerald.
    expect(eventTimeline).toMatch(/m\.closedTerminal\s*\?\s*"text-slate-300"/);
  });

  it("EventTimeline closed branch marks milestones 0-7 complete and milestone 8 as current", () => {
    // The closed branch is separate from the normal progress branch.
    expect(eventTimeline).toMatch(/if \(isClosed\)/);
    expect(eventTimeline).toMatch(/if \(i < 8\)\s*complete\s*=\s*true/);
    expect(eventTimeline).toMatch(/if \(i === 8\)[\s\S]{0,200}current = true/);
  });
});
