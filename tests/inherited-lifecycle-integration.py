"""Disposable PostgreSQL integration suite, derived from the preserved PR #16 review.
Requires psycopg 3 and the proposed migration on opp_inherited_test_verified/127.0.0.1:55486.
Synthetic records only. No provider/SMTP calls. net.http_post must be a local
recording stub; see docs/opportunity-lifecycle.md. Results include explicit
contract gates, not a certification of Cockpit compatibility or production.
"""
from pathlib import Path
import psycopg, json, uuid, threading, time, sys
ROOT=Path(sys.argv[1]) if len(sys.argv)>1 else Path.cwd()
# Deliberately fixed disposable loopback target. Never accept a production DSN.
DSN='host=127.0.0.1 port=55486 user=postgres dbname=opp_inherited_test_verified'
results=[]
def connect(role='service_role', autocommit=False):
    c=psycopg.connect(DSN,autocommit=autocommit)
    assert c.info.host=='127.0.0.1' and c.info.port==55486
    assert c.execute('select inet_server_port(),current_database()').fetchone()==(5432,'opp_inherited_test_verified')
    assert 'net.test_requests' in c.execute("select pg_get_functiondef('net.http_post(text,jsonb,jsonb,jsonb,integer)'::regprocedure)").fetchone()[0], 'a non-networked recording stub is mandatory'
    c.execute('set statement_timeout=10000')
    c.execute('set role '+role)
    if not autocommit:c.commit()
    return c
def scalar(c,q,p=()):return c.execute(q,p).fetchone()[0]
def lead(c):
    i=uuid.uuid4()
    c.execute("insert into local_business_leads(id,business_name,email,source) values(%s,%s,%s,'disposable-lifecycle-review')",(i,'TEST '+str(i),str(i)+'@example.invalid'))
    return i
def archive(c,i,state=True):return scalar(c,'select set_opportunity_archived(%s,%s)',(i,state))
def draft(c,i,status='draft'):
    return scalar(c,"insert into local_business_outreach_drafts(lead_id,body,status,sent_at,selection) values(%s,'TEST retained content',%s,case when %s='sent' then now() else null end,'{}'::jsonb) returning id",(i,status,status))
def claim(c,i,d):
    row=c.execute('select d.updated_at,l.email,d.subject,d.body,d.selection from local_business_outreach_drafts d join local_business_leads l on l.id=d.lead_id where d.id=%s',(d,)).fetchone()
    c.execute('select claim_scenario_outreach_send(%s,%s,%s,%s,%s::jsonb,%s,%s,%s::jsonb)',(d,i,row[2],row[3],json.dumps(row[4]),row[0],row[1],json.dumps(dict(recipient=row[1],live=False,overridden=False,transport='smtp'))))
    return d

def complete(c,i,d,receipt,sent):
    assert receipt==d
    return scalar(c,'select complete_scenario_outreach_send(%s,%s,%s,%s)',(i,d,sent,'synthetic transport only'))

def denied(c,q,p,code,message=None):
    c.execute('savepoint expect_failure')
    try:c.execute(q,p)
    except psycopg.Error as e:
        c.execute('rollback to savepoint expect_failure')
        assert e.sqlstate==code,(e.sqlstate,str(e))
        if message:assert message in str(e) or (message=='send_in_progress' and 'send_claim_requires_reconciliation' in str(e)),str(e)
        return
    raise AssertionError('operation unexpectedly succeeded')
def test(name,fn):
    try:
        detail=fn()
        results.append(dict(name=name,status='PASS',detail=detail))
    except Exception as e:results.append(dict(name=name,status='FAIL',detail=str(e)))
    print(results[-1],flush=True)
def permissions():
    with connect() as c:
        i=lead(c); archive(c,i); archive(c,i,False)
        for role in ['anon','authenticated']:
            c.execute('set role '+role)
            denied(c,'select set_opportunity_archived(%s,true)',(i,),'42501')
            c.execute('set role service_role')
        c.execute('set role authenticated')
        denied(c,"update local_business_leads set archived_at=now(),archived_by='forged' where id=%s",(i,),'42501','lifecycle_operator_required')
        c.rollback()
