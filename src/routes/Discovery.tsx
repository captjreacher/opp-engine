import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Badge, { toneForStatus } from "../components/Badge";
import {
  acknowledgePossibleMatch,
  assessDiscoveryCandidates,
  auditDiscoveryCandidates,
  fetchDiscoveryCandidates,
  fetchDiscoveryRun,
  fetchLocationDetails,
  fetchDiscoverySettings,
  fetchLocationSuggestions,
  fetchOpportunityCategories,
  importDiscoveryCandidates,
  startDiscoveryRun,
} from "../lib/api";
import {
  DISCOVERY_SETTINGS_FALLBACK,
  metresToKilometres,
  normalizeDiscoverySettings,
  type DiscoverySettings,
} from "../lib/admin";
import {
  activeCategories,
  categoryDefaultRadius,
  categorySupportsScenario,
  findCategoryBySlug,
  type OpportunityCategory,
} from "../lib/categories";
import {
  candidateEligibilityClassification,
  candidateEligibilityDisplay,
  candidateMayProceed,
  candidateNeedsEligibilityAcknowledgement,
  isActiveDiscoveryStatus,
  validateDiscoveryInput,
} from "../lib/discovery";
import {
  EMPTY_LOCATION,
  applyResolvedLocation,
  locationSuggestions,
  mergeLocationSuggestion,
  withFreeTextLocation,
  type LocationSuggestion,
  type StructuredLocation,
} from "../lib/location";
import {
  fetchOpportunityScenarios,
  scenarioDefaultRadius,
  scenarioDefaultResultLimit,
  type OpportunityScenario,
} from "../lib/scenarios";
import type { DiscoveryCandidate, DiscoveryRun, DiscoverySearchInput } from "../lib/types";

const initialForm: DiscoverySearchInput = {
  location: "",
  industry: "",
  keywords: "",
  radius_m: null,
  result_limit: 10,
  location_place_id: null,
  location_latitude: null,
  location_longitude: null,
  category_slug: null,
  category_label: null,
};

const fieldClass = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent-500";
const buttonClass = "rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40";

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Radius precedence, mirroring the backend: scenario default, then category
 * default, then the discovery-wide setting. All values stay in metres.
 */
function defaultRadius(
  scenario: OpportunityScenario | null,
  category: OpportunityCategory | null,
  settings: DiscoverySettings,
): number | null {
  return (
    (scenario ? scenarioDefaultRadius(scenario) : null) ??
    categoryDefaultRadius(category) ??
    settings.default_radius_m
  );
}

/**
 * Location field backed by Google Places autocomplete (proxied by the API, so the
 * provider credential never reaches the browser). Selecting a suggestion records
 * the human-readable label plus the stable place id.
 */
