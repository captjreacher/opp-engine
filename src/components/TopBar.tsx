import { Link, NavLink } from "react-router-dom";
import { envStatus, isApiConfigured } from "../lib/api";
import Badge from "./Badge";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `oe-nav-item rounded px-2.5 py-2 text-sm transition-colors ${
    isActive ? "oe-nav-active bg-accent-900 text-graphite-100" : "text-graphite-400 hover:text-graphite-200"
  }`;

/** Persistent top bar: app identity, primary nav, and a small API/auth configuration indicator. */
export default function TopBar() {
  return (
    <header className="sticky top-0 z-20 border-b border-graphite-800 bg-console-raised">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <Link to="/opportunities" className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-accent-500/20 text-accent-300 ring-1 ring-inset ring-accent-500/40">
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
          <span className="text-sm font-semibold tracking-tight text-graphite-100">Opportunity Engine</span>
          <span className="hidden text-sm text-graphite-500 sm:inline">Commercial intelligence</span>
        </Link>

        <nav aria-label="Primary navigation" className="oe-nav flex items-center gap-1">
          <NavLink to="/discovery" className={navClass}>Discovery</NavLink>
          <NavLink to="/opportunities" className={navClass}>Opportunities</NavLink>
          <NavLink to="/batches" className={navClass}>Batches</NavLink>
          <NavLink to="/pipeline" className={navClass}>Pipeline</NavLink>
          <NavLink to="/admin" className={navClass}>Admin</NavLink>
        </nav>

        <div className="oe-connection ml-auto flex items-center gap-2 text-xs">
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
