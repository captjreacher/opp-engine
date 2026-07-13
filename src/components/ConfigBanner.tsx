import { envStatus } from "../lib/api";

/**
 * Full-width banner shown when required env vars are missing. Rendered instead
 * of attempting API calls, so the app never crashes on a bad/missing config.
 */
export default function ConfigBanner() {
  const missing: string[] = [];
  if (!envStatus.hasApiBase) missing.push("VITE_API_BASE");
  if (!envStatus.hasOperatorToken) missing.push("VITE_OPERATOR_TOKEN");

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <div className="mx-auto flex max-w-7xl flex-col gap-1">
        <p className="font-medium">
          opp-engine is not configured — {missing.join(" and ")}{" "}
          {missing.length > 1 ? "are" : "is"} missing.
        </p>
        <p className="text-amber-200/80">
          Copy <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">.env.example</code>{" "}
          to <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">.env.local</code> and
          set the opportunities Edge Function URL and operator bearer token, then restart the dev
          server. No data can be loaded until this is set.
        </p>
      </div>
    </div>
  );
}
