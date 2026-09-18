import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "../components/Badge";
import {
  fetchAdminConfig,
  fetchAdminDiagnostics,
  updateAdminCategory,
  updateAdminScenario,
  updateAdminSettings,
  type AdminCategoryPatch,
  type AdminScenarioPatch,
} from "../lib/api";
import {
  DISCOVERY_SETTINGS_FALLBACK,
  HARD_LIMITS,
  categoryScenarioOptions,
  describeChange,
  type AdminChange,
  formatRadius,
  joinTerms,
  kilometresToMetres,
  metresToKilometres,
  normalizeAdminCategory,
  normalizeAdminScenario,
  normalizeDiscoverySettings,
  scenarioReadinessLabel,
  scenarioStatusOptions,
  splitTerms,
  validateDiscoverySettings,
  type AdminCategory,
  type AdminCapabilities,
  type AdminConfigResponse,
  type AdminDiagnostics,
  type AdminScenario,
  type DiscoverySettings,
} from "../lib/admin";

const fieldClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent-500";
const buttonClass =
  "rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40";
const primaryButtonClass = `${buttonClass} border-accent-600 bg-accent-600 hover:bg-accent-500`;
const cardClass = "rounded-lg border border-slate-800 bg-slate-900/60 p-5";

type TabKey = "categories" | "scenarios" | "settings" | "diagnostics";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "categories", label: "Categories" },
  { key: "scenarios", label: "Scenarios" },
  { key: "settings", label: "Discovery Settings" },
  { key: "diagnostics", label: "Diagnostics" },
];

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusTone(status: string) {
  if (status === "active") return "success" as const;
  if (status === "draft") return "warning" as const;
  if (status === "retired") return "danger" as const;
  return "neutral" as const;
}

