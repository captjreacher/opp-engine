// Local-only browser harness: actual compiled API handlers + migrated disposable PostgreSQL.
// No production credentials or external network. SMTP is replaced with a refusing transport.
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createServer} from 'vite';
const database=process.env.OPP_RELEASE_DATABASE;
if(!database?.startsWith('opp_release_test'))throw new Error('Explicit disposable release database required');
const port=Number(process.env.OPP_PREVIEW_PORT??5179);
const psql=process.env.OPP_TEST_PSQL??'psql';
const args=['-h','127.0.0.1','-p',process.env.OPP_TEST_PGPORT??'55485','-U','postgres','-d',database,'-X','-v','ON_ERROR_STOP=1','-qtAX'];
const rawSql=q=>execFileSync(psql,args,{input:'set role service_role;\n'+q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const quote=v=>v===null||v===undefined?'null':typeof v==='boolean'||typeof v==='number'?String(v):"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
const identifier=v=>{if(!/^[a-z_][a-z0-9_]*$/.test(v))throw new Error('Unsafe fixture identifier');return '"'+v+'"';};
const rows=q=>JSON.parse(rawSql(`select coalesce(json_agg(q),'[]'::json) from (${q}) q;`)||'[]');
class Query {
 constructor(table){this.table=identifier(table);this.filters=[];this.sort='';this.count='';this.operation='select';}
 select(){return this;}
 eq(k,v){this.filters.push(`${identifier(k)}=${quote(v)}`);return this;}
 in(k,values){this.filters.push(values.length?`${identifier(k)} in (${values.map(quote).join(',')})`:'false');return this;}
 is(k,v){this.filters.push(`${identifier(k)} is ${v===null?'null':quote(v)}`);return this;}
 not(k,op,v){if(op!=='is'||v!==null)throw new Error('Unsupported fixture filter');this.filters.push(`${identifier(k)} is not null`);return this;}
 or(text){this.filters.push('('+text.split(',').map(item=>{const [k,op,...value]=item.split('.');if(op!=='eq')throw new Error('Unsupported fixture or');return `${identifier(k)}=${quote(value.join('.'))}`;}).join(' or ')+')');return this;}
 order(k,o={}){this.sort=` order by ${identifier(k)} ${o.ascending===false?'desc':'asc'}`;return this;}
 limit(n){this.count=` limit ${Number(n)}`;return this;}
 insert(row){this.operation='insert';this.values=row;return this;}
 upsert(row,options){this.operation='insert';this.values=row;this.conflict=options.onConflict;return this;}
 update(row){this.operation='update';this.values=row;return this;}
 run(single=false){try{
  const where=this.filters.length?' where '+this.filters.join(' and '):'';let result;
  if(this.operation==='select') result=rows(`select * from public.${this.table}${where}${this.sort}${this.count}`);
  else {
   const keys=Object.keys(this.values);const change=this.operation==='insert'?`insert into public.${this.table} (${keys.map(identifier).join(',')}) values (${keys.map(k=>quote(this.values[k])).join(',')})${this.conflict?` on conflict(${identifier(this.conflict)}) do nothing`:''}`:`update public.${this.table} set ${keys.map(k=>`${identifier(k)}=${quote(this.values[k])}`).join(',')}${where}`;
   result=JSON.parse(rawSql(`with changed as (${change} returning *) select coalesce(json_agg(changed),'[]'::json) from changed;`));
  }
  return {data:single?(result[0]??null):result,error:null};
 }catch(error){return {data:null,error:{message:error.stderr?.toString()??error.message}};}}
 single(){return Promise.resolve(this.run(true));}
 maybeSingle(){return Promise.resolve(this.run(true));}
 then(resolve,reject){return Promise.resolve(this.run()).then(resolve,reject);}
}
const stats={mockTransportAttempts:0,outboundMessages:0};
const supabase={from:table=>new Query(table),rpc:async(name,payload)=>{
 if(name==='check_prospect_eligibility')return {data:{classification:payload.p_business_name?.includes('Previously contacted')?'previously_contacted':'eligible'},error:null};
 try{return {data:JSON.parse(rawSql(`select coalesce(to_jsonb(public.${identifier(name)}(${Object.entries(payload).map(([k,v])=>`${identifier(k)}=>${quote(v)}`).join(',')})),'null'::jsonb);`)),error:null};}
 catch(error){return {data:null,error:{message:error.stderr?.toString()??error.message}};}
}};
process.env.VITE_API_BASE=`http://127.0.0.1:${port}/fixture/opportunities`;
process.env.VITE_OPERATOR_TOKEN='local-release-fixture';
const vite=await createServer({server:{middlewareMode:true,hmr:{port:24679}},appType:'spa'});
const reports=await vite.ssrLoadModule('/supabase/functions/_shared/scenarioReports.ts');
const company=await vite.ssrLoadModule('/supabase/functions/_shared/companyScenarios.ts');
const lifecycle=await vite.ssrLoadModule('/supabase/functions/_shared/opportunityLifecycle.ts');
const workflow=await vite.ssrLoadModule('/supabase/functions/_shared/opportunityWorkflow.ts');
const batches=await vite.ssrLoadModule('/supabase/functions/_shared/opportunityBatches.ts');
const plan={planId:'plan-release-fixture',productId:'product-release-fixture',name:'Fixture reviewed website offer',description:'Review and confirm the agreed website scope.',isSellable:true,isArchived:false,billingType:'one-off'};
const price={planId:plan.planId,planVersionId:'fixture-price-v2',version:2,status:'published',effectiveFrom:'2026-10-19',effectiveTo:null,price:{kind:'fixed',currency:'NZD',amountMinor:125000,taxTreatment:'exclusive',taxRate:1500}};
const fixtureFetch=async input=>{
 const url=String(input);if(!url.startsWith('https://billing-fixture.invalid/'))throw new Error('External network forbidden in release harness');
 return new Response(JSON.stringify({data:url.includes('/prices/current')?{current:price}:url.includes('/products/')?{productId:plan.productId,lifecycleStatus:'published'}:url.includes('withdrawn')?{...plan,planId:'plan-withdrawn',isSellable:false}:plan}));
};
const source=readFileSync('supabase/functions/opportunities/index.ts','utf8');
const file=ts.createSourceFile('api.ts',source,ts.ScriptTarget.Latest,true);
const edits=[];
for(const node of file.statements){
 if(ts.isImportDeclaration(node))edits.push([node.getStart(file),node.end,'']);
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='sendSmtpEmail')edits.push([node.getStart(file),node.end,'async function sendSmtpEmail(){fixtureStats.mockTransportAttempts++;throw new Error("Release validation transport disabled: no mail sent.");}']);
}
let isolated=source;for(const [a,b,text]of edits.sort((a,b)=>b[0]-a[0]))isolated=isolated.slice(0,a)+text+isolated.slice(b);
const compiled=ts.transpileModule(isolated,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let route;
const environment={OPERATOR_TOKEN:'local-release-fixture',SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',BILLING_API_BASE_URL:'https://billing-fixture.invalid',BILLING_CATALOGUE_API_KEY:'fixture-only',OUTREACH_TEST_EMAIL:'sink@example.invalid',OUTREACH_SEND_MODE:'test',MGRNZ_SMTP_HOST:'127.0.0.1',MGRNZ_SMTP_USERNAME:'fixture@example.invalid',MGRNZ_SMTP_PASSWORD:'fixture-only',OUTREACH_FROM_NAME:'MGRNZ'};
const deps={...reports,...company,...lifecycle,...workflow,...batches,fixtureStats:stats,resolveOffer:(t,c)=>reports.resolveOffer(t,c,fixtureFetch),createClient:()=>supabase,Deno:{env:{get:key=>environment[key]},serve:handler=>{route=handler;}},fetch:fixtureFetch};
new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;${compiled}`)(deps);

const ids={single:'11111111-1111-4111-8111-111111111111',multi:'22222222-2222-4222-8222-222222222222',missing:'33333333-3333-4333-8333-333333333333',archived:'44444444-4444-4444-8444-444444444444',withdrawn:'55555555-5555-4555-8555-555555555555'};
const sid=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scenarios=[['website',1],['profile',2],['unmapped',3],['withdrawn',4]];
for(const [key,n] of scenarios)rawSql(`insert into opportunity_scenarios(id,slug,name,status,version) values(${quote(sid(n))},${quote('release-'+key)},${quote('Recorded '+key+' scenario')},'active',1) on conflict(id) do nothing;`);
const template=(n,keys,combined=false,offer=plan.planId)=>({id:sid(100+n),version:1,name:combined?'Combined website and profile':offer==='plan-withdrawn'?'Withdrawn offer fixture':'Website conversation',scenario_keys:keys.map(key=>'release-'+key),combined,subject:'Recorded opportunities for {{business_name}}',body:'Hello,\nWe reviewed the recorded observations for {{business_name}}.',offer_id:offer,destination:'https://maximisedai.com/products/fixture-only',destination_verified_at:'2026-10-19',enabled:true,approved_details:{approved_at:'2026-10-19',inclusions:['Fixture inclusion: agreed website service page'],terms:['Fixture commercial terms: scope confirmation required']},edit_phrases:['Would you like to discuss the recorded findings?']});
for(const t of [template(1,['website']),template(2,['website','profile'],true),template(3,['withdrawn'],false,'plan-withdrawn')])rawSql(`insert into opportunity_outreach_templates(${Object.keys(t).map(identifier).join(',')}) values(${Object.values(t).map(v=>Array.isArray(v)?'array['+v.map(quote).join(',')+']':quote(v)).join(',')}) on conflict(id) do nothing;`);
for(const [kind,id]of Object.entries(ids)){
 if(rows(`select id from local_business_leads where id=${quote(id)}`).length)continue;
 rawSql(`insert into local_business_leads(id,business_name,status,email,category,suburb,enrichment_status,enrichment_diagnostics) values(${quote(id)},${quote('Release '+kind+' fixture')},'assessed','fixture@example.invalid','Professional services','Auckland','enriched','{"enrichment_result":{"observed_at":"2026-10-20","trust_score":70}}');`);
 const keys=kind==='multi'?['website','profile']:kind==='missing'?['unmapped']:kind==='withdrawn'?['withdrawn']:['website'];
 const matches=keys.map(key=>({scenario_key:'release-'+key,scenario_id:sid(scenarios.find(([k])=>k===key)[1]),scenario_version:1,state:'confirmed',assessed_at:'2026-10-21',score:70,evidence:[{key,description:`Recorded ${key} observation from local fixture`,source:'https://example.invalid/fixture-evidence',value:'Recorded',score:70,supported:true}]}));
 const assessment=rows(`select id from local_business_lead_assessments where lead_id=${quote(id)}`)[0];
 if(!assessment)rawSql(`insert into local_business_lead_assessments(lead_id,scenario_matches,demand_signal_score,trust_leakage_score,assessment_summary,assessed_at) values(${quote(id)},${quote(matches)},50,60,'Recorded fixture observations only.','2026-10-21')`);
 const aid=rows(`select id from local_business_lead_assessments where lead_id=${quote(id)}`)[0].id;
 rawSql(`select persist_opportunity_company_scenarios(${quote(id)},${quote(matches)},true);insert into opportunity_console_audit_log(action,lead_id,actor,metadata) values('analysis_completed',${quote(id)},'fixture',${quote({assessment_id:aid})}),('opportunity_contact_ready',${quote(id)},'fixture','{}');`);
 // Archive only after the first report snapshot has been materialised by the actual API.
 if(kind==='archived'){await route(new Request(`http://127.0.0.1/opportunities/${id}`,{headers:{Authorization:'Bearer local-release-fixture'}}));rawSql(`select set_opportunity_archived(${quote(id)},true,'Archived fixture');`);}
}
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(url.pathname==='/fixture-stats'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({...stats,retainedClaims:rows("select lead_id,state from opportunity_outreach_send_claims"),ids}));}
  if(!url.pathname.startsWith('/fixture/'))return vite.middlewares(req,res,()=>res.end());
  let body='';for await(const chunk of req)body+=chunk;
  const response=await route(new Request(`http://127.0.0.1:${port}${url.pathname.replace('/fixture','')}${url.search}`,{method:req.method,headers:req.headers,...(body?{body}:{} )}));
  res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await response.text());
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
}).listen(port,'127.0.0.1',()=>console.log(JSON.stringify({preview:`http://127.0.0.1:${port}/opportunities/${ids.single}`,ids,transport:'refusing mock; zero outbound messages'})));
