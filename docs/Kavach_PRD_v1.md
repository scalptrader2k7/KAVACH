# KAVACH — Product Requirements Document
Version 1.0 · 16 October 2026 · Vyom Cybersecurity Brief 02
Status: proposed implementation contract; no implementation or test results claimed.
Tagline: Every command verified. Every decision traceable.

## 1. Product decision

Kavach is a local satellite telemetry and command-validation simulator. It lets a user construct a synthetic message, send it through a defensive validator, inspect every validation decision, and observe the resulting simulated state.

The central proof is simple: valid messages are accepted; malformed, tampered, stale, replayed, or unauthorised messages are rejected with an explanation; rejected messages never change the protected simulated state.

Althon uses Bloom. Kavach is the separate Vyom project. This PRD assumes two developers and an eight-hour focused build window; the actual submission deadline remains unconfirmed. Milestones use elapsed time.

## 2. Problem and users

A structured message can look legitimate while containing invalid values, an unauthorised command, an expired timestamp, or previously accepted instructions. A dashboard that merely displays a red warning does not demonstrate that execution was prevented.

Primary users:
- A hackathon judge who wants to change inputs and inspect real outcomes.
- A developer or security learner who wants to understand message validation.
- A presenter who needs a reliable, reproducible two-minute demonstration.

The product succeeds when a judge can submit a valid message, break one property, see the corresponding rejection, and verify the protected state stayed unchanged.

## 3. Scope

### Required for submission

1. One synthetic satellite, KAVACH-SAT-01.
2. Separate command and telemetry message types.
3. Structured message builder and editable JSON view.
4. Strict schema, type, range, command, and target validation.
5. HMAC-SHA256 message authentication using Python's standard library.
6. Timestamp checks and persistent replay protection.
7. Server-defined permissions for synthetic senders.
8. Validation trace with PASS, FAIL, and NOT RUN states.
9. Simulated spacecraft state and separately labelled received telemetry.
10. Persistent audit history, deterministic scenario tests, and JSON evidence export.
11. Local operation after dependencies are installed, without external APIs.

Authentication is optional in the organiser brief but included in Kavach's chosen MVP because it makes the security demonstration concrete.

### Deferred

A 3D globe, orbit propagation, RF simulation, live satellite feeds, network scanning, custom cryptography, post-quantum cryptography, ML anomaly scoring, an AI assistant, account registration, multi-satellite support, editable permission policies, PDF generation, and cloud infrastructure are outside the initial build.

A static satellite illustration or small state animation may support the interface, but must not imply real telemetry or orbital accuracy. The submitted system has no live command channel.

## 4. Product journey

1. Open Mission Console; see Local simulation, API availability, and current simulated mode.
2. Select a synthetic sender and a command or telemetry preset.
3. Generate a fresh signed sample. Issuance time and sequence are produced by the local fixture issuer.
4. Inspect the JSON, including the authentication tag, without exposing its secret key.
5. Optionally edit the payload after signing.
6. Submit the exact displayed message to the receiver.
7. Read the validation trace and final decision.
8. Compare state before and after.
9. Open the audit entry or export the session evidence.

Editing must mark the message “Modified since signing.” Submission must never silently re-sign it. A separate “Generate fresh signed sample” action makes signing explicit. Replay resends the original bytes without changing timestamps or sequence.

## 5. Screens and presentation

### Mission Console — primary screen

Desktop layout:
- Header: Kavach, Local simulation badge, API status, session identifier.
- Left panel: sender, message type, command/payload form, JSON editor, generate and submit controls.
- Centre panel: validation stages, concise verdict, failing field or rule.
- Right panel: simulated mode and reporting interval; separate latest accepted telemetry card.
- Bottom: audit table with time, sender, message type, verdict, reason, and details.

All verdicts come from the backend. The frontend may render progress but must not invent check results or change satellite state optimistically.

Use navy/charcoal surfaces, clear typography, blue for navigation, green for accepted, red for rejected, and amber for pending. Include text and icons with colour. Put meaningful decisions ahead of decorative charts. At narrow widths, stack builder, results, and state vertically.

### Scenario Lab

Seeded buttons for Valid command, Tampered payload, Replay, Expired message, Future timestamp, Unauthorised command, Invalid payload, and Valid telemetry. “Run suite” starts an isolated test session and displays actual expected/observed comparisons.

### Audit & Evidence

Filter by verdict, sender, message type, or reason. Open a decision to inspect the bounded submitted payload, authentication status, check trace, policy version, and before/after protected-state snapshot. Export JSON. Logs are persistent application records, not claimed to be immutable or tamper-proof.

