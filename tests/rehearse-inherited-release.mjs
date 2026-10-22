// Explicitly local schema-only rehearsal. No production connection or provider transport.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const db=process.env.OPP_INHERITED_DATABASE;
if(!db?.startsWith('opp_inherited_test')||process.env.OPP_TEST_PGPORT!=='55486')throw new Error('Dedicated disposable database on localhost:55486 required');
const psql=process.env.OPP_TEST_PSQL??'psql';
const args=['-h','127.0.0.1','-p','55486','-U','postgres','-d',db,'-X','-v','ON_ERROR_STOP=1','-qtAX'];
const out=process.env.OPP_REHEARSAL_EVIDENCE??'node_modules/.cache/blocker-review';fs.mkdirSync(out,{recursive:true});
const run=(text,stop=true)=>execFileSync(psql,stop?args:args.map(x=>x==='ON_ERROR_STOP=1'?'ON_ERROR_STOP=0':x),{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:10*1024*1024});
const baseline=process.env.OPP_SCHEMA_BASELINE;
const shared=process.env.OPP_SHARED_MIGRATIONS;
const review=process.env.OPP_OWNER_SCHEMA_FIXTURES;
if(!baseline||!shared||!review)throw new Error('Provide schema-only baseline, inherited migrations and owner fixture directory');
const manifest=[];
function file(p,transform=s=>s,stop=true){let s=fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');manifest.push({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});s=transform(s);try{run(s,stop);console.log('APPLIED '+path.basename(p));}catch(e){fs.writeFileSync(out+'/inherited-error.log',String(e.stderr));throw new Error('Rehearsal failed at '+path.basename(p)+'; see local error log');}}
run(fs.readFileSync(path.join(review,'bootstrap.sql'),'utf8').replace(/create role (anon|authenticated|service_role) ([^;]+);/g,(_,name,options)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${name}') then create role ${name} ${options}; end if; end$$;`));
// Restore the historical schema with explicit accounting for missing Paperclip views.
const raw=fs.readFileSync(baseline,'utf8');
// Keep all tables, functions and constraints. Only skip unavailable cross-schema Paperclip views
// and their dependent Cockpit view statements, recording the original restore errors instead.
const result=spawnSync(psql,args.map(x=>x==='ON_ERROR_STOP=1'?'ON_ERROR_STOP=0':x),{input:raw,encoding:'utf8',maxBuffer:10*1024*1024});
manifest.push({path:baseline,sha256:crypto.createHash('sha256').update(raw).digest('hex')});
fs.writeFileSync(out+'/inherited-baseline-stdout.log',result.stdout??'');
fs.writeFileSync(out+'/inherited-baseline-stderr.log',result.stderr??'');
const baselineErrors=(result.stderr??'').split('\n').filter(l=>l.includes('ERROR:'));
const allowed=/relation "(?:paperclip\.issues|public\.cockpit_(?:paperclip_issues|available_actions|journey_candidates|journey_summary|operating_summary|operator_mode_summary|workflow_queue|workflow_summary))" does not exist/;
if(result.status!==0||baselineErrors.some(l=>!allowed.test(l)))throw new Error('Unexpected baseline restoration error; inspect local evidence before continuing');
file(path.join(shared,'20260801010000_generalise_ticketing_case_management.sql'));
file(path.join(review,'client-relational-prefix.sql'));
file(path.join(shared,'20260810053516_visual_opportunity_intelligence.sql'));
file(path.join(shared,'20260907123000_opportunity_prospect_eligibility.sql'));
for(const name of fs.readdirSync('supabase/migrations').filter(n=>n.startsWith('2026')&&n>='202608').sort()){
 if(name==='20260907132500_handoff_sent_outreach_to_cockpit.sql')file(path.join(shared,'20260907131000_opportunity_outbound_handoff.sql'));
 file('supabase/migrations/'+name,s=>s.replace(/create extension if not exists pg_net[^;]*;/ig,'-- pg_net replaced by non-networked recording stub'));
}
const summary=JSON.parse(run("select json_build_object('tables',(select count(*) from pg_tables where schemaname='public'),'triggers',(select count(*) from pg_trigger where not tgisinternal and tgrelid in(select oid from pg_class where relnamespace='public'::regnamespace)),'functions',(select count(*) from pg_proc where pronamespace='public'::regnamespace),'network_stub',position('net.test_requests' in pg_get_functiondef('net.http_post(text,jsonb,jsonb,jsonb,integer)'::regprocedure))>0,'second_send_ledger',to_regclass('public.opportunity_send_claims') is not null);").trim());
fs.writeFileSync('docs/evidence/release-blockers/inherited-rehearsal.json',JSON.stringify({database:db,port:55486,sourceManifest:manifest,baselineErrors:{count:baselineErrors.length,unique:[...new Set(baselineErrors)]},summary,limitations:['Historical public schema baseline; current production drift requires comparison','External Paperclip views omitted','Auth helpers are fixtures; net.http_post records locally without network','Storage/platform execution not emulated']},null,2));
console.log(JSON.stringify(summary));
