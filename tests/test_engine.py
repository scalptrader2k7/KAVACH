import json
import sqlite3
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
import pytest
from backend.engine import Engine, canonical

NOW=1792137600
@pytest.fixture
def engine(tmp_path): return Engine(tmp_path)
def issue(e,**kw): return e.issue(now=NOW,payload=kw.pop('payload',{'mode':'POWER_SAVING'}),**kw)
def raw(m): return json.dumps(m).encode()
def validate(e,m,**kw): return e.validate(m if isinstance(m,bytes) else raw(m),now=NOW,**kw)
def resign(e,m): m['auth_tag']=e.sign(m); return m

def test_deterministic_suite(engine):
 report=engine.scenarios()
 assert report['passed']==report['total']==29
 assert engine.state()['protected_state']=={'mode':'NORMAL','report_interval_s':10}
 assert engine.state()['latest_telemetry'] is None

def test_accept_replay_and_audit_atomicity(engine):
 msg=issue(engine)
 first=validate(engine,msg);state=engine.state()
 assert first['verdict']=='ACCEPTED' and first['state_changed']
 assert all(c['status']=='PASS' for c in first['checks'])
 assert state['protected_state']['mode']=='POWER_SAVING'
 assert state['latest_telemetry']['source']=='Local satellite model'
 second=validate(engine,msg)
 assert second['reason_code']=='REPLAY'
 assert second['checks'][-1]['status']=='NOT_RUN'
 assert engine.state()==state
 assert engine.audit()['total']==2

def test_restart_persists_keys_state_session_and_replay(engine):
 msg=issue(engine);validate(engine,msg)
 restarted=Engine(engine.root)
 assert restarted.state()==engine.state()
 assert restarted.secrets==engine.secrets
 assert validate(restarted,msg)['reason_code']=='REPLAY'
 assert restarted.audit()['total']==2

def test_simultaneous_duplicate_executes_once(engine):
 msg=raw(issue(engine));barrier=threading.Barrier(2)
 def submit(_): barrier.wait();return engine.validate(msg,now=NOW)
 with ThreadPoolExecutor(2) as pool: results=list(pool.map(submit,range(2)))
 assert sorted(r['verdict'] for r in results)==['ACCEPTED','REJECTED']
 assert sum(r['state_changed'] for r in results)==1
 assert {r['reason_code'] for r in results}=={'OK','REPLAY'}
 assert engine.audit()['total']==2

def test_commit_failure_rolls_back_state_replay_and_audit(engine,monkeypatch):
 msg=issue(engine);before=engine.state();original=engine.connect
 class BrokenConnection:
  def __init__(self): self.conn=original()
  def __getattr__(self,name): return getattr(self.conn,name)
  def commit(self): raise sqlite3.OperationalError('injected commit failure')
 monkeypatch.setattr(engine,'connect',BrokenConnection)
 result=validate(engine,msg)
 assert result['verdict']=='SERVICE_ERROR'
 assert result['checks'][-1]['status']=='FAIL'
 monkeypatch.setattr(engine,'connect',original)
 assert engine.state()==before
 assert engine.audit()['total']==0
 assert validate(engine,msg)['verdict']=='ACCEPTED'

def test_audit_write_failure_causes_no_execution(engine,monkeypatch):
 msg=issue(engine);before=engine.state();original=engine.connect
 class BrokenAudit:
  def __init__(self): self.conn=original()
  def __getattr__(self,name): return getattr(self.conn,name)
  def execute(self,sql,*args):
   if sql.startswith('INSERT INTO audit'): raise sqlite3.OperationalError('injected audit failure')
   return self.conn.execute(sql,*args)
 monkeypatch.setattr(engine,'connect',BrokenAudit)
 result=validate(engine,msg)
 assert result['verdict']=='SERVICE_ERROR'
 monkeypatch.setattr(engine,'connect',original)
 assert engine.state()==before
 assert engine.audit()['total']==0
 assert validate(engine,msg)['verdict']=='ACCEPTED'

