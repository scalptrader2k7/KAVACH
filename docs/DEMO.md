# Kavach · two-minute presentation

## Before presenting

1. Run the application and check the green API Connected indicator.
2. Open Scenario Lab and run the suite; inspect any failure before presenting.
3. Start a new demo session. This preserves previous test evidence without mixing the demo's replay stream with it.
4. Return to Mission Console. Keep local server time correct. Generate fixtures immediately before each submission so they are not stale.
5. Have `reports/kavach-walkthrough.webm` and `reports/browser-session-evidence.json` available as a backup. The video is a short silent actual workflow recording, not a two-minute narrated presentation.

## Script

**0:00–0:15 — Frame the problem**

“Kavach is a local simulator for validating satellite commands. There is no live satellite connection. The important question isn't whether we can show a warning; it's whether a rejected instruction was prevented from changing protected state.”

**0:15–0:35 — Valid command**

Use operator-01 → SET_MODE → Power saving. Generate and submit. Point to the eight PASS stages, the committed mode, and the separate local telemetry snapshot.

“Every verdict is produced by Python. State, replay records, and the acceptance audit commit together.”

**0:35–0:55 — Tamper**

Click Tamper, then submit. Show Modified since signing, AUTH_FAILED, Sender unverified, later NOT RUN stages, and state unchanged.

“The message was changed after signing. Submission never silently re-signs it.”

**0:55–1:10 — Replay**

Click Replay, then submit. Show REPLAY and unchanged state.

“We sent the original accepted bytes. A message ID can't execute twice, and sequences must strictly increase per stream.”

**1:10–1:30 — Valid HMAC, invalid permission**

Open Scenario Lab → Unauthorised command → submit. HMAC passes; permission fails.

“Authentication and authorisation are different. An observer can possess a valid key and still be forbidden from changing mode.”

**1:30–1:45 — Telemetry / expiry**

Load Valid telemetry and submit. Show that received telemetry does not overwrite protected mode. Optionally load Expired message if time permits.

**1:45–2:00 — Evidence**

Open an audit event, show before/after protected state and policy version. Export evidence. Open Scenario Lab and run the isolated suite if the presenter can do so within time.

“We test the outcomes, including concurrent duplicates and failure rollback. Our audit is persistent, not tamper-proof, and passing these scenarios isn't a claim of production security.”

## Q&A demonstrations

- Concurrent duplicates: suite rows Concurrent duplicate / 1 and / 2 must show one acceptance and one REPLAY.
- Restart persistence: suite reinitializes the engine using persisted keys and database; accepted fixture remains a replay. It does not terminate the HTTP process.
- Commit/audit failures: isolated temporary databases inject actual SQLite errors. Both must yield SERVICE_ERROR, unchanged state/replay, no persisted acceptance, and a successful retry after recovery.
- Whitespace-only edits: generate GET_STATUS, reformat JSON, submit. Authentication remains valid under the documented encoding contract.
- Duplicate JSON keys: type `{"version":1,"version":1}` into the editor and submit. The frontend sends it verbatim; the receiver returns INVALID_JSON.

## Hardened console shortcut path

The existing console now includes **Unauthorised** and **Telemetry fixture** next to Tamper/Replay. You do not need to leave Mission Console between these steps. Each fixture generation makes the form match the actual returned sender/type/action. Submit explicitly after each load.

The Attempt proof receipt answers three questions without asking a judge to interpret every stage: what was attempted, why the receiver accepted/rejected it, and what happened to protected state. Point out that the expected field is fixture intent, while the observed verdict and audit/replay fields come from Python.

Updated compact sequence:

| Time | Action | Evidence to point at |
|---|---|---|
| 0:00–0:15 | Explain local synthetic-only boundary | No live channel; API connected |
| 0:15–0:35 | Fresh operator Power saving → Submit | ACCEPTED, mode changed, replay YES, persisted audit ID |
| 0:35–0:55 | Tamper → Submit | AUTH_FAILED, sender UNVERIFIED, mode/telemetry/replay unchanged |
| 0:55–1:10 | Replay → Submit | Original bytes; REPLAY; no second application |
| 1:10–1:30 | Unauthorised → Submit | Observer HMAC PASS, permissions FAIL, unchanged state |
| 1:30–1:45 | Telemetry fixture → Submit | Received mode can differ; protected mode stays Power saving |
| 1:45–2:00 | Audit & Evidence → open decision/export | Full trace, before/after, policy, hash, persisted decision |

Do not let an accepted replay fixture expire before the Replay step; time checks correctly take precedence. A replay click with no accepted message now explains that prerequisite instead of secretly submitting GET_STATUS. Run the 29-case suite before the timed presentation, not at the cost of explaining the six primary steps. The automated walkthrough exercises this sequence, but is not a timed first-time-human usability study; approximately two minutes remains a presentation target, not a certified usability measurement.
