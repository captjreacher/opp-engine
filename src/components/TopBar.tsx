import { Link, NavLink } from "react-router-dom";
import { envStatus, isApiConfigured } from "../lib/api";
import Badge from "./Badge";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2.5 py-1 text-sm transition-colors ${
    isActive ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
  }`;

/** Persistent top bar: app identity, primary nav, and a small API/auth configuration indicator. */
export default function TopBar() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link to="/opportunities" className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-accent-500/20 text-accent-300 ring-1 ring-inset ring-accent-500/40">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
              <path
                d="M4 18L9 9L14 14L20 5"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="font-mono text-sm font-semibold tracking-tight text-slate-100">opp-engine</span>
          <span className="hidden text-sm text-slate-500 sm:inline">· Operator Console</span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink to="/opportunities" className={navClass}>Opportunities</NavLink>
          <NavLink to="/pipeline" className={navClass}>Pipeline</NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${isApiConfigured ? "bg-emerald-400" : "bg-rose-400"}`}
            aria-hidden="true"
          />
          {isApiConfigured ? (
            <Badge tone="success" title={envStatus.apiBase}>
              API configured
            </Badge>
          ) : (
            <Badge tone="danger">
              API not configured
              {!envStatus.hasApiBase && !envStatus.hasOperatorToken
                ? " (missing base + token)"
                : !envStatus.hasApiBase
                  ? " (missing base URL)"
                  : " (missing token)"}
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