/** Small labelled field wrapper so the console reads as a form, not a table editor. */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-400">{error}</span>}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-slate-300">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          checked ? "bg-emerald-500/80" : "bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            checked ? "left-4" : "left-0.5"
          }`}
        />
      </button>
      {label}
    </label>
  );
}

// ---- Categories -------------------------------------------------------------

function CategoryEditor({
  category,
  scenarios,
  saving,
  onCancel,
  onSave,
}: {
  category: AdminCategory;
  scenarios: AdminScenario[];
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: AdminCategoryPatch) => void;
}) {
  const [label, setLabel] = useState(category.label);
  const [description, setDescription] = useState(category.description ?? "");
  const [active, setActive] = useState(category.status === "active");
  const [searchTerms, setSearchTerms] = useState(joinTerms(category.search_terms));
  const [googleTypes, setGoogleTypes] = useState(joinTerms(category.google_types));
  const [radiusKm, setRadiusKm] = useState(
    metresToKilometres(category.default_radius_m) ?? "",
  );
  const [sortOrder, setSortOrder] = useState(String(category.sort_order ?? 100));
  const [compatible, setCompatible] = useState<string[]>(category.compatible_scenarios);

  const scenarioSlugs = categoryScenarioOptions(scenarios);

  function save() {
    onSave({
      label: label.trim(),
      description: description.trim() ? description.trim() : null,
      status: active ? "active" : "inactive",
      search_terms: splitTerms(searchTerms),
      google_types: splitTerms(googleTypes),
      default_radius_m: kilometresToMetres(
        radiusKm === "" ? null : Number(radiusKm),
      ),
      sort_order: Number(sortOrder),
      compatible_scenarios: compatible,
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/70" role="dialog" aria-modal="true" aria-label={`Edit ${category.slug}`}>
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-accent-400">Category</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{category.label}</h2>
            <p className="mt-1 font-mono text-xs text-slate-500">{category.slug}</p>
          </div>
          <button className={buttonClass} onClick={onCancel}>Close</button>
        </div>

        <div className="mt-6 space-y-4">
          <Toggle checked={active} onChange={setActive} label={active ? "Active — selectable in Discovery" : "Inactive — hidden from Discovery"} />
          <Field label="Label">
            <input className={fieldClass} value={label} onChange={(event) => setLabel(event.target.value)} />
          </Field>
          <Field label="Description" hint="Operator-facing summary shown next to the category.">
            <textarea className={fieldClass} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field
            label="Search terms"
            hint="Provider queries this category expands into (comma or newline separated). Empty falls back to the label."
          >
            <textarea className={fieldClass} rows={3} value={searchTerms} onChange={(event) => setSearchTerms(event.target.value)} />
          </Field>
          <p className="text-xs text-slate-500">
            Expands to: {splitTerms(searchTerms).length ? splitTerms(searchTerms).slice(0, HARD_LIMITS.maxSearchTerms).join(" · ") : "label only"}
          </p>
          <Field
            label="Google types"
            hint="Provider-native place types retained for metadata. Not used as a strict filter."
          >
            <textarea className={fieldClass} rows={2} value={googleTypes} onChange={(event) => setGoogleTypes(event.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default radius (km)" hint="Falls back to the discovery-wide default when empty.">
              <input className={fieldClass} type="number" min={0.1} max={50} step={0.5} value={radiusKm} onChange={(event) => setRadiusKm(event.target.value)} />
            </Field>
            <Field label="Sort order" hint="Lower values appear first in Discovery.">
              <input className={fieldClass} type="number" min={0} max={10000} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
            </Field>
          </div>
          <fieldset className="rounded-md border border-slate-800 p-3">
            <legend className="px-1 text-sm text-slate-300">Compatible scenarios</legend>
            <p className="mb-2 text-xs text-slate-500">None selected = compatible with every scenario.</p>
            <div className="space-y-2">
              {scenarioSlugs.map((slug) => (
                <label key={slug} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={compatible.includes(slug)}
                    onChange={(event) =>
                      setCompatible((current) =>
                        event.target.checked
                          ? [...current, slug]
                          : current.filter((item) => item !== slug),
                      )
                    }
                  />
                  <span className="font-mono text-xs">{slug}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button className={primaryButtonClass} disabled={saving || !label.trim()} onClick={save}>
            {saving ? "Saving…" : "Save category"}
          </button>
          <button className={buttonClass} disabled={saving} onClick={onCancel}>Cancel</button>
          <span className="text-xs text-slate-500">Existing runs keep their recorded snapshot.</span>
        </div>
      </div>
    </div>
  );
}

function CategoriesTab({
  config,
  onRefresh,
  onResult,
  onError,
}: {
  config: AdminConfigResponse;
  onRefresh: () => Promise<void>;
  onResult: (message: string, changes?: AdminChange[]) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(patch: AdminCategoryPatch) {
    if (!editing) return;
    setSaving(true);
    try {
      const response = await updateAdminCategory(editing.slug, patch);
      onResult(
        response.changes.length
          ? `Saved ${editing.slug} (${response.changes.length} field${response.changes.length === 1 ? "" : "s"} changed)${response.audit_logged ? " · audited" : ""}.`
          : "No changes to save.",
        response.changes,
      );
      setEditing(null);
      await onRefresh();
    } catch (error) {
      onError(displayError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Category registry</h2>
          <p className="mt-1 text-xs text-slate-500">
            Deactivating hides a category from Discovery. Categories are never deleted, so historical runs stay readable.
          </p>
        </div>
        <Badge tone="neutral">{config.categories.length} total</Badge>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-950/50 text-xs text-slate-500">
            <tr>
              {["Category", "Slug", "Status", "Radius", "Terms", "Scenarios", "Order", ""].map((heading) => (
                <th key={heading} className="px-3 py-2 text-left font-medium">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {config.categories.map((category) => (
              <tr key={category.id} className="hover:bg-slate-800/30">
                <td className="px-3 py-3">
                  <p className="font-medium text-slate-200">{category.label}</p>
                  {category.description && <p className="mt-0.5 max-w-72 text-xs text-slate-500">{category.description}</p>}
                </td>
                <td className="px-3 py-3 font-mono text-xs text-slate-400">{category.slug}</td>
                <td className="px-3 py-3"><Badge tone={statusTone(category.status)}>{category.status}</Badge></td>
                <td className="px-3 py-3 text-slate-300">{formatRadius(category.default_radius_m)}</td>
                <td className="px-3 py-3 text-slate-400">{category.search_terms.length}</td>
                <td className="px-3 py-3 font-mono text-xs text-slate-400">
                  {category.compatible_scenarios.length ? category.compatible_scenarios.join(", ") : "any"}
                </td>
                <td className="px-3 py-3 text-slate-400">{category.sort_order ?? "—"}</td>
                <td className="px-3 py-3">
                  <button className="text-accent-400 hover:underline" onClick={() => setEditing(category)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <CategoryEditor
          category={editing}
          scenarios={config.scenarios}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={(patch) => void save(patch)}
        />
      )}
    </section>
  );
}

// ---- Scenarios --------------------------------------------------------------

function ScenarioEditor({
  scenario,
  categories,
  capabilities,
  saving,
  onCancel,
  onSave,
}: {
  scenario: AdminScenario;
  categories: AdminCategory[];
  capabilities: AdminCapabilities;
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: AdminScenarioPatch) => void;
}) {
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description ?? "");
  const [status, setStatus] = useState(scenario.status);
  const [resultLimit, setResultLimit] = useState(
    String(scenario.discovery_config.default_result_limit ?? ""),
  );
  const [radiusKm, setRadiusKm] = useState(
    metresToKilometres(
      typeof scenario.discovery_config.radius_m === "number"
        ? scenario.discovery_config.radius_m
        : null,
    ) ?? "",
  );

  const statusOptions = scenarioStatusOptions(scenario, capabilities.default_scenario_slug);
  const linkedCategories = categories.filter((category) =>
    category.compatible_scenarios.includes(scenario.slug),
  );

  function save() {
    onSave({
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
      status,
      discovery_config: {
        default_result_limit: resultLimit === "" ? undefined : Number(resultLimit),
        radius_m: kilometresToMetres(radiusKm === "" ? null : Number(radiusKm)),
      },
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/70" role="dialog" aria-modal="true" aria-label={`Edit ${scenario.slug}`}>
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-accent-400">Scenario</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{scenario.name}</h2>
            <p className="mt-1 font-mono text-xs text-slate-500">{scenario.slug} · v{scenario.version}</p>
          </div>
          <button className={buttonClass} onClick={onCancel}>Close</button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(scenario.status)}>{scenario.status}</Badge>
          <Badge tone={scenario.executable ? "success" : "warning"}>{scenarioReadinessLabel(scenario)}</Badge>
        </div>

        {!scenario.executable && (
          <div className="mt-4 rounded-md border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200" role="note">
            This scenario is registered but not wired into the discovery execution path. It can be described and prepared,
            but it cannot be activated from here — changing status alone will be refused by the backend.
          </div>
        )}

        <div className="mt-6 space-y-4">
          <Field label="Operator-facing name">
            <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Description">
            <textarea className={fieldClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field
            label="Status"
            hint={
              scenario.slug === capabilities.default_scenario_slug
                ? "The default scenario must stay active — discovery runs resolve it automatically."
                : "A scenario only becomes selectable when the backend supports its execution contract."
            }
          >
            <select className={fieldClass} value={status} onChange={(event) => setStatus(event.target.value)}>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                  {option.disabled ? " — unavailable" : ""}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default result limit" hint={`1–${capabilities.max_result_limit} results per run.`}>
              <input
                className={fieldClass}
                type="number"
                min={1}
                max={capabilities.max_result_limit}
                value={resultLimit}
                onChange={(event) => setResultLimit(event.target.value)}
              />
            </Field>
            <Field label="Default radius (km)" hint="Empty means no scenario-level radius.">
              <input className={fieldClass} type="number" min={0.1} max={50} step={0.5} value={radiusKm} onChange={(event) => setRadiusKm(event.target.value)} />
            </Field>
          </div>
        </div>

        <section className="mt-6 rounded-md border border-slate-800 p-3">
          <h3 className="text-sm text-slate-300">Compatible categories</h3>
          {linkedCategories.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">No category restricts itself to this scenario.</p>
          ) : (
            <p className="mt-1 text-xs text-slate-400">{linkedCategories.map((category) => category.label).join(" · ")}</p>
          )}
        </section>

        <div className="mt-6 flex items-center gap-3">
          <button className={primaryButtonClass} disabled={saving || !name.trim()} onClick={save}>
            {saving ? "Saving…" : "Save scenario"}
          </button>
          <button className={buttonClass} disabled={saving} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ScenariosTab({
  config,
  onRefresh,
  onResult,
  onError,
}: {
  config: AdminConfigResponse;
  onRefresh: () => Promise<void>;
  onResult: (message: string, changes?: AdminChange[]) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState<AdminScenario | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(patch: AdminScenarioPatch) {
    if (!editing) return;
    setSaving(true);
    try {
      const response = await updateAdminScenario(editing.id, patch);
      onResult(
        response.changes.length
          ? `Saved ${editing.slug} (${response.changes.length} field${response.changes.length === 1 ? "" : "s"} changed)${response.audit_logged ? " · audited" : ""}.`
          : "No changes to save.",
        response.changes,
      );
      setEditing(null);
      await onRefresh();
    } catch (error) {
      onError(displayError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Scenario registry</h2>
          <p className="mt-1 text-xs text-slate-500">
            Drafts are visible here but never in the Discovery selector. Only scenarios the execution path supports can be activated.
          </p>
        </div>
        <Badge tone="neutral">{config.scenarios.length} versions</Badge>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-950/50 text-xs text-slate-500">
            <tr>
              {["Scenario", "Slug", "Version", "Status", "Execution", "Result limit", "Radius", ""].map((heading) => (
                <th key={heading} className="px-3 py-2 text-left font-medium">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {config.scenarios.map((scenario) => (
              <tr key={scenario.id} className="hover:bg-slate-800/30">
                <td className="px-3 py-3">
                  <p className="font-medium text-slate-200">{scenario.name}</p>
                  {scenario.description && <p className="mt-0.5 max-w-72 text-xs text-slate-500">{scenario.description}</p>}
                </td>
                <td className="px-3 py-3 font-mono text-xs text-slate-400">{scenario.slug}</td>
                <td className="px-3 py-3 text-slate-400">v{scenario.version}</td>
                <td className="px-3 py-3"><Badge tone={statusTone(scenario.status)}>{scenario.status}</Badge></td>
                <td className="px-3 py-3">
                  <Badge tone={scenario.executable ? "success" : "warning"}>
                    {scenario.executable ? "executable" : "not yet executable"}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-slate-300">{String(scenario.discovery_config.default_result_limit ?? "—")}</td>
                <td className="px-3 py-3 text-slate-300">
                  {formatRadius(
                    typeof scenario.discovery_config.radius_m === "number"
                      ? scenario.discovery_config.radius_m
                      : null,
                  )}
                </td>
                <td className="px-3 py-3">
                  <button className="text-accent-400 hover:underline" onClick={() => setEditing(scenario)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <ScenarioEditor
          scenario={editing}
          categories={config.categories}
          capabilities={config.capabilities}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={(patch) => void save(patch)}
        />
      )}
    </section>
  );
}

// ---- Discovery settings -----------------------------------------------------

function SettingsTab({
  config,
  onRefresh,
  onResult,
  onError,
}: {
  config: AdminConfigResponse;
  onRefresh: () => Promise<void>;
  onResult: (message: string, changes?: AdminChange[]) => void;
  onError: (message: string) => void;
}) {
  const [values, setValues] = useState<DiscoverySettings>(config.settings);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  // Keep the form in step with a refresh unless the operator is mid-edit.
  useEffect(() => {
    if (!touched) setValues(config.settings);
  }, [config.settings, touched]);

  const validation = useMemo(() => validateDiscoverySettings(values), [values]);
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(config.settings),
    [values, config.settings],
  );

  async function save() {
    setSaving(true);
    try {
      const response = await updateAdminSettings(values);
      onResult(
        response.changes.length
          ? `Saved discovery settings (${response.changes.length} field${response.changes.length === 1 ? "" : "s"} changed)${response.audit_logged ? " · audited" : ""}. Affects new runs only.`
          : "No changes to save.",
        response.changes,
      );
      setTouched(false);
      await onRefresh();
    } catch (error) {
      onError(displayError(error));
    } finally {
      setSaving(false);
    }
  }

  const bounds = config.capabilities.radius_bounds_m;

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Discovery settings</h2>
          <p className="mt-1 text-xs text-slate-500">
            Discovery-wide defaults that do not belong to a category or scenario. Applying a change affects new runs only —
            existing runs keep their recorded configuration.
          </p>
        </div>
        <Badge tone="neutral">hard ceilings · {config.capabilities.max_result_limit} results · {config.capabilities.max_search_terms} terms</Badge>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Default radius (km)" hint="Used when neither the scenario nor the category supplies one. Empty disables the global default.">
          <input
            className={fieldClass}
            type="number"
            min={0.1}
            max={50}
            step={0.5}
            value={metresToKilometres(values.default_radius_m) ?? ""}
            onChange={(event) => {
              setTouched(true);
              setValues((current) => ({
                ...current,
                default_radius_m: kilometresToMetres(
                  event.target.value === "" ? null : Number(event.target.value),
                ),
              }));
            }}
          />
        </Field>
        <Field label="Supported radius options (km)" hint="Comma separated; offered as the Discovery radius list.">
          <input
            className={fieldClass}
            value={(values.radius_options_m.map((metres) => metresToKilometres(metres) ?? 0).join(", "))}
            onChange={(event) => {
              setTouched(true);
              setValues((current) => ({
                ...current,
                radius_options_m: splitTerms(event.target.value)
                  .map((entry) => kilometresToMetres(Number(entry)))
                  .filter((entry): entry is number => entry !== null && Number.isFinite(entry)),
              }));
            }}
          />
        </Field>
        <Field label="Default maximum results" hint="Pre-filled in the Discovery form.">
          <input
            className={fieldClass}
            type="number"
            min={1}
            max={values.max_result_limit}
            value={values.default_result_limit}
            onChange={(event) => {
              setTouched(true);
              setValues((current) => ({ ...current, default_result_limit: Number(event.target.value) }));
            }}
          />
        </Field>
        <Field label="Maximum allowed results" hint={`Hard ceiling ${HARD_LIMITS.maxResultLimit} — an operator cannot exceed it.`}>
          <input
            className={fieldClass}
            type="number"
            min={1}
            max={HARD_LIMITS.maxResultLimit}
            value={values.max_result_limit}
            onChange={(event) => {
              setTouched(true);
              setValues((current) => ({ ...current, max_result_limit: Number(event.target.value) }));
            }}
          />
        </Field>
        <Field label="Location country bias" hint="Applied to location autocomplete and provider text search.">
          <select
            className={fieldClass}
            value={values.location_country_bias}
            onChange={(event) => {
              setTouched(true);
              setValues((current) => ({ ...current, location_country_bias: event.target.value }));
            }}
          >
            {config.capabilities.allowed_country_biases.map((bias) => (
              <option key={bias} value={bias}>{bias.toUpperCase()}</option>
            ))}
          </select>
        </Field>
        <Field label="Category search-term expansion" hint={`1–${HARD_LIMITS.maxSearchTerms} provider queries per category.`}>
          <select
            className={fieldClass}
            value={String(values.max_search_terms)}
            onChange={(event) => {
              setTouched(true);
              setValues((current) => ({ ...current, max_search_terms: Number(event.target.value) }));
            }}
          >
            {[1, 2, 3].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Field>
        <Field label="Autocomplete result limit" hint={`1–${HARD_LIMITS.maxAutocompleteLimit} location suggestions per query.`}>
          <input
            className={fieldClass}
            type="number"
            min={1}
            max={HARD_LIMITS.maxAutocompleteLimit}
            value={values.autocomplete_limit}
            onChange={(event) => {
              setTouched(true);
              setValues((current) => ({ ...current, autocomplete_limit: Number(event.target.value) }));
            }}
          />
        </Field>
        <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
          <p className="font-medium text-slate-300">Effective now</p>
          <p className="mt-1">Radius {formatRadius(config.settings.default_radius_m)} · results {config.settings.default_result_limit}/{config.settings.max_result_limit} · bias {config.settings.location_country_bias.toUpperCase()}</p>
          <p className="mt-1">Bounds {bounds.min}–{bounds.max} m · editable only within the code ceilings.</p>
        </div>
      </div>

      {Object.keys(validation.errors).length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-rose-300" role="alert">
          {Object.entries(validation.errors).map(([field, message]) => (
            <li key={field}>{message}</li>
          ))}
        </ul>
      )}
      {validation.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-amber-300" role="note">
          {validation.warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          className={primaryButtonClass}
          disabled={
            saving ||
            !dirty ||
            Object.keys(validation.errors).length > 0
          }
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        <button
          className={buttonClass}
          disabled={saving || !dirty}
          onClick={() => {
            setValues(config.settings);
            setTouched(false);
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

// ---- Diagnostics ------------------------------------------------------------

function DiagnosticsTab({ onError }: { onError: (message: string) => void }) {
  const [diagnostics, setDiagnostics] = useState<AdminDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDiagnostics(await fetchAdminDiagnostics());
    } catch (error) {
      onError(displayError(error));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!diagnostics) {
    return (
      <section className={cardClass}>
        <p className="text-sm text-slate-400">{loading ? "Loading diagnostics…" : "Diagnostics unavailable."}</p>
      </section>
    );
  }

  const stats: Array<[string, string]> = [
    ["Active categories", String(diagnostics.categories.active)],
    ["Inactive categories", String(diagnostics.categories.inactive)],
    ["Active scenarios", String(diagnostics.scenarios.active.length)],
    ["Draft scenarios", String(diagnostics.scenarios.draft.length)],
    ["Executable scenarios", diagnostics.scenarios.executable.join(", ") || "none"],
    ["Default scenario", diagnostics.scenarios.default_scenario_slug],
  ];

  return (
    <div className="space-y-5">
      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-200">Operational snapshot</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Generated {new Date(diagnostics.generated_at).toLocaleString()}</span>
            <button className={buttonClass} disabled={loading} onClick={() => void load()}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-1 text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-slate-200">Environment</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={diagnostics.provider.google_places_configured ? "success" : "danger"}>
            Google Places {diagnostics.provider.google_places_configured ? "configured" : "not configured"}
          </Badge>
          <Badge tone={diagnostics.provider.smtp_configured ? "success" : "danger"}>
            SMTP {diagnostics.provider.smtp_configured ? "configured" : "not configured"}
          </Badge>
          <Badge tone="neutral">Credentials are never returned by this endpoint</Badge>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-slate-200">Effective discovery defaults</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {([
            ["Default radius", formatRadius(diagnostics.settings.default_radius_m)],
            ["Radius options", diagnostics.settings.radius_options_m.map((m) => metresToKilometres(m)).join(", ")],
            ["Default results", String(diagnostics.settings.default_result_limit)],
            ["Max results", String(diagnostics.settings.max_result_limit)],
            ["Country bias", diagnostics.settings.location_country_bias.toUpperCase()],
            ["Search terms", String(diagnostics.settings.max_search_terms)],
          ] as Array<[string, string]>).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-1 text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-slate-200">Recent discovery runs</h2>
        {diagnostics.recent_runs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No discovery runs recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-950/50 text-xs text-slate-500">
                <tr>
                  {["Created", "Status", "Scenario", "Category", "Location", "Terms", "Results", "Radius"].map((heading) => (
                    <th key={heading} className="px-3 py-2 text-left font-medium">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {diagnostics.recent_runs.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-800/30">
                    <td className="whitespace-nowrap px-3 py-3 text-slate-300">{new Date(run.created_at).toLocaleString()}</td>
                    <td className="px-3 py-3"><Badge tone={run.status === "completed" ? "success" : run.status === "failed" ? "danger" : "info"}>{run.status}</Badge></td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-400">{run.scenario_slug ?? "—"}{run.scenario_version ? ` v${run.scenario_version}` : ""}</td>
                    <td className="px-3 py-3 text-slate-300">{run.category_label ?? run.category_slug ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-400">{run.location ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-400">{run.discovery_terms?.length ? run.discovery_terms.join(" · ") : "—"}</td>
                    <td className="px-3 py-3 text-slate-300">{run.result_limit ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-300">{formatRadius(run.radius_m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---- Console ----------------------------------------------------------------

export default function Admin() {
  const [config, setConfig] = useState<AdminConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("categories");
  const [notice, setNotice] = useState<string | null>(null);
  const [lastChanges, setLastChanges] = useState<AdminChange[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchAdminConfig();
      setConfig({
        settings: normalizeDiscoverySettings(response.settings),
        categories: response.categories
          .map(normalizeAdminCategory)
          .filter((category): category is AdminCategory => category !== null),
        scenarios: response.scenarios
          .map(normalizeAdminScenario)
          .filter((scenario): scenario is AdminScenario => scenario !== null),
        capabilities:
          response.capabilities ?? {
            supported_scenarios: [],
            default_scenario_slug: "local-digital-presence",
            radius_bounds_m: { min: HARD_LIMITS.minRadiusM, max: HARD_LIMITS.maxRadiusM },
            max_result_limit: HARD_LIMITS.maxResultLimit,
            max_search_terms: HARD_LIMITS.maxSearchTerms,
            max_autocomplete_limit: HARD_LIMITS.maxAutocompleteLimit,
            allowed_country_biases: [...HARD_LIMITS.allowedCountryBiases],
            default_radius_options_m: DISCOVERY_SETTINGS_FALLBACK.radius_options_m,
            effective: normalizeDiscoverySettings(response.settings),
          },
      });
    } catch (reason) {
      setError(displayError(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function showNotice(message: string, changes: AdminChange[] = []) {
    setNotice(message);
    setLastChanges(changes);
    setError(null);
  }

  function showError(message: string) {
    setError(message);
    setNotice(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-400">Operator console</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Admin</h1>
          <p className="mt-1 text-sm text-slate-400">
            Tune discovery configuration without editing migrations or source. Every change is validated and audited server-side.
          </p>
        </div>
        <button className={buttonClass} disabled={loading} onClick={() => void load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              tab === entry.key ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
            aria-current={tab === entry.key ? "page" : undefined}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {error && <div role="alert" className="rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</div>}
      {notice && (
        <div className="rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-300">
          <p>{notice}</p>
          {lastChanges.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-emerald-200/80">
              {lastChanges.slice(0, 6).map((change) => (
                <li key={change.field}>{describeChange(change)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!config ? (
        <section className={cardClass}>
          <p className="text-sm text-slate-400">{loading ? "Loading configuration…" : "Configuration unavailable."}</p>
        </section>
      ) : tab === "categories" ? (
        <CategoriesTab config={config} onRefresh={load} onResult={showNotice} onError={showError} />
      ) : tab === "scenarios" ? (
        <ScenariosTab config={config} onRefresh={load} onResult={showNotice} onError={showError} />
      ) : tab === "settings" ? (
        <SettingsTab config={config} onRefresh={load} onResult={showNotice} onError={showError} />
      ) : (
        <DiagnosticsTab onError={showError} />
      )}
    </div>
  );
}