def atomicity():
    with connect('postgres') as c:
        i=lead(c)
        c.execute("create function test_reject_audit() returns trigger language plpgsql as $$begin if new.action='opportunity_archived' then raise exception 'injected_audit_failure'; end if; return new; end$$")
        c.execute('create trigger zz_test_reject_audit before insert on opportunity_console_audit_log for each row execute function test_reject_audit()')
        c.execute('set role service_role')
        denied(c,'select set_opportunity_archived(%s,true)',(i,),'P0001','injected_audit_failure')
        assert scalar(c,'select archived_at is null from local_business_leads where id=%s',(i,))
        assert scalar(c,"select count(*) from opportunity_console_audit_log where lead_id=%s and action='opportunity_archived'",(i,))==0
        c.rollback()
def retention():
    with connect() as c:
        i=lead(c)
        a=scalar(c,'insert into local_business_lead_assessments(lead_id) values(%s) returning id',(i,))
        c.execute("insert into local_business_audit_reports(lead_id,assessment_id,report_version) values(%s,%s,'TEST')",(i,a))
        draft(c,i)
        c.execute("insert into local_business_lead_signals(lead_id,signal_type) values(%s,'TEST')",(i,))
        tables=['local_business_lead_assessments','local_business_audit_reports','local_business_outreach_drafts','local_business_lead_signals','local_business_lead_events']
        before={t:c.execute('select to_jsonb(t) from '+t+' t where lead_id=%s order by id',(i,)).fetchall() for t in tables}
        archive(c,i)
        for t in tables[:-1]:denied(c,'delete from '+t+' where lead_id=%s',(i,),'P0001','opportunity_archived')
        archive(c,i,False)
        after={t:c.execute('select to_jsonb(t) from '+t+' t where lead_id=%s order by id',(i,)).fetchall() for t in tables}
        assert before==after
        c.rollback()
def handoff():
    with connect() as c:
        i=lead(c); d=draft(c,i,'sent'); archive(c,i)
        r=scalar(c,"select opportunity_attempt_cockpit_handoff(%s,'{\"live\":true,\"overridden\":false}'::jsonb)",(d,))
        assert r.get('ok'),r
        contact=r['contact_id']
        assert scalar(c,'select cockpit_handoff_status from local_business_outreach_drafts where id=%s',(d,))=='completed'
        again=scalar(c,"select opportunity_attempt_cockpit_handoff(%s,'{\"live\":true}'::jsonb)",(d,))
        assert again.get('idempotent') and again['contact_id']==contact,again
        assert scalar(c,'select count(*) from opportunity_contact_handoffs where source_outreach_id=%s',(d,))==1
        assert scalar(c,"select check_prospect_eligibility(null,%s,null)->>'classification'",(str(i)+'@example.invalid',))=='previously_contacted'
        denied(c,"update local_business_outreach_drafts set body='changed' where id=%s",(d,),'P0001','opportunity_archived')
        archive(c,i,False)
        assert scalar(c,'select cockpit_contact_id::text from local_business_outreach_drafts where id=%s',(d,))==contact
        c.rollback()
def visual_gap():
    with connect() as c:
        i=lead(c)
        e=scalar(c,"insert into local_business_visual_evidence(lead_id,source) values(%s,'operator_upload') returning id",(i,))
        a=scalar(c,'insert into local_business_visual_assessments(lead_id,evidence_id) values(%s,%s) returning id',(i,e))
        f=scalar(c,"insert into local_business_visual_findings(assessment_id,category,condition,confidence,evidence_description) values(%s,'fencing','TEST',0.8,'retained evidence') returning id",(a,))
        archive(c,i)
        denied(c,"update local_business_visual_findings set evidence_description='changed while archived' where id=%s",(f,),'P0001','opportunity_archived')
        c.rollback()
def indirect_gap():
    with connect() as c:
        i=lead(c); j=lead(c)
        e=scalar(c,"insert into local_business_visual_evidence(lead_id,source) values(%s,'operator_upload') returning id",(i,))
        archive(c,i)
        denied(c,'insert into local_business_visual_assessments(lead_id,evidence_id) values(%s,%s)',(j,e),'P0001','opportunity_archived')
        c.rollback()
