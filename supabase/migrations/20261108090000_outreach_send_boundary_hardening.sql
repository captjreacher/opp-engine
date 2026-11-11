-- Bind Website send claims to the Billing product and plan identities that
-- were persisted in the approved scenario report. Older reports without these
-- identities fail closed and must be regenerated and re-approved.
begin;

alter table public.opportunity_outreach_templates
  add column if not exists product_id text;

update public.opportunity_outreach_templates
set product_id = offer_id
where product_id is null
  and id in ('9f6c67f4-33d8-4d84-97f1-2b07e4210a01'::uuid,
             '9f6c67f4-33d8-4d84-97f1-2b07e4210a02'::uuid);

create or replace function public.opportunity_claim_outreach_send(
  p_draft_id uuid, p_attempt_id uuid, p_approval_fingerprint text,
  p_current_assessment_id uuid, p_scenario_id uuid, p_scenario_report_id uuid,
  p_scenario_report_fingerprint text, p_audit_report_id uuid,
  p_audit_report_fingerprint text, p_recipient text, p_destination_url text,
  p_snapshot jsonb, p_claim_ttl_seconds integer default 120
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  d public.local_business_outreach_drafts%rowtype;
  a public.opportunity_outreach_send_attempts%rowtype;
  ar public.opportunity_scenario_reports%rowtype;
  audit_row public.local_business_audit_reports%rowtype;
  latest_assessment uuid;
  template_offer text;
  template_product text;
  template_destination text;
  report_ref record;
  billing_row jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_draft_id::text,0));
  select * into d from public.local_business_outreach_drafts where id=p_draft_id for update;
  if not found then return jsonb_build_object('ok',false,'error','draft_not_found'); end if;
  if d.status='sent' or d.sent_at is not null then return jsonb_build_object('ok',false,'error','already_sent'); end if;
  if d.status<>'approved' then return jsonb_build_object('ok',false,'error','not_approved'); end if;
  if d.lead_id is distinct from (p_snapshot->>'lead_id')::uuid
     or p_snapshot->>'approval_fingerprint' is distinct from p_approval_fingerprint
     or p_snapshot->>'recipient' is distinct from p_recipient
     or p_snapshot->>'destination_url' is distinct from p_destination_url
     or p_snapshot->>'subject' is distinct from coalesce(d.subject,'')
     or p_snapshot->>'body' is distinct from coalesce(d.body,'')
     or p_snapshot->'billing' is distinct from d.approved_commercial_reference
     or p_snapshot->'scenario_report_references' is distinct from coalesce(d.approved_scenario_report_references,'[]'::jsonb)
  then return jsonb_build_object('ok',false,'error','approval_snapshot_stale'); end if;
  if d.approval_fingerprint is distinct from p_approval_fingerprint
     or d.approved_current_assessment_id is distinct from p_current_assessment_id
     or d.approved_scenario_report_id is distinct from p_scenario_report_id
     or d.approved_scenario_report_fingerprint is distinct from p_scenario_report_fingerprint
     or d.approved_audit_report_id is distinct from p_audit_report_id
     or d.approved_audit_report_fingerprint is distinct from p_audit_report_fingerprint
     or d.approved_recipient is distinct from p_recipient
     or d.approved_destination_url is distinct from p_destination_url
     or p_snapshot is null
     or p_snapshot->>'subject' is distinct from coalesce(d.subject,'')
     or p_snapshot->>'body' is distinct from coalesce(d.body,'')
  then return jsonb_build_object('ok',false,'error','approval_snapshot_stale'); end if;
  select id into latest_assessment from public.local_business_lead_assessments
  where lead_id=d.lead_id order by assessed_at desc limit 1;
  if latest_assessment is distinct from p_current_assessment_id then return jsonb_build_object('ok',false,'error','assessment_stale'); end if;
  if p_scenario_report_id is null or p_scenario_report_fingerprint is null then return jsonb_build_object('ok',false,'error','scenario_report_required'); end if;
  select * into ar from public.opportunity_scenario_reports
  where id=p_scenario_report_id and lead_id=d.lead_id and assessment_id=p_current_assessment_id
    and scenario_id=p_scenario_id and fingerprint=p_scenario_report_fingerprint;
  if not found then return jsonb_build_object('ok',false,'error','scenario_report_identity_mismatch'); end if;
  billing_row := p_snapshot->'billing'->'catalogue'->0;
  if billing_row is null
     or billing_row->>'id' is null
     or billing_row->>'plan_id' is null
     or billing_row->>'product_id' is null
     or billing_row->>'price_version' is null
     or billing_row->>'destination' is null
     or billing_row->>'id' is distinct from ar.report->'offer'->>'id'
     or billing_row->>'plan_id' is distinct from ar.report->'offer'->>'plan_id'
     or billing_row->>'product_id' is distinct from ar.report->'offer'->>'product_id'
     or billing_row->>'price_version' is distinct from ar.report->'offer'->>'price_version'
     or billing_row->>'destination' is distinct from ar.report->'offer'->>'destination' then
    return jsonb_build_object('ok',false,'error','commercial_snapshot_mismatch');
  end if;
  if exists (select 1 from public.opportunity_scenario_reports newer
    where newer.lead_id=ar.lead_id and newer.assessment_id=ar.assessment_id
      and newer.scenario_id=ar.scenario_id and newer.created_at>ar.created_at) then
    return jsonb_build_object('ok',false,'error','scenario_report_superseded');
  end if;
  if jsonb_typeof(p_snapshot->'scenario_report_references') <> 'array' or jsonb_array_length(p_snapshot->'scenario_report_references') = 0 then
    return jsonb_build_object('ok',false,'error','scenario_report_references_required');
  end if;
  for report_ref in select * from jsonb_to_recordset(p_snapshot->'scenario_report_references') as refs(id uuid,scenario_id uuid,fingerprint text) loop
    if not exists (select 1 from public.opportunity_scenario_reports r
      where r.id=report_ref.id and r.lead_id=d.lead_id and r.assessment_id=p_current_assessment_id
        and r.scenario_id=report_ref.scenario_id and r.fingerprint=report_ref.fingerprint) then
      return jsonb_build_object('ok',false,'error','scenario_report_identity_mismatch');
    end if;
    if exists (select 1 from public.opportunity_scenario_reports newer
      where newer.lead_id=d.lead_id and newer.assessment_id=p_current_assessment_id
        and newer.scenario_id=report_ref.scenario_id and newer.created_at >
          (select r.created_at from public.opportunity_scenario_reports r where r.id=report_ref.id)) then
      return jsonb_build_object('ok',false,'error','scenario_report_superseded');
    end if;
  end loop;
  if p_audit_report_id is not null then
    select * into audit_row from public.local_business_audit_reports
    where id=p_audit_report_id and lead_id=d.lead_id and assessment_id=p_current_assessment_id
      and outreach_identity_fingerprint=p_audit_report_fingerprint;
    if not found then return jsonb_build_object('ok',false,'error','audit_report_identity_mismatch'); end if;
  elsif d.approved_audit_report_id is not null then
    return jsonb_build_object('ok',false,'error','audit_report_required');
  end if;
  begin
    select offer_id,product_id,destination into template_offer,template_product,template_destination
    from public.opportunity_outreach_templates where id=(d.selection->>'template_id')::uuid and enabled=true;
  exception when invalid_text_representation then
    return jsonb_build_object('ok',false,'error','commercial_reference_invalid');
  end;
  if template_offer is null or template_product is null
     or template_offer is distinct from d.approved_billing_offer_id
     or template_destination is distinct from p_destination_url
     or d.selection->>'offer_id' is distinct from template_offer
     or template_product is distinct from ar.report->'offer'->>'product_id'
     or d.selection->>'product_id' is distinct from template_product
     or d.selection->>'destination' is distinct from template_destination then
    return jsonb_build_object('ok',false,'error','commercial_reference_invalid');
  end if;
  perform set_config('app.outreach_attempt_rpc','on',true);
  select * into a from public.opportunity_outreach_send_attempts where draft_id=p_draft_id and state in ('claimed','sending','send_unknown') order by created_at desc limit 1 for update;
  if found then return jsonb_build_object('ok',false,'error',case when a.state='send_unknown' then 'send_unknown' else 'send_in_progress' end,'attempt_id',a.attempt_id); end if;
  insert into public.opportunity_outreach_send_attempts(
    lead_id,draft_id,attempt_id,state,current_assessment_id,scenario_id,scenario_report_id,
    scenario_report_fingerprint,audit_report_id,audit_report_fingerprint,
    approval_fingerprint,send_snapshot,recipient,destination_url,expires_at)
  values (d.lead_id,p_draft_id,p_attempt_id,'claimed',p_current_assessment_id,p_scenario_id,p_scenario_report_id,
    p_scenario_report_fingerprint,p_audit_report_id,p_audit_report_fingerprint,p_approval_fingerprint,
    p_snapshot,p_recipient,p_destination_url,now()+make_interval(secs=>greatest(30,least(p_claim_ttl_seconds,900))));
  return jsonb_build_object('ok',true,'state','claimed','attempt_id',p_attempt_id);
exception when unique_violation then return jsonb_build_object('ok',false,'error','send_in_progress');
end; $$;

commit;
