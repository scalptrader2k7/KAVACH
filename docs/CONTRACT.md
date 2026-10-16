# Kavach implementation contract · v1

This implementation uses one invented target, `KAVACH-SAT-01`, and policy `kavach-policy/1.0`.

## Envelope

All fields are required, and unknown envelope or action-payload fields are rejected.

| Field | Receiver rule |
|---|---|
| version | Strict integer 1 |
| message_id | UUID string |
| message_type | `COMMAND` or `TELEMETRY` |
| sender_id | ASCII identifier `[A-Za-z0-9_-]{1,64}` |
| target_id | `KAVACH-SAT-01` |
| key_id | ASCII identifier `[A-Za-z0-9_-]{1,64}`, registered server-side |
| sequence | Strict integer 1 to 2^53−1 |
| issued_at | Strict integer Unix seconds |
| expires_at | Strict integer Unix seconds |
| action | Allowed action for the message type |
| payload | Exact action-specific object |
| auth_tag | Exactly 64 lowercase hexadecimal characters |

Duplicate JSON keys at any depth, non-finite values, floats, booleans, nulls, arrays, non-ASCII strings, and values below objects nested beyond four levels are rejected. The entire submitted body is limited to 8192 bytes. JSON numeric strings are never coerced into integers.

The envelope and supported v1 values are checked before key lookup. The target/action/payload semantics are checked after HMAC, so fixtures can demonstrate authenticated-but-invalid content.

## Actions and permissions

| Type / action | Exact payload | Allowed synthetic sender |
|---|---|---|
| COMMAND / GET_STATUS | `{}` | observer-01 or operator-01 |
| COMMAND / SET_MODE | `{"mode":"NORMAL"}`, `"POWER_SAVING"`, or `"SAFE"` | operator-01 |
| COMMAND / SET_REPORT_INTERVAL | `{"seconds":15}`; integer 1–60 | operator-01 |
| TELEMETRY / TELEMETRY_STATUS | `{"battery_pct":87,"temperature_c":24,"mode":"NORMAL"}` | satellite-01 |

Telemetry integer bounds: battery 0–100 inclusive; temperature −50–120 inclusive. Telemetry mode has the same three enum values. These are invented simulator bounds.

Registered key IDs are `operator-key-01`, `observer-key-01`, and `satellite-key-01`. Each key belongs to exactly one matching synthetic sender. Roles are not accepted in messages. The backend registry—not the form or a submitted field—controls permissions.

Initial protected state:
```json
{"mode":"NORMAL","report_interval_s":10}
```
Received telemetry is a different ground-side record. Accepted telemetry cannot change either protected-state property. A state-changing accepted command causes a labeled local model snapshot, not a physical observation or a second human command.

## Authentication bytes

```python
unsigned = {k: v for k, v in message.items() if k != "auth_tag"}
encoded = json.dumps(
    unsigned,
    sort_keys=True,
    separators=(",", ":"),
    ensure_ascii=True,
    allow_nan=False,
).encode("utf-8")
tag = hmac.new(secret_bytes, encoded, hashlib.sha256).hexdigest()
```

The receiver compares tags with `hmac.compare_digest`. This is a documented simulator-specific encoding, **not** a universal canonical JSON standard. Key order and insignificant whitespace do not affect authentication. The exact original editor bytes are still sent to the strict parser. An accepted event stores its bounded, validated original text so the Replay action can resend identical bytes.

Only the backend fixture issuer can access the synthetic shared keys. It can deliberately sign invalid content and unauthorised commands, which makes policy enforcement testable. It never accepts a client-supplied secret.

## Time

Receiver time is captured once per attempt. Require all of:

```text
issued_at <= receiver_time + 5
0 < expires_at - issued_at <= 60
receiver_time < expires_at
receiver_time - issued_at <= 60
```

Five seconds is future clock skew. Sixty seconds is the maximum simulator lifetime. Runtime scenarios use the injected timestamp `1792137600`; normal editor fixtures use the current system UTC clock.

## Ordered pipeline

1. Body-size, strict JSON, exact envelope, supported values.
2. Known key ID with matching sender.
3. HMAC-SHA256 authentication.
4. Known target and action; exact payload schema/ranges.
5. Time validity.
6. Server-controlled permission policy.
7. Replay check per `(session, sender_id, target_id, message_type)`.
8. Apply state, advance replay, and append acceptance audit in one commit.

Stop at the first failure. Subsequent stages are `NOT_RUN`. Sender verification becomes true only after HMAC success. A later permission failure retains verified=true; valid HMAC is not equivalent to authorisation.

SQLite `BEGIN IMMEDIATE` is acquired before validation, and the replay check occurs while holding that transaction. Accepted IDs and maximum accepted sequences survive restart. A new UUID with an old/equal sequence yields `OUT_OF_ORDER`; an already accepted UUID yields `REPLAY`. A rejected message never reserves a UUID or advances the replay maximum. Key IDs do not define replay streams.

Exactly one simultaneous copy can commit. `SERVICE_ERROR` means no successful execution/persistence is claimed. Audit failures and commit failures roll back state and replay changes. A rejected message may add a rejection audit record but cannot mutate the three protected domains: spacecraft state, received telemetry, replay state.

## Result

Normal attempts include:
- event_id, session_id, verdict (`ACCEPTED` / `REJECTED`)
- reason_code, explanation, sender_verified, received_at
- checks (`stage`, `label`, `status`, `explanation`)
- protected_state_before / after; state_changed
- telemetry_before / after; policy_version
- input_sha256, bounded message, measured duration_ms
- submitted_text for accepted, validated envelopes only