def cockpit_delete():
    with connect('authenticated') as c:
        i=lead(c)
        denied(c,'delete from local_business_leads where id=%s',(i,),'42501','permanent_deletion_unavailable')
        c.rollback()
def legacy_archive():
    with connect() as c:
        i=lead(c); c.execute("update local_business_leads set status='archived' where id=%s",(i,))
        assert scalar(c,"select archived_at is not null or status='archived' from local_business_leads where id=%s",(i,))
        denied(c,'select set_opportunity_archived(%s,false)',(i,),'P0001','legacy_archive_review_required')
        assert scalar(c,'select archived_at is null from local_business_leads where id=%s',(i,))
        c.rollback()
def approved_demotion():
    # Simulate sender after its approved SELECT, paused before external SMTP.
    # No email is sent. These are the intervening writes permitted by the API.
    with connect() as c:
        i=lead(c); d=draft(c,i,'approved')
        assert scalar(c,'select status from local_business_outreach_drafts where id=%s',(d,))=='approved'
        claim(c,i,d)
        denied(c,"update local_business_outreach_drafts set status='draft' where id=%s",(d,),'P0001','send_in_progress')
        denied(c,'select set_opportunity_archived(%s,true)',(i,),'P0001','send_in_progress')
        c.rollback()
def discovery():
    with connect() as c:
        i=lead(c)
        website='https://'+str(i)+'.example.invalid'
        c.execute('update local_business_leads set website_url=%s where id=%s',(website,i))
        archive(c,i)
        r=scalar(c,"insert into opportunity_discovery_runs(location,industry) values('Auckland','TEST') returning id")
        candidate=scalar(c,"insert into opportunity_discovery_candidates(run_id,source_identifier,business_name,normalized_identity,location,website_url) values(%s,%s,%s,%s,'Auckland',%s) returning id",(r,str(i),'TEST '+str(i),str(i)+'|auckland',website))
        result=scalar(c,'select opportunity_import_discovery_candidate(%s)',(candidate,))
        assert result.get('ok') and result['lead_id']==str(i) and not result['created'],result
        assert scalar(c,'select archived_at is not null from local_business_leads where id=%s',(i,))
        c.rollback()
def event_history_gap():
    with connect() as c:
        i=lead(c)
        c.execute("insert into opportunity_console_audit_log(action,lead_id) values('opportunity_review_completed',%s)",(i,))
        archive(c,i)
        denied(c,"delete from opportunity_console_audit_log where lead_id=%s and action='opportunity_review_completed'",(i,),'P0001','opportunity_archived')
        c.rollback()
def truncate_gap():
    with connect() as c:
        assert scalar(c,"select has_table_privilege(current_user,'local_business_leads','TRUNCATE')")
        denied(c,'truncate local_business_leads cascade',(),'42501','permanent_deletion_unavailable')
        c.rollback()
def handoff_modes():
    with connect() as c:
        for mode in ['test','failed','customer']:
            i=lead(c); d=draft(c,i,'sent')
            if mode=='failed':c.execute('update local_business_leads set email=null where id=%s',(i,))
            if mode=='customer':
                c.execute("insert into contacts(email,business_name,lead_status,lifecycle_stage,relationship_types,source_system) values(%s,'TEST retained customer','converted','customer',array['client'],'disposable-review')",(str(i)+'@example.invalid',))
            archive(c,i)
            r=scalar(c,'select opportunity_attempt_cockpit_handoff(%s,%s::jsonb)',(d,json.dumps({'live':mode!='test','overridden':False})))
            if mode=='test':assert r.get('handoff_status')=='skipped',r
            if mode=='failed':assert not r.get('ok') and r.get('handoff_status')=='failed',r
            if mode=='customer':
                assert r.get('ok'),r
                state=c.execute('select lead_status,lifecycle_stage from contacts where id=%s',(r['contact_id'],)).fetchone()
                assert state==('converted','customer'),state
        c.rollback()
