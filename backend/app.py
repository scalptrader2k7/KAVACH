"""Local-only Kavach API. The fixture issuer is privileged, not public authentication."""
from pathlib import Path
import json
import logging
import os
import sqlite3
import threading
from typing import Literal
from urllib.parse import urlsplit
from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool
from .engine import Engine, Invalid, SessionNotFound, pairs_hook, shape

ROOT = Path(__file__).resolve().parent.parent
# Importing this module must not create or modify runtime material.
engine: Engine | None = None
_engine_lock = threading.Lock()

def get_engine() -> Engine:
    global engine
    with _engine_lock:
        if engine is None:
            try:
                engine = Engine(os.environ.get('KAVACH_DATA_DIR', str(ROOT/'data')))
            except (OSError, ValueError, sqlite3.Error):
                raise RuntimeError('Runtime initialization failed; check private local configuration.') from None
        return engine


def service_error():
    return JSONResponse({'verdict':'SERVICE_ERROR','reason_code':'SERVICE_ERROR','explanation':'Local storage is unavailable or busy. No successful execution or audit persistence is claimed. Retry after checking the local service.','audit_persisted':False,'replay_state_advanced':False},status_code=503,headers={'Retry-After':'2'})


class LocalRequestGuard:
    """Small local/DNS-rebinding/foreign-browser guard, not a public auth layer."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope,receive,send)
        headers={k.lower():v for k,v in scope.get('headers',[])}
        host=headers.get(b'host',b'').decode('latin1')
        try:
            hostname=urlsplit('//'+host).hostname
        except ValueError:
            hostname=None
        allowed={'localhost','127.0.0.1','::1'}
        if os.environ.get('KAVACH_ALLOW_EXTERNAL')=='1':
            extras=os.environ.get('KAVACH_ALLOWED_HOSTS','').split(',')
            allowed.update(h.strip().lower() for h in extras if h.strip() and not any(c in h for c in '*/:') and not h.startswith('.'))
        if hostname not in allowed:
            return await JSONResponse({'detail':'Host not permitted. Use a loopback URL or deliberately configure an exact trusted demo host.'},status_code=400)(scope,receive,send)
        if scope['path'].startswith('/api/'):
            origin=headers.get(b'origin',b'').decode('latin1')
            trusted={f'{scheme}://{host}' for scheme in ['http','https']}
            trusted.update({'http://127.0.0.1:5173','http://localhost:5173'})
            if os.environ.get('KAVACH_ALLOW_EXTERNAL')=='1':
                for candidate in os.environ.get('KAVACH_ALLOWED_ORIGINS','').split(','):
                    candidate=candidate.strip()
                    try:
                        parsed=urlsplit(candidate)
                        if parsed.scheme in {'http','https'} and parsed.hostname in allowed and not parsed.path and not parsed.query and not parsed.fragment and not parsed.username and not parsed.password:
                            trusted.add(candidate)
                    except ValueError:
                        pass
            if origin and origin not in trusted or headers.get(b'sec-fetch-site')==b'cross-site':
                return await JSONResponse({'detail':'Cross-origin browser API requests are not permitted.'},status_code=403)(scope,receive,send)
            # Non-receiver POST bodies are bounded before FastAPI parses them.
            # Receiver keeps its own strict 8193-byte sentinel and structured audit decision.
            if scope['method']=='POST' and scope['path']!='/api/messages':
                body=bytearray()
                while True:
                    part=await receive()
                    if part['type']=='http.disconnect':
                        return
                    chunk=part.get('body',b'')
                    if len(body)+len(chunk)>8192:
                        return await JSONResponse({'detail':'Request exceeds the 8 KiB limit.'},status_code=413)(scope,receive,send)
                    body.extend(chunk)
                    if not part.get('more_body'): break
                if scope['path']=='/api/demo/issue':
                    try:
                        json.loads(body.decode('utf-8'),object_pairs_hook=pairs_hook,parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                    except (Invalid,ValueError,UnicodeError,RecursionError):
                        return await JSONResponse({'detail':'Fixture request must be strict UTF-8 JSON without duplicate keys or non-finite numbers.'},status_code=400)(scope,receive,send)
                delivered=False
                original_receive=receive
                async def bounded_receive():
                    nonlocal delivered
                    if not delivered:
                        delivered=True
                        return {'type':'http.request','body':bytes(body),'more_body':False}
                    return await original_receive()
                receive=bounded_receive
        return await self.app(scope,receive,send)


app = FastAPI(title='Kavach — local synthetic simulator', version='1.0.1',debug=False)
app.add_middleware(LocalRequestGuard)

@app.exception_handler(RequestValidationError)
async def invalid_parameters(request, exc):
    errors=[{'field':'.'.join(str(x)[:40] for x in e['loc'])[:120], 'message':e['msg'][:160], 'type':e['type'][:60]} for e in exc.errors()[:8]]
    return JSONResponse({'detail':'Invalid request parameters.','errors':errors},status_code=422)

@app.exception_handler(sqlite3.Error)
@app.exception_handler(OSError)
@app.exception_handler(RuntimeError)
@app.exception_handler(ValueError)
async def storage_error(request, exc):
    logging.getLogger('kavach').error('Local API operation failed (%s).',type(exc).__name__)
    return service_error()

@app.exception_handler(Exception)
async def unexpected_error(request, exc):
    logging.getLogger('kavach').error('Unexpected local API failure (%s).',type(exc).__name__)
    return service_error()


class Fixture(BaseModel):
    model_config = ConfigDict(extra='forbid',strict=True)
    sender_id: Literal['operator-01','observer-01','satellite-01'] = 'operator-01'
    message_type: Literal['COMMAND','TELEMETRY'] = 'COMMAND'
    action: str = Field(default='SET_MODE',min_length=1,max_length=64)
    payload: dict = Field(default_factory=lambda: {'mode':'POWER_SAVING'})
    session_id: str | None = Field(default=None,max_length=64)
    scenario: Literal['valid','tampered','replay','expired','future','unauthorised','invalid','telemetry'] = 'valid'

    @field_validator('payload')
    @classmethod
    def bounded_payload(cls, value):
        try:
            shape(value,2)
        except Invalid:
            raise ValueError('Fixture values must be bounded-depth ASCII strings, integers, and objects.') from None
        return value


def ensure_session(receiver: Engine, session_id: str | None):
    if session_id is not None:
        try:
            receiver.state(session_id)
        except SessionNotFound:
            raise HTTPException(404,'Unknown session. Select an existing session or explicitly create a new demo session.') from None

@app.get('/api/health')
def health():
    try:
        receiver=get_engine()
        snapshot=receiver.state()
        return {'status':'online','database':'ready','local_simulation':True,'session_id':snapshot['session_id']}
    except Exception:
        return JSONResponse({'status':'unavailable','detail':'Local storage is unavailable or busy.'},status_code=503)

@app.get('/api/state')
def state(session_id: str | None = None):
    receiver=get_engine();ensure_session(receiver,session_id)
    return receiver.state(session_id)

@app.post('/api/demo/sessions')
def new_session():
    receiver=get_engine()
    return receiver.state(receiver.new_session())

@app.post('/api/demo/issue')
def issue(data: Fixture):
    receiver=get_engine();ensure_session(receiver,data.session_id)
    if data.scenario == 'replay':
        sid=data.session_id or receiver.active_session()
        accepted=receiver.audit(session=sid,verdict='ACCEPTED',limit=1)['events']
        if not accepted or not accepted[0].get('submitted_text'):
            raise HTTPException(409,'Accept a valid signed message first; replay never creates or executes a hidden command.')
        event=accepted[0]
        message=event['message']
        import time
        expired=int(time.time())>=message['expires_at'] or int(time.time())-message['issued_at']>60
        return {'message':message,'raw_text':event['submitted_text'],'modified':False,'session_id':sid,'expected_outcome':'EXPIRED' if expired else 'REPLAY','expectation_source':'original accepted record; time checks precede replay'}
    sender,kind,action,payload = data.sender_id,data.message_type,data.action,data.payload
    offset = 0
    if data.scenario == 'expired': offset=-65
    if data.scenario == 'future': offset=30
    if data.scenario == 'unauthorised': sender,kind,action,payload='observer-01','COMMAND','SET_MODE',{'mode':'SAFE'}
    if data.scenario == 'invalid': action,payload,kind='SET_REPORT_INTERVAL',{'seconds':90},'COMMAND'
    if data.scenario == 'telemetry': sender,kind,action,payload='satellite-01','TELEMETRY','TELEMETRY_STATUS',{'battery_pct':87,'temperature_c':24,'mode':'NORMAL'}
    try:
        message = receiver.issue(sender,kind,action,payload,data.session_id,issued_offset=offset)
    except ValueError:
        raise HTTPException(422,'Unable to issue this fixture; check its supported values.') from None
    if data.scenario == 'tampered':
        message['payload'] = {'mode':'SAFE' if payload.get('mode') != 'SAFE' else 'NORMAL'}
    expected={'tampered':'AUTH_FAILED','expired':'EXPIRED','future':'CLOCK_SKEW','unauthorised':'NOT_AUTHORISED','invalid':'PAYLOAD_INVALID','telemetry':'ACCEPTED','replay':'REPLAY'}.get(data.scenario,'ACCEPTED')
    return {'message':message,'modified':data.scenario=='tampered','session_id':data.session_id or receiver.active_session(),'expected_outcome':expected,'expectation_source':'fixture preset; not a receiver verdict'}

@app.post('/api/messages')
async def receive(request: Request, session_id: str | None = None):
    receiver=get_engine()
    await run_in_threadpool(ensure_session,receiver,session_id)
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk[:8193-len(raw)])
        if len(raw)>8192: break
    result = await run_in_threadpool(receiver.validate,bytes(raw),session_id,input_truncated=len(raw)>8192)
    result['input_truncated']=len(raw)>8192
    if result['input_truncated']:
        result['input_hash_scope']='first 8193 bytes; full oversized body was not retained'
    return JSONResponse(result,status_code=503 if result['verdict']=='SERVICE_ERROR' else 200)

@app.get('/api/audit')
def audit(session_id: str | None = None, verdict: str | None = None, sender: str | None = None, message_type: str | None = None, reason: str | None = None, limit: int = 50, offset: int = 0):
    receiver=get_engine();ensure_session(receiver,session_id)
    return receiver.audit(session_id,verdict,sender,message_type,reason,max(1,min(limit,200)),max(0,offset))

@app.post('/api/scenarios/run')
def scenarios():
    return get_engine().scenarios()

@app.get('/api/export')
def export(session_id: str | None = None):
    receiver=get_engine();ensure_session(receiver,session_id)
    data=receiver.export(session_id)
    return JSONResponse(data,headers={'Content-Disposition':f'attachment; filename="kavach-evidence-{data["session_id"]}.json"','Cache-Control':'no-store'})

WEB = ROOT/'dist'
if WEB.exists():
    app.mount('/assets', StaticFiles(directory=WEB/'assets'), name='assets')
    app.mount('/fonts', StaticFiles(directory=WEB/'fonts'), name='fonts')
    @app.get('/{path:path}')
    def frontend(path: str):
        if path.startswith('api/'):
            raise HTTPException(404,'Unknown API endpoint.')
        return FileResponse(WEB/'index.html',headers={'Cache-Control':'no-cache'})