## 6. Synthetic spacecraft and permission policy

Initial protected spacecraft state:
- mode: NORMAL
- report_interval_s: 10

| Command | Payload | Allowed sender | Simulated effect |
| --- | --- | --- | --- |
| GET_STATUS | Empty object | observer-01, operator-01 | Returns current state; no mode or interval change |
| SET_MODE | mode: NORMAL, POWER_SAVING, or SAFE | operator-01 | Updates mode |
| SET_REPORT_INTERVAL | seconds: integer 1–60 | operator-01 | Updates reporting interval |

A satellite-01 sender can publish TELEMETRY_STATUS for KAVACH-SAT-01. Neither human-style sender may publish telemetry as satellite-01. The receiver resolves identity and permissions from its key registry; a submitted role field never grants permissions and is rejected as an unknown field.

Telemetry payload:
- battery_pct: integer 0–100
- temperature_c: integer -50–120
- mode: NORMAL, POWER_SAVING, or SAFE

These are invented simulator bounds, not universal spacecraft operating limits. An accepted telemetry message updates a ground-side “latest received telemetry” snapshot. It does not issue a command or overwrite spacecraft mode. In the normal demo, the local satellite model emits a telemetry snapshot after an accepted state-changing command.

HMAC establishes possession of a shared key and message integrity. It does not encrypt the payload, prove a named human's identity, or establish that telemetry reflects physical reality.

## 7. Message contract

All messages use this envelope:

| Field | Rule |
| --- | --- |
| version | Integer, exactly 1 |
| message_id | UUID string generated for each newly issued message |
| message_type | COMMAND or TELEMETRY |
| sender_id | Bounded ASCII identifier, maximum 64 characters |
| target_id | KAVACH-SAT-01 in this MVP |
| key_id | Bounded ASCII key identifier, maximum 64 characters |
| sequence | Integer 1 through 2^53 - 1, never boolean |
| issued_at | Integer UTC Unix time in seconds |
| expires_at | Integer UTC Unix time in seconds |
| action | One of the three commands or TELEMETRY_STATUS |
| payload | Action-specific object with exact allowed fields |
| auth_tag | Exactly 64 lowercase hexadecimal characters |

Reject unknown envelope/payload fields, duplicate JSON keys at any depth, nulls where a concrete value is required, coercion of strings to numbers, booleans as integers, and non-finite numeric values. Limit request bodies to 8 KiB and nesting to four levels.

An illustrative unsigned command body follows. The issuer generates actual timestamps, sequence, UUID, and tag at runtime; this is documentation, not a ready-to-submit signed fixture.

```json
{
  "version": 1,
  "message_id": "a3e5e180-d80b-4ef9-b642-11f116d9a3c1",
  "message_type": "COMMAND",
  "sender_id": "operator-01",
  "target_id": "KAVACH-SAT-01",
  "key_id": "operator-key-01",
  "sequence": 42,
  "issued_at": 1792137600,
  "expires_at": 1792137660,
  "action": "SET_MODE",
  "payload": {"mode": "POWER_SAVING"}
}
```

## 8. Validation and security behaviour

### Validation order

1. Enforce body-size limit; strictly parse JSON and envelope structure.
2. Resolve key_id and confirm it belongs to the claimed sender.
3. Verify HMAC over the complete envelope except auth_tag.
4. Validate target, action, exact payload schema, and field ranges.
5. Check time validity.
6. Check receiver-controlled sender permissions.
7. In one database transaction, check replay state, apply the simulated effect, advance replay state, and record acceptance.
8. Return the committed result.

Stop on first failure; later checks show NOT RUN, never a false pass. For pre-authentication failures, label sender identity as unverified. The trace must explain that a valid HMAC can coexist with a later permission failure.

### Signing

Use Python hmac with SHA-256 and hmac.compare_digest. Define reproducible bytes by removing auth_tag, rejecting unsupported types, then serialising with sorted keys, compact separators, ensure_ascii=True, and allow_nan=False, encoded as UTF-8. Restrict v1 values to the documented integers, ASCII strings, and objects. Both issuer and receiver use this documented representation; test key-order and whitespace invariance. This is a simulator-specific encoding contract, not a claim of a general canonical-JSON standard.

Each synthetic sender has its own randomly generated secret, created once and persisted outside source control. The backend fixture issuer signs samples; secret values never enter browser bundles, responses, logs, screenshots, or exports. HMAC keys must survive ordinary restarts along with the replay database.