Operational errors return `SERVICE_ERROR` and a trace, without claiming an event persisted. If a commit fails, the commit check is FAIL, not PASS.

## API

| Endpoint | Contract |
|---|---|
| GET /api/health | Real process/database readiness and active session |
| POST /api/demo/issue | JSON fixture parameters; response contains signed message, modified flag, session_id; never a secret |
| POST /api/messages?session_id=… | Exact editor text as request body; structured decisions, including malformed input; 503 on operational failure |
| GET /api/state?session_id=… | Current committed protected state and separately labeled received telemetry |
| GET /api/audit | Optional session_id, verdict, sender, message_type, exact reason, limit (1–200), offset; returns events and total |
| POST /api/scenarios/run | 29-case real engine suite; isolated namespace; report persisted with active owner session |
| GET /api/export?session_id=… | JSON attachment: synthetic-data label, versions, current state, all session events, scenario reports |
| POST /api/demo/sessions | Fresh active namespace, preserving old records |

Fixture parameters: sender_id, message_type, action, payload, optional session_id, and scenario (`valid`, `tampered`, `expired`, `future`, `unauthorised`, `invalid`, `telemetry`). The UI implements replay by loading original accepted bytes, not by issuing a new signature.

Examples are runtime-generated; no static sample can remain clock-valid forever. Unknown session IDs return 404 for read endpoints. Invalid fixture parameters use FastAPI's 422 response. Message rejection itself is a normal 200 response containing `verdict: REJECTED` so the frontend can render the structured evidence.

## Logs and export

Malformed/rejected inputs use a hash and bounded whitelist representation; arbitrary unknown fields and raw invalid dumps are not logged. Accepted envelopes are schema-validated and bounded before exact text storage. The database is persistent but not immutable or tamper-proof. Exporting evidence does not confer cryptographic attestation on the audit database.

## Hardening addendum · 1.0.1 (16 October 2026)

The canonical signing function and stream key `(session, sender_id, target_id, message_type)` are unchanged. All eight stages and first-failure/NOT_RUN behavior remain enforced by Python. Changes below concern release hygiene, bounded failure handling, and fact presentation, not new cryptographic or replay semantics.

### Decision proof fields

New decisions include `audit_persisted`, `replay_state_advanced`, `replay_sequence_before`, and `replay_sequence_after`. Acceptance returns these only after the atomic commit. A rejection can have `audit_persisted: true` and `replay_state_advanced: false`. GET_STATUS can advance replay while leaving protected spacecraft state unchanged. Sequences are null if replay was not reached; the UI must not invent a replay maximum. Operational failures return no confirmed audit event, false replay advancement, and available before/after snapshots after rollback; no successful execution is claimed.

The Mission Console receipt renders the submitted action/claimed sender from the backend's bounded message, HMAC identity status, first failed stage, protected before/after state, replay flag, and persisted event reference. Missing snapshots or traces are labeled unavailable, not false passes. The fixture endpoint returns `expected_outcome` and `expectation_source` as **preset intent**; this is not an observed verdict. Edited inputs have no promised expectation. The summary's observed outcomes always use the actual receiver response.

### Exact editor formatting and transport

`web/src/editor.ts` first validates syntax, independently detects decoded duplicate keys at all levels, then indents the original JSON tokens. Malformed/duplicate-key input is returned unchanged with a warning. Numeric lexemes are not round-tripped through JavaScript numbers, so formatting does not silently round large integers or rewrite exponent tokens. Formatting neither calls the issuer nor changes auth_tag. `/api/messages` receives the exact current editor string encoded as UTF-8, not an object serialization.

### Replay fixture contract

`POST /api/demo/issue` with `scenario: replay` returns the latest accepted event's original `raw_text`, bounded `message`, session_id, and an expectation of REPLAY or EXPIRED based on the original timestamps. It never signs a replacement or executes a hidden status command. If no accepted byte-exact record exists it returns 409, asking the user to first accept a valid message. Receiver time checks still run before replay checks.

### API bounds and errors

- Fixture POST bodies are limited to 8192 bytes before model parsing; too large returns 413. Duplicate/non-finite/invalid UTF-8 fixture JSON returns bounded 400. Invalid fixture schema/types return 422 without echoing request values. Validly signed unauthorised and out-of-range fixtures remain deliberate test inputs.
- The message receiver retains at most 8193 bytes to detect oversized inputs. Oversized results and persisted events carry `input_truncated: true` and `input_hash_scope` explicitly identifying the retained prefix. This is not the hash of a discarded oversized tail. Normal inputs use a complete-input hash.
- Unknown explicit sessions return 404 consistently for state, audit, export, issuance, and receiver submission, without creating a namespace. The client never silently changes session to make a request work.
- Database open/read/write/commit errors and busy-lock timeouts return bounded 503 SERVICE_ERROR with no secret, raw private storage, or stack trace in the response. Unexpected API errors use the same fail-closed public response. Logs record exception class, not submitted values.
- Blocking validation runs in the API thread pool, so SQLite lock waits do not deliberately block the event loop. Transactions still serialize acceptance correctly.
- Read-only evidence export observes one consistent SQLite snapshot.

### Local runtime and release boundary

API import is side-effect free. Runtime initialization re-enforces owner-only POSIX permissions, validates existing keys without replacing them, and refuses an existing database whose keys are missing. Context-managed SQLite connections are explicitly closed. Existing data/key bytes and audit history are not reset or rotated.

Use `python -m backend` for the loopback-only supported launcher. See SECURITY.md for deliberate trusted-network exceptions, Origin/Host safeguards, key-exposure recovery, and the unimplemented public-demo model. Only the exact-allowlist release ZIP is a submission; a generic workspace archive may still contain the intentionally preserved runtime.
