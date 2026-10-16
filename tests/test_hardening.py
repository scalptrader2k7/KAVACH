import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import pytest
from fastapi.testclient import TestClient
import backend.app as module
from backend.engine import Engine, restrict_runtime_permissions

@pytest.fixture
def receiver(tmp_path): return Engine(tmp_path/'private')
@pytest.fixture
def client(receiver,monkeypatch):
    monkeypatch.setattr(module,'engine',receiver)
    with TestClient(module.app,base_url='http://127.0.0.1') as c: yield c

def fixture(client): return client.post('/api/demo/issue',json={}).json()['message']

def test_connection_open_failure_is_structured_and_changes_nothing(receiver,monkeypatch):
    msg=receiver.issue(payload={'mode':'SAFE'});before=receiver.state()
    original=receiver.connect
    def broken():raise sqlite3.OperationalError('PRIVATE INTERNAL ERROR DO NOT DISCLOSE')
    monkeypatch.setattr(receiver,'connect',broken)
    result=receiver.validate(json.dumps(msg).encode())
    assert result['verdict']=='SERVICE_ERROR' and not result['audit_persisted'] and not result['replay_state_advanced']
    assert 'PRIVATE INTERNAL' not in json.dumps(result)
    monkeypatch.setattr(receiver,'connect',original)
    assert receiver.state()==before and receiver.audit()['total']==0
    assert receiver.validate(json.dumps(msg).encode())['verdict']=='ACCEPTED'

@pytest.mark.parametrize('endpoint',['/api/demo/issue','/api/demo/sessions','/api/scenarios/run'])
def test_lock_contention_is_bounded_service_error(client,receiver,endpoint):
    receiver.db_timeout_s=0.05
    before=receiver.state()
    with receiver.connect() as lock:
        lock.execute('BEGIN IMMEDIATE')
        started=time.monotonic();response=client.post(endpoint,json={})
        assert response.status_code==503
        assert time.monotonic()-started<1
        assert len(response.content)<2048
        assert response.json()['verdict']=='SERVICE_ERROR'
        assert 'locked' not in response.text.lower()
        lock.rollback()
    assert receiver.state()==before

def test_receiver_lock_contention_does_not_advance_or_audit(client,receiver):
    msg=fixture(client);before=receiver.state();receiver.db_timeout_s=0.05
    with receiver.connect() as lock:
        lock.execute('BEGIN IMMEDIATE')
        response=client.post('/api/messages',content=json.dumps(msg))
        assert response.status_code==503 and not response.json()['replay_state_advanced']
        lock.rollback()
    assert receiver.state()==before and receiver.audit()['total']==0
    assert client.post('/api/messages',content=json.dumps(msg)).json()['verdict']=='ACCEPTED'

@pytest.mark.parametrize('path',['/api/state','/api/audit','/api/export','/api/messages'])
def test_missing_session_has_bounded_404(client,receiver,path):
    before=receiver.state()
    response=client.post(path+'?session_id=KVC-00000000',content='{}') if path.endswith('messages') else client.get(path+'?session_id=KVC-00000000')
    assert response.status_code==404 and len(response.content)<500
    assert receiver.state()==before

def test_missing_fixture_session_404(client):
    assert client.post('/api/demo/issue',json={'session_id':'KVC-00000000'}).status_code==404

@pytest.mark.parametrize('body',['{"payload":{"mode":NaN}}','{"payload":{"x":1,"x":2}}','{bad-json'])
def test_fixture_json_is_bounded_strict_and_not_echoed(client,body):
    r=client.post('/api/demo/issue',content=body)
    assert r.status_code==400 and len(r.content)<500

def test_fixture_size_depth_type_and_error_redaction(client):
    assert client.post('/api/demo/issue',content='x'*10000).status_code==413
    deep={'x':{'x':{'x':{'x':1}}}}
    assert client.post('/api/demo/issue',json={'payload':deep}).status_code==422
    canary='CLIENT_SENSITIVE_VALUE_DO_NOT_ECHO'
    r=client.post('/api/demo/issue',json={'unknown_field':canary,'action':None})
    assert r.status_code==422 and canary not in r.text and all('input' not in item for item in r.json()['errors'])
    assert len(r.content)<2048