The fixture issuer is a deliberately privileged test harness. It can create a signed but unauthorised command for an observer so the receiver's policy is tested. Its existence is explicit: this is an educational local simulator, not a production identity service. The receiver never accepts a client-supplied secret or role.

### Time validity

Capture receiver time once per request. Require:
- issued_at <= receiver_time + 5 seconds;
- 0 < expires_at - issued_at <= 60 seconds;
- receiver_time < expires_at;
- receiver_time - issued_at <= 60 seconds.

Five seconds is permitted future clock skew; 60 seconds is the chosen simulator maximum lifetime. Tests use an injected clock so expiry and boundaries are reproducible.

### Replay and transactional state

For each (sender_id, target_id, message_type), persist the highest accepted sequence and accepted message IDs. A sequence must be strictly greater than the stored maximum, and the message ID must not already be accepted in that stream.

This simple policy intentionally rejects late out-of-order messages; it is not a sliding replay window. Key IDs do not reset the stream's replay state. Rejected inputs never advance a sequence or reserve a message ID. Separate streams prevent telemetry and commands from blocking one another.

Two simultaneous copies of the same valid message must yield exactly one acceptance. Re-check replay state while holding the database transaction. State, replay update, and acceptance log must commit together. A database failure causes no execution and returns SERVICE_ERROR, not ACCEPTED. If an audit write fails, show that failure; do not claim persistence.

Only an explicit “New demo session” creates a fresh isolated scenario namespace. Ordinary reloads and process restarts retain state. Existing audit history remains available.

## 9. Result and audit contract

Each completed validation attempt returns:
- event_id and session_id;
- verdict: ACCEPTED or REJECTED;
- reason_code and plain-language explanation;
- checks: stage, PASS/FAIL/NOT_RUN, explanation;
- sender_verified;
- received_at;
- protected_state_before and protected_state_after;
- state_changed;
- policy_version.

Operational failures return SERVICE_ERROR with no claimed successful execution. Structured malformed-input results should still be shown in the UI. Representative reason codes include INVALID_JSON, SCHEMA_INVALID, KEY_UNKNOWN, IDENTITY_MISMATCH, AUTH_FAILED, TARGET_UNKNOWN, ACTION_INVALID, PAYLOAD_INVALID, CLOCK_SKEW, EXPIRED, NOT_AUTHORISED, REPLAY, OUT_OF_ORDER, and SERVICE_ERROR.

A rejection may append an audit record; “state unchanged” means the protected spacecraft state, accepted telemetry snapshot, and replay state are unchanged. GET_STATUS can be accepted without changing spacecraft mode.

Store a bounded message representation or input hash for invalid input. Do not log keys or uncontrolled raw request dumps. Audit export includes schema/policy version, events, scenario results, and a synthetic-data label.

## 10. Architecture and integration contract

Proposed stack:
- React + TypeScript + Vite for the UI.
- FastAPI + strict Pydantic models plus strict JSON parsing for the API.
- Python standard-library hmac/hashlib for authentication.
- SQLite for spacecraft state, received telemetry, replay state, and audit records.
- pytest for engine, persistence, and concurrency behaviour.

One backend process hosts the local API and can serve the built frontend. Bind to localhost for the MVP; no external network calls are needed during the demonstration. A separate public deployment is not a completion gate for this brief.

| Endpoint | Responsibility |
| --- | --- |
| GET /api/health | Actual process/database readiness |
| POST /api/demo/issue | Generate synthetic signed fixture; never returns a secret |
| POST /api/messages | Validate and conditionally apply the exact submitted message |
| GET /api/state | Protected spacecraft state and latest accepted telemetry |
| GET /api/audit | Paginated/filterable decision history |
| POST /api/scenarios/run | Run scenarios in an isolated namespace |
| GET /api/export | Export current session's evidence as JSON |
| POST /api/demo/sessions | Start a fresh isolated demonstration session |

The frontend sends exact editor text to /api/messages so duplicate keys and malformed JSON remain testable. It renders backend responses and refreshes committed state. Polling is enough for MVP; WebSockets are optional.

## 11. Acceptance tests and evaluation

Test outcomes below are requirements, not completed results.

