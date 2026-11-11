import { beforeAll, describe, it, expect } from "vitest";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const database = process.env.OPP_TEST_DATABASE;
const suite = database ? describe : describe.skip;
const psql = process.env.OPP_TEST_PSQL ?? "psql";
const args = [
  "-h",
  "127.0.0.1",
  "-p",
  process.env.OPP_TEST_PGPORT ?? "55482",
  "-U",
  "postgres",
  "-d",
  database ?? "opp_company_test",
  "-X",
  "-v",
  "ON_ERROR_STOP=1",
  "-At",
];
const sql = (query: string) =>
  execFileSync(psql, args, { input: query, encoding: "utf8" }).trim();
const asyncSql = (query: string) =>
  promisify(execFile)(psql, [...args, "-c", query]);
const lead = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const batch = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
suite("local PostgreSQL company membership and send uniqueness", { timeout: 15000 }, () => {
  beforeAll(() => {
    if (!database?.startsWith("opp_company_test"))
      throw new Error(
        "Only an explicitly named disposable local test database is permitted",
      );
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
    sql(
      readFileSync(
        resolve("supabase/migrations/20261002044415_opportunity_batches.sql"),
        "utf8",
      ),
    );
  });
  it("blocks ambiguous legacy membership without automatically choosing or deleting history", () => {
    sql(
      `insert into opportunity_batches(id,name) values('${batch(90)}','Legacy A'),('${batch(91)}','Legacy B');insert into opportunity_batch_members(batch_id,lead_id) values('${batch(90)}','${lead}'),('${batch(91)}','${lead}');`,
    );
    const migration = readFileSync(
      resolve(
        "supabase/migrations/20261009145236_company_scenario_workflow.sql",
      ),
      "utf8",
    );
    expect(() => sql(migration)).toThrow();
    expect(
      sql(
        `select count(*) from opportunity_batch_members where lead_id='${lead}'`,
      ),
    ).toBe("2");
    // Only reset this disposable preflight fixture, then test the actual upgrade.
    sql(
      `delete from opportunity_batch_members;delete from opportunity_batches;`,
    );
    sql(migration);
  });
  it("allows exactly one of two concurrent overlapping batch creation requests", async () => {
    const results = await Promise.allSettled([
      asyncSql(
        `begin;select create_opportunity_batch('${batch(10)}','A',array['${lead}','${other}']::uuid[]);select pg_sleep(0.3);commit;`,
      ),
      asyncSql(
        `select create_opportunity_batch('${batch(11)}','B',array['${lead}','${other}']::uuid[]);`,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      sql(
        `select count(*) from opportunity_batch_members where lead_id='${lead}' and released_at is null`,
      ),
    ).toBe("1");
  });
  it("moves explicitly while preserving historical membership and audit", () => {
    const from = sql(
      `select batch_id from opportunity_batch_members where lead_id='${lead}' and released_at is null`,
    );
    sql(
      `insert into opportunity_batches(id,name) values('${batch(12)}','Destination');select move_opportunity_batch_member('${lead}','${from}','${batch(12)}');`,
    );
    expect(
      sql(
        `select count(*) from opportunity_batch_members where lead_id='${lead}'`,
      ),
    ).toBe("2");
    expect(
      sql(
        `select count(*) from opportunity_batch_members where lead_id='${lead}' and released_at is null`,
      ),
    ).toBe("1");
    expect(
      sql(
        `select action from opportunity_console_audit_log where lead_id='${lead}'`,
      ),
    ).toBe("batch_member_moved");
  });
  it("rejects stale-source moves without changing membership", () => {
    expect(() =>
      sql(
        `select move_opportunity_batch_member('${lead}','${batch(99)}','${batch(10)}')`,
      ),
    ).toThrow();
    expect(
      sql(
        `select batch_id from opportunity_batch_members where lead_id='${lead}' and released_at is null`,
      ),
    ).toBe(batch(12));
  });
  it("archives and releases active membership without deleting historical rows", () => {
    sql(`select archive_opportunity_batch('${batch(12)}')`);
    expect(
      sql(
        `select count(*) from opportunity_batch_members where lead_id='${lead}'`,
      ),
    ).toBe("2");
    expect(
      sql(
        `select count(*) from opportunity_batch_members where lead_id='${lead}' and released_at is null`,
      ),
    ).toBe("0");
    expect(() =>
      sql(
        `insert into opportunity_batch_members(batch_id,lead_id) values('${batch(12)}','${other}')`,
      ),
    ).toThrow();
  });
  it("has one scenario row per stable company/scenario key", () => {
    const scenarioId = batch(20);
    sql(
      `insert into opportunity_scenarios values('${scenarioId}');insert into opportunity_company_scenarios values('${lead}','website','${scenarioId}',1,'unassessed','[]',now(),null);`,
    );
    expect(() =>
      sql(
        `insert into opportunity_company_scenarios values('${lead}','website','${scenarioId}',2,'uncertain','[]',now(),null)`,
      ),
    ).toThrow();
  });
  it("preserves confirmed tags when a concurrent incomplete import waits for assessment", async () => {
    const scenarioId = batch(20);
    const match = (state: string) =>
      JSON.stringify([
        {
          scenario_key: "website",
          scenario_id: scenarioId,
          scenario_version: 1,
          state,
          evidence: [],
          assessed_at: "2026-10-10",
          score: state === "confirmed" ? 70 : null,
        },
      ]);
    const results = await Promise.allSettled([
      asyncSql(
        `begin;select persist_opportunity_company_scenarios('${lead}','${match("confirmed")}',true);select pg_sleep(0.3);commit;`,
      ),
      asyncSql(
        `select persist_opportunity_company_scenarios('${lead}','${match("unassessed")}',false)`,
      ),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(
      sql(
        `select state from opportunity_company_scenarios where lead_id='${lead}' and scenario_key='website'`,
      ),
    ).toBe("confirmed");
  });
  it("claims a first send only once even across different drafts for one company", async () => {
    sql(
      `insert into local_business_outreach_drafts values('${batch(30)}'),('${batch(31)}')`,
    );
    const results = await Promise.allSettled([
      asyncSql(
        `insert into opportunity_outreach_send_claims(draft_id,lead_id) values('${batch(30)}','${lead}')`,
      ),
      asyncSql(
        `insert into opportunity_outreach_send_claims(draft_id,lead_id) values('${batch(31)}','${lead}')`,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("applies additive report migration without removing historical data",()=>{
    sql(`alter table local_business_outreach_drafts add column lead_id uuid, add column subject text, add column body text, add column status text default 'draft', add column sent_at timestamptz, add column updated_at timestamptz default now();`);
    sql(readFileSync(resolve("supabase/migrations/20261020234438_scenario_reports.sql"),"utf8"));
    expect(sql("select count(*) from opportunity_company_scenarios")).toBe("1");
    expect(sql("select count(*) from opportunity_scenario_reports")).toBe("0");
    expect(sql("select relrowsecurity from pg_class where oid='opportunity_scenario_reports'::regclass")).toBe("t");
    expect(sql("select has_table_privilege('authenticated','opportunity_scenario_reports','SELECT')")).toBe("f");
    expect(sql("select has_table_privilege('service_role','opportunity_scenario_reports','UPDATE')")).toBe("f");
  });
  it("stores reproducible reports idempotently and denies public access",()=>{
    sql(`insert into local_business_lead_assessments(id) values('${batch(50)}');
      insert into opportunity_scenario_reports(lead_id,assessment_id,scenario_id,fingerprint,report)
      values('${lead}','${batch(50)}','${batch(20)}',repeat('a',64),'{}');`);
    sql(`insert into opportunity_scenario_reports(lead_id,assessment_id,scenario_id,fingerprint,report)
      values('${lead}','${batch(50)}','${batch(20)}',repeat('a',64),'{}') on conflict(fingerprint) do nothing;`);
    expect(sql("select count(*) from opportunity_scenario_reports")).toBe("1");
    expect(sql("select count(*) from opportunity_console_audit_log where action='scenario_report_prepared'")).toBe("1");
    expect(()=>sql("set role authenticated; select * from opportunity_scenario_reports")).toThrow();
  });
  it("blocks unapproved or changed content at the atomic claim boundary",()=>{
    sql(`insert into local_business_outreach_drafts(id,lead_id,subject,body,status,selection,updated_at)
      values('${batch(40)}','${other}','Subject','Body','draft','{}','2026-10-20');`);
    const claim=(body:string)=>`select claim_scenario_outreach_send('${batch(40)}','${other}','Subject','${body}','{}','2026-10-20')`;
    expect(()=>sql(claim('Body'))).toThrow();
    sql(`update local_business_outreach_drafts set status='approved' where id='${batch(40)}'`);
    expect(()=>sql(claim('Edited'))).toThrow();
    expect(sql(`select count(*) from opportunity_outreach_send_claims where lead_id='${other}'`)).toBe("0");
  });
  it("serializes concurrent send claims and freezes reviewed content after claim",async()=>{
    const claim=`select claim_scenario_outreach_send('${batch(40)}','${other}','Subject','Body','{}','2026-10-20')`;
    const results=await Promise.allSettled([asyncSql(claim),asyncSql(claim)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(()=>sql(`update local_business_outreach_drafts set body='Changed' where id='${batch(40)}'`)).toThrow();
    expect(()=>sql(`update local_business_outreach_drafts set status='draft' where id='${batch(40)}'`)).toThrow();
    sql(`update local_business_outreach_drafts set status='sent',sent_at=now() where id='${batch(40)}'`);
    expect(sql(`select body from local_business_outreach_drafts where id='${batch(40)}'`)).toBe('Body');
  });

});