def test_oversized_receiver_keeps_bounded_audit_and_hash_scope(client,receiver):
    before=receiver.state()
    r=client.post('/api/messages',content='x'*100000).json()
    assert r['reason_code']=='BODY_TOO_LARGE' and r['input_truncated']
    assert 'first 8193' in r['input_hash_scope']
    event=receiver.audit()['events'][0]
    assert event['input_truncated'] and event['input_sha256']==hashlib.sha256(b'x'*8193).hexdigest()
    assert len(json.dumps(event))<5000 and receiver.state()==before

@pytest.mark.parametrize('origin',['https://evil.invalid','null','http://localhost:9999'])
def test_cross_origin_browser_requests_rejected_before_execution(client,receiver,origin):
    before=receiver.state()
    r=client.post('/api/demo/sessions',headers={'Origin':origin})
    assert r.status_code==403 and receiver.state()==before

def test_dns_rebinding_host_is_rejected(client):
    assert client.get('/api/health',headers={'Host':'evil.invalid'}).status_code==400

def test_same_origin_and_vite_dev_origin_work(client):
    assert client.post('/api/demo/issue',json={},headers={'Origin':'http://127.0.0.1'}).status_code==200
    assert client.post('/api/demo/issue',json={},headers={'Origin':'http://localhost:5173'}).status_code==200

def test_replay_fixture_never_executes_hidden_command(client,receiver):
    before=receiver.state()
    assert client.post('/api/demo/issue',json={'scenario':'replay'}).status_code==409
    assert receiver.state()==before and receiver.audit()['total']==0
    msg=fixture(client);raw=json.dumps(msg,indent=3)
    client.post('/api/messages',content=raw)
    replay=client.post('/api/demo/issue',json={'scenario':'replay'}).json()
    assert replay['raw_text']==raw and replay['expected_outcome']=='REPLAY'
    assert receiver.audit()['total']==1
    assert client.post('/api/messages',content=replay['raw_text']).json()['reason_code']=='REPLAY'

def test_summary_fields_are_receiver_authored_and_persisted(client,receiver):
    msg=fixture(client);first=client.post('/api/messages',content=json.dumps(msg)).json()
    assert first['audit_persisted'] is True and first['replay_state_advanced'] is True
    assert first['replay_sequence_before']==0 and first['replay_sequence_after']==msg['sequence']
    assert receiver.audit()['events'][0]['event_id']==first['event_id']
    rejected=client.post('/api/messages',content=json.dumps(msg)).json()
    assert rejected['replay_state_advanced'] is False and rejected['audit_persisted'] is True
    assert rejected['replay_sequence_before']==rejected['replay_sequence_after']==msg['sequence']

@pytest.mark.skipif(os.name!='posix',reason='POSIX mode gate; Windows requires ACL verification')
def test_permissions_restricted_without_changing_bytes(receiver):
    files=[receiver.root/'sender-secrets.json',receiver.root/'kavach.sqlite3']
    hashes=[hashlib.sha256(p.read_bytes()).hexdigest() for p in files]
    receiver.root.chmod(0o755)
    for p in files:p.chmod(0o644)
    restrict_runtime_permissions(receiver.root)
    assert receiver.root.stat().st_mode&0o777==0o700
    assert all(p.stat().st_mode&0o777==0o600 for p in files)
    assert hashes==[hashlib.sha256(p.read_bytes()).hexdigest() for p in files]
    with receiver.connect() as db:
        db.execute('BEGIN IMMEDIATE');db.execute("UPDATE meta SET value=value WHERE key='active'")
        journal=receiver.root/'kavach.sqlite3-journal'
        if journal.exists():assert journal.stat().st_mode&0o077==0
        db.rollback()

