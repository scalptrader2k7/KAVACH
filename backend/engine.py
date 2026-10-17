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

# --- Protected-state schema (versioned) -------------------------------------------
# Version 1 shipped only mode + report_interval_s. Version 2 adds two fictional
# fields so the simulator can demonstrate a safe, additive state migration.
#
# These are SYNTHETIC MODEL OUTPUTS, not spacecraft telemetry and not physical
# truth. They are derived from the protected mode by a documented local rule
# table and are never settable by any message: no new command, action, payload
# field, or permission is introduced, so the message attack surface is unchanged.
#
# Deterministic initial values are required by the roadmap and are asserted in
# tests/test_engine.py.
STATE_SCHEMA_VERSION = 2
INITIAL = {'mode': 'NORMAL', 'report_interval_s': 10, 'antenna_status': 'NOMINAL', 'power_level_pct': 87}
ANTENNA_STATES = {'NOMINAL', 'DEGRADED', 'STOWED'}
# Local synthetic model rule: protected mode -> antenna/power model output.
MODEL_RULES = {
    'NORMAL': {'antenna_status': 'NOMINAL', 'power_level_pct': 87},
    'POWER_SAVING': {'antenna_status': 'STOWED', 'power_level_pct': 42},
    'SAFE': {'antenna_status': 'DEGRADED', 'power_level_pct': 65},
}
MODEL_RULE_FIELDS = ('antenna_status', 'power_level_pct')

# Which receiver stage raises each reason code. Deterministic by construction: every
# fail() call belongs to exactly one stage, so a stage filter can be expressed as a
# reason-code set without parsing stored JSON.
STAGE_REASONS = {
    'structure': ('BODY_TOO_LARGE', 'INVALID_JSON', 'SCHEMA_INVALID'),
    'identity': ('KEY_UNKNOWN', 'IDENTITY_MISMATCH'),
    'authentication': ('AUTH_FAILED',),
    'payload': ('TARGET_UNKNOWN', 'ACTION_INVALID', 'PAYLOAD_INVALID'),
    'time': ('CLOCK_SKEW', 'LIFETIME_INVALID', 'EXPIRED'),
    'permissions': ('NOT_AUTHORISED',),
    'replay': ('REPLAY', 'OUT_OF_ORDER'),
    'commit': ('SERVICE_ERROR',),
}
REASON_STAGE = {reason: stage for stage, reasons in STAGE_REASONS.items() for reason in reasons}

# Declared scenario-suite size. tests/test_phase4.py asserts this equals the number of
# cases the suite actually executes, so the number shown in the UI can never drift.
SCENARIO_CASE_COUNT = 31

# --- Tamper-evident audit chain -------------------------------------------------
# Each accepted-or-rejected decision is appended to a hash-linked log in the SAME
# transaction that writes the audit row, so chain and record commit or roll back
# together (Rule 4: atomicity is never traded for evidence).
#
# record_hash = SHA256(prev_hash || canonical(covered_fields))
#
# LIMITATION, stated plainly: a hash chain detects modification of a COVERED record
# and detects broken links or missing intermediate records. It does NOT prove record
# origin, does NOT prevent an attacker with write access from rewriting the entire
# chain from genesis, and is NOT tamper-proof. It is a local integrity check only.
CHAIN_GENESIS = '0' * 64
# Exactly which fields the chain covers. Anything not listed here is NOT covered.
CHAIN_COVERED_FIELDS = (
    'event_id', 'session_id', 'verdict', 'reason_code', 'sender', 'kind',
    'received_at', 'input_sha256', 'sender_verified', 'state_changed',
    'replay_state_advanced', 'protected_state_before', 'protected_state_after',
    'telemetry_before', 'telemetry_after', 'checks', 'policy_version',
)

