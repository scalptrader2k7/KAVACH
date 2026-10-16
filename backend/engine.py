"""Kavach local-only synthetic message validator. No spacecraft connectivity."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from pathlib import Path
from contextlib import suppress

POLICY = 'kavach-policy/1.0'
TARGET = 'KAVACH-SAT-01'
STAGES = [
    ('structure', 'Message structure'), ('identity', 'Sender identity'),
    ('authentication', 'HMAC authentication'), ('payload', 'Payload & target'),
    ('time', 'Timestamp validity'), ('permissions', 'Sender permissions'),
    ('replay', 'Replay protection'), ('commit', 'State commit'),
]
FIELDS = {'version', 'message_id', 'message_type', 'sender_id', 'target_id', 'key_id', 'sequence', 'issued_at', 'expires_at', 'action', 'payload', 'auth_tag'}
KEYS = {'operator-key-01': 'operator-01', 'observer-key-01': 'observer-01', 'satellite-key-01': 'satellite-01'}
MODES = {'NORMAL', 'POWER_SAVING', 'SAFE'}
INITIAL = {'mode': 'NORMAL', 'report_interval_s': 10}

class SessionNotFound(ValueError):
    pass


class Invalid(Exception):
    def __init__(self, code, explanation):
        self.code, self.explanation = code, explanation

def fail(code, text):
    raise Invalid(code, text)

def canonical(message):
    return json.dumps({k: v for k, v in message.items() if k != 'auth_tag'}, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('utf-8')

def pairs_hook(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            fail('INVALID_JSON', 'Duplicate JSON key detected; input left unmodified.')
        obj[key] = value
    return obj

def shape(value, level=1):
    if level > 4:
        fail('SCHEMA_INVALID', 'Maximum nesting depth is four levels.')
    if isinstance(value, dict):
        for k, v in value.items():
            if not k.isascii(): fail('SCHEMA_INVALID', 'Field names must be ASCII.')
            shape(v, level + 1)
    elif type(value) is int:
        pass
    elif type(value) is str:
        if not value.isascii(): fail('SCHEMA_INVALID', 'Only ASCII strings are supported in v1.')
    else:
        fail('SCHEMA_INVALID', 'Only integer, ASCII string, and object values are supported; no coercion is performed.')

def restrict_runtime_permissions(root):
    """Change metadata only; never rotate keys, rewrite records, or reset a session."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == 'posix':
        root.chmod(0o700)
    for name in ['sender-secrets.json', 'kavach.sqlite3', 'kavach.sqlite3-journal', 'kavach.sqlite3-wal', 'kavach.sqlite3-shm']:
        path = root / name
        if path.is_symlink():
            raise ValueError('Runtime key/database symlinks are not supported.')
        if path.exists() and os.name == 'posix':
            path.chmod(0o600)