@pytest.mark.parametrize('offset,lifetime,code',[(0,60,'OK'),(5,60,'OK'),(6,60,'CLOCK_SKEW'),(-59,60,'OK'),(-60,60,'EXPIRED'),(-61,60,'EXPIRED'),(0,0,'LIFETIME_INVALID'),(0,61,'LIFETIME_INVALID'),(0,-1,'LIFETIME_INVALID')])
def test_time_boundaries(engine,offset,lifetime,code):
 msg=issue(engine,issued_offset=offset,lifetime=lifetime)
 assert validate(engine,msg)['reason_code']==code

@pytest.mark.parametrize('mutator,code',[
 (lambda m:m.update(sequence=True),'SCHEMA_INVALID'),
 (lambda m:m.update(sequence='1'),'SCHEMA_INVALID'),
 (lambda m:m.update(sequence=0),'SCHEMA_INVALID'),
 (lambda m:m.update(sequence=2**53),'SCHEMA_INVALID'),
 (lambda m:m.update(version=2),'SCHEMA_INVALID'),
 (lambda m:m.update(payload=None),'SCHEMA_INVALID'),
 (lambda m:m.update(payload={'mode':{}}),'PAYLOAD_INVALID'),
 (lambda m:m.update(payload={'mode':'SAFE','role':'admin'}),'PAYLOAD_INVALID'),
 (lambda m:m.update(target_id='OTHER'),'TARGET_UNKNOWN'),
 (lambda m:m.update(action='DELETE'),'ACTION_INVALID'),
 (lambda m:m.update(sender_id='observér-01'),'SCHEMA_INVALID'),
 (lambda m:m.update(role='admin'),'SCHEMA_INVALID'),
 (lambda m:m.update(auth_tag='A'*64),'SCHEMA_INVALID'),
 (lambda m:m.pop('version'),'SCHEMA_INVALID'),
])
def test_strict_envelope_and_payload(engine,mutator,code):
 msg=issue(engine);mutator(msg)
 if 'auth_tag' in msg and code!='SCHEMA_INVALID': resign(engine,msg)
 before=engine.state();r=validate(engine,msg)
 assert r['reason_code']==code
 assert r['verdict']=='REJECTED'
 assert engine.state()==before
 fail=[i for i,c in enumerate(r['checks']) if c['status']=='FAIL']
 assert len(fail)==1
 assert all(c['status']=='NOT_RUN' for c in r['checks'][fail[0]+1:])

@pytest.mark.parametrize('data,code',[
 (b'{"x":1,"x":2}','INVALID_JSON'),
 (b'{"payload":{"x":1,"x":2}}','INVALID_JSON'),
 (b'null','SCHEMA_INVALID'),(b'[]','SCHEMA_INVALID'),
 (b'{"x":NaN}','INVALID_JSON'),(b'{"x":Infinity}','INVALID_JSON'),
 (b'\xff','INVALID_JSON'),(b'{oops','INVALID_JSON'),
 (b'x'*8193,'BODY_TOO_LARGE'),
])
def test_bad_raw_json(engine,data,code):
 before=engine.state();r=validate(engine,data)
 assert r['reason_code']==code
 assert engine.state()==before
 assert not r['sender_verified']

def test_float_bool_null_depth_and_secret_redaction(engine):
 for value in [1.5,True,None,{'a':{'b':{'c':{'d':1}}}}]:
  msg=issue(engine);msg['payload']={'mode':value};resign(engine,msg)
  assert validate(engine,msg)['reason_code']=='SCHEMA_INVALID'
 msg=issue(engine);msg['client_secret']='NEVER_LOG_THIS'
 validate(engine,msg)
 export=json.dumps(engine.export())
 assert 'NEVER_LOG_THIS' not in export
 for key in engine.secrets.values(): assert key not in export

