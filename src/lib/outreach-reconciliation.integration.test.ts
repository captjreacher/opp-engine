import { beforeAll, describe, expect, it } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

// This suite is intentionally opt-in. It resets only an explicitly named
// disposable database and must never run against a shared Supabase project.
const database = process.env.OPP_OUTREACH_DATABASE;
if (process.env.CI && (!database || !process.env.OPP_TEST_PSQL))
  throw new Error("CI requires OPP_OUTREACH_DATABASE and OPP_TEST_PSQL for the PostgreSQL release gate");
const suite = database ? describe : describe.skip;
const psql = process.env.OPP_TEST_PSQL ?? "psql";
const prefix = process.env.OPP_TEST_PSQL_PREFIX_JSON
  ? (JSON.parse(process.env.OPP_TEST_PSQL_PREFIX_JSON) as string[])
  : [];
const args = [
  ...prefix,
  "-h",
  "127.0.0.1",
  "-p",
  process.env.OPP_TEST_PGPORT ?? "55485",
  "-U",
  "postgres",
  "-d",
  database ?? "opp_outreach_test_rehearsal",
  "-X",
  "-v",
  "ON_ERROR_STOP=1",
  "-At",
];

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const asyncExecFile = promisify(execFile);
const sql = (query: string) =>
  execFileSync(psql, args, {
    input: query,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const asyncSql = (query: string) =>
  asyncExecFile(psql, [...args, "-c", query], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
const attemptSql = (draft: number, attempt: number, state: string, expires = "now()", lead = draft >= 100 ? draft - 100 : draft) => `
  begin;
  select set_config('app.outreach_attempt_rpc','on',true);
  insert into opportunity_outreach_send_attempts
    (lead_id,draft_id,attempt_id,state,approval_fingerprint,send_snapshot,recipient,destination_url,expires_at)
  values ('${id(lead)}','${id(draft)}','${id(attempt)}','${state}',repeat('a',64),'{}','lead${lead}@example.invalid','https://example.invalid/offer',${expires});
  commit;`;

const migrationLineage = [
  "20261009145236_company_scenario_workflow.sql",
  "20261018144011_opportunity_archive_restore_governance.sql",
  "20261020234438_scenario_reports.sql",
  "20261021003415_scenario_archive_release_compatibility.sql",
  "20261021012142_scenario_owner_retention_reconciliation.sql",
  "20261021121314_gbp_commercial_draft.sql",
  "20261107090000_outreach_architecture_reconciliation.sql",
  "20261108090000_outreach_send_boundary_hardening.sql",
  "20261108100000_outreach_canonical_identity.sql",
];

suite(
  "Round 3 outreach reconciliation against the PR #19 schema",
  { timeout: 60000 },
  () => {
    beforeAll(() => {
      if (!database?.startsWith("opp_outreach_test"))
        throw new Error("Explicit disposable outreach rehearsal database required");

      sql("drop schema public cascade; drop schema if exists auth cascade; create schema public;");
      sql(`do $$ begin
        create role anon;
      exception when duplicate_object then null;
      end $$;
      do $$ begin
        create role authenticated;
      exception when duplicate_object then null;
      end $$;
      do $$ begin
        create role service_role;
      exception when duplicate_object then null;
      end $$;`);
      sql(readFileSync("tests/fixtures/opportunity-release-schema.sql", "utf8"));

      for (const migration of migrationLineage.slice(0, -3))
        sql(readFileSync(`supabase/migrations/${migration}`, "utf8"));

      // Legacy approved data is deliberately incomplete. The final migration
      // must invalidate it and leave an audit record in the same transaction.
      const fixtureLeads = Array.from({ length: 12 }, (_, index) => index + 10)
        .map((n) => `('${id(n)}','Rehearsal lead ${n}','assessed','lead${n}@example.invalid')`)
        .join(",");
      const fixtureDrafts = Array.from({ length: 12 }, (_, index) => index + 10)
        .map((n) => `('${id(100 + n)}','${id(n)}','Subject ${n}','Body ${n}','draft','{}',now())`)
        .join(",");
      sql(`
        insert into auth.users(id) values ('${id(6)}');
        insert into local_business_leads(id,business_name,status,email) values ${fixtureLeads};
        insert into local_business_outreach_drafts(id,lead_id,subject,body,status,selection,updated_at) values ${fixtureDrafts};
        insert into local_business_leads(id,business_name,status,email)
          values ('${id(1)}','Legacy rehearsal lead','assessed','legacy@example.invalid');
        insert into local_business_lead_assessments(id,lead_id)
          values ('${id(2)}','${id(1)}');
        insert into local_business_outreach_drafts
          (id,lead_id,subject,body,status,selection,updated_at)
          values ('${id(3)}','${id(1)}','Legacy subject','Legacy body','approved','{}',now());
        insert into opportunity_outreach_send_claims(draft_id,lead_id,state,send_metadata)
          values ('${id(3)}','${id(1)}','sending','{"recipient":"legacy@example.invalid"}');
      `);

      sql(readFileSync("supabase/migrations/20261107090000_outreach_architecture_reconciliation.sql", "utf8"));
      sql(readFileSync("supabase/migrations/20261108090000_outreach_send_boundary_hardening.sql", "utf8"));
    }, 60000);

    it("invalidates incomplete legacy approvals and classifies legacy claims", () => {
      expect(sql(`select status from local_business_outreach_drafts where id='${id(3)}'`)).toBe("draft");
      expect(sql(`select count(*) from opportunity_console_audit_log where action='outreach_approval_invalidated' and draft_id='${id(3)}'`)).toBe("1");
      expect(sql(`select historical_classification from opportunity_outreach_send_claims where draft_id='${id(3)}'`)).toBe("legacy_incomplete");
    });

    it("rejects report Billing identity substitutions at the atomic claim boundary", () => {
      const lead = id(40), assessment = id(41), scenario = id(42), report = id(43), template = id(44), draft = id(45);
      const offer = (overrides: Partial<Record<string, string>> = {}) => JSON.stringify({ id: overrides.id ?? "plan-1", plan_id: overrides.plan_id ?? "plan-1", product_id: overrides.product_id ?? "product-1", price_version: overrides.price_version ?? "price-1", destination: overrides.destination ?? "https://example.invalid/offer" });
      const reportOffer = offer();
      sql(`insert into local_business_leads(id,business_name,status,email) values('${lead}','Claim identity fixture','assessed','claim@example.invalid');
        insert into local_business_lead_assessments(id,lead_id,assessed_at) values('${assessment}','${lead}',now());
        insert into opportunity_scenarios(id,slug,name,status,version) values('${scenario}','claim-identity','Claim identity','active',1);
        insert into opportunity_scenario_reports(id,lead_id,assessment_id,scenario_id,fingerprint,report) values('${report}','${lead}','${assessment}','${scenario}',repeat('c',64),jsonb_build_object('business',jsonb_build_object('id','${lead}'),'scenario',jsonb_build_object('id','${scenario}','key','claim-identity','version',1),'offer','${reportOffer}'::jsonb));
        insert into opportunity_outreach_templates(id,version,name,scenario_keys,combined,subject,body,offer_id,product_id,destination,destination_verified_at,enabled) values('${template}',1,'Claim identity',array['claim-identity'],false,'Subject','Body','plan-1','product-1','https://example.invalid/offer',now(),true);
        insert into local_business_outreach_drafts(id,lead_id,subject,body,status,selection,scenario_id,scenario_version,approval_fingerprint,approved_current_assessment_id,approved_scenario_report_id,approved_scenario_report_fingerprint,approved_scenario_report_references,approved_billing_offer_id,approved_recipient,approved_destination_url,approved_commercial_reference) values('${draft}','${lead}','Subject','Body','approved',jsonb_build_object('template_id','${template}','template_version',1,'scenario_keys',array['claim-identity'],'offer_id','plan-1','product_id','product-1','destination','https://example.invalid/offer','assessment_id','${assessment}','report_ids',array['${report}']), '${scenario}',1,repeat('a',64),'${assessment}','${report}',repeat('c',64),jsonb_build_array(jsonb_build_object('id','${report}','scenario_id','${scenario}','fingerprint',repeat('c',64))),'plan-1','claim@example.invalid','https://example.invalid/offer',jsonb_build_object('offer_id','plan-1','catalogue',jsonb_build_array('${reportOffer}'::jsonb)));`);
      const mismatches = [
        { name: "offer", value: { id: "plan-2" } },
        { name: "plan", value: { plan_id: "plan-2" } },
        { name: "product", value: { product_id: "product-2" } },
        { name: "price", value: { price_version: "price-2" } },
        { name: "destination", value: { destination: "https://example.invalid/other" } },
      ];
      for (const [index, mismatch] of mismatches.entries()) {
        const billing = offer(mismatch.value);
        sql(`update local_business_outreach_drafts set approved_commercial_reference=jsonb_build_object('offer_id','plan-1','catalogue',jsonb_build_array('${billing}'::jsonb)) where id='${draft}';`);
        const result = sql(`select opportunity_claim_outreach_send('${draft}','${id(50 + index)}',repeat('a',64),'${assessment}','${scenario}','${report}',repeat('c',64),null,null,'claim@example.invalid','https://example.invalid/offer',jsonb_build_object('lead_id','${lead}','approval_fingerprint',repeat('a',64),'recipient','claim@example.invalid','destination_url','https://example.invalid/offer','subject','Subject','body','Body','billing',jsonb_build_object('offer_id','plan-1','catalogue',jsonb_build_array('${billing}'::jsonb)),'scenario_report_references',jsonb_build_array(jsonb_build_object('id','${report}','scenario_id','${scenario}','fingerprint',repeat('c',64)))),120)->>'error';`);
        expect(result).toBe("commercial_snapshot_mismatch");
      }
    });

    it("installs the canonical attempt ledger, lead relationship and active-send index", () => {
      expect(sql("select count(*) from information_schema.columns where table_name='opportunity_outreach_send_attempts' and column_name='lead_id'")).toBe("1");
      expect(sql("select count(*) from pg_indexes where indexname='opportunity_outreach_send_attempts_active_idx'")).toBe("1");
      expect(sql("select relrowsecurity from pg_class where oid='public.opportunity_outreach_send_attempts'::regclass")).toBe("t");
      expect(sql("select has_table_privilege('service_role','opportunity_outreach_send_attempts','INSERT')")).toBe("f");
    });

    it("rolls back an injected migration failure without leaving partial schema", () => {
      const marker = "__outreach_rehearsal_partial_schema";
      const injected = readFileSync("supabase/migrations/20261108090000_outreach_send_boundary_hardening.sql", "utf8")
        .replace("begin;", `begin; create table public.${marker}(id integer); do $$ begin raise exception 'injected_migration_failure'; end $$;`);
      expect(() => sql(injected)).toThrow();
      expect(sql(`select to_regclass('public.${marker}')`)).toBe("");
    });

    it("fails closed for direct service-role ledger mutation and retired claim RPCs", () => {
      expect(() =>
        sql(`set role service_role;
          insert into opportunity_outreach_send_attempts
            (draft_id,attempt_id,state,approval_fingerprint,send_snapshot,recipient,destination_url,expires_at)
          values ('${id(3)}','${id(4)}','claimed',repeat('a',64),'{}','legacy@example.invalid','https://example.invalid',now());
          reset role;`),
      ).toThrow();
      expect(() =>
        sql(`select public.claim_scenario_outreach_send('${id(3)}','${id(1)}','Legacy subject','Legacy body','{}'::jsonb,now(),'legacy@example.invalid','{"recipient":"legacy@example.invalid","live":false,"overridden":true}'::jsonb)`),
      ).toThrow();
      expect(sql(`select count(*) from opportunity_outreach_send_attempts where draft_id='${id(3)}'`)).toBe("0");
    });

    it("adds immutable audit identity evidence for existing and new audit reports", () => {
      sql(`insert into local_business_audit_reports(id,lead_id,assessment_id,report_version,generated_by)
        values ('${id(5)}','${id(1)}','${id(2)}','rehearsal','${id(6)}')`);
      expect(sql(`select length(outreach_identity_fingerprint) from local_business_audit_reports where id='${id(5)}'`)).toBe("32");
      expect(sql("select count(*) from pg_trigger where tgname='set_audit_identity_fingerprint'")).toBe("1");
    });

    it("serializes concurrent claims for the same draft", async () => {
      const results = await Promise.allSettled([
        asyncSql(attemptSql(110, 200, "claimed", "now()", 10)),
        asyncSql(attemptSql(110, 201, "claimed", "now()", 10)),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(sql(`select count(*) from opportunity_outreach_send_attempts where draft_id='${id(110)}' and state='claimed'`)).toBe("1");
    });

    it("serializes concurrent active claims across different drafts for one lead", async () => {
      sql(`insert into local_business_outreach_drafts(id,lead_id,subject,body,status,selection,updated_at)
        values ('${id(122)}','${id(10)}','Subject extra','Body extra','draft','{}',now())`);
      const results = await Promise.allSettled([
        asyncSql(attemptSql(111, 210, "claimed", "now()", 11)),
        asyncSql(attemptSql(122, 211, "claimed", "now()", 10)),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(sql(`select count(*) from opportunity_outreach_send_attempts where lead_id='${id(10)}' and state='claimed'`)).toBe("1");
    });

    it("rejects direct snapshot and identity mutations for application and service roles", () => {
      sql(attemptSql(112, 220, "claimed"));
      expect(() => sql(`update opportunity_outreach_send_attempts set send_snapshot='{"altered":true}' where attempt_id='${id(220)}'`)).toThrow();
      expect(() => sql(`set role service_role; update opportunity_outreach_send_attempts set recipient='changed@example.invalid' where attempt_id='${id(220)}'; reset role;`)).toThrow();
      expect(() => sql(`set role authenticated; update opportunity_outreach_send_attempts set recipient='changed@example.invalid' where attempt_id='${id(220)}'; reset role;`)).toThrow();
    });

    it("recovers expired claims and sending leases into distinct safe states", () => {
      sql(attemptSql(113, 230, "claimed", "now()-interval '1 second'", 13));
      expect(sql(`select public.opportunity_recover_outreach_send('${id(113)}','${id(230)}',300)->>'state'`)).toContain("failed");
      expect(sql(`select count(*) from opportunity_console_audit_log where draft_id='${id(113)}' and action='outreach_send_recovered'`)).toBe("1");
      sql(attemptSql(114, 231, "sending", "now()", 14));
      sql(`begin; select set_config('app.outreach_attempt_rpc','on',true); update opportunity_outreach_send_attempts set sending_at=now()-interval '600 seconds' where attempt_id='${id(231)}'; commit;`);
      expect(sql(`select public.opportunity_recover_outreach_send('${id(114)}','${id(231)}',300)->>'state'`)).toContain("send_unknown");
      expect(sql(`select retry_authorized from opportunity_outreach_send_attempts where attempt_id='${id(231)}'`)).toBe("f");
    });

    it("serializes concurrent recovery and reconciliation outcomes", async () => {
      sql(attemptSql(115, 232, "claimed", "now()-interval '1 second'", 15));
      const recoveries = await Promise.allSettled([
        asyncSql(`select public.opportunity_recover_outreach_send('${id(115)}','${id(232)}',300)`),
        asyncSql(`select public.opportunity_recover_outreach_send('${id(115)}','${id(232)}',300)`),
      ]);
      expect(recoveries.every((result) => result.status === "fulfilled")).toBe(true);
      expect(sql(`select state from opportunity_outreach_send_attempts where attempt_id='${id(232)}'`)).toBe("failed");

      sql(attemptSql(116, 233, "sending", "now()", 16));
      expect(sql(`select public.opportunity_finish_outreach_send('${id(116)}','${id(233)}','send_unknown','transport uncertain')->>'state'`)).toContain("send_unknown");
      expect(sql(`select count(*) from opportunity_console_audit_log where draft_id='${id(116)}' and action='outreach_send_uncertain'`)).toBe("1");
      const reconciliations = await Promise.all([
        asyncSql(`begin; select set_config('request.jwt.claim.role','service_role',true); select public.opportunity_reconcile_outreach_send('${id(116)}','${id(233)}','confirmed_sent','service_role','confirmed by provider'); commit;`),
        asyncSql(`begin; select set_config('request.jwt.claim.role','service_role',true); select public.opportunity_reconcile_outreach_send('${id(116)}','${id(233)}','confirmed_not_sent','service_role','provider says not sent'); commit;`),
      ]);
      expect(reconciliations).toHaveLength(2);
      expect(sql(`select state from opportunity_outreach_send_attempts where attempt_id='${id(233)}'`)).toMatch(/^(sent|failed)$/);
      expect(sql(`select count(*) from opportunity_console_audit_log where draft_id='${id(116)}' and action='outreach_send_reconciled'`)).toBe("1");
    });

    it("fails closed for unauthorised reconciliation and invalid reasons or outcomes", () => {
      sql(attemptSql(117, 234, "sending", "now()", 17));
      sql(`select public.opportunity_finish_outreach_send('${id(117)}','${id(234)}','send_unknown','transport uncertain')`);
      expect(sql(`begin; select set_config('request.jwt.claim.role','authenticated',true); select public.opportunity_reconcile_outreach_send('${id(117)}','${id(234)}','confirmed_sent','authenticated','x'); rollback;`)).toContain("unauthorized");
      expect(sql(`begin; select set_config('request.jwt.claim.role','service_role',true); select public.opportunity_reconcile_outreach_send('${id(117)}','${id(234)}','still_unknown','service_role',''); rollback;`)).toContain("reconciliation_reason_required");
      expect(sql(`begin; select set_config('request.jwt.claim.role','service_role',true); select public.opportunity_reconcile_outreach_send('${id(117)}','${id(234)}','bogus','service_role','x'); rollback;`)).toContain("invalid_reconciliation_outcome");
      expect(sql(`begin; select set_config('request.jwt.claim.role','service_role',true); select public.opportunity_reconcile_outreach_send('${id(117)}','${id(234)}','still_unknown','service_role',repeat('x',501)); rollback;`)).toContain("reconciliation_reason_required");
    });

    it("rolls back a terminal transition when audit insertion fails", () => {
      sql(attemptSql(118, 235, "sending", "now()", 18));
      sql("create function fixture_reject_outreach_audit() returns trigger language plpgsql as $$begin if new.action='outreach_send_failed' then raise exception 'audit unavailable'; end if; return new; end;$$; create trigger fixture_reject_outreach_audit before insert on opportunity_console_audit_log for each row execute function fixture_reject_outreach_audit();");
      expect(() => sql(`select public.opportunity_finish_outreach_send('${id(118)}','${id(235)}','failed','transport failed')`)).toThrow();
      expect(sql(`select state from opportunity_outreach_send_attempts where attempt_id='${id(235)}'`)).toBe("sending");
      sql("drop trigger fixture_reject_outreach_audit on opportunity_console_audit_log; drop function fixture_reject_outreach_audit();");
    });

    it("preserves terminal history across archive and restore and blocks lead deletion", () => {
      sql(attemptSql(119, 236, "sending", "now()", 19));
      sql(`select public.opportunity_finish_outreach_send('${id(119)}','${id(236)}','sent',null)`);
      expect(sql(`select count(*) from opportunity_console_audit_log where draft_id='${id(119)}' and action='outreach_sent'`)).toBe("1");
      expect(() => sql(`set role service_role; update opportunity_outreach_send_attempts set state='failed' where attempt_id='${id(236)}'; reset role;`)).toThrow();
      expect(() => sql(`set role authenticated; delete from opportunity_outreach_send_attempts where attempt_id='${id(236)}'; reset role;`)).toThrow();
      expect(sql(`select (public.set_opportunity_archived('${id(19)}',true,'retain send evidence'))->>'ok'`)).toContain("true");
      expect(sql(`select state from opportunity_outreach_send_attempts where attempt_id='${id(236)}'`)).toBe("sent");
      expect(sql(`select (public.set_opportunity_archived('${id(19)}',false,null))->>'ok'`)).toContain("true");
      expect(() => sql(`delete from local_business_leads where id='${id(20)}'`)).toThrow();
    });

    it("denies truncation and retains referenced audit evidence", () => {
      sql(`insert into local_business_lead_assessments(id,lead_id) values ('${id(241)}','${id(20)}');
        insert into local_business_audit_reports(id,lead_id,assessment_id,report_version,generated_by) values ('${id(242)}','${id(20)}','${id(241)}','retention','${id(6)}');
        insert into local_business_outreach_drafts(id,lead_id,subject,body,status,selection,updated_at) values ('${id(123)}','${id(20)}','Retention','Retention body','draft','{}',now());`);
      sql(`begin; select set_config('app.outreach_attempt_rpc','on',true); insert into opportunity_outreach_send_attempts(lead_id,draft_id,attempt_id,state,audit_report_id,audit_report_fingerprint,approval_fingerprint,send_snapshot,recipient,destination_url,expires_at) values ('${id(20)}','${id(123)}','${id(243)}','sent','${id(242)}',(select outreach_identity_fingerprint from local_business_audit_reports where id='${id(242)}'),repeat('b',64),'{}','lead20@example.invalid','https://example.invalid/offer',now()); commit;`);
      expect(() => sql(`set role service_role; truncate opportunity_outreach_send_attempts; reset role;`)).toThrow();
      expect(() => sql(`delete from local_business_audit_reports where id='${id(242)}'`)).toThrow();
      expect(sql(`select state from opportunity_outreach_send_attempts where attempt_id='${id(243)}'`)).toBe("sent");
    });
  },
);