class ClosingConnection(sqlite3.Connection):
    """SQLite's normal context manager does not close connections; this one does."""
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class Engine:
    def __init__(self, data_dir):
        self.root = Path(data_dir)
        restrict_runtime_permissions(self.root)
        path = self.root / 'sender-secrets.json'
        if (self.root / 'kavach.sqlite3').exists() and not path.exists():
            raise ValueError('Existing runtime database has no key file. Restore its original keys or select a new data directory; no keys were generated.')
        # Exclusive creation prevents two initializers from replacing persisted keys.
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, 'w') as f:
                json.dump({key: secrets.token_hex(32) for key in KEYS}, f)
        self.secrets = json.loads(path.read_text())
        if set(self.secrets) != set(KEYS) or any(type(v) is not str or not re.fullmatch('[0-9a-f]{64}', v) for v in self.secrets.values()):
            raise ValueError('Invalid runtime key registry; refusing to replace existing keys.')
        db_path = self.root / 'kavach.sqlite3'
        try:
            fd = os.open(db_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(fd)
        self.db_timeout_s = max(0.01, min(5.0, float(os.environ.get('KAVACH_DB_TIMEOUT_S', '2'))))
        with self.connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, created INTEGER, state TEXT, telemetry TEXT);
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE IF NOT EXISTS issuer(session TEXT, sender TEXT, kind TEXT, seq INTEGER, PRIMARY KEY(session,sender,kind));
            CREATE TABLE IF NOT EXISTS streams(session TEXT,sender TEXT,target TEXT,kind TEXT,seq INTEGER,PRIMARY KEY(session,sender,target,kind));
            CREATE TABLE IF NOT EXISTS accepted(session TEXT,sender TEXT,target TEXT,kind TEXT,message_id TEXT,PRIMARY KEY(session,sender,target,kind,message_id));
            CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, session TEXT, received INTEGER, verdict TEXT,sender TEXT,kind TEXT,reason TEXT,event TEXT);
            CREATE TABLE IF NOT EXISTS suites(id TEXT PRIMARY KEY,session TEXT,result TEXT);
            ''')
            if not db.execute("SELECT value FROM meta WHERE key='active'").fetchone():
                self._new_session(db, True)

    def connect(self):
        db = sqlite3.connect(self.root / 'kavach.sqlite3', timeout=self.db_timeout_s, isolation_level=None, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        return db

    def _new_session(self, db, active=False):
        sid = 'KVC-' + uuid.uuid4().hex[:8].upper()
        db.execute('INSERT INTO sessions VALUES(?,?,?,NULL)', (sid, int(time.time()), json.dumps(INITIAL)))
        if active:
            db.execute("INSERT OR REPLACE INTO meta VALUES('active',?)", (sid,))
        return sid

    def new_session(self, active=True):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            sid = self._new_session(db, active)
            db.commit()
            return sid

    def active_session(self, db=None):
        if db is not None:
            return db.execute("SELECT value FROM meta WHERE key='active'").fetchone()[0]
        with self.connect() as conn:
            return self.active_session(conn)

    def state(self, session=None, db=None):
        if db is None:
            with self.connect() as conn:
                return self.state(session, conn)
        sid = session or self.active_session(db)
        row = db.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
        if not row: raise SessionNotFound('Unknown session')
        return {'session_id': sid, 'protected_state': json.loads(row['state']), 'latest_telemetry': json.loads(row['telemetry']) if row['telemetry'] else None, 'target_id': TARGET, 'policy_version': POLICY}

    def issue(self, sender='operator-01', kind='COMMAND', action='SET_MODE', payload=None, session=None, now=None, issued_offset=0, lifetime=60):
        if sender not in KEYS.values(): raise ValueError('Unknown synthetic sender')
        if kind not in {'COMMAND', 'TELEMETRY'}: raise ValueError('Unknown message type')
        now = int(time.time()) if now is None else now
        key = next(k for k,v in KEYS.items() if v == sender)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            sid = session or self.active_session(db)
            if not db.execute('SELECT id FROM sessions WHERE id=?', (sid,)).fetchone(): raise SessionNotFound('Unknown session')
            row = db.execute('SELECT seq FROM issuer WHERE session=? AND sender=? AND kind=?', (sid,sender,kind)).fetchone()
            accepted = db.execute('SELECT seq FROM streams WHERE session=? AND sender=? AND target=? AND kind=?', (sid,sender,TARGET,kind)).fetchone()
            seq = max(row[0] if row else 0, accepted[0] if accepted else 0) + 1
            db.execute('INSERT OR REPLACE INTO issuer VALUES(?,?,?,?)', (sid,sender,kind,seq))
            db.commit()
        message = dict(version=1,message_id=str(uuid.uuid4()),message_type=kind,sender_id=sender,target_id=TARGET,key_id=key,sequence=seq,issued_at=now+issued_offset,expires_at=now+issued_offset+lifetime,action=action,payload={} if payload is None else payload)
        message['auth_tag'] = self.sign(message)
        return message

    def sign(self, message):
        return hmac.new(bytes.fromhex(self.secrets[message['key_id']]), canonical(message), hashlib.sha256).hexdigest()

    def validate(self, raw, session=None, now=None, input_truncated=False):
        started = time.perf_counter()
        now = int(time.time()) if now is None else now
        checks = [{'stage': key,'label': label,'status': 'NOT_RUN','explanation': 'Waiting for preceding checks.'} for key,label in STAGES]
        idx, verified, message = 0, False, None
        db, sid, before = None, session, None
        replay_before = None
        try:
            db = self.connect()
            db.execute('BEGIN IMMEDIATE')
            sid = session or self.active_session(db)
            snapshot = self.state(sid, db)
            before, telemetry_before = snapshot['protected_state'], snapshot['latest_telemetry']
            after, telemetry_after = dict(before), telemetry_before
            try:
                if len(raw) > 8192: fail('BODY_TOO_LARGE', 'Message exceeds the 8 KiB request limit.')
                try:
                    message = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs_hook, parse_constant=lambda x: fail('INVALID_JSON', f'Non-finite number {x} is not allowed.'))
                except (ValueError, UnicodeError, RecursionError) as exc:
                    fail('INVALID_JSON', 'Message is not valid UTF-8 JSON: ' + str(exc)[:150])
                if type(message) is not dict: fail('SCHEMA_INVALID', 'Message must be a JSON object.')
                if set(message) != FIELDS:
                    missing, extra = sorted(FIELDS - set(message)), sorted(set(message) - FIELDS)
                    fail('SCHEMA_INVALID', f'Envelope fields do not match. Missing: {missing}; unknown field count: {len(extra)}.')
                shape(message)
                for field in ['version','sequence','issued_at','expires_at']:
                    if type(message[field]) is not int: fail('SCHEMA_INVALID', f'{field} must be an integer, never a boolean or string.')
                if message['version'] != 1: fail('SCHEMA_INVALID', 'Only version 1 is supported.')
                if not 1 <= message['sequence'] <= 2**53-1: fail('SCHEMA_INVALID', 'sequence must be between 1 and 2^53−1.')
                for field in ['message_id','message_type','sender_id','target_id','key_id','action','auth_tag']:
                    if type(message[field]) is not str: fail('SCHEMA_INVALID', f'{field} must be a string.')
                for field in ['sender_id','key_id']:
                    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', message[field]): fail('SCHEMA_INVALID', f'{field} must be a bounded ASCII identifier.')
                try: uuid.UUID(message['message_id'])
                except ValueError: fail('SCHEMA_INVALID', 'message_id must be a UUID string.')
                if message['message_type'] not in {'COMMAND','TELEMETRY'}: fail('SCHEMA_INVALID', 'message_type must be COMMAND or TELEMETRY.')
                if type(message['payload']) is not dict: fail('SCHEMA_INVALID', 'payload must be an object.')
                if not re.fullmatch('[0-9a-f]{64}', message['auth_tag']): fail('SCHEMA_INVALID', 'auth_tag must be 64 lowercase hexadecimal characters.')
                checks[idx].update(status='PASS', explanation='Strict JSON, exact envelope, types, and size verified.')
                idx = 1
                if message['key_id'] not in KEYS: fail('KEY_UNKNOWN', 'Key identifier is not registered. Sender remains unverified.')
                if KEYS[message['key_id']] != message['sender_id']: fail('IDENTITY_MISMATCH', 'Registered key does not belong to the claimed sender.')
                checks[idx].update(status='PASS', explanation='Key registry matches the claimed sender; authentication follows.')
                idx = 2
                if not hmac.compare_digest(self.sign(message), message['auth_tag']): fail('AUTH_FAILED', 'HMAC does not match. The message may have been modified after signing.')
                verified = True
                checks[idx].update(status='PASS', explanation='HMAC-SHA256 verified using constant-time comparison.')
                idx = 3
                if message['target_id'] != TARGET: fail('TARGET_UNKNOWN', 'Only KAVACH-SAT-01 is a valid target.')
                action, payload, kind = message['action'], message['payload'], message['message_type']
                allowed = {'GET_STATUS','SET_MODE','SET_REPORT_INTERVAL'} if kind == 'COMMAND' else {'TELEMETRY_STATUS'}
                if action not in allowed: fail('ACTION_INVALID', 'Action is not defined for this message type.')
                if action == 'GET_STATUS' and payload != {}: fail('PAYLOAD_INVALID','GET_STATUS requires an empty payload.')
                if action == 'SET_MODE' and (set(payload) != {'mode'} or type(payload['mode']) is not str or payload['mode'] not in MODES): fail('PAYLOAD_INVALID', 'mode must be NORMAL, POWER_SAVING, or SAFE, with no extra fields.')
                if action == 'SET_REPORT_INTERVAL' and (set(payload) != {'seconds'} or type(payload['seconds']) is not int or not 1 <= payload['seconds'] <= 60): fail('PAYLOAD_INVALID', 'seconds must be an integer from 1 to 60, with no extra fields.')
                if action == 'TELEMETRY_STATUS':
                    if set(payload) != {'battery_pct','temperature_c','mode'}: fail('PAYLOAD_INVALID', 'Telemetry requires exactly battery_pct, temperature_c, and mode.')
                    for field, low, high in [('battery_pct',0,100),('temperature_c',-50,120)]:
                        if type(payload[field]) is not int or not low <= payload[field] <= high: fail('PAYLOAD_INVALID', f'{field} must be an integer from {low} to {high}.')
                    if type(payload['mode']) is not str or payload['mode'] not in MODES: fail('PAYLOAD_INVALID', 'Telemetry mode is not supported.')
                checks[idx].update(status='PASS', explanation='Target, action, exact payload fields, and simulator bounds verified.')
                idx = 4
                issued, expires = message['issued_at'], message['expires_at']
                if issued > now + 5: fail('CLOCK_SKEW', 'issued_at exceeds the permitted 5-second future clock skew.')
                if not 0 < expires-issued <= 60: fail('LIFETIME_INVALID', 'Message lifetime must be greater than 0 and at most 60 seconds.')
                if now >= expires or now-issued > 60: fail('EXPIRED', 'Message has expired at the captured receiver time.')
                checks[idx].update(status='PASS', explanation='Message is within its lifetime and the permitted clock skew.')
                idx = 5
                sender = message['sender_id']
                authorised = (kind == 'TELEMETRY' and sender == 'satellite-01') or (kind == 'COMMAND' and (sender == 'operator-01' or (sender == 'observer-01' and action == 'GET_STATUS')))
                if not authorised: fail('NOT_AUTHORISED', f'Authenticated {sender} is not permitted to perform {action}. A valid HMAC does not grant permission.')
                checks[idx].update(status='PASS', explanation=f'{sender} is authorised for {action} under {POLICY}.')
                idx = 6
                stream = (sid,sender,TARGET,kind)
                last = db.execute('SELECT seq FROM streams WHERE session=? AND sender=? AND target=? AND kind=?', stream).fetchone()
                replay_before = last[0] if last else 0
                if db.execute('SELECT 1 FROM accepted WHERE session=? AND sender=? AND target=? AND kind=? AND message_id=?', (*stream,message['message_id'])).fetchone(): fail('REPLAY', 'This message ID was already accepted in this stream.')
                if last and message['sequence'] <= last[0]: fail('OUT_OF_ORDER', f'Sequence {message["sequence"]} is not greater than the accepted maximum {last[0]}.')
                checks[idx].update(status='PASS', explanation='Message ID is new and sequence strictly increases in this stream.')
                idx = 7
                if action == 'SET_MODE': after['mode'] = payload['mode']
                if action == 'SET_REPORT_INTERVAL': after['report_interval_s'] = payload['seconds']
                if kind == 'TELEMETRY': telemetry_after = {**payload,'received_at': now,'source': 'Accepted satellite fixture','message_id': message['message_id']}
                elif after != before:
                    # Local synthetic model emission, not physical telemetry or a client command.
                    telemetry_after = {'battery_pct': 87,'temperature_c': 24,'mode': after['mode'],'received_at': now,'source': 'Local satellite model'}
                db.execute('UPDATE sessions SET state=?,telemetry=? WHERE id=?', (json.dumps(after),json.dumps(telemetry_after) if telemetry_after else None,sid))
                db.execute('INSERT OR REPLACE INTO streams VALUES(?,?,?,?,?)', (*stream,message['sequence']))
                db.execute('INSERT INTO accepted VALUES(?,?,?,?,?)', (*stream,message['message_id']))
                checks[idx].update(status='PASS', explanation='State, replay protection, and acceptance audit committed atomically.')
                verdict, code, explanation = 'ACCEPTED', 'OK', ('Telemetry received. Protected spacecraft mode is unchanged.' if kind == 'TELEMETRY' else 'All checks passed. ' + ('Simulated spacecraft state updated.' if before != after else 'Command accepted; no protected state change.'))
            except Invalid as exc:
                checks[idx].update(status='FAIL', explanation=exc.explanation)
                verdict, code, explanation = 'REJECTED', exc.code, exc.explanation
                after, telemetry_after = dict(before), telemetry_before
            event = dict(event_id=str(uuid.uuid4()),session_id=sid,verdict=verdict,reason_code=code,explanation=explanation,checks=checks,sender_verified=verified,received_at=now,protected_state_before=before,protected_state_after=after,state_changed=before != after,telemetry_before=telemetry_before,telemetry_after=telemetry_after,policy_version=POLICY,input_sha256=hashlib.sha256(raw).hexdigest(),message=self.safe_message(message),duration_ms=round((time.perf_counter()-started)*1000,2))
            event.update(input_truncated=input_truncated, input_hash_scope='first 8193 bytes; full oversized body was not retained' if input_truncated else 'complete received input', audit_persisted=True, replay_state_advanced=verdict == 'ACCEPTED', replay_sequence_before=replay_before, replay_sequence_after=message['sequence'] if verdict == 'ACCEPTED' else replay_before)
            if verdict == 'ACCEPTED':
                event['submitted_text'] = raw.decode('utf-8')  # bounded, validated envelope; enables byte-exact replay
            db.execute('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)', (event['event_id'],sid,now,verdict,message.get('sender_id','unverified') if isinstance(message,dict) and isinstance(message.get('sender_id'),str) else 'unverified',message.get('message_type','UNKNOWN') if isinstance(message,dict) and isinstance(message.get('message_type'),str) else 'UNKNOWN',code,json.dumps(event)))
            db.commit()
            return event
        except (sqlite3.Error, ValueError, TypeError, OverflowError) as exc:
            if db is not None:
                with suppress(sqlite3.Error):
                    db.rollback()
            checks[min(idx,7)].update(status='FAIL', explanation='Service failure. Transaction rolled back; no execution committed and no persistence claimed.')
            return {'verdict':'SERVICE_ERROR','reason_code':'SERVICE_ERROR','explanation':'No execution committed. Database or validator service failed.','checks':checks,'sender_verified':verified,'state_changed':False,'policy_version':POLICY,'session_id':sid,'protected_state_before':before,'protected_state_after':before,'audit_persisted':False,'replay_state_advanced':False,'replay_sequence_before':replay_before,'replay_sequence_after':replay_before,'message':self.safe_message(message)}
        finally:
            if db is not None:
                with suppress(sqlite3.Error):
                    db.close()

    @staticmethod
    def safe_message(message):
        if not isinstance(message,dict): return None
        clean = {k:v for k,v in message.items() if k in FIELDS and k != 'payload' and type(v) in (int,str) and len(str(v)) <= 200}
        if isinstance(message.get('payload'),dict):
            clean['payload'] = {k:v for k,v in message['payload'].items() if k in {'mode','seconds','battery_pct','temperature_c'} and type(v) in (int,str) and len(str(v)) <= 100}
        return clean

    def audit(self, session=None, verdict=None, sender=None, kind=None, reason=None, limit=50, offset=0):
        with self.connect() as db:
            if session is not None:
                self.state(session, db)
            sql, args = ' FROM audit WHERE 1=1', []
            for col, val in [('session',session),('verdict',verdict),('sender',sender),('kind',kind),('reason',reason)]:
                if val: sql += f' AND {col}=?'; args.append(val)
            total = db.execute('SELECT COUNT(*)'+sql,args).fetchone()[0]
            rows = db.execute('SELECT event'+sql+' ORDER BY rowid DESC LIMIT ? OFFSET ?',(*args,min(limit,200),offset)).fetchall()
            return {'total':total,'events':[json.loads(row[0]) for row in rows]}

    def export(self, session=None):
        sid = session or self.active_session()
        with self.connect() as db:
            db.execute('BEGIN')  # Consistent read-only snapshot of state and evidence.
            snapshot = self.state(sid, db)
            events = [json.loads(r[0]) for r in db.execute('SELECT event FROM audit WHERE session=? ORDER BY rowid',(sid,))]
            suites = [json.loads(r[0]) for r in db.execute('SELECT result FROM suites WHERE session=?',(sid,))]
            db.commit()
        return {'label':'Synthetic data — local simulation only. Not immutable or tamper-proof.','schema_version':1,'policy_version':POLICY,'exported_at':int(time.time()),'session_id':sid,'state':snapshot,'events':events,'scenario_results':suites}

    def scenarios(self, owner_session=None):
        sid, now = self.new_session(False), 1792137600
        results = []
        def replay_snapshot():
            with self.connect() as db:
                return ([tuple(r) for r in db.execute('SELECT * FROM streams WHERE session=? ORDER BY sender,target,kind',(sid,))], [tuple(r) for r in db.execute('SELECT * FROM accepted WHERE session=? ORDER BY sender,target,kind,message_id',(sid,))])
        def run(name, expected, msg, note=''):

            before = self.state(sid)
            replay_before = replay_snapshot()
            result = self.validate(msg if isinstance(msg,bytes) else json.dumps(msg).encode(),sid,now)
            after = self.state(sid)
            unchanged = result['verdict'] == 'ACCEPTED' or (before == after and replay_before == replay_snapshot())
            effect_matches = True
            if result['verdict'] == 'ACCEPTED' and isinstance(msg, dict):
                expected_state = dict(before['protected_state'])
                if msg['action'] == 'SET_MODE': expected_state['mode'] = msg['payload']['mode']
                if msg['action'] == 'SET_REPORT_INTERVAL': expected_state['report_interval_s'] = msg['payload']['seconds']
                effect_matches = after['protected_state'] == expected_state
                if msg['message_type'] == 'TELEMETRY':
                    effect_matches = effect_matches and all(after['latest_telemetry'][k] == v for k,v in msg['payload'].items())
            observed = 'ACCEPTED' if result['verdict'] == 'ACCEPTED' else result['reason_code']
            results.append({'name':name,'expected':expected,'observed':observed,'passed':observed==expected and unchanged and effect_matches,'state_preserved':unchanged,'effect_matches':effect_matches,'event_id':result.get('event_id'),'note':note,'result':result})
            return result
        def issue(**kw): return self.issue(session=sid,now=now,**kw)
        def signed(msg, **kw):
            msg.update(kw); msg['auth_tag'] = self.sign(msg); return msg
        valid = issue(payload={'mode':'POWER_SAVING'})
        run('Valid operator command','ACCEPTED',valid)
        tampered = issue(payload={'mode':'NORMAL'}); tampered['payload']['mode']='SAFE'
        run('Tampered payload','AUTH_FAILED',tampered)
        run('Replay accepted message','REPLAY',valid)
        run('Expired message','EXPIRED',issue(payload={'mode':'SAFE'},issued_offset=-61))
        run('Future timestamp','CLOCK_SKEW',issue(payload={'mode':'SAFE'},issued_offset=6))
        run('Unauthorised observer','NOT_AUTHORISED',issue(sender='observer-01',payload={'mode':'SAFE'}))
        run('Invalid payload range','PAYLOAD_INVALID',issue(action='SET_REPORT_INTERVAL',payload={'seconds':61}))
        run('Valid telemetry','ACCEPTED',issue(sender='satellite-01',kind='TELEMETRY',action='TELEMETRY_STATUS',payload={'battery_pct':87,'temperature_c':24,'mode':'SAFE'}))
        run('Observer status request','ACCEPTED',issue(sender='observer-01',action='GET_STATUS',payload={}))
        run('Unknown key','KEY_UNKNOWN',{**issue(payload={'mode':'SAFE'}),'key_id':'unknown-key'})
        run('Mismatched sender','IDENTITY_MISMATCH',{**issue(payload={'mode':'SAFE'}),'sender_id':'observer-01'})
        run('Excessive lifetime','LIFETIME_INVALID',issue(payload={'mode':'SAFE'},lifetime=61))
        run('Out-of-order sequence','OUT_OF_ORDER',signed(issue(payload={'mode':'SAFE'}),sequence=1))
        run('Unknown action','ACTION_INVALID',issue(action='UNDEFINED',payload={}))
        run('Unknown target','TARGET_UNKNOWN',signed(issue(payload={'mode':'SAFE'}),target_id='OTHER-SAT'))
        run('Boolean is not integer','SCHEMA_INVALID',signed(issue(action='SET_REPORT_INTERVAL',payload={'seconds':True})))
        run('Duplicate JSON key','INVALID_JSON',b'{"version":1,"version":1}')
        run('Malformed JSON','INVALID_JSON',b'{not-json}')
        run('Unknown envelope field','SCHEMA_INVALID',{**issue(payload={'mode':'SAFE'}),'role':'admin'})
        run('Missing required field','SCHEMA_INVALID',{k:v for k,v in issue(payload={'mode':'SAFE'}).items() if k!='version'})
        run('Key order & whitespace invariance','ACCEPTED',json.dumps(dict(reversed(list(issue(payload={'mode':'SAFE'}).items()))),indent=4).encode())
        run('Invalid telemetry preserves snapshot','PAYLOAD_INVALID',issue(sender='satellite-01',kind='TELEMETRY',action='TELEMETRY_STATUS',payload={'battery_pct':101,'temperature_c':24,'mode':'SAFE'}))
        bad = issue(payload={'mode':'NORMAL'}); bad['sequence']=999999; bad['payload']['mode']='SAFE'
        run('Invalid high sequence','AUTH_FAILED',bad)
        run('Valid after high-sequence rejection','ACCEPTED',issue(payload={'mode':'NORMAL'}))
        # Exercise the real transaction lock using simultaneous duplicate submissions.
        from concurrent.futures import ThreadPoolExecutor
        import threading
        import tempfile
        import platform
        concurrent_message = json.dumps(issue(payload={'mode':'SAFE'})).encode()
        barrier = threading.Barrier(2)
        def concurrent_submit(_):
            barrier.wait(timeout=10)
            return self.validate(concurrent_message, sid, now)
        with ThreadPoolExecutor(2) as pool:
            concurrent_results = sorted(list(pool.map(concurrent_submit, range(2))), key=lambda r:r['verdict'])
        for index, result in enumerate(concurrent_results):
            expected = 'ACCEPTED' if index == 0 else 'REPLAY'
            observed = 'ACCEPTED' if result['verdict'] == 'ACCEPTED' else result['reason_code']
            results.append({'name':f'Concurrent duplicate / {index+1}', 'expected':expected, 'observed':observed, 'passed':observed==expected, 'state_preserved':not result['state_changed'] if index else True, 'event_id':result.get('event_id'), 'note':'Two submissions synchronized at a thread barrier. Exactly one must commit.', 'result':result})
        restarted = Engine(self.root)
        result = restarted.validate(concurrent_message,sid,now)
        results.append({'name':'Replay after engine restart','expected':'REPLAY','observed':result['reason_code'],'passed':result['reason_code']=='REPLAY','state_preserved':not result['state_changed'],'event_id':result.get('event_id'),'note':'New engine instance reloads keys, replay records, and state from disk; the web process is not stopped.','result':result})
        # Failure injection uses a separate temporary database, never the mission DB.
        for failure in ['commit', 'audit']:
            with tempfile.TemporaryDirectory(prefix='kavach-fault-') as directory:
                fault_engine = Engine(directory)
                fixture = fault_engine.issue(payload={'mode':'SAFE'},now=now)
                before = fault_engine.state()
                original_connect = fault_engine.connect
                class FaultConnection:
                    def __init__(self): self.conn = original_connect()
                    def __getattr__(self,name): return getattr(self.conn,name)
                    def execute(self,sql,*args):
                        if failure == 'audit' and sql.startswith('INSERT INTO audit'):
                            raise sqlite3.OperationalError('Injected audit write failure')
                        return self.conn.execute(sql,*args)
                    def commit(self):
                        if failure == 'commit': raise sqlite3.OperationalError('Injected commit failure')
                        return self.conn.commit()
                fault_engine.connect = FaultConnection
                result = fault_engine.validate(json.dumps(fixture).encode(),now=now)
                fault_engine.connect = original_connect
                unchanged = before == fault_engine.state() and fault_engine.audit()['total'] == 0
                retry = fault_engine.validate(json.dumps(fixture).encode(),now=now)
                passed = result['verdict']=='SERVICE_ERROR' and unchanged and retry['verdict']=='ACCEPTED'
                results.append({'name':f'Database {failure} failure rollback','expected':'SERVICE_ERROR','observed':result['verdict'],'passed':passed,'state_preserved':unchanged,'event_id':None,'note':'Isolated temporary DB. State, audit, and replay roll back; a retry after recovery must succeed.','result':result})
        report = {'suite_id':str(uuid.uuid4()),'session_id':sid,'owner_session_id':owner_session or self.active_session(),'executed_at':int(time.time()),'clock':'Injected UTC Unix time 1792137600','passed':sum(r['passed'] for r in results),'total':len(results),'results':results,'isolated':True,'environment':{'python':platform.python_version(),'sqlite':sqlite3.sqlite_version,'platform':platform.platform()}}
        with self.connect() as db:
            db.execute('INSERT INTO suites VALUES(?,?,?)',(report['suite_id'],report['owner_session_id'],json.dumps(report)))
        return report