def race(kind,first):
    setup=connect(autocommit=True); i=lead(setup); d=draft(setup,i) if kind=='approval' else None; setup.close()
    a=connect(); b=connect(); monitor=connect('postgres',True)
    opq="select queue_local_business_enrichment(%s,'http://example.invalid','TEST-only',false)"
    if kind=='claim':opq="update local_business_leads set enrichment_status='enriching' where id=%s returning id"
    if kind=='approval':opq="update local_business_outreach_drafts set status='approved' where id=%s returning id"
    p=(d if kind=='approval' else i,)
    aq='select set_opportunity_archived(%s,true)'
    q1,p1=(aq,(i,)) if first=='archive' else (opq,p)
    q2,p2=(opq,p) if first=='archive' else (aq,(i,))
    a.execute(q1,p1)
    result={}
    def contender():
        try:result['row']=b.execute(q2,p2).fetchone(); b.commit()
        except psycopg.Error as e:result.update(code=e.sqlstate,error=str(e)); b.rollback()
    t=threading.Thread(target=contender); t.start()
    waited=False
    for _ in range(100):
        waiting=scalar(monitor,"select wait_event_type='Lock' from pg_stat_activity where pid=%s",(b.info.backend_pid,))
        if waiting:waited=True;break
        if not t.is_alive():break
        time.sleep(.02)
    a.commit();t.join(12)
    assert waited,'contender did not block on first transaction'
    assert not t.is_alive(),'contender did not finish'
    expected='opportunity_archived' if first=='archive' else ('approved_outreach_conflict' if kind=='approval' else 'enrichment_running')
    assert result.get('code')=='P0001' and expected in result.get('error',''),result
    archived=scalar(monitor,'select archived_at is not null from local_business_leads where id=%s',(i,))
    assert archived==(first=='archive')
    requests=scalar(monitor,"select count(*) from net.test_requests where body->>'lead_id'=%s",(str(i),))
    assert requests==(1 if kind=='queue' and first!='archive' else 0),requests
    a.close();b.close();monitor.close()
    return dict(blocked=True,loser=expected,recorded_network_requests=requests)
def more_race(kind,first):
    setup=connect(autocommit=True); i=lead(setup); d=draft(setup,i,'sent') if kind=='handoff' else None;setup.close()
    a=connect();b=connect();monitor=connect('postgres',True)
    aq='select set_opportunity_archived(%s,true)'
    if kind=='idempotency':opq=aq;p=(i,)
    elif kind=='handoff':opq="select opportunity_attempt_cockpit_handoff(%s,'{\"live\":true}'::jsonb)";p=(d,)
    else:opq="insert into opportunity_console_audit_log(action,lead_id) values('opportunity_review_completed',%s) returning id";p=(i,)
    q1,p1=(aq,(i,)) if first=='archive' else (opq,p)
    q2,p2=(opq,p) if first=='archive' else (aq,(i,))
    a.execute(q1,p1);result={}
    def contender():
        try:result['row']=b.execute(q2,p2).fetchone();b.commit()
        except psycopg.Error as e:result.update(code=e.sqlstate,error=str(e));b.rollback()
    t=threading.Thread(target=contender);t.start();waited=False
    for _ in range(100):
        if scalar(monitor,"select wait_event_type='Lock' from pg_stat_activity where pid=%s",(b.info.backend_pid,)):waited=True;break
        if not t.is_alive():break
        time.sleep(.02)
    a.commit();t.join(12)
    assert waited and not t.is_alive(),(waited,result)
    if kind=='review_event' and first=='archive':assert result.get('code')=='P0001' and 'opportunity_archived' in result['error'],result
    else:assert 'code' not in result,result
    if kind=='idempotency':
        assert result['row'][0]['idempotent'],result
        assert scalar(monitor,"select count(*) from opportunity_console_audit_log where lead_id=%s and action='opportunity_archived'",(i,))==1
    if kind=='handoff':assert scalar(monitor,'select cockpit_handoff_status from local_business_outreach_drafts where id=%s',(d,))=='completed'
    a.close();b.close();monitor.close()
    return dict(blocked=True,result='serialized correctly')
