import { Navigate, Route, Routes } from "react-router-dom";
import TopBar from "./components/TopBar";
import ConfigBanner from "./components/ConfigBanner";
import { isApiConfigured } from "./lib/api";
import OpportunityList from "./routes/OpportunityList";
import OpportunityDetail from "./routes/OpportunityDetail";

export default function App() {
  return (
    <div className="min-h-full bg-slate-950">
      <TopBar />
      {!isApiConfigured && <ConfigBanner />}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/opportunities" replace />} />
          <Route path="/opportunities" element={<OpportunityList />} />
          <Route path="/opportunities/:id" element={<OpportunityDetail />} />
          <Route
            path="*"
            element={
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">
                Page not found.{" "}
                <a href="/opportunities" className="text-accent-400 hover:underline">
                  Back to opportunities
                </a>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
