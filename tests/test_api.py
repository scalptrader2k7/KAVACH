import json
import pytest
from fastapi.testclient import TestClient
from backend.engine import Engine
import backend.app as module

@pytest.fixture
def client(tmp_path,monkeypatch):
 monkeypatch.setattr(module,'engine',Engine(tmp_path))
 with TestClient(module.app,base_url="http://127.0.0.1") as client: yield client

def test_health_and_initial_state(client):
 assert client.get('/api/health').json()['status']=='online'
 assert client.get('/api/state').json()['protected_state']=={'mode':'NORMAL','report_interval_s':10}
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
 assert suite['passed']==suite['total']==29
 assert client.get('/api/state').json()==old
 export=client.get('/api/export')
 assert export.status_code==200 and 'attachment' in export.headers['content-disposition']
 assert export.json()['scenario_results'][0]['suite_id']==suite['suite_id']
 new=client.post('/api/demo/sessions').json()
 assert new['session_id']!=old['session_id']
 assert client.get('/api/export?session_id=unknown').status_code==404