| Case | Expected outcome |
| --- | --- |
| Valid operator SET_MODE | Accepted; mode updates exactly once |
| Valid observer GET_STATUS | Accepted; returns state |
| Valid satellite telemetry | Accepted; received telemetry updates |
| Payload edited after signing | AUTH_FAILED; protected state unchanged |
| Unknown key or mismatched sender | Rejected; no identity trusted |
| Correctly signed observer SET_MODE | NOT_AUTHORISED |
| Expired or excessively future-dated message | Rejected for applicable time rule |
| Lifetime exceeds 60 seconds | Rejected |
| Duplicate accepted message | REPLAY; no repeat application |
| Fresh UUID with old sequence | OUT_OF_ORDER |
| Duplicate submitted concurrently | One accepted, one rejected |
| Duplicate after backend restart | Still rejected; use a clock-valid fixture |
| Invalid message with very high sequence | Rejected; subsequent valid sequence still accepted |
| Missing field, duplicate key, unknown field, bad type or range | Rejected with specific explanation |
| Valid signature with unknown action or target | Rejected |
| Whitespace/key-order-only edit | Authentication remains valid |
| Invalid telemetry | Latest accepted telemetry unchanged |
| Database commit failure | SERVICE_ERROR; no partial state/replay update |

Show counts of expected vs observed accepts/rejects and every failing test. Report execution environment and actual results. No “100% secure,” operational certification, or live-network accuracy claims. All required scenarios must pass before feature freeze; passing them establishes coverage of these cases only.

Usability target: a first-time reviewer can run the valid, tamper, and replay scenarios within two minutes. Performance target: at most one second from local submission to visible verdict under normal demo load; measure before claiming it is achieved.

## 12. Milestones and ownership

Proposed ownership: Subbu handles interface, integration, and presentation; teammate handles validator, persistence, and automated tests. Both review the API contract and complete the demo.

| Elapsed time | Milestone | Owner | Exit criterion |
| --- | --- | --- | --- |
| 0:00–0:30 | Freeze contract | Both | Envelope, permissions, commands, response shape, and first fixtures agreed |
| 0:30–2:00 | First complete path | Teammate: engine; Subbu: console | Valid signed command changes state; tampered command fails with visible evidence |
| 2:00–3:30 | Stateful protection | Teammate | Timestamp, permissions, replay, concurrency, and restart tests pass |
| 2:00–4:30 | User workflow | Subbu | Builder, trace, state panel, scenario controls, and audit history use real API data |
| 4:30–6:00 | Full integration | Both | Command and telemetry flows work; rejected messages leave protected state unchanged |
| 6:00–7:00 | Evaluation | Both | Required suite passes; audit/evidence export agrees with observed outcomes |
| 7:00–8:00 | Freeze and rehearse | Both | Two-minute demo succeeds three times; local backup and short video ready |

If time contracts, cut 3D visuals, WebSockets, animations, PDF export, and policy editing first. Preserve real backend validation, authentication, persistent replay protection, audit records, and the tested core journey.

## 13. Two-minute demo script outline

- 0:00–0:15: Explain that Kavach validates synthetic satellite messages before applying them.
- 0:15–0:35: Send a valid signed mode command; show the accepted trace and new state.
- 0:35–0:55: Alter a newly signed command without re-signing; show authentication failure and unchanged state.
- 0:55–1:10: Replay a recent accepted command; show replay rejection.
- 1:10–1:30: Send an authenticated observer command outside its permissions.
- 1:30–1:45: Show valid/invalid telemetry and a stale-message scenario.
- 1:45–2:00: Open audit evidence and the actual automated scenario report.

Run restart and concurrency demonstrations in Scenario Lab or Q&A; do not make the short demo depend on a process restart.

## 14. Deliverables and definition of done

Deliverables:
- Runnable local application with setup instructions.
- Documented command/telemetry schemas and permission policy.
- Seeded valid and invalid examples.
- Tests and a timestamped test-results report.
- Persistent audit log and JSON evidence export.
- Architecture explanation, limitations, two-minute presentation, and backup video.

Complete means the app works without external APIs, critical journeys use real validator responses, keys stay server-side, accepted state survives restart, duplicate commands cannot execute twice, rejected messages do not mutate protected state, and every required test has an observed passing result.

Open logistics: exact deadline, organiser submission format, team availability, and policy on pre-existing/open-source code. These affect packaging and scheduling, not the first local implementation milestone.

## 15. References

The organiser's supplied Cybersecurity 2 brief is the scope authority. The following are technical and visual references, not dependencies or claims of endorsement:

- Python HMAC: https://docs.python.org/3/library/hmac.html
- Python JSON parser and encoder: https://docs.python.org/3/library/json.html
- NASA CryptoLib (background reference): https://github.com/nasa/CryptoLib
- Zee-1 command-validation reference: https://github.com/KekBatikMatcha/Zee-1-satellite-telemetry-simulator-
- QUARANET (visual reference only; its performance claims are not Kavach results): https://www.quaranet.space/

