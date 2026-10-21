import { beforeAll, describe, it, expect } from "vitest";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
const db = process.env.OPP_RELEASE_DATABASE;
const suite = db ? describe : describe.skip;
const psql = process.env.OPP_TEST_PSQL ?? "psql";
const args = [
  "-h",
  "127.0.0.1",
  "-p",
  process.env.OPP_TEST_PGPORT ?? "55485",
  "-U",
  "postgres",
  "-d",
  db ?? "opp_release_test_rehearsal",
  "-X",
  "-v",
  "ON_ERROR_STOP=1",
  "-At",
];
const sql = (query: string) =>
  execFileSync(psql, args, {
    input: query,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const asyncSql = (query: string) =>
  promisify(execFile)(psql, [...args, "-c", query]);
const id = (n: number) =>
  `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-21T00:00:00Z";
function lead(n: number) {
  sql(
    `insert into local_business_leads(id,business_name,status,email) values('${id(n)}','Release fixture ${n}','assessed','fixture${n}@example.invalid')`,
  );
}
function draft(n: number, company: number, status = "approved") {
  sql(
    `insert into local_business_outreach_drafts(id,lead_id,subject,body,status,selection,updated_at) values('${id(n)}','${id(company)}','Subject','Body','${status}','{}','${at}')`,
  );
}
function claim(
  n: number,
  company: number,
  email = `fixture${company}@example.invalid`,
) {
  return `select claim_scenario_outreach_send('${id(n)}','${id(company)}','Subject','Body','{}','${at}','${email}','{"recipient":"sink@example.invalid","live":false,"overridden":true}')`;
}
suite(
  "combined release migrations on production-derived target schema",
  { timeout: 20000 },
  () => {
    beforeAll(() => {
      if (!db?.startsWith("opp_release_test"))
        throw new Error("Explicit disposable release database required");
      sql(
        "drop schema public cascade; drop schema if exists auth cascade; create schema public;",
      );
      sql(
        readFileSync("tests/fixtures/opportunity-release-schema.sql", "utf8"),
      );
      for (const migration of [
        "20261009145236_company_scenario_workflow.sql",
        "20261018144011_opportunity_archive_restore_governance.sql",
        "20261020234438_scenario_reports.sql",
        "20261021003415_scenario_archive_release_compatibility.sql",
        "20261021012142_scenario_owner_retention_reconciliation.sql",
      ])
        sql(readFileSync(`supabase/migrations/${migration}`, "utf8"));
      lead(1);
      lead(2);
      lead(3);
      lead(4);
      lead(5);
      lead(6);
    });
    it("retains canonical UUID constraints, generated scores and source foreign keys", () => {
      expect(() =>
        sql(
          "insert into local_business_audit_reports(lead_id,generated_by) values('" +
            id(1) +
            "','opportunity-engine')",
        ),
      ).toThrow();
      expect(
        sql(
          `insert into local_business_lead_assessments(lead_id,demand_signal_score,trust_leakage_score) values('${id(1)}',50,60) returning opportunity_score`,
        ),
      ).toContain("135");
      expect(
        sql(
          "select count(*) from information_schema.columns where table_name='opportunity_scenario_reports' and column_name='report'",
        ),
      ).toBe("1");
    });
    it("archives/restores idempotently with retained evidence and scenario reports", () => {
      sql(`insert into opportunity_scenarios(id,slug,name,status,version) values('${id(50)}','fixture','Fixture','active',1);
    insert into local_business_lead_assessments(id,lead_id) values('${id(51)}','${id(1)}');
    insert into opportunity_scenario_reports(lead_id,assessment_id,scenario_id,fingerprint,report) values('${id(1)}','${id(51)}','${id(50)}',repeat('a',64),'{}');`);
      sql(
        `select set_opportunity_archived('${id(1)}',true,'Fixture'); select set_opportunity_archived('${id(1)}',true,'Fixture')`,
      );
      expect(
        sql(
          `select count(*) from opportunity_console_audit_log where action='opportunity_archived' and lead_id='${id(1)}'`,
        ),
      ).toBe("1");
      expect(() =>
        sql(
          `insert into opportunity_scenario_reports(lead_id,assessment_id,scenario_id,fingerprint,report) values('${id(1)}','${id(51)}','${id(50)}',repeat('b',64),'{}')`,
        ),
      ).toThrow();
      expect(() =>
        sql(
          `select persist_opportunity_company_scenarios('${id(1)}','[{"scenario_key":"fixture","scenario_id":"${id(50)}","scenario_version":1,"state":"confirmed","evidence":[],"assessed_at":"2026-10-21","score":60}]',true)`,
        ),
      ).toThrow();
      expect(
        sql(
          `select count(*) from opportunity_scenario_reports where lead_id='${id(1)}'`,
        ),
      ).toBe("1");
      sql(`select set_opportunity_archived('${id(1)}',false)`);
      expect(
        sql(`select status from local_business_leads where id='${id(1)}'`),
      ).toBe("assessed");
    });
    it("blocks stale recipient, unapproved drafts and archived claims before any transport", () => {
      draft(20, 2, "draft");
      expect(() => sql(claim(20, 2))).toThrow();
      sql(
        `update local_business_outreach_drafts set status='approved' where id='${id(20)}'`,
      );
      expect(() => sql(claim(20, 2, "changed@example.invalid"))).toThrow();
      expect(
        sql(
          `select count(*) from opportunity_outreach_send_claims where lead_id='${id(2)}'`,
        ),
      ).toBe("0");
    });
    it("serializes company claims across different scenario drafts", async () => {
      draft(30, 3);
      draft(31, 3);
      const results = await Promise.allSettled([
        asyncSql(claim(30, 3)),
        asyncSql(claim(31, 3)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(() =>
        sql(
          `update local_business_leads set email='changed@example.invalid' where id='${id(3)}'`,
        ),
      ).toThrow();
      expect(() =>
        sql(`select set_opportunity_archived('${id(3)}',true)`),
      ).toThrow();
    });
    it("records uncertain outcomes once, retains claims and refuses retries or edits", () => {
      draft(40, 4);
      sql(claim(40, 4));
      sql(
        `select complete_scenario_outreach_send('${id(4)}','${id(40)}',false,'Fixture transport uncertainty'); select complete_scenario_outreach_send('${id(4)}','${id(40)}',false,'Retry completion only')`,
      );
      expect(
        sql(
          `select state from opportunity_outreach_send_claims where draft_id='${id(40)}'`,
        ),
      ).toBe("uncertain");
      expect(
        sql(
          `select count(*) from opportunity_console_audit_log where lead_id='${id(4)}' and action='outreach_send_failed'`,
        ),
      ).toBe("1");
      expect(() => sql(claim(40, 4))).toThrow();
      expect(() =>
        sql(
          `update local_business_outreach_drafts set status='sent' where id='${id(40)}'`,
        ),
      ).toThrow();
      expect(() =>
        sql(
          `delete from opportunity_outreach_send_claims where draft_id='${id(40)}'`,
        ),
      ).toThrow();
    });
    it("makes mock delivery completion and handoff event atomic and idempotent", () => {
      draft(60, 6);
      sql(claim(60, 6));
      sql(
        `select complete_scenario_outreach_send('${id(6)}','${id(60)}',true,null);select complete_scenario_outreach_send('${id(6)}','${id(60)}',true,null)`,
      );
      expect(
        sql(
          `select status from local_business_outreach_drafts where id='${id(60)}'`,
        ),
      ).toBe("sent");
      expect(
        sql(
          `select count(*) from opportunity_console_audit_log where lead_id='${id(6)}' and action='outreach_sent'`,
        ),
      ).toBe("1");
      sql(`select set_opportunity_archived('${id(6)}',true)`);
      expect(
        sql(
          `select state from opportunity_outreach_send_claims where draft_id='${id(60)}'`,
        ),
      ).toBe("sent");
    });
    it("rolls back state when atomic completion audit fails", () => {
      draft(70, 5);
      sql(claim(70, 5));
      sql(
        "create function fixture_reject_sent_event() returns trigger language plpgsql as $$begin if new.action='outreach_sent' then raise exception 'fixture audit unavailable'; end if;return new;end;$$;create trigger fixture_reject_sent_event before insert on opportunity_console_audit_log for each row execute function fixture_reject_sent_event();",
      );
      expect(() =>
        sql(
          `select complete_scenario_outreach_send('${id(5)}','${id(70)}',true,null)`,
        ),
      ).toThrow();
      expect(
        sql(
          `select status from local_business_outreach_drafts where id='${id(70)}'`,
        ),
      ).toBe("approved");
      expect(
        sql(
          `select state from opportunity_outreach_send_claims where draft_id='${id(70)}'`,
        ),
      ).toBe("sending");
      sql(
        "drop trigger fixture_reject_sent_event on opportunity_console_audit_log;drop function fixture_reject_sent_event();",
      );
    });
    it("denies public reports and privileged claim/complete RPCs", () => {
      expect(
        sql(
          "select has_table_privilege('authenticated','opportunity_scenario_reports','SELECT')",
        ),
      ).toBe("f");
      expect(
        sql(
          "select has_function_privilege('authenticated','complete_scenario_outreach_send(uuid,uuid,boolean,text)','execute')",
        ),
      ).toBe("f");
      expect(
        sql(
          "select has_function_privilege('anon','claim_scenario_outreach_send(uuid,uuid,text,text,jsonb,timestamptz,text,jsonb)','execute')",
        ),
      ).toBe("f");
    });
    it("fences archive versus report insertion in both parent-lock orders", async () => {
      lead(7);
      lead(8);
      for (const n of [7, 8])
        sql(
          `insert into local_business_lead_assessments(id,lead_id) values('${id(100 + n)}','${id(n)}')`,
        );
      const insert = (n: number) =>
        `insert into opportunity_scenario_reports(lead_id,assessment_id,scenario_id,fingerprint,report) values('${id(n)}','${id(100 + n)}','${id(50)}',repeat('${n}',64),'{}')`;
      const archivedFirst = asyncSql(
        `begin;select id from local_business_leads where id='${id(7)}' for update;select pg_advisory_xact_lock(7101);select pg_sleep(1);select set_opportunity_archived('${id(7)}',true);commit;`,
      );
      while (
        sql(
          "select count(*) from pg_locks where locktype='advisory' and objid=7101 and granted",
        ) !== "1"
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      const denied = asyncSql(insert(7));
      const first = await Promise.allSettled([archivedFirst, denied]);
      expect(first.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
      const reportFirst = asyncSql(
        `begin;${insert(8)};select pg_advisory_xact_lock(7102);select pg_sleep(1);commit;`,
      );
      while (
        sql(
          "select count(*) from pg_locks where locktype='advisory' and objid=7102 and granted",
        ) !== "1"
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      const archivedLater = asyncSql(
        `select set_opportunity_archived('${id(8)}',true)`,
      );
      const second = await Promise.allSettled([reportFirst, archivedLater]);
      expect(second.every((r) => r.status === "fulfilled")).toBe(true);
      expect(
        sql(
          `select count(*) from opportunity_scenario_reports where lead_id='${id(8)}'`,
        ),
      ).toBe("1");
    });
    it("fences archive versus draft approval in both parent-lock orders", async () => {
      lead(9);
      lead(10);
      draft(90, 9, "draft");
      draft(91, 10, "draft");
      const archiveFirst = asyncSql(
        `begin;select id from local_business_leads where id='${id(9)}' for update;select pg_advisory_xact_lock(7103);select pg_sleep(1);select set_opportunity_archived('${id(9)}',true);commit;`,
      );
      while (
        sql(
          "select count(*) from pg_locks where locktype='advisory' and objid=7103 and granted",
        ) !== "1"
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      const deniedApproval = asyncSql(
        `update local_business_outreach_drafts set status='approved' where id='${id(90)}'`,
      );
      expect(
        (await Promise.allSettled([archiveFirst, deniedApproval])).map(
          (r) => r.status,
        ),
      ).toEqual(["fulfilled", "rejected"]);
      const approvalFirst = asyncSql(
        `begin;update local_business_outreach_drafts set status='approved' where id='${id(91)}';select pg_advisory_xact_lock(7104);select pg_sleep(1);commit;`,
      );
      while (
        sql(
          "select count(*) from pg_locks where locktype='advisory' and objid=7104 and granted",
        ) !== "1"
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      const deniedArchive = asyncSql(
        `select set_opportunity_archived('${id(10)}',true)`,
      );
      expect(
        (await Promise.allSettled([approvalFirst, deniedArchive])).map(
          (r) => r.status,
        ),
      ).toEqual(["fulfilled", "rejected"]);
    });
  },
);