def test_whitespace_key_order_invariance(engine):
 msg=issue(engine);reordered=dict(reversed(list(msg.items())))
 assert canonical(msg)==canonical(reordered)
 assert validate(engine,json.dumps(reordered,indent=3).encode())['verdict']=='ACCEPTED'

def test_hmac_not_permissions(engine):
 before=engine.state();r=validate(engine,issue(engine,sender='observer-01'))
 assert r['reason_code']=='NOT_AUTHORISED' and r['sender_verified']
 assert r['checks'][2]['status']=='PASS' and r['checks'][5]['status']=='FAIL'
 assert engine.state()==before

def test_humans_cannot_publish_telemetry_satellite_cannot_command(engine):
 for sender in ['operator-01','observer-01']:
  msg=issue(engine,sender=sender,kind='TELEMETRY',action='TELEMETRY_STATUS',payload={'battery_pct':87,'temperature_c':24,'mode':'SAFE'})
  assert validate(engine,msg)['reason_code']=='NOT_AUTHORISED'
 assert validate(engine,issue(engine,sender='satellite-01'))['reason_code']=='NOT_AUTHORISED'

def test_telemetry_never_overwrites_protected_mode(engine):
 msg=issue(engine,sender='satellite-01',kind='TELEMETRY',action='TELEMETRY_STATUS',payload={'battery_pct':0,'temperature_c':-50,'mode':'SAFE'})
 result=validate(engine,msg)
 assert result['verdict']=='ACCEPTED'
 assert result['state_changed'] is False
 assert engine.state()['protected_state']['mode']=='NORMAL'
 assert engine.state()['latest_telemetry']['mode']=='SAFE'
 before=engine.state()
 bad=issue(engine,sender='satellite-01',kind='TELEMETRY',action='TELEMETRY_STATUS',payload={'battery_pct':101,'temperature_c':24,'mode':'SAFE'})
 assert validate(engine,bad)['reason_code']=='PAYLOAD_INVALID'
 assert engine.state()==before

def test_streams_and_rejected_high_sequence(engine):
 msg=issue(engine);msg['sequence']=10000 # deliberately not re-signed
 assert validate(engine,msg)['reason_code']=='AUTH_FAILED'
 assert validate(engine,issue(engine))['verdict']=='ACCEPTED'
 msg=issue(engine);msg['message_id']=str(uuid.uuid4());msg['sequence']=1;resign(engine,msg)
 assert validate(engine,msg)['reason_code']=='OUT_OF_ORDER'
 # Satellite can submit sequence 1 despite operator stream advancing.
 telemetry=issue(engine,sender='satellite-01',kind='TELEMETRY',action='TELEMETRY_STATUS',payload={'battery_pct':100,'temperature_c':120,'mode':'NORMAL'})
 assert telemetry['sequence']==1 and validate(engine,telemetry)['verdict']=='ACCEPTED'

def test_new_sessions_preserve_old_history(engine):
 msg=issue(engine);r=validate(engine,msg);old=engine.active_session()
 new=engine.new_session()
 assert new!=old and engine.state()['protected_state']['mode']=='NORMAL'
 assert engine.audit(session=old)['events'][0]['event_id']==r['event_id']
 # A fresh isolated namespace intentionally has its own replay stream.
 assert validate(engine,msg)['verdict']=='ACCEPTED'
 assert engine.audit(session=new)['total']==1


def test_filter_pagination_export(engine):
 validate(engine,issue(engine));validate(engine,issue(engine,sender='observer-01'))
 assert engine.audit(verdict='ACCEPTED')['total']==1
 assert engine.audit(sender='observer-01',reason='NOT_AUTHORISED')['total']==1
 assert len(engine.audit(limit=1)['events'])==1
 assert len(engine.audit(limit=1,offset=1)['events'])==1
 report=engine.scenarios();evidence=engine.export()
 assert evidence['scenario_results'][0]['suite_id']==report['suite_id']
 assert len(evidence['events'])==2 and evidence['schema_version']==1
