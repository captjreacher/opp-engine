// Isolated, in-memory UI fixture. Never connects to Supabase or any provider.
// Start: node tests/lifecycle-preview.mjs; point Vite at http://127.0.0.1:8788/opportunities.
import { createServer } from 'node:http';
const id = '11111111-1111-4111-8111-111111111111';
const runningId = '22222222-2222-4222-8222-222222222222';
const at = '2026-10-19T00:00:00Z';
let archivedAt = null;
let reason = null;
const events = [{id:'event-1',lead_id:id,action:'opportunity_review_started',actor:'fixture-operator',metadata:{},created_at:at}];
const row = () => ({id,business_name:'Harbour Services (test fixture)',location:'Auckland',industry:'Commercial services',pipeline_status:'discovered',enrichment_status:'enriched',enrichment_ready:true,enrichment_running:false,opportunity_score:'72',demand_signal_score:20,trust_leakage_score:20,conversion_maturity_score:20,ai_readiness_score:12,recommended_outreach_angle:'Retained test evidence',assessed_at:at,has_audit:true,outreach_status:'draft',updated_at:at,archived_at:archivedAt,archive_reason:reason});
const running = () => ({...row(),id:runningId,business_name:'Running enrichment (test fixture)',archived_at:null,enrichment_status:'enriching',enrichment_running:true,enrichment_ready:false});
const assessment = {id:'assessment',opportunity_score:'72',demand_signal_score:20,trust_leakage_score:20,conversion_maturity_score:20,ai_readiness_score:12,assessment_summary:'Evidence preserved throughout archive and restore.',recommended_outreach_angle:'Test fixture only',assessed_at:at};
const report = {id:'report',assessment_id:'assessment',generated_at:at,report_version:'fixture',pdf_url:null,metadata_json:{}};
let changes = 0;
createServer(async (req,res) => {
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5175');
 res.setHeader('Access-Control-Allow-Headers','authorization,content-type');
 res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 res.setHeader('content-type','application/json');
 const send = (body,status=200) => {res.statusCode=status;res.end(JSON.stringify(body));};
 if(req.method==='OPTIONS') return send({});
 if(req.headers.authorization!=='Bearer local-fixture-token') return send({error:'unauthorized'},401);
 const url=new URL(req.url,'http://127.0.0.1:8788');const path=url.pathname.replace(/\/$/,'');
 if(req.method==='GET' && path==='/opportunities/fixture-stats') return send({changes,events:events.length,archived:!!archivedAt,evidence:1,assessments:1,reports:1,drafts:1});
 if(req.method==='GET' && path==='/opportunities') {
   const view=url.searchParams.get('lifecycle')??'active';
   return send({opportunities:[row(),running()].filter(r=>view==='all'||(view==='archived'?!!r.archived_at:!r.archived_at))});
 }
 if(req.method==='GET' && path===`/opportunities/${id}`) return send({lead:{...row(),status:'discovered',category:'Commercial services',suburb:'Auckland',region:null,slug:null,phone:null,email:null,website_url:'https://example.invalid',google_maps_url:null,source:'isolated-fixture',enrichment_diagnostics:{enrichment_result:{trust_score:70}}},latest_assessment:assessment,assessments:[assessment],audit_report:report,audit_reports:[report],events:[{id:'canonical-event',event_type:'fixture',created_at:at}],outreach_drafts:[{id:'draft',subject:'Retained fixture draft',body:'Local test fixture. This draft is never sent.',status:'draft',created_at:at,approved_at:null,sent_at:null}],review_state:'reviewed',outcome_state:null,console_events:events,visual_evidence:[],batches:[]});
 if(req.method==='POST' && [ `/opportunities/${id}/archive`,`/opportunities/${id}/restore`].includes(path)) {
   let raw='';for await(const chunk of req)raw+=chunk;
   const payload=JSON.parse(raw);if(payload.confirm!==true)return send({error:'confirmation_required'},400);
   const archive=path.endsWith('/archive');const idempotent=archive===!!archivedAt;
   if(!idempotent){archivedAt=archive?new Date().toISOString():null;reason=archive?payload.reason:null;changes++;events.unshift({id:`event-${events.length+1}`,lead_id:id,action:archive?'opportunity_archived':'opportunity_restored',actor:'fixture-operator',metadata:{reason:payload.reason},created_at:new Date().toISOString()});}
   return send({ok:true,id,archived_at:archivedAt,idempotent});
 }
 return send({error:'fixture_only',detail:'This local fixture supports archive and restore only. No production actions exist.'},403);
}).listen(8788,'127.0.0.1',()=>console.log('Lifecycle in-memory fixture: http://127.0.0.1:8788 (no production access)'));