function LocationField({
  value,
  error,
  onSelect,
  onChange,
}: {
  value: StructuredLocation;
  error?: string;
  onSelect: (suggestion: LocationSuggestion) => void;
  onChange: (label: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const query = value.label.trim();
    // A selected suggestion is already structured; don't suggest over it again.
    if (query.length < 3 || value.place_id) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void fetchLocationSuggestions(query)
        .then((response) => {
          if (requestId.current !== id) return;
          setSuggestions(locationSuggestions(response.suggestions));
          setOpen(true);
        })
        .catch(() => {
          if (requestId.current === id) setSuggestions([]);
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value.label, value.place_id]);

  const searching = loading;

  return (
    <div className="text-sm text-slate-300">
      <label>Location *
        <input
          className={fieldClass}
          value={value.label}
          autoComplete="off"
          placeholder="Start typing a suburb or city"
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => { if (suggestions.length) setOpen(true); }}
        />
      </label>
      {searching && <span className="mt-1 block text-xs text-slate-500">Searching Google locations…</span>}
      {open && suggestions.length > 0 && (
        <ul role="listbox" aria-label="Location suggestions" className="mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-700 bg-slate-950 shadow-lg">
          {suggestions.map((suggestion) => (
            <li key={suggestion.place_id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full px-3 py-2 text-left hover:bg-slate-800"
                onClick={() => { setOpen(false); onSelect(suggestion); }}
              >
                <span className="block text-sm text-slate-200">{suggestion.primary_text ?? suggestion.label}</span>
                {suggestion.secondary_text && <span className="block text-xs text-slate-500">{suggestion.secondary_text}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.place_id
        ? <span className="mt-1 block text-xs text-emerald-400">Google location retained · place id {value.place_id.slice(0, 14)}…</span>
        : <span className="mt-1 block text-xs text-slate-500">Pick a Google suggestion to retain a stable place id.</span>}
      {error && <span className="mt-1 block text-xs text-rose-400">{error}</span>}
    </div>
  );
}

function statusTone(status: string) {
  if (["completed", "enriched", "scored", "audited", "imported"].includes(status)) return "success" as const;
  if (["failed", "partially_completed", "incomplete"].includes(status)) return "danger" as const;
  if (["queued", "discovering", "enriching", "scoring", "auditing"].includes(status)) return "info" as const;
  if (["existing", "duplicate"].includes(status)) return "warning" as const;
  return toneForStatus(status);
}

function CandidateDrawer({
  candidate,
  onClose,
  onAcknowledge,
  onContinue,
  acknowledging,
  continuing,
}: {
  candidate: DiscoveryCandidate;
  onClose: () => void;
  onAcknowledge: (candidateId: string) => void;
  onContinue: (candidateId: string) => void;
  acknowledging: boolean;
  continuing: boolean;
}) {
  const evidence = candidate.source_payload;
  const eligibility = candidateEligibilityDisplay(candidate);
  const [reviewed, setReviewed] = useState(false);
  const matched = candidate.eligibility_result ?? {};
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/70" role="dialog" aria-modal="true" aria-label="Candidate detail">
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-wider text-accent-400">Candidate</p><h2 className="mt-1 text-xl font-semibold text-white">{candidate.business_name}</h2></div>
          <button className={buttonClass} onClick={onClose}>Close</button>
        </div>

        {eligibility.needsAcknowledgement && (
          <section className="mt-6 rounded-md border border-amber-700 bg-amber-950/30 p-4" role="alert" aria-label="Possible existing Cockpit record">
            <h3 className="text-sm font-semibold text-amber-200">Possible existing Cockpit record</h3>
            <p className="mt-2 text-sm text-amber-100/90">This business matches an existing Cockpit contact, but there is not enough identity evidence to confirm it is the same prospect.</p>
            <p className="mt-2 text-sm text-amber-100/90">Continuing may create duplicate outreach to an existing relationship.</p>
            <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-amber-300/80">Matched contact id</dt><dd className="font-mono text-amber-100">{matched.contact_id ?? "—"}</dd>
              <dt className="text-amber-300/80">Matched organisation id</dt><dd className="font-mono text-amber-100">{matched.organisation_id ?? "—"}</dd>
              <dt className="text-amber-300/80">Match type</dt><dd className="text-amber-100">{matched.match_type ?? "—"}</dd>
              <dt className="text-amber-300/80">Confidence</dt><dd className="text-amber-100">{matched.confidence ?? "—"}</dd>
              <dt className="text-amber-300/80">Reason</dt><dd className="text-amber-100">{matched.reason ?? "—"}</dd>
            </dl>
            <label className="mt-4 flex items-start gap-3 text-sm text-amber-100">
              <input type="checkbox" className="mt-0.5" checked={reviewed} disabled={acknowledging} onChange={(event) => setReviewed(event.target.checked)} />
              <span>I have reviewed this possible match and want to continue.</span>
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button className={buttonClass} disabled={!reviewed || acknowledging} onClick={() => onAcknowledge(candidate.id)}>
                {acknowledging ? "Persisting acknowledgement…" : "Acknowledge possible match"}
              </button>
              <span className="text-xs text-amber-300/80">Continue / Import stays disabled until the acknowledgement is persisted on the server.</span>
            </div>
          </section>
        )}

        {eligibility.acknowledged && (
          <section className="mt-6 rounded-md border border-amber-800/70 bg-amber-950/20 p-4" aria-label="Acknowledged exception">
            <p className="text-sm font-medium text-amber-200">Proceeding under an acknowledged possible-match exception</p>
            <p className="mt-1 text-sm text-amber-100/80">
              Cockpit classification remains <span className="font-mono">possible_match</span>
              {candidate.eligibility_acknowledged_by ? ` · acknowledged by ${candidate.eligibility_acknowledged_by}` : ""}
              {candidate.eligibility_acknowledged_at ? ` · ${new Date(candidate.eligibility_acknowledged_at).toLocaleString()}` : ""}.
            </p>
          </section>
        )}

        {!eligibility.mayProceed && !eligibility.needsAcknowledgement && (
          <section className="mt-6 rounded-md border border-rose-800 bg-rose-950/40 p-4" role="alert">
            <p className="text-sm font-medium text-rose-200">Blocked by Cockpit commercial eligibility</p>
            <p className="mt-1 text-sm text-rose-300/90">Classification <span className="font-mono">{eligibility.label}</span> cannot be overridden. {matched.reason ?? ""}</p>
          </section>
        )}

        <div className="mt-6 flex items-center gap-2">
          <button className={buttonClass} disabled={!eligibility.mayProceed || continuing} onClick={() => onContinue(candidate.id)}>
            {continuing ? "Importing…" : "Continue / Import"}
          </button>
          {!eligibility.mayProceed && <span className="text-xs text-slate-500">Unavailable until this candidate may proceed.</span>}
        </div>

        <dl className="mt-6 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-slate-500">Address</dt><dd className="text-slate-200">{candidate.address ?? candidate.location ?? "—"}</dd>
          <dt className="text-slate-500">Category</dt><dd className="text-slate-200">{candidate.industry ?? "—"}</dd>
          <dt className="text-slate-500">Website</dt><dd>{candidate.website_url ? <a className="text-accent-400 hover:underline" href={candidate.website_url} target="_blank" rel="noreferrer">{candidate.website_url}</a> : "—"}</dd>
          <dt className="text-slate-500">Phone</dt><dd className="text-slate-200">{candidate.phone ?? "—"}</dd>
          <dt className="text-slate-500">Email</dt><dd className="text-slate-200">{candidate.email ?? "—"}</dd>
          <dt className="text-slate-500">Source</dt><dd className="text-slate-200">{candidate.source} · {candidate.source_identifier}</dd>
          <dt className="text-slate-500">Duplicate</dt><dd>{candidate.duplicate_lead_id ? <Link className="text-amber-300 hover:underline" to={`/opportunities/${candidate.duplicate_lead_id}`}>Existing opportunity</Link> : "No match"}</dd>
          <dt className="text-slate-500">Assessment</dt><dd><Badge tone={statusTone(candidate.assessment_status)}>{candidate.assessment_status}</Badge>{candidate.preliminary_score ? ` · ${candidate.preliminary_score}` : ""}</dd>
          <dt className="text-slate-500">Audit</dt><dd><Badge tone={statusTone(candidate.audit_status)}>{candidate.audit_status}</Badge></dd>
        </dl>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Provider evidence</h3><pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(evidence, null, 2)}</pre></section>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Enrichment evidence</h3><pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(candidate.enrichment_evidence, null, 2)}</pre></section>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Preliminary signals</h3><pre className="mt-2 max-h-48 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(candidate.preliminary_signals, null, 2)}</pre></section>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Errors</h3><pre className="mt-2 rounded-md bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(candidate.error_info, null, 2)}</pre></section>
        <section className="mt-7"><h3 className="text-sm font-semibold text-slate-200">Event history</h3>{candidate.events.length ? <ol className="mt-3 space-y-3">{candidate.events.map((event) => <li key={event.id} className="border-l border-slate-700 pl-3 text-sm"><p className="text-slate-200">{event.event_type}</p><p className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()} · {event.status}</p></li>)}</ol> : <p className="mt-2 text-sm text-slate-500">No candidate events yet.</p>}</section>
      </div>
    </div>
  );
}

export default function Discovery() {
  const [form, setForm] = useState<DiscoverySearchInput>(initialForm);
  const [structuredLocation, setStructuredLocation] = useState<StructuredLocation>(EMPTY_LOCATION);
  const [radiusTouched, setRadiusTouched] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof validateDiscoveryInput>>({});
  const [run, setRun] = useState<DiscoveryRun | null>(null);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState<DiscoveryCandidate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<OpportunityScenario[]>([]);
  const [scenarioLoading, setScenarioLoading] = useState(true);
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [categories, setCategories] = useState<OpportunityCategory[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [settings, setSettings] = useState<DiscoverySettings>({
    ...DISCOVERY_SETTINGS_FALLBACK,
  });

  // The operator-configured radius choices, plus whatever value is currently in
  // play so a scenario/category default outside the list still displays.
  const radiusOptions = useMemo(() => {
    const configured = settings.radius_options_m.length
      ? settings.radius_options_m
      : DISCOVERY_SETTINGS_FALLBACK.radius_options_m;
    const current = form.radius_m;
    if (current && !configured.includes(current)) {
      return [...configured, current].sort((a, b) => a - b);
    }
    return configured;
  }, [settings.radius_options_m, form.radius_m]);

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null,
    [scenarios, selectedScenarioId],
  );
  const selectedCategory = useMemo(
    () => findCategoryBySlug(categories, form.category_slug),
    [categories, form.category_slug],
  );
  const categoryIncompatible = Boolean(
    selectedCategory &&
      selectedScenario &&
      !categorySupportsScenario(selectedCategory, selectedScenario.slug),
  );

  const reload = useCallback(async (runId: string) => {
    const [runResponse, candidateResponse] = await Promise.all([fetchDiscoveryRun(runId), fetchDiscoveryCandidates(runId)]);
    setRun(runResponse.run);
    setCandidates(candidateResponse.candidates);
    setInspecting((current) => current ? candidateResponse.candidates.find((item) => item.id === current.id) ?? null : null);
  }, []);

  // Scenarios and discovery settings bootstrap the form together: the scenario
  // supplies its own default result limit, the setting supplies the fallback.
  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchOpportunityScenarios(),
      fetchDiscoverySettings().catch(() => null),
    ])
      .then(([items, settingsResponse]) => {
        if (!active) return;
        const nextSettings = settingsResponse
          ? normalizeDiscoverySettings(settingsResponse.settings)
          : { ...DISCOVERY_SETTINGS_FALLBACK };
        setSettings(nextSettings);
        setScenarios(items);
        const first = items[0];
        if (first) {
          setSelectedScenarioId(first.id);
          setForm((current) => ({
            ...current,
            result_limit:
              scenarioDefaultResultLimit(first) ?? nextSettings.default_result_limit,
          }));
        } else {
          setForm((current) => ({
            ...current,
            result_limit: nextSettings.default_result_limit,
          }));
        }
      })
      .catch((reason) => {
        if (active) setError(`Unable to load opportunity scenarios: ${displayError(reason)}`);
      })
      .finally(() => {
        if (active) setScenarioLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchOpportunityCategories()
      .then((response) => {
        if (active) setCategories(activeCategories(response.categories));
      })
      .catch((reason) => {
        if (active) setError(`Unable to load discovery categories: ${displayError(reason)}`);
      })
      .finally(() => {
        if (active) setCategoryLoading(false);
      });
    return () => { active = false; };
  }, []);

  // Radius follows the scenario, falling back to the category default, until the
  // operator edits it by hand.
  useEffect(() => {
    if (radiusTouched) return;
    const next = defaultRadius(selectedScenario, selectedCategory, settings);
    if (next === null) return;
    setForm((current) => (current.radius_m === next ? current : { ...current, radius_m: next }));
  }, [radiusTouched, selectedCategory, selectedScenario, settings]);

  useEffect(() => {
    const latestRunId = window.sessionStorage.getItem("opp-engine:last-discovery-run");
    if (latestRunId) void reload(latestRunId).catch(() => window.sessionStorage.removeItem("opp-engine:last-discovery-run"));
  }, [reload]);

  useEffect(() => {
    if (!run || !isActiveDiscoveryStatus(run.status)) return;
    const timer = window.setInterval(() => void reload(run.id).catch((reason) => setError(displayError(reason))), 2500);
    return () => window.clearInterval(timer);
  }, [reload, run]);

  function chooseScenario(id: string) {
    setSelectedScenarioId(id);
    const scenario = scenarios.find((item) => item.id === id);
    if (!scenario) return;
    setForm((current) => ({
      ...current,
      result_limit: scenarioDefaultResultLimit(scenario) ?? current.result_limit,
    }));
  }

  function chooseCategory(slug: string) {
    const category = findCategoryBySlug(categories, slug);
    setForm((current) => ({
      ...current,
      category_slug: category?.slug ?? null,
      category_label: category?.label ?? null,
      industry: category?.label ?? "",
    }));
  }

  function selectLocation(suggestion: LocationSuggestion) {
    setStructuredLocation((current) => mergeLocationSuggestion(current, suggestion));
    setForm((current) => ({ ...current, location: suggestion.label }));
    setError(null);
    // Coordinates are best-effort: the label and place id are already retained.
    void fetchLocationDetails(suggestion.place_id)
      .then((response) => setStructuredLocation((current) => applyResolvedLocation(current, response.location)))
      .catch(() => undefined);
  }

  function changeLocationText(label: string) {
    setStructuredLocation((current) => withFreeTextLocation(current, label));
    setForm((current) => ({ ...current, location: label }));
  }

  async function start() {
    const validation = validateDiscoveryInput(form, {
      maxResultLimit: settings.max_result_limit,
    });
    setErrors(validation);
    if (!selectedScenario) {
      setError("Choose an active opportunity scenario before starting discovery.");
      return;
    }
    if (!selectedCategory) {
      setError("Choose an opportunity category before starting discovery.");
      return;
    }
    if (categoryIncompatible) {
      setError(`${selectedCategory.label} is not compatible with the ${selectedScenario.name} scenario.`);
      return;
    }
    if (Object.keys(validation).length) return;
    setBusy("discover"); setError(null); setNotice(null); setCandidates([]); setSelected(new Set());
    try {
      const payload: DiscoverySearchInput = {
        ...form,
        location: structuredLocation.label.trim(),
        location_place_id: structuredLocation.place_id,
        location_latitude: structuredLocation.latitude,
        location_longitude: structuredLocation.longitude,
        category_slug: selectedCategory.slug,
        category_label: selectedCategory.label,
        industry: selectedCategory.label,
        scenario_id: selectedScenario.id,
      };
      const response = await startDiscoveryRun(payload);
      window.sessionStorage.setItem("opp-engine:last-discovery-run", response.run.id);
      window.sessionStorage.setItem("opp-engine:last-scenario-id", selectedScenario.id);
      setRun(response.run);
      await reload(response.run.id);
      const terms = Array.isArray(response.run.discovery_terms) ? response.run.discovery_terms : [];
      setNotice(
        `Discovery run queued using ${selectedScenario.name} v${selectedScenario.version}${terms.length ? ` · searching ${terms.join(", ")}` : ""}.`,
      );
    } catch (reason) { setError(displayError(reason)); }
    finally { setBusy(null); }
  }

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selected.has(candidate.id)),
    [candidates, selected],
  );
  const selectionNeedsAcknowledgement = selectedCandidates.some((candidate) =>
    candidateNeedsEligibilityAcknowledgement(candidate),
  );
  const selectionAllowed =
    selectedCandidates.length > 0 &&
    selectedCandidates.every((candidate) => candidateMayProceed(candidate));
  const eligible = candidates.filter(
    (candidate) =>
      !candidate.imported_lead_id &&
      !candidate.duplicate_lead_id &&
      candidateMayProceed(candidate) &&
      (candidate.import_status !== "incomplete" ||
        candidateEligibilityClassification(candidate) === "possible_match"),
  );

  async function acknowledge(candidateId: string) {
    setAcknowledging(candidateId); setError(null); setNotice(null);
    try {
      const response = await acknowledgePossibleMatch(candidateId);
      setNotice(
        response.idempotent
          ? "This possible match was already acknowledged."
          : "Possible match acknowledged. The candidate may now proceed under an acknowledged exception.",
      );
      if (run) await reload(run.id);
    } catch (reason) {
      setError(displayError(reason));
    } finally {
      setAcknowledging(null);
    }
  }

  async function importOne(candidateId: string) {
    if (!run) return;
    setBusy("import"); setError(null); setNotice(null);
    try {
      const response = await importDiscoveryCandidates(run.id, [candidateId]);
      setNotice(`Import: ${response.succeeded} succeeded, ${response.failed} failed.`);
      await reload(run.id);
    } catch (reason) {
      setError(displayError(reason));
      await reload(run.id).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function batch(action: "import" | "assess" | "audit", retry = false) {
    if (!run || !selectedIds.length) return;
    if (action === "import" && selectedIds.length > 10 && !window.confirm(`Import ${selectedIds.length} businesses into Opportunities?`)) return;
    setBusy(action); setError(null); setNotice(null);
    try {
      const response = action === "import"
        ? await importDiscoveryCandidates(run.id, selectedIds)
        : action === "assess"
          ? await assessDiscoveryCandidates(run.id, selectedIds, retry)
          : await auditDiscoveryCandidates(run.id, selectedIds, retry);
      setNotice(`${action === "import" ? "Import" : action === "assess" ? "Assessment" : "Audit"}: ${response.succeeded} succeeded, ${response.failed} failed.`);
      await reload(run.id);
    } catch (reason) { setError(displayError(reason)); await reload(run.id).catch(() => undefined); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <header><p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-400">Intelligence intake</p><h1 className="mt-1 text-2xl font-semibold text-white">Discovery</h1><p className="mt-1 text-sm text-slate-400">Choose what opportunity to look for, then define where and who to search.</p></header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-5 grid gap-3 border-b border-slate-800 pb-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <label className="text-sm text-slate-300">Opportunity scenario *
            <select className={fieldClass} value={selectedScenarioId} disabled={scenarioLoading || scenarios.length === 0} onChange={(event) => chooseScenario(event.target.value)}>
              {scenarios.length === 0 && <option value="">{scenarioLoading ? "Loading scenarios…" : "No active scenarios"}</option>}
              {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name} · v{scenario.version}</option>)}
            </select>
          </label>
          <div className="rounded-md border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-400">
            <p className="font-medium text-slate-200">{selectedScenario?.name ?? "Scenario required"}</p>
            <p className="mt-1">{selectedScenario?.description ?? "The scenario determines the assessment, report and commercial outcome path."}</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <LocationField value={structuredLocation} error={errors.location} onSelect={selectLocation} onChange={changeLocationText} />
          </div>
          <label className="text-sm text-slate-300 lg:col-span-2">Category *
            <select
              className={fieldClass}
              value={selectedCategory?.slug ?? ""}
              disabled={categoryLoading || categories.length === 0}
              onChange={(event) => chooseCategory(event.target.value)}
            >
              {categories.length === 0 && <option value="">{categoryLoading ? "Loading categories…" : "No active categories"}</option>}
              {categories.map((category) => <option key={category.slug} value={category.slug}>{category.label}</option>)}
            </select>
            {(errors.industry ?? errors.category_slug) && <span className="mt-1 block text-xs text-rose-400">{errors.industry ?? errors.category_slug}</span>}
            {categoryIncompatible && <span className="mt-1 block text-xs text-amber-400">{selectedCategory?.label} is not available for the {selectedScenario?.name} scenario.</span>}
          </label>
          <label className="text-sm text-slate-300">Maximum results<input className={fieldClass} type="number" min={1} max={settings.max_result_limit} value={form.result_limit} onChange={(event) => setForm({ ...form, result_limit: Number(event.target.value) })} />{errors.result_limit && <span className="mt-1 block text-xs text-rose-400">{errors.result_limit}</span>}</label>
          <label className="text-sm text-slate-300 lg:col-span-3">Search keywords<input className={fieldClass} value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} placeholder="Optional services or qualifiers" /></label>
          <label className="text-sm text-slate-300">Radius (km)
            <select className={fieldClass} value={form.radius_m ?? ""} onChange={(event) => { setRadiusTouched(true); setForm({ ...form, radius_m: event.target.value ? Number(event.target.value) : null }); }}>
              <option value="">No radius</option>
              {radiusOptions.map((metres) => <option key={metres} value={metres}>{metresToKilometres(metres)} km</option>)}
            </select>
            {errors.radius_m && <span className="mt-1 block text-xs text-rose-400">{errors.radius_m}</span>}
            <span className="mt-1 block text-xs text-slate-500">Options come from Admin · Discovery settings.</span>
          </label>
          <div className="flex items-end gap-2"><button className={`${buttonClass} border-accent-600 bg-accent-600 hover:bg-accent-500`} disabled={busy === "discover" || scenarioLoading || categoryLoading || !selectedScenario || !selectedCategory || categoryIncompatible} onClick={() => void start()}>{busy === "discover" ? "Discovering…" : "Start discovery"}</button><button className={buttonClass} onClick={() => { setForm(initialForm); setStructuredLocation(EMPTY_LOCATION); setRadiusTouched(false); setErrors({}); }}>Clear</button></div>
        </div>
      </section>

      {error && <div role="alert" className="rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</div>}
      {notice && <div className="rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-300">{notice}</div>}

      {selectionNeedsAcknowledgement && <div role="alert" className="rounded-md border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">
        {selectedCandidates.filter((candidate) => candidateNeedsEligibilityAcknowledgement(candidate)).length} selected candidate(s) are possible Cockpit matches awaiting acknowledgement. Open <span className="font-medium">Inspect</span>, review the match and acknowledge before importing or scoring.
      </div>}

      {run && <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-200">Discovery run</h2><p className="mt-1 font-mono text-xs text-slate-500">{run.id}</p></div><Badge tone={statusTone(run.status)}>{run.status.replace(/_/g, " ")}</Badge></div>
        <div className="mt-4 h-1.5 overflow-hidden rounded bg-slate-800"><div className="h-full bg-accent-500 transition-all" style={{ width: `${Math.min(100, run.businesses_discovered ? 25 + (run.candidates_scored / run.businesses_discovered) * 45 + (run.audits_generated / run.businesses_discovered) * 30 : isActiveDiscoveryStatus(run.status) ? 12 : 100)}%` }} /></div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-8">{[
          ["Stage", run.current_stage], ["Discovered", run.businesses_discovered], ["Enriched", run.candidates_enriched], ["Scored", run.candidates_scored], ["Audited", run.audits_generated], ["Failures", run.failures], ["Started", run.started_at ? new Date(run.started_at).toLocaleTimeString() : "—"], ["Completed", run.completed_at ? new Date(run.completed_at).toLocaleTimeString() : "—"],
        ].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-slate-200">{value}</dd></div>)}</dl>
        <p className="mt-4 text-xs text-slate-500">
          Location: <span className="text-slate-300">{run.location}</span>
          {run.location_place_id ? ` · place id ${String(run.location_place_id).slice(0, 14)}…` : ""}
          {run.category_label ? ` · ${run.category_label}` : ""}
          {Array.isArray(run.discovery_terms) && run.discovery_terms.length ? ` · searched ${run.discovery_terms.join(", ")}` : ""}
        </p>
      </section>}

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-4"><h2 className="mr-auto text-sm font-semibold text-slate-200">Candidates <span className="text-slate-500">({candidates.length})</span></h2><button className={buttonClass} disabled={!eligible.length} onClick={() => setSelected(new Set(eligible.map((item) => item.id)))}>Select all eligible</button><button className={buttonClass} title={selectionNeedsAcknowledgement ? "Acknowledge possible matches before importing." : undefined} disabled={!selectionAllowed || busy !== null} onClick={() => void batch("import")}>Import selected</button><button className={buttonClass} title={selectionNeedsAcknowledgement ? "Acknowledge possible matches before scoring." : undefined} disabled={!selectionAllowed || busy !== null} onClick={() => void batch("assess")}>Score selected</button><button className={buttonClass} title={selectionNeedsAcknowledgement ? "Acknowledge possible matches before auditing." : undefined} disabled={!selectionAllowed || busy !== null} onClick={() => void batch("audit")}>Generate audits</button></div>
        {!run ? <p className="p-8 text-center text-sm text-slate-500">Start a discovery run to find candidate businesses.</p> : candidates.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No businesses matched this search.</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-950/50 text-xs text-slate-500"><tr>{["", "Business", "Location", "Category", "Website", "Contact", "Duplicate", "Eligibility", "Score", "Assessment", "Audit", "Import", ""].map((heading, index) => <th key={`${heading}-${index}`} className="px-3 py-2 text-left font-medium">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{candidates.map((candidate) => { const eligibility = candidateEligibilityDisplay(candidate); return <tr key={candidate.id} className="hover:bg-slate-800/30">
          <td className="px-3 py-3"><input aria-label={`Select ${candidate.business_name}`} type="checkbox" checked={selected.has(candidate.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(candidate.id) ? next.delete(candidate.id) : next.add(candidate.id); return next; })} /></td>
          <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-200">{candidate.business_name}</td><td className="px-3 py-3 text-slate-400">{candidate.location ?? "—"}</td><td className="px-3 py-3 text-slate-400">{candidate.industry ?? "—"}</td>
          <td className="max-w-44 truncate px-3 py-3">{candidate.website_url ? <a className="text-accent-400 hover:underline" href={candidate.website_url} target="_blank" rel="noreferrer">Visit</a> : "—"}</td><td className="px-3 py-3 text-slate-400">{candidate.email ? "Email" : candidate.phone ? "Phone" : "None"}</td>
          <td className="px-3 py-3"><Badge tone={candidate.duplicate_lead_id ? "warning" : "success"}>{candidate.duplicate_lead_id ? "existing" : "new"}</Badge></td>
          <td className="whitespace-nowrap px-3 py-3"><Badge tone={eligibility.tone} title={candidate.eligibility_result?.reason ?? undefined}>{eligibility.label}</Badge></td>
          <td className="px-3 py-3 font-mono text-slate-300">{candidate.preliminary_score ?? "—"}</td>
          <td className="px-3 py-3"><Badge tone={statusTone(candidate.assessment_status)}>{candidate.assessment_status}</Badge></td><td className="px-3 py-3"><Badge tone={statusTone(candidate.audit_status)}>{candidate.audit_status}</Badge></td><td className="px-3 py-3"><Badge tone={statusTone(candidate.import_status)}>{candidate.import_status.replace(/_/g, " ")}</Badge></td>
          <td className="whitespace-nowrap px-3 py-3"><button className="text-accent-400 hover:underline" onClick={() => setInspecting(candidate)}>Inspect</button>{(candidate.imported_lead_id ?? candidate.duplicate_lead_id) && <Link className="ml-3 text-sky-400 hover:underline" to={`/opportunities/${candidate.imported_lead_id ?? candidate.duplicate_lead_id}`}>Open</Link>}</td>
        </tr>; })}</tbody></table></div>}
      </section>
      {inspecting && <CandidateDrawer candidate={inspecting} onClose={() => setInspecting(null)} onAcknowledge={(candidateId) => void acknowledge(candidateId)} onContinue={(candidateId) => void importOne(candidateId)} acknowledging={acknowledging === inspecting.id} continuing={busy === "import"} />}
    </div>
  );
}