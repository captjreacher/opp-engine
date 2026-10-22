import { useState } from 'react';
import type { GbpPreparationInput } from '../lib/api';

interface Props {
  onPrepare: (input: GbpPreparationInput) => Promise<void>;
  busy: boolean;
  error: string | null;
}

/** Explicit operator evidence and customer-confirmation intake for local GBP drafts. */
export default function GbpPreparation({ onPrepare, busy, error }: Props) {
  const [code, setCode] = useState<'G01' | 'G02'>('G01');
  const [serviceCount, setServiceCount] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLocation, setSearchLocation] = useState('');
  const [candidateReview, setCandidateReview] = useState('');
  const [searchResult, setSearchResult] = useState<'no_match' | 'unclaimed_match'>('no_match');
  const [observation, setObservation] = useState('');
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [humanReviewed, setHumanReviewed] = useState(false);

  return (
    <form className="space-y-3 rounded border border-sky-700/40 bg-sky-950/20 p-4" onSubmit={(event) => {
      event.preventDefault();
      void onPrepare({
        scenarioCode: code,
        serviceCount: Number(serviceCount),
        customerConfirmed,
        profileStatus: code === 'G01' ? 'none_or_unclaimed' : 'verified_controlled',
        humanReviewed,
        observedAt: new Date().toISOString(),
        evidenceUrl: evidenceUrl.trim() || undefined,
        searchQuery: code === 'G01' ? searchQuery.trim() : undefined,
        searchLocation: code === 'G01' ? searchLocation.trim() : undefined,
        candidateReview: code === 'G01' ? candidateReview.trim() : undefined,
        searchAttempted: code === 'G01',
        searchResult: code === 'G01' ? searchResult : 'matching_profile',
        observation: code === 'G02' ? observation.trim() : undefined,
      });
    }}>
      <h3 className="text-sm font-semibold text-sky-100">Prepare a GBP commercial draft</h3>
      <p className="text-xs text-slate-400">Local review only. The server requires evidence, customer confirmation, a published Billing price in the local catalogue, and an explicit draft-mode setting. Sending remains blocked.</p>
      <label className="block text-xs text-slate-300">Scenario
        <select value={code} onChange={(event) => setCode(event.target.value as 'G01' | 'G02')} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm">
          <option value="G01">G01 — GBP Setup</option><option value="G02">G02 — GBP Improvement</option>
        </select>
      </label>
      <label className="block text-xs text-slate-300">Confirmed number of genuine services (1–5)
        <input required type="number" min="1" max="5" value={serviceCount} onChange={(event) => setServiceCount(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
      </label>
      {code === 'G01' ? <>
        <label className="block text-xs text-slate-300">Documented public search query
          <input required value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
        </label>
        <label className="block text-xs text-slate-300">Search location
          <input required value={searchLocation} onChange={(event) => setSearchLocation(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
        </label>
        <label className="block text-xs text-slate-300">Candidate review and plausible variants checked
          <textarea required value={candidateReview} onChange={(event) => setCandidateReview(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
        </label>
        <label className="block text-xs text-slate-300">Search finding
          <select value={searchResult} onChange={(event) => setSearchResult(event.target.value as 'no_match' | 'unclaimed_match')} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"><option value="no_match">No matching profile confirmed</option><option value="unclaimed_match">Matching unclaimed profile</option></select>
        </label>
      </> : <label className="block text-xs text-slate-300">Specific observable improvement finding
        <textarea required maxLength={300} value={observation} onChange={(event) => setObservation(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
      </label>}
      {(code === 'G02' || searchResult === 'unclaimed_match') && <label className="block text-xs text-slate-300">Matching profile evidence URL
        <input required type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
      </label>}
      <label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={humanReviewed} onChange={(event) => setHumanReviewed(event.target.checked)} />I reviewed the evidence and business identity.</label>
      <label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={customerConfirmed} onChange={(event) => setCustomerConfirmed(event.target.checked)} />The customer confirmed profile status, control and service count.</label>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      <button type="submit" disabled={busy || !humanReviewed || !customerConfirmed} className="rounded bg-sky-700 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Preparing…' : 'Prepare report and draft'}</button>
    </form>
  );
}