# --- Server-authoritative policy model (roadmap feature 8) ----------------------
# Roles are synthetic simulator constructs. The receiver evaluates them; the browser
# can only read them. A message field can NEVER grant a role (see TestRolePolicy in
# tests/test_phase2.py).
#
# Compatibility: the operator / observer / satellite fixture identities are retained
# exactly. Their default roles reproduce the previous hardcoded authorisation
# expression decision-for-decision, so no existing command changes verdict:
#
#   TELEMETRY was authorised iff sender == 'satellite-01'
#   COMMAND   was authorised iff sender == 'operator-01'
#                               or (sender == 'observer-01' and action == 'GET_STATUS')
ROLES = ('VIEWER', 'OPERATOR', 'TELEMETRY_SOURCE', 'ADMINISTRATOR')
ROLE_LABELS = {
    'VIEWER': 'Viewer — may request status only',
    'OPERATOR': 'Operator — may command the simulator',
    'TELEMETRY_SOURCE': 'Telemetry source — may publish telemetry only',
    'ADMINISTRATOR': 'Administrator — full command authority and policy modification',
}
# sender_id -> default role. Unchanged semantics for the three baseline identities.
DEFAULT_ROLES = {
    'observer-01': 'VIEWER',
    'operator-01': 'OPERATOR',
    'satellite-01': 'TELEMETRY_SOURCE',
}
# role -> permitted actions, per message type. Exactly the original expression.
ROLE_PERMISSIONS = {
    'VIEWER':           {'COMMAND': {'GET_STATUS'}, 'TELEMETRY': set()},
    'OPERATOR':         {'COMMAND': {'GET_STATUS', 'SET_MODE', 'SET_REPORT_INTERVAL'}, 'TELEMETRY': set()},
    'TELEMETRY_SOURCE': {'COMMAND': set(), 'TELEMETRY': {'TELEMETRY_STATUS'}},
    'ADMINISTRATOR':    {'COMMAND': {'GET_STATUS', 'SET_MODE', 'SET_REPORT_INTERVAL'}, 'TELEMETRY': {'TELEMETRY_STATUS'}},
}
# No baseline sender maps to ADMINISTRATOR by default, so it is inert until an
# administrator deliberately assigns it through the gated local policy surface.

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
            CREATE TABLE IF NOT EXISTS policy(role TEXT PRIMARY KEY,actions TEXT);
            CREATE TABLE IF NOT EXISTS audit_chain(seq INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT,event_id TEXT,record_hash TEXT,prev_hash TEXT,covered TEXT);
            ''')
            if not db.execute("SELECT value FROM meta WHERE key='active'").fetchone():
                self._new_session(db, True)
            self._migrate_state(db)
            self._seed_policy(db)

    def _migrate_state(self, db):
        """Additive, idempotent, non-destructive protected-state migration.

        Version 1 stored only {'mode', 'report_interval_s'}. Version 2 adds the
        fictional antenna/power model fields. Existing values are never altered,
        dropped, or re-signed; only *missing* keys are filled from the documented
        synthetic model rule for that session's current mode. Historical audit
        snapshots are deliberately left exactly as recorded.

        The applied version is recorded in `meta` so the migration runs at most
        once per database and can be audited. If a stored state is unparseable
        the migration raises rather than guessing.
        """
        row = db.execute("SELECT value FROM meta WHERE key='state_schema_version'").fetchone()
        applied = int(row[0]) if row else 1
        if applied >= STATE_SCHEMA_VERSION:
            return
        migrated = 0
        for session in db.execute('SELECT id, state FROM sessions').fetchall():
            try:
                stored = json.loads(session['state'])
            except (ValueError, TypeError):
                raise ValueError('Stored protected state is unreadable; refusing to migrate.') from None
            if not isinstance(stored, dict):
                raise ValueError('Stored protected state is not an object; refusing to migrate.')
            if all(field in stored for field in MODEL_RULE_FIELDS):
                continue  # already at version 2
            mode = stored.get('mode')
            if mode not in MODEL_RULES:
                # Unknown mode: keep the record untouched and skip it loudly.
                continue
            filled = dict(stored)
            for field in MODEL_RULE_FIELDS:
                if field not in filled:
                    filled[field] = MODEL_RULES[mode][field]
            db.execute('UPDATE sessions SET state=? WHERE id=?', (json.dumps(filled), session['id']))
            migrated += 1
        db.execute("INSERT OR REPLACE INTO meta VALUES('state_schema_version',?)", (str(STATE_SCHEMA_VERSION),))
        db.execute("INSERT OR REPLACE INTO meta VALUES('state_migrated_sessions',?)", (str(migrated),))
        db.commit()

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

    def reset_demo(self):
        """Deterministic scenario reset (roadmap features 18 and 24).

        Creates a new isolated session whose state is exactly the documented
        INITIAL value, with a fresh replay stream. Nothing is deleted: prior
        sessions, their audit history, and every signing key are preserved and
        reported back so the operator can see what survived.

        Deterministic means the resulting state is always the same documented
        value, never that history is discarded to obtain it.
        """
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            preserved_sessions = db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]
            preserved_audit = db.execute('SELECT COUNT(*) FROM audit').fetchone()[0]
            preserved_chain = db.execute('SELECT COUNT(*) FROM audit_chain').fetchone()[0]
            sid = self._new_session(db, True)
            db.commit()
        return {'session_id': sid, 'protected_state': dict(INITIAL),
                'state_schema_version': STATE_SCHEMA_VERSION,
                'latest_telemetry': None, 'target_id': TARGET, 'policy_version': self.policy_version(),
                'preserved': {'sessions': preserved_sessions, 'audit_events': preserved_audit,
                              'chain_links': preserved_chain, 'signing_keys': len(self.secrets)},
                'note': 'Deterministic reset: the new session always starts at the documented initial state. No session, audit record, or signing key was deleted.'}

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
        return {'session_id': sid, 'protected_state': json.loads(row['state']), 'latest_telemetry': json.loads(row['telemetry']) if row['telemetry'] else None, 'target_id': TARGET, 'policy_version': POLICY, 'state_schema_version': STATE_SCHEMA_VERSION}

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

    # --- Server-authoritative policy model --------------------------------------

    def _seed_policy(self, db):
        """Insert default role permissions. Never overwrites an existing policy row,
        so an administrator's deliberate changes survive restarts."""
        for role, per_type in ROLE_PERMISSIONS.items():
            row = db.execute('SELECT actions FROM policy WHERE role=?', (role,)).fetchone()
            if row:
                continue
            db.execute('INSERT INTO policy VALUES(?,?)', (role, json.dumps({k: sorted(v) for k, v in per_type.items()})))
        db.commit()

    def _stored_policy(self, db):
        """Read the policy table using the caller's connection. Never opens a second
        connection: validate() holds BEGIN IMMEDIATE and a nested connect could
        deadlock or fail under lock contention."""
        return {r[0]: json.loads(r[1]) for r in db.execute('SELECT role,actions FROM policy').fetchall()}

    def role_for(self, sender, db=None):
        """Role lookup is server-side only. An unknown sender has no role."""
        if sender not in DEFAULT_ROLES:
            return None
        role = DEFAULT_ROLES[sender]
        if db is None:
            with self.connect() as conn:
                stored = self._stored_policy(conn)
        else:
            stored = self._stored_policy(db)
        if role not in stored:
            return role
        merged = {k: set(v) for k, v in ROLE_PERMISSIONS[role].items()}
        for kind, actions in stored[role].items():
            merged.setdefault(kind, set()).update(actions)
        return role

    def permitted(self, sender, kind, action, db=None):
        """Authorisation decision. Pure read of the policy table; no writes, and it
        reuses the caller's transaction when one is supplied."""
        role = self.role_for(sender, db)
        if role is None:
            return False, None
        allowed = set(ROLE_PERMISSIONS[role].get(kind, set()))
        if db is None:
            with self.connect() as conn:
                allowed |= set(self._stored_policy(conn).get(role, {}).get(kind, []))
        else:
            allowed |= set(self._stored_policy(db).get(role, {}).get(kind, []))
        return action in allowed, role

    def policy_snapshot(self):
        """Read-only view for the UI. Contains no secrets and grants nothing."""
        with self.connect() as db:
            stored = self._stored_policy(db)
        roles = []
        for role in ROLES:
            per_type = {k: sorted(v) for k, v in ROLE_PERMISSIONS[role].items()}
            for kind, actions in stored.get(role, {}).items():
                per_type.setdefault(kind, [])
                per_type[kind] = sorted(set(per_type[kind]) | set(actions))
            roles.append({'role': role, 'label': ROLE_LABELS[role], 'permissions': per_type,
                          'senders': sorted(s for s, r in DEFAULT_ROLES.items() if r == role)})
        return {'policy_version': POLICY, 'roles': roles, 'default_roles': dict(DEFAULT_ROLES),
                'server_authoritative': True,
                'note': 'Roles are evaluated by the receiver. No message field can grant a role.'}

    def policy_version(self, db=None):
        if db is not None:
            row = db.execute("SELECT value FROM meta WHERE key='policy_version'").fetchone()
        else:
            with self.connect() as conn:
                row = conn.execute("SELECT value FROM meta WHERE key='policy_version'").fetchone()
        return row[0] if row else POLICY

    def set_role_permissions(self, role, permissions):
        """Administrative policy modification. Server-authoritative, validated, versioned,
        and audited. Returns the new policy version.

        `permissions` must map message kind -> list of action names. Unknown roles,
        kinds, or actions are rejected rather than silently dropped.
        """
        if role not in ROLES:
            raise ValueError(f'Unknown role {role!r}. Known roles: {", ".join(ROLES)}.')
        if not isinstance(permissions, dict) or not permissions:
            raise ValueError('Permissions must be a non-empty object of message kind to action list.')
        cleaned = {}
        for kind, actions in permissions.items():
            if kind not in {'COMMAND', 'TELEMETRY'}:
                raise ValueError(f'Unknown message kind {kind!r}.')
            if not isinstance(actions, list) or any(not isinstance(a, str) for a in actions):
                raise ValueError(f'Actions for {kind} must be a list of strings.')
            known = {a for per in ROLE_PERMISSIONS.values() for a in per.get(kind, set())}
            unknown = sorted(set(actions) - known)
            if unknown:
                raise ValueError(f'Unknown action(s) for {kind}: {", ".join(unknown)}.')
            cleaned[kind] = sorted(set(actions))
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT OR REPLACE INTO policy VALUES(?,?)', (role, json.dumps(cleaned)))
            major, minor = self.policy_version(db).rsplit('.', 1)
            version = f'{major}.{int(minor) + 1}'
            db.execute("INSERT OR REPLACE INTO meta VALUES('policy_version',?)", (version,))
            event = dict(event_id=str(uuid.uuid4()), session_id=None, verdict='POLICY_CHANGE',
                         reason_code='POLICY_UPDATED',
                         explanation=f'Role {role} permissions updated by the local administrative boundary. Policy is now {version}.',
                         checks=[], sender_verified=True, received_at=int(time.time()),
                         protected_state_before=None, protected_state_after=None, state_changed=False,
                         telemetry_before=None, telemetry_after=None, policy_version=version,
                         input_sha256=hashlib.sha256(json.dumps(cleaned, sort_keys=True).encode()).hexdigest(),
                         audit_persisted=True, replay_state_advanced=False, role=role, permissions=cleaned)
            db.execute('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)',
                       (event['event_id'], 'policy', int(time.time()), 'POLICY_CHANGE', 'administrator',
                        'POLICY', 'POLICY_UPDATED', json.dumps(event)))
            self._append_chain(db, event)
            db.commit()
        return version

    # --- Hash-linked audit chain --------------------------------------------------

    @staticmethod
    def _covered(event):
        """Canonical, deterministic encoding of exactly the covered fields."""
        covered = {field: event.get(field) for field in CHAIN_COVERED_FIELDS}
        return json.dumps(covered, sort_keys=True, separators=(',', ':'),
                          ensure_ascii=True, allow_nan=False, default=str).encode('utf-8')

    @classmethod
    def _chain_hash(cls, prev_hash, covered_bytes):
        return hashlib.sha256(prev_hash.encode('ascii') + b'\x00' + covered_bytes).hexdigest()

    def _append_chain(self, db, event):
        """Append one link. Must be called inside the caller's open transaction."""
        last = db.execute('SELECT record_hash FROM audit_chain ORDER BY seq DESC LIMIT 1').fetchone()
        prev = last[0] if last else CHAIN_GENESIS
        covered = self._covered(event)
        db.execute('INSERT INTO audit_chain(session,event_id,record_hash,prev_hash,covered) VALUES(?,?,?,?,?)',
                   (event.get('session_id'), event.get('event_id'),
                    self._chain_hash(prev, covered), prev, covered.decode('utf-8')))

    def verify_audit_chain(self, session=None, db=None):
        """Verify the hash-linked audit log.

        Detects: modification of a covered record's contents, broken links, and
        missing intermediate records (sequence gaps). Records written before the
        chain existed are reported as UNCOVERED, never silently repaired and never
        treated as failures.
        """
        if db is None:
            with self.connect() as conn:
                return self.verify_audit_chain(session, conn)
        rows = db.execute('SELECT seq,session,event_id,record_hash,prev_hash,covered FROM audit_chain ORDER BY seq').fetchall()
        audit_rows = {r[0]: r[1] for r in db.execute('SELECT id,event FROM audit').fetchall()}
        problems, previous = [], CHAIN_GENESIS
        expected_seq = None
        for index, row in enumerate(rows):
            seq, row_session, event_id, record_hash, prev_hash, covered = row
            label = f'link #{seq} (event {event_id})'
            if expected_seq is not None and seq != expected_seq:
                problems.append({'kind': 'MISSING_LINK', 'detail': f'Sequence jumped from {expected_seq - 1} to {seq}; intermediate record(s) missing.', 'link': seq})
            expected_seq = seq + 1
            if prev_hash != previous:
                problems.append({'kind': 'BROKEN_LINK', 'detail': 'Stored previous hash does not match the preceding record hash.', 'link': seq})
            recomputed = self._chain_hash(prev_hash, covered.encode('utf-8'))
            if recomputed != record_hash:
                problems.append({'kind': 'HASH_MISMATCH', 'detail': 'Stored record hash does not match its covered contents.', 'link': seq})
            stored = audit_rows.get(event_id)
            if stored is None:
                problems.append({'kind': 'ORPHAN_LINK', 'detail': 'Chain link has no corresponding audit record.', 'link': seq})
            else:
                live = self._covered(json.loads(stored))
                if live.decode('utf-8') != covered:
                    problems.append({'kind': 'RECORD_MODIFIED', 'detail': 'The persisted audit record no longer matches its chained contents. A covered field was altered after commit.', 'link': seq})
            if session is not None and row_session != session:
                continue
            previous = record_hash
        covered_ids = {r[2] for r in rows}
        uncovered = [eid for eid in audit_rows if eid not in covered_ids]
        status = 'VERIFIED' if not problems else 'FAILED'
        return {
            'status': status,
            'links_checked': len(rows),
            'uncovered_records': len(uncovered),
            'uncovered_note': ('Records written before the audit chain existed are not covered by it. '
                               'They are reported here rather than repaired or deleted.') if uncovered else None,
            'problems': problems[:20],
            'genesis': CHAIN_GENESIS,
            'covered_fields': list(CHAIN_COVERED_FIELDS),
            'limitations': [
                'Detects modification of covered record contents, broken links, and missing intermediate records.',
                'Does NOT prove record origin or authorship.',
                'Does NOT prevent an attacker with write access from rewriting the entire chain from genesis.',
                'Is NOT tamper-proof. It is a local integrity check over a local SQLite file.',
            ],
        }

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
                authorised, role = self.permitted(sender, kind, action, db)
                if not authorised:
                    fail('NOT_AUTHORISED', f'Authenticated {sender} is not permitted to perform {action}. A valid HMAC does not grant permission.')
                checks[idx].update(status='PASS', explanation=f'{sender} is authorised for {action} as {role} under {POLICY}.')
                idx = 6
                stream = (sid,sender,TARGET,kind)
                last = db.execute('SELECT seq FROM streams WHERE session=? AND sender=? AND target=? AND kind=?', stream).fetchone()
                replay_before = last[0] if last else 0
                if db.execute('SELECT 1 FROM accepted WHERE session=? AND sender=? AND target=? AND kind=? AND message_id=?', (*stream,message['message_id'])).fetchone(): fail('REPLAY', 'This message ID was already accepted in this stream.')
                if last and message['sequence'] <= last[0]: fail('OUT_OF_ORDER', f'Sequence {message["sequence"]} is not greater than the accepted maximum {last[0]}.')
                checks[idx].update(status='PASS', explanation='Message ID is new and sequence strictly increases in this stream.')
                idx = 7
                if action == 'SET_MODE':
                    after['mode'] = payload['mode']
                    # Synthetic local model rule. Not settable by any message and not
                    # physical telemetry; see STATE_SCHEMA_VERSION above.
                    after.update(MODEL_RULES[payload['mode']])
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
            first_failed_stage = checks[idx]['stage'] if verdict == 'REJECTED' else None
            event = dict(event_id=str(uuid.uuid4()),session_id=sid,verdict=verdict,reason_code=code,explanation=explanation,checks=checks,sender_verified=verified,received_at=now,protected_state_before=before,protected_state_after=after,state_changed=before != after,telemetry_before=telemetry_before,telemetry_after=telemetry_after,policy_version=POLICY,input_sha256=hashlib.sha256(raw).hexdigest(),message=self.safe_message(message),duration_ms=round((time.perf_counter()-started)*1000,2),first_failed_stage=first_failed_stage)
            event.update(input_truncated=input_truncated, input_hash_scope='first 8193 bytes; full oversized body was not retained' if input_truncated else 'complete received input', audit_persisted=True, replay_state_advanced=verdict == 'ACCEPTED', replay_sequence_before=replay_before, replay_sequence_after=message['sequence'] if verdict == 'ACCEPTED' else replay_before)
            if verdict == 'ACCEPTED':
                event['submitted_text'] = raw.decode('utf-8')  # bounded, validated envelope; enables byte-exact replay
            db.execute('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)', (event['event_id'],sid,now,verdict,message.get('sender_id','unverified') if isinstance(message,dict) and isinstance(message.get('sender_id'),str) else 'unverified',message.get('message_type','UNKNOWN') if isinstance(message,dict) and isinstance(message.get('message_type'),str) else 'UNKNOWN',code,json.dumps(event)))
            # The chain link is written in the SAME transaction as the audit row. If it
            # fails, state, replay, and audit all roll back together.
            self._append_chain(db, event)
            db.commit()
            return event
        except (sqlite3.Error, ValueError, TypeError, OverflowError) as exc:
            if db is not None:
                with suppress(sqlite3.Error):
                    db.rollback()
            failed_stage_idx = min(idx, 7)
            checks[failed_stage_idx].update(status='FAIL', explanation='Service failure. Transaction rolled back; no execution committed and no persistence claimed.')
            return {'verdict':'SERVICE_ERROR','reason_code':'SERVICE_ERROR','explanation':'No execution committed. Database or validator service failed.','checks':checks,'sender_verified':verified,'state_changed':False,'policy_version':POLICY,'session_id':sid,'protected_state_before':before,'protected_state_after':before,'audit_persisted':False,'replay_state_advanced':False,'replay_sequence_before':replay_before,'replay_sequence_after':replay_before,'message':self.safe_message(message),'first_failed_stage':checks[failed_stage_idx]['stage']}
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

    def audit(self, session=None, verdict=None, sender=None, kind=None, reason=None,
              stage=None, since=None, until=None, limit=50, offset=0):
        """Filtered decision history. Supports sender, message type, verdict, reason,
        validation stage, session, and a received-at time range.

        `stage` is translated into the deterministic reason-code set for that stage,
        so filtering never has to parse stored JSON and pagination stays accurate.
        """
        if stage is not None and stage not in STAGE_REASONS:
            raise ValueError(f'Unknown validation stage {stage!r}. Known stages: {", ".join(STAGE_REASONS)}.')
        for name, value in [('since', since), ('until', until)]:
            if value is not None and (not isinstance(value, int) or isinstance(value, bool)):
                raise ValueError(f'{name} must be an integer Unix timestamp.')
        with self.connect() as db:
            if session is not None:
                self.state(session, db)
            sql, args = ' FROM audit WHERE 1=1', []
            for col, val in [('session',session),('verdict',verdict),('sender',sender),('kind',kind),('reason',reason)]:
                if val: sql += f' AND {col}=?'; args.append(val)
            if stage is not None:
                sql += ' AND reason IN (%s)' % ','.join('?' * len(STAGE_REASONS[stage]))
                args.extend(STAGE_REASONS[stage])
            if since is not None: sql += ' AND received>=?'; args.append(since)
            if until is not None: sql += ' AND received<=?'; args.append(until)
            total = db.execute('SELECT COUNT(*)'+sql,args).fetchone()[0]
            rows = db.execute('SELECT event'+sql+' ORDER BY rowid DESC LIMIT ? OFFSET ?',(*args,min(limit,200),offset)).fetchall()
            events = [json.loads(row[0]) for row in rows]
            for event in events:
                # Record which stage first failed so the UI can label it directly.
                failed = next((c['stage'] for c in event.get('checks') or [] if c.get('status') == 'FAIL'), None)
                event['first_failed_stage'] = failed or REASON_STAGE.get(event.get('reason_code'))
        return {'total':total,'events':events}

    def metrics(self, session=None):
        """Security metrics derived from persisted records. Nothing is hardcoded.

        Live-session statistics and isolated scenario-suite statistics are kept
        separate so a suite run can never inflate the live dashboard.
        """
        with self.connect() as db:
            # Default scope is the LIVE session. Suite runs write into their own isolated
            # session, so they are structurally excluded from the live counters.
            sid = session or self.active_session(db)
            self.state(sid, db)
            where, args = ' WHERE session=?', [sid]
            base = ' FROM audit' + where
            total = db.execute('SELECT COUNT(*)' + base, args).fetchone()[0]
            accepted = db.execute("SELECT COUNT(*)" + base + " AND verdict='ACCEPTED'", args).fetchone()[0]
            rejected = db.execute("SELECT COUNT(*)" + base + " AND verdict='REJECTED'", args).fetchone()[0]
            service = db.execute("SELECT COUNT(*)" + base + " AND verdict='SERVICE_ERROR'", args).fetchone()[0]
            replay_attempts = db.execute("SELECT COUNT(*)" + base + " AND reason='REPLAY'", args).fetchone()[0]
            out_of_order = db.execute("SELECT COUNT(*)" + base + " AND reason='OUT_OF_ORDER'", args).fetchone()[0]
            auth_failures = db.execute("SELECT COUNT(*)" + base + " AND reason='AUTH_FAILED'", args).fetchone()[0]
            not_authorised = db.execute("SELECT COUNT(*)" + base + " AND reason='NOT_AUTHORISED'", args).fetchone()[0]
            reasons = {r[0]: r[1] for r in db.execute(
                'SELECT reason,COUNT(*)' + base + ' GROUP BY reason ORDER BY COUNT(*) DESC', args)}
            events = [json.loads(r[0]) for r in db.execute('SELECT event' + base + ' ORDER BY rowid', args)]
            # Which validation stage first failed, across all decisions.
            first_failed_stages = {}
            for event in events:
                for check in event.get('checks') or []:
                    if check.get('status') == 'FAIL':
                        first_failed_stages[check['stage']] = first_failed_stages.get(check['stage'], 0) + 1
                        break
            # Suite results are stored per owner session and are deliberately excluded
            # from the live counts above.
            suites = [json.loads(r[0]) for r in db.execute('SELECT result FROM suites').fetchall()]
            own_suites = [r for r in suites if r.get('owner_session_id') == sid]
        suite_total = sum(r['total'] for r in own_suites)
        suite_passed = sum(r['passed'] for r in own_suites)
        integrity_violations = sum(
            1 for r in own_suites for x in r['results']
            if not x['passed'] and not x.get('state_preserved', True))
        return {
            'scope': 'live session',
            'session_id': sid,
            'live': {
                'messages_checked': total, 'accepted': accepted, 'rejected': rejected,
                'service_errors': service, 'replay_attempts_detected': replay_attempts,
                'out_of_order_rejected': out_of_order, 'authentication_failures': auth_failures,
                'authorisation_denials': not_authorised,
                'reason_code_breakdown': reasons,
                'rejection_reasons': {k: v for k, v in reasons.items() if k != 'OK'},
                'first_failed_stages': first_failed_stages,
                'acceptance_rate': round(accepted / total, 4) if total else None,
            },
            'scenario_suites': {
                'runs': len(own_suites), 'cases_executed': suite_total, 'cases_passed': suite_passed,
                'cases_failed': suite_total - suite_passed,
                'protected_state_integrity_violations': integrity_violations,
                'note': 'Isolated scenario runs. Never mixed into the live counters above.',
            },
        }

    # --- Synthetic telemetry anomaly detection (roadmap feature 21) -------------
    # Rule-based and explainable. No model, no ML, no external feed. An anomaly is a
    # simulator observation, NOT proof of malicious activity, and is deliberately kept
    # separate from authentication and authorisation verdicts.
    ANOMALY_RULES = (
        ('OUT_OF_RANGE', 'Accepted telemetry value sits outside the simulator bounds.'),
        ('SUDDEN_BATTERY_DROP', 'Battery fell more than 30 points between consecutive accepted reports.'),
        ('SUDDEN_TEMPERATURE_JUMP', 'Temperature moved more than 40 °C between consecutive accepted reports.'),
        ('MODE_WITHOUT_COMMAND', 'Telemetry reports a mode that no accepted command set.'),
        ('STALE_REPORT', 'Reported mode disagrees with the current protected mode.'),
    )
    ANOMALY_THRESHOLDS = {'battery_pct_delta': 30, 'temperature_c_delta': 40,
                          'battery_pct_range': (0, 100), 'temperature_c_range': (-50, 120)}

    def anomalies(self, session=None):
        with self.connect() as db:
            sid = session or self.active_session(db)
            snapshot = self.state(sid, db)
            rows = [json.loads(r[0]) for r in db.execute(
                'SELECT event FROM audit WHERE session=? ORDER BY rowid', (sid,))]
        findings, previous, mode_set_by = [], None, None
        for event in rows:
            if event.get('verdict') != 'ACCEPTED':
                continue
            message = event.get('message') or {}
            if message.get('message_type') == 'COMMAND' and message.get('action') == 'SET_MODE':
                mode_set_by = (message.get('payload') or {}).get('mode')
            telemetry = event.get('telemetry_after')
            if not isinstance(telemetry, dict):
                continue
            battery, temperature = telemetry.get('battery_pct'), telemetry.get('temperature_c')
            low, high = self.ANOMALY_THRESHOLDS['battery_pct_range']
            if isinstance(battery, int) and not low <= battery <= high:
                findings.append(self._finding('OUT_OF_RANGE', event, f'battery_pct={battery} is outside {low}–{high}.'))
            low, high = self.ANOMALY_THRESHOLDS['temperature_c_range']
            if isinstance(temperature, int) and not low <= temperature <= high:
                findings.append(self._finding('OUT_OF_RANGE', event, f'temperature_c={temperature} is outside {low}–{high}.'))
            if previous is not None:
                if isinstance(battery, int) and isinstance(previous[0], int) and previous[0] - battery > self.ANOMALY_THRESHOLDS['battery_pct_delta']:
                    findings.append(self._finding('SUDDEN_BATTERY_DROP', event, f'battery_pct fell from {previous[0]} to {battery}.'))
                if isinstance(temperature, int) and isinstance(previous[1], int) and abs(temperature - previous[1]) > self.ANOMALY_THRESHOLDS['temperature_c_delta']:
                    findings.append(self._finding('SUDDEN_TEMPERATURE_JUMP', event, f'temperature_c moved from {previous[1]} to {temperature}.'))
            reported = telemetry.get('mode')
            protected = snapshot['protected_state']['mode']
            if reported != protected:
                findings.append(self._finding('STALE_REPORT', event, f'Telemetry reports {reported} but protected mode is {protected}.'))
            if reported and mode_set_by is None:
                findings.append(self._finding('MODE_WITHOUT_COMMAND', event, f'Telemetry reports mode {reported} with no accepted SET_MODE command in this session.'))
            previous = (battery, temperature)
        return {
            'session_id': sid, 'findings': findings, 'finding_count': len(findings),
            'rules': [{'rule': name, 'description': text,
                       'thresholds': self.ANOMALY_THRESHOLDS} for name, text in self.ANOMALY_RULES],
            'disclaimer': ('Rule-based observations over synthetic telemetry. An anomaly is NOT proof of '
                           'malicious activity and is separate from authentication and authorisation verdicts.'),
        }

    @staticmethod
    def _finding(rule, event, detail):
        return {'rule': rule, 'detail': detail, 'event_id': event.get('event_id'),
                'received_at': event.get('received_at'), 'verdict': event.get('verdict'),
                'reason_code': event.get('reason_code')}

    def export(self, session=None):
        with self.connect() as db:
            db.execute('BEGIN')  # Consistent read-only snapshot of state and evidence.
            sid = session or self.active_session(db)
            snapshot = self.state(sid, db)
            events = [json.loads(r[0]) for r in db.execute('SELECT event FROM audit WHERE session=? ORDER BY rowid',(sid,))]
            for event in events:
                if 'first_failed_stage' not in event:
                    failed = next((c['stage'] for c in event.get('checks') or [] if c.get('status') == 'FAIL'), None)
                    event['first_failed_stage'] = failed or REASON_STAGE.get(event.get('reason_code'))
            suites = [json.loads(r[0]) for r in db.execute('SELECT result FROM suites WHERE session=?',(sid,))]
            audit_chain = self.verify_audit_chain(sid, db)
            db.commit()
        return {'label':'Synthetic data — local simulation only. Not immutable or tamper-proof.','schema_version':1,'policy_version':POLICY,'exported_at':int(time.time()),'session_id':sid,'state':snapshot,'events':events,'scenario_results':suites,'audit_chain':audit_chain}

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
                if msg['action'] == 'SET_MODE':
                    expected_state['mode'] = msg['payload']['mode']
                    expected_state.update(MODEL_RULES[msg['payload']['mode']])
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
        # Oversized body: the receiver's 8 KiB sentinel must reject before parsing.
        oversized = b' ' * 8200 + b'{}'
        result = self.validate(oversized, sid, now)
        results.append({'name':'Oversized body','expected':'BODY_TOO_LARGE','observed':result['reason_code'],'passed':result['reason_code']=='BODY_TOO_LARGE','state_preserved':not result['state_changed'],'event_id':result.get('event_id'),'note':'9 KiB body. Rejected at the size sentinel before any JSON is parsed.','result':result})
        # Corrupt storage: an unparseable audit record must surface as an error, never
        # be silently swallowed, and never leak its content.
        with tempfile.TemporaryDirectory(prefix='kavach-corrupt-') as directory:
            corrupt_engine = Engine(directory)
            # A real decision must exist before its record can be corrupted.
            corrupt_engine.validate(json.dumps(corrupt_engine.issue(payload={'mode':'SAFE'}, now=now)).encode(), now=now)
            with corrupt_engine.connect() as cdb:
                cdb.execute("UPDATE audit SET event='CORRUPT_PRIVATE_STORAGE_VALUE'")
            raised = False
            try:
                corrupt_engine.audit()
            except Exception:
                raised = True
            results.append({'name':'Corrupt storage surfaces as an error','expected':'RAISED','observed':'RAISED' if raised else 'SWALLOWED','passed':raised,'state_preserved':True,'event_id':None,'note':'An unparseable persisted record must raise rather than be silently dropped. The API layer surfaces it as a bounded SERVICE_ERROR without echoing the content.','result':{'verdict':'SERVICE_ERROR' if raised else 'ACCEPTED','reason_code':'SERVICE_ERROR' if raised else 'OK','checks':[],'sender_verified':False,'state_changed':False,'policy_version':POLICY}})
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
