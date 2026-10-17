import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from backend.engine import Engine, INITIAL, SCENARIO_CASE_COUNT
import backend.app as module

@pytest.fixture
def client(tmp_path,monkeypatch):
 monkeypatch.setattr(module,'engine',Engine(tmp_path))
 with TestClient(module.app,base_url="http://127.0.0.1") as client: yield client

def test_health_and_initial_state(client):
 assert client.get('/api/health').json()['status']=='online'
 assert client.get('/api/state').json()['protected_state']==INITIAL
 assert client.get('/api/state?session_id=unknown').status_code==404

def test_fixture_and_exact_raw_validation(client):
 fixture=client.post('/api/demo/issue',json={}).json()
 assert 'secret' not in json.dumps(fixture)
 text=json.dumps(fixture['message'],indent=2)
 result=client.post('/api/messages',content=text).json()
 assert result['verdict']=='ACCEPTED'
 assert result['submitted_text']==text
 assert client.post('/api/messages',content=text).json()['reason_code']=='REPLAY'
 assert client.get('/api/audit?verdict=ACCEPTED').json()['total']==1

def test_strict_fixture_api(client):
 assert client.post('/api/demo/issue',json={'role':'operator'}).status_code==422
 assert client.post('/api/demo/issue',json={'sender_id':'unknown'}).status_code==422

@pytest.mark.parametrize('scenario,reason',[('tampered','AUTH_FAILED'),('expired','EXPIRED'),('future','CLOCK_SKEW'),('unauthorised','NOT_AUTHORISED'),('invalid','PAYLOAD_INVALID')])
def test_scenario_fixtures(client,scenario,reason):
 fixture=client.post('/api/demo/issue',json={'scenario':scenario}).json()
 result=client.post('/api/messages',content=json.dumps(fixture['message'])).json()
 assert result['reason_code']==reason and result['state_changed'] is False

def test_api_raw_parser_and_size_bound(client):
 assert client.post('/api/messages',content='{"a":1,"a":2}').json()['reason_code']=='INVALID_JSON'
 assert client.post('/api/messages',content='x'*9000).json()['reason_code']=='BODY_TOO_LARGE'
 assert client.post('/api/messages',content='{bad-json').json()['reason_code']=='INVALID_JSON'

def test_api_export_suite_and_sessions(client):
 old=client.get('/api/state').json()
 suite=client.post('/api/scenarios/run').json()
 assert suite['total']==SCENARIO_CASE_COUNT
 assert suite['passed']==suite['total']
 assert client.get('/api/state').json()==old
 export=client.get('/api/export')
 assert export.status_code==200 and 'attachment' in export.headers['content-disposition']
 assert export.json()['scenario_results'][0]['suite_id']==suite['suite_id']
 new=client.post('/api/demo/sessions').json()
 assert new['session_id']!=old['session_id']
 assert client.get('/api/export?session_id=unknown').status_code==404

