export interface FilterState {
  scoreThreshold: number;
  pipelineStatus: string; // "" = all
  auditAvailability: "all" | "available" | "none";
  outreachStatus: string; // "" = all
}

export const DEFAULT_FILTER_STATE: FilterState = {
  scoreThreshold: 0,
  pipelineStatus: "",
  auditAvailability: "all",
  outreachStatus: "",
};

interface FiltersProps {
  state: FilterState;
  onChange: (next: FilterState) => void;
  pipelineStatusOptions: string[];
  outreachStatusOptions: string[];
  maxScore: number;
}

/** Client-side filter bar for the opportunities list. Applies instantly over fetched rows. */
export default function Filters({
  state,
  onChange,
  pipelineStatusOptions,
  outreachStatusOptions,
  maxScore,
}: FiltersProps) {
  const sliderMax = Math.max(1, Math.ceil(maxScore));

  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-graphite-800 bg-graphite-900/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label htmlFor="score-threshold" className="mb-1.5 block text-xs font-medium text-graphite-400">
          Min. opportunity score
        </label>
        <div className="flex items-center gap-2">
          <input
            aria-label="Minimum opportunity score"
            type="range"
            min={0}
            max={sliderMax}
            step={1}
            value={state.scoreThreshold}
            onChange={(e) =>
              onChange({ ...state, scoreThreshold: Number(e.target.value) })
            }
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-graphite-800 accent-accent-500"
          />
          <input
            id="score-threshold"
            type="number"
            min={0}
            value={state.scoreThreshold}
            onChange={(e) =>
              onChange({ ...state, scoreThreshold: Number(e.target.value) || 0 })
            }
            className="w-16 rounded border border-graphite-700 bg-graphite-950 px-1.5 py-1 text-right text-xs text-graphite-200 focus:border-accent-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="pipeline-filter" className="mb-1.5 block text-xs font-medium text-graphite-400">
          Pipeline status
        </label>
        <select
          id="pipeline-filter"
          value={state.pipelineStatus}
          onChange={(e) => onChange({ ...state, pipelineStatus: e.target.value })}
          className={`w-full rounded border border-graphite-700 bg-graphite-950 px-2 py-1.5 text-sm text-graphite-200 focus:border-accent-500 focus:outline-none ${state.pipelineStatus !== "" ? "oe-filter-active" : ""}`}
        >
          <option value="">All statuses</option>
          {pipelineStatusOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="audit-filter" className="mb-1.5 block text-xs font-medium text-graphite-400">
          Audit available
        </label>
        <select
          id="audit-filter"
          value={state.auditAvailability}
          onChange={(e) =>
            onChange({
              ...state,
              auditAvailability: e.target.value as FilterState["auditAvailability"],
            })
          }
          className={`w-full rounded border border-graphite-700 bg-graphite-950 px-2 py-1.5 text-sm text-graphite-200 focus:border-accent-500 focus:outline-none ${state.auditAvailability !== "all" ? "oe-filter-active" : ""}`}
        >
          <option value="all">All</option>
          <option value="available">Available</option>
          <option value="none">None</option>
        </select>
      </div>

      <div>
        <label htmlFor="outreach-filter" className="mb-1.5 block text-xs font-medium text-graphite-400">
          Outreach status
        </label>
        <select
          id="outreach-filter"
          value={state.outreachStatus}
          onChange={(e) => onChange({ ...state, outreachStatus: e.target.value })}
          className={`w-full rounded border border-graphite-700 bg-graphite-950 px-2 py-1.5 text-sm text-graphite-200 focus:border-accent-500 focus:outline-none ${state.outreachStatus !== "" ? "oe-filter-active" : ""}`}
        >
          <option value="">All</option>
          {outreachStatusOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