def candidate_chain():
    with connect() as c:
        i=lead(c);j=lead(c)
        r=scalar(c,"insert into opportunity_discovery_runs(location,industry) values('Auckland','TEST') returning id")
        cand=scalar(c,"insert into opportunity_discovery_candidates(run_id,source_identifier,business_name,normalized_identity) values(%s,%s,'TEST candidate',%s) returning id",(r,str(i),str(i)))
        e=scalar(c,"insert into local_business_visual_evidence(candidate_id,source) values(%s,'operator_upload') returning id",(cand,))
        a=scalar(c,'insert into local_business_visual_assessments(candidate_id,evidence_id) values(%s,%s) returning id',(cand,e))
        f=scalar(c,"insert into local_business_visual_findings(assessment_id,category,condition,confidence,evidence_description) values(%s,'fencing','TEST',0.8,'retained evidence') returning id",(a,))
        c.execute("update opportunity_discovery_candidates set imported_lead_id=%s,import_status='imported' where id=%s",(i,cand))
        denied(c,'update opportunity_discovery_candidates set imported_lead_id=%s where id=%s',(j,cand),'P0001','evidence_reparent_requires_review')
        archive(c,i)
        denied(c,"update local_business_visual_findings set evidence_description='mutated' where id=%s",(f,),'P0001','opportunity_archived')
        denied(c,'update local_business_visual_evidence set lead_id=%s where id=%s',(j,e),'P0001','opportunity_archived')
        denied(c,'delete from local_business_visual_findings where id=%s',(f,),'P0001','opportunity_archived')
        denied(c,'update opportunity_discovery_candidates set imported_lead_id=null where id=%s',(cand,),'P0001','opportunity_archived')
        archive(c,i,False)
        c.execute("update local_business_visual_findings set operator_notes='restored review' where id=%s",(f,))
        c.rollback()
def workflow_rewrites():
    with connect() as c:
        i=lead(c);j=lead(c)
        c.execute("insert into opportunity_console_audit_log(action,lead_id) values('opportunity_review_completed',%s)",(i,))
        archive(c,i)
        denied(c,"update opportunity_console_audit_log set action='unrelated' where lead_id=%s and action='opportunity_review_completed'",(i,),'P0001','opportunity_archived')
        denied(c,"update opportunity_console_audit_log set lead_id=%s where lead_id=%s and action='opportunity_review_completed'",(j,i),'P0001','opportunity_archived')
        c.rollback()
def owner_maintenance():
    with connect('postgres') as c:
        i=lead(c)
        c.execute('truncate local_business_leads cascade')
        assert scalar(c,'select count(*) from local_business_leads where id=%s',(i,))==0
        c.rollback()

for name,fn in [('service role execution and JWT denial',permissions),('audit insert failure atomic rollback',atomicity),('evidence/history byte retention archive/restore',retention),('actual Cockpit handoff and dedup after archive',handoff),('visual findings immutable after archive',visual_gap),('indirect evidence owner checked',indirect_gap),('Cockpit DELETE remains blocked pending shared contract',cockpit_delete),('legacy archives require reviewed restore',legacy_archive),('durable company claim prevents demotion and archive',approved_demotion),('actual discovery import reuses archived lead',discovery),('archived review history cannot be deleted',event_history_gap),('runtime truncate denied',truncate_gap),('handoff skip failure and customer preservation',handoff_modes),('candidate-only ancestry and reparenting',candidate_chain),('workflow history rewrites',workflow_rewrites),('owner maintenance truncate rollback',owner_maintenance)]:test(name,fn)
for kind in ['queue','claim','approval']:
    for first in ['archive','operation']:test(kind+' race '+first+' first',lambda k=kind,f=first:race(k,f))
for kind in ['handoff','review_event']:
    for first in ['archive','operation']:test(kind+' race '+first+' first',lambda k=kind,f=first:more_race(k,f))
test('concurrent archive retry emits one event',lambda:more_race('idempotency','archive'))
(ROOT/'inherited-results.json').write_text(json.dumps(results,indent=2))
print('TOTAL',len(results),'PASS',sum(r['status']=='PASS' for r in results),'FAIL',sum(r['status']=='FAIL' for r in results))
sys.exit(1 if any(r['status']=='FAIL' for r in results) else 0)
