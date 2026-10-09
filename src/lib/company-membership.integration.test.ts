import {beforeAll,describe,it,expect} from "vitest";
import {execFileSync,execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const database=process.env.OPP_TEST_DATABASE;
const suite=database?describe:describe.skip;
const psql=process.env.OPP_TEST_PSQL??"psql";
const args=["-h","127.0.0.1","-p",process.env.OPP_TEST_PGPORT??"55482","-U","postgres","-d",database??"opp_company_test","-X","-v","ON_ERROR_STOP=1","-At"];
const sql=(query:string)=>execFileSync(psql,args,{input:query,encoding:"utf8"}).trim();
const asyncSql=(query:string)=>promisify(execFile)(psql,[...args,"-c",query]);
const lead="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const batch=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
suite("local PostgreSQL company membership and send uniqueness",()=>{
  beforeAll(()=>{
    if(!database?.startsWith("opp_company_test")) throw new Error("Only an explicitly named disposable local test database is permitted");
    sql(`drop schema public cascade; create schema public;
      do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end;$$;
      create table local_business_leads(id uuid primary key,status text not null);
      create table opportunity_scenarios(id uuid primary key);
      create table opportunity_discovery_runs(id uuid primary key);
      create table opportunity_discovery_candidates(id uuid primary key);
      create table local_business_lead_assessments(id uuid primary key);
      create table local_business_outreach_drafts(id uuid primary key);
      create table opportunity_console_audit_log(action text,lead_id uuid,actor text,metadata jsonb);
      insert into local_business_leads values('${lead}','discovered'),('${other}','discovered');`);
    sql(readFileSync(resolve("supabase/migrations/20261002044415_opportunity_batches.sql"),"utf8"));
    sql(readFileSync(resolve("supabase/migrations/20261009145236_company_scenario_workflow.sql"),"utf8"));
  });
  it("allows exactly one of two concurrent overlapping batch creation requests",async()=>{
    const results=await Promise.allSettled([asyncSql(`begin;select create_opportunity_batch('${batch(10)}','A',array['${lead}','${other}']::uuid[]);select pg_sleep(0.3);commit;`),asyncSql(`select create_opportunity_batch('${batch(11)}','B',array['${lead}','${other}']::uuid[]);`)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(sql(`select count(*) from opportunity_batch_members where lead_id='${lead}' and released_at is null`)).toBe("1");
  });
  it("moves explicitly while preserving historical membership and audit",()=>{
    const from=sql(`select batch_id from opportunity_batch_members where lead_id='${lead}' and released_at is null`);
    sql(`insert into opportunity_batches(id,name) values('${batch(12)}','Destination');select move_opportunity_batch_member('${lead}','${from}','${batch(12)}');`);
    expect(sql(`select count(*) from opportunity_batch_members where lead_id='${lead}'`)).toBe("2");
    expect(sql(`select count(*) from opportunity_batch_members where lead_id='${lead}' and released_at is null`)).toBe("1");
    expect(sql(`select action from opportunity_console_audit_log where lead_id='${lead}'`)).toBe("batch_member_moved");
  });
  it("rejects stale-source moves without changing membership",()=>{
    expect(()=>sql(`select move_opportunity_batch_member('${lead}','${batch(99)}','${batch(10)}')`)).toThrow();
    expect(sql(`select batch_id from opportunity_batch_members where lead_id='${lead}' and released_at is null`)).toBe(batch(12));
  });
  it("archives and releases active membership without deleting historical rows",()=>{
    sql(`select archive_opportunity_batch('${batch(12)}')`);
    expect(sql(`select count(*) from opportunity_batch_members where lead_id='${lead}'`)).toBe("2");
    expect(sql(`select count(*) from opportunity_batch_members where lead_id='${lead}' and released_at is null`)).toBe("0");
    expect(()=>sql(`insert into opportunity_batch_members(batch_id,lead_id) values('${batch(12)}','${other}')`)).toThrow();
  });
  it("has one scenario row per stable company/scenario key",()=>{
    const scenarioId=batch(20);sql(`insert into opportunity_scenarios values('${scenarioId}');insert into opportunity_company_scenarios values('${lead}','website','${scenarioId}',1,'unassessed','[]',now(),null);`);
    expect(()=>sql(`insert into opportunity_company_scenarios values('${lead}','website','${scenarioId}',2,'uncertain','[]',now(),null)`)).toThrow();
  });
  it("claims a send only once under concurrent requests",async()=>{
    sql(`insert into local_business_outreach_drafts values('${batch(30)}')`);
    const results=await Promise.allSettled([asyncSql(`insert into opportunity_outreach_send_claims(draft_id) values('${batch(30)}')`),asyncSql(`insert into opportunity_outreach_send_claims(draft_id) values('${batch(30)}')`)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  });
});