def test_qa09_consistent_decision_response_contract_across_stages(client):
    """QA-09: Verify first_failed_stage contract across serialized API responses, audit, export, and service error."""
    # 1. Successful command: verdict ACCEPTED, first_failed_stage is None
    fixture = client.post('/api/demo/issue', json={'scenario': 'valid'}).json()
    resp_success = client.post('/api/messages', content=json.dumps(fixture['message'])).json()
    assert resp_success['verdict'] == 'ACCEPTED'
    assert 'first_failed_stage' in resp_success
    assert resp_success['first_failed_stage'] is None

    # 2. Replay failure: stage 'replay'
    resp_replay = client.post('/api/messages', content=json.dumps(fixture['message'])).json()
    assert resp_replay['verdict'] == 'REJECTED'
    assert resp_replay['reason_code'] == 'REPLAY'
    assert resp_replay['first_failed_stage'] == 'replay'

    # 3. Malformed JSON: stage 'structure'
    resp_malformed = client.post('/api/messages', content='{"bad": json}').json()
    assert resp_malformed['verdict'] == 'REJECTED'
    assert resp_malformed['reason_code'] == 'INVALID_JSON'
    assert resp_malformed['first_failed_stage'] == 'structure'

    # 4. Structural validation failure (e.g. invalid envelope field / missing field): stage 'structure'
    bad_struct = dict(fixture['message'])
    bad_struct.pop('sequence')
    resp_struct = client.post('/api/messages', content=json.dumps(bad_struct)).json()
    assert resp_struct['verdict'] == 'REJECTED'
    assert resp_struct['reason_code'] == 'SCHEMA_INVALID'
    assert resp_struct['first_failed_stage'] == 'structure'

    # 5. Unknown key / identity failure: stage 'identity'
    unknown_key = client.post('/api/demo/issue', json={'scenario': 'unknown_key'}).json()
    resp_id = client.post('/api/messages', content=json.dumps(unknown_key['message'])).json()
    assert resp_id['verdict'] == 'REJECTED'
    assert resp_id['reason_code'] == 'KEY_UNKNOWN'
    assert resp_id['first_failed_stage'] == 'identity'

    # 6. Authentication failure: stage 'authentication'
    tampered = client.post('/api/demo/issue', json={'scenario': 'tampered'}).json()
    resp_auth = client.post('/api/messages', content=json.dumps(tampered['message'])).json()
    assert resp_auth['verdict'] == 'REJECTED'
    assert resp_auth['reason_code'] == 'AUTH_FAILED'
    assert resp_auth['first_failed_stage'] == 'authentication'

    # 7. Payload validation failure: stage 'payload'
    invalid_payload = client.post('/api/demo/issue', json={'scenario': 'invalid'}).json()
    resp_payload = client.post('/api/messages', content=json.dumps(invalid_payload['message'])).json()
    assert resp_payload['verdict'] == 'REJECTED'
    assert resp_payload['reason_code'] == 'PAYLOAD_INVALID'
    assert resp_payload['first_failed_stage'] == 'payload'

    # 8. Timing failure: stage 'time'
    expired = client.post('/api/demo/issue', json={'scenario': 'expired'}).json()
    resp_time = client.post('/api/messages', content=json.dumps(expired['message'])).json()
    assert resp_time['verdict'] == 'REJECTED'
    assert resp_time['reason_code'] == 'EXPIRED'
    assert resp_time['first_failed_stage'] == 'time'

    # 9. Authorization failure: stage 'permissions'
    unauth = client.post('/api/demo/issue', json={'scenario': 'unauthorised'}).json()
    resp_perm = client.post('/api/messages', content=json.dumps(unauth['message'])).json()
    assert resp_perm['verdict'] == 'REJECTED'
    assert resp_perm['reason_code'] == 'NOT_AUTHORISED'
    assert resp_perm['first_failed_stage'] == 'permissions'

    # 10. Service error fallback: stage 'commit' (or failed check stage)
    # Using engine directly or via monkeypatch to inject commit failure
    engine = module.engine
    original_connect = engine.connect
    class FailingCommitConn:
        def __init__(self): self.conn = original_connect()
        def __enter__(self): return self
        def __exit__(self, exc_type, exc_val, exc_tb): return self.conn.__exit__(exc_type, exc_val, exc_tb)
        def __getattr__(self, name): return getattr(self.conn, name)
        def commit(self): raise sqlite3.OperationalError('injected error')
    
    fresh_fixture = client.post('/api/demo/issue', json={'scenario': 'valid'}).json()
    engine.connect = FailingCommitConn
    try:
        resp_err = client.post('/api/messages', content=json.dumps(fresh_fixture['message'])).json()
        assert resp_err['verdict'] == 'SERVICE_ERROR'
        assert resp_err['first_failed_stage'] == 'commit'
    finally:
        engine.connect = original_connect
    
    # 11. Consistency check: Compare direct responses with persisted audit records and exported evidence
    audit_data = client.get('/api/audit').json()
    audit_events = {e['event_id']: e for e in audit_data['events']}

    for direct in [resp_success, resp_replay, resp_malformed, resp_struct, resp_id, resp_auth, resp_payload, resp_time, resp_perm]:
        eid = direct['event_id']
        assert eid in audit_events, f"Event {eid} should be persisted in audit"
        audit_e = audit_events[eid]
        assert audit_e['verdict'] == direct['verdict']
        assert audit_e['reason_code'] == direct['reason_code']
        assert audit_e['first_failed_stage'] == direct['first_failed_stage']

    export_events = {e['event_id']: e for e in client.get('/api/export').json()['events']}
    for direct in [resp_success, resp_replay, resp_malformed, resp_struct, resp_id, resp_auth, resp_payload, resp_time, resp_perm]:
        eid = direct['event_id']
        assert eid in export_events, f"Event {eid} should be present in export"
        exp_e = export_events[eid]
        assert exp_e['verdict'] == direct['verdict']
        assert exp_e['reason_code'] == direct['reason_code']
        assert exp_e['first_failed_stage'] == direct['first_failed_stage']