def test_missing_or_invalid_keys_never_silently_rotate(receiver):
    path=receiver.root/'sender-secrets.json';original=path.read_bytes();dbhash=hashlib.sha256((receiver.root/'kavach.sqlite3').read_bytes()).hexdigest()
    path.unlink()
    with pytest.raises(ValueError,match='no key file'):Engine(receiver.root)
    assert not path.exists() and hashlib.sha256((receiver.root/'kavach.sqlite3').read_bytes()).hexdigest()==dbhash
    path.write_text('{}')
    with pytest.raises(ValueError,match='Invalid runtime key registry'):Engine(receiver.root)
    assert path.read_text()=='{}'
    path.write_bytes(original)

def test_connection_context_closes(receiver):
    with receiver.connect() as db:db.execute('SELECT 1')
    with pytest.raises(sqlite3.ProgrammingError):db.execute('SELECT 1')

def test_imports_do_not_start_browser_or_initialize_runtime(tmp_path):
    root=Path(__file__).resolve().parents[1]
    code='''import builtins,runpy,os
old=builtins.__import__
def guarded(name,*a,**k):
 if name.startswith('playwright'):raise AssertionError('Optional browser imported during discovery')
 return old(name,*a,**k)
builtins.__import__=guarded
runpy.run_path('preview/test_offline.py',run_name='import_check')
runpy.run_path('tests/browser_smoke.py',run_name='import_check')
runpy.run_path('preview/build_preview.py',run_name='import_check')
import backend.app
assert not os.path.exists(os.environ['KAVACH_DATA_DIR'])
'''
    env={**os.environ,'KAVACH_DATA_DIR':str(tmp_path/'must-not-exist')}
    result=subprocess.run([sys.executable,'-c',code],cwd=root,env=env,capture_output=True,text=True)
    assert result.returncode==0,result.stderr

def test_launcher_refuses_external_binding_without_acknowledgement():
    root=Path(__file__).resolve().parents[1]
    env={k:v for k,v in os.environ.items() if k!='KAVACH_ALLOW_EXTERNAL'}
    r=subprocess.run([sys.executable,'-m','backend','--host','0.0.0.0'],cwd=root,env=env,capture_output=True,text=True)
    assert r.returncode!=0 and 'KAVACH_ALLOW_EXTERNAL=1' in r.stderr


def test_replay_is_blocked_across_actual_python_process_restart(tmp_path):
    root=Path(__file__).resolve().parents[1]
    create="""from backend.engine import Engine
import json,sys
engine=Engine(sys.argv[1]);message=engine.issue(payload={'mode':'SAFE'},now=1792137600)
result=engine.validate(json.dumps(message).encode(),now=1792137600)
print(json.dumps({'message':message,'verdict':result['verdict']}))
"""
    first=subprocess.run([sys.executable,'-c',create,str(tmp_path/'restart')],cwd=root,text=True,capture_output=True,check=True)
    saved=json.loads(first.stdout);assert saved['verdict']=='ACCEPTED'
    replay="""from backend.engine import Engine
import json,sys
engine=Engine(sys.argv[1]);result=engine.validate(sys.argv[2].encode(),now=1792137600)
print(json.dumps({'reason':result['reason_code'],'mode':engine.state()['protected_state']['mode']}))
"""
    second=subprocess.run([sys.executable,'-c',replay,str(tmp_path/'restart'),json.dumps(saved['message'])],cwd=root,text=True,capture_output=True,check=True)
    assert json.loads(second.stdout)=={'reason':'REPLAY','mode':'SAFE'}


def test_corrupt_audit_record_is_service_error_not_secret_or_stacktrace(client,receiver):
    msg=fixture(client)
    client.post('/api/messages',content=json.dumps(msg))
    with receiver.connect() as db:
        db.execute("UPDATE audit SET event='CORRUPT_PRIVATE_STORAGE_VALUE'")
    r=client.get('/api/audit')
    assert r.status_code==503 and r.json()['verdict']=='SERVICE_ERROR'
    assert 'CORRUPT_PRIVATE_STORAGE_VALUE' not in r.text and 'Traceback' not in r.text
