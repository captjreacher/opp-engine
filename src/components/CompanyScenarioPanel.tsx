import {useState} from "react";
import type {OppDetail} from "../lib/types";
import {fetchOpportunityBatches,moveBatchMember} from "../lib/api";

export default function CompanyScenarioPanel({detail,selected,onSelect,onRefresh}:{detail:OppDetail;selected:string;onSelect:(id:string)=>void;onRefresh:()=>Promise<void>}) {
  const [destinations,setDestinations]=useState<{id:string;name:string}[]>([]);
  const [target,setTarget]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const matches=detail.company_scenarios??[];
  const templates=detail.outreach_options??[];
  const active=detail.batches?.find(batch=>batch.active);
  const choice=templates.find(template=>template.id===selected);
  const explanation=(detail.latest_assessment as unknown as {score_explanation?:{base_score?:number;strongest_evidence?:number;independent_support?:number}} | null)?.score_explanation;
  return <section className="space-y-3 rounded border border-slate-700 p-4">
    <h2 className="font-semibold">Company scenarios and outreach selection</h2>
    {!matches.length && <p>No scenarios assessed yet.</p>}
    {matches.map(match=><div key={match.scenario_key} className="text-sm"><strong>{match.scenario_key}</strong> — {match.state} · score {match.score??"not assessed"} · {match.assessed_at}
      <ul>{match.evidence.map(e=><li key={e.key}>{e.description} ({e.source})</li>)}</ul></div>)}
    <p className="text-xs text-slate-400">Missing evidence is not proof of absence. Scenario count does not imply buying readiness.</p>
    {explanation?.base_score !== undefined && <p className="text-sm">Base opportunity score: {explanation.base_score}. Evidence strength: {explanation.strongest_evidence}/100. Independent evidence adds {explanation.independent_support} points. Shared evidence counts once.</p>}
    <label className="block text-sm">Outreach template<select className="ml-2 rounded bg-slate-900 p-2" value={selected} onChange={event=>onSelect(event.target.value)}><option value="">Select a compatible template</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} v{t.version}{!t.destination_verified_at?" — destination unverified":""}</option>)}</select></label>
    {!templates.length && <p className="text-amber-300 text-sm">No compatible configured templates. Sending is blocked until the offer mapping and landing page are verified.</p>}
    {choice && <p className="text-sm">Offer: {choice.offer_id} · Destination: {choice.destination??"not configured"} · {choice.destination_verified_at?"Verified":"Unverified — sending blocked"}</p>}
    {active && <div className="space-y-2 text-sm"><p>Active batch: {active.name}</p><button disabled={busy} onClick={async()=>{try{setDestinations((await fetchOpportunityBatches()).batches.filter(b=>!b.archived_at&&b.id!==active.id));}catch(err){setError(String(err));}}}>Choose a batch to move to</button>
      {!!destinations.length && <><select value={target} onChange={e=>setTarget(e.target.value)} className="bg-slate-900 p-2"><option value="">Destination batch</option>{destinations.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><button disabled={!target||busy} onClick={async()=>{if(!window.confirm("Move this company to the selected batch? Historical membership is retained."))return;setBusy(true);try{await moveBatchMember(detail.lead.id,active.id,target);await onRefresh();setTarget("");setDestinations([]);}catch(err){setError(String(err));}finally{setBusy(false);}}}>Confirm move</button></>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
