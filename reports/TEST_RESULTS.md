# Kavach · observed test results

Executed: **2026-10-16T08:02:57Z** (UTC). These are observed results, not security-certification claims.

## Environment

- Python 3.13.16
- SQLite 3.46.1
- Node.js v20.20.2; Vite 6.4.4; TypeScript 5.7.3
- Linux-6.1.158+-x86_64-with-glibc2.41
- Browser: Playwright Chromium; desktop 1440×900 and mobile 390×844
- Runtime scenarios: injected UTC Unix time 1792137600
- Local browser requests: actual running FastAPI service, no mocked verdicts

## Summary

| Check | Observed result | Evidence |
|---|---|---|
| Engine + HTTP API pytest suite | 56 passed; 0 failures; 0 errors; 0 skipped; 0.786 s | test-results.xml; pytest-results.txt |
| Isolated runtime Scenario Lab | 29 / 29 passed | browser-session-evidence.json |
| Real-browser workflow assertions | 16 / 16 passed | browser-results.json |
| JavaScript runtime errors | 0 observed | browser-results.json |
| TypeScript + production build | Passed | build-results.txt |
| npm dependency audit | 0 reported vulnerabilities at execution | npm-audit.json |

Pytest emitted one upstream Starlette TestClient deprecation warning about the use of httpx. This did not fail tests; the production API does not use the test client.

## Measured local latency

Five browser submissions measured click-to-visible-verdict (including browser action/rendering overhead): **300.3, 227.19, 143.31, 302.44, 132.77 ms**. The maximum in this sample was **302.44 ms**; all five were below the one-second demo target.

Backend validator measurements for those requests: 0.97, 0.58, 0.65, 0.55, 0.88 ms.

This is a small local sample, not a sustained-load benchmark or performance guarantee. It does not measure external preview proxy latency for a remote user's device.

## Critical invariants exercised

- Valid command commits once; valid observer GET_STATUS does not change mode.
- Authenticated telemetry is stored separately and cannot overwrite protected mode.
- Payload tampering fails HMAC; unknown/mismatched identities stay unverified.
- HMAC success can coexist with NOT_AUTHORISED.
- Expiry, 5-second future-skew boundary, and 60-second maximum lifetime.
- Accepted message replay, new ID with old sequence, invalid high sequence followed by valid input.
- Synchronized duplicate submissions produce one acceptance and one rejection.
- A new engine instance reloads persisted keys, state, active session, and replay records.
- Injected database commit and audit-write errors roll back state, replay, and acceptance audit; retry succeeds after recovery.
- Duplicate JSON keys, malformed UTF-8/JSON, non-finite values, booleans, numeric strings, floats, nulls, extra fields, bad ranges, excessive size/depth.
- Key-order and whitespace invariance of HMAC.
- Rejections preserve protected state and latest received telemetry.
- Session isolation, audit filters/pagination, and exported suite evidence.
- Browser submission sends exact editor bytes; Replay reuses original accepted bytes.
- Responsive layouts have no page-level horizontal overflow at the two tested viewports.
- Export contains no server secret values; invalid unknown-field contents are redacted from bounded message records.

## Runtime scenario outcomes

| Scenario | Expected | Observed | Result |
|---|---|---|---|
| Valid operator command | ACCEPTED | ACCEPTED | PASS |
| Tampered payload | AUTH_FAILED | AUTH_FAILED | PASS |
| Replay accepted message | REPLAY | REPLAY | PASS |
| Expired message | EXPIRED | EXPIRED | PASS |
| Future timestamp | CLOCK_SKEW | CLOCK_SKEW | PASS |
| Unauthorised observer | NOT_AUTHORISED | NOT_AUTHORISED | PASS |
| Invalid payload range | PAYLOAD_INVALID | PAYLOAD_INVALID | PASS |
| Valid telemetry | ACCEPTED | ACCEPTED | PASS |
| Observer status request | ACCEPTED | ACCEPTED | PASS |
| Unknown key | KEY_UNKNOWN | KEY_UNKNOWN | PASS |
| Mismatched sender | IDENTITY_MISMATCH | IDENTITY_MISMATCH | PASS |
| Excessive lifetime | LIFETIME_INVALID | LIFETIME_INVALID | PASS |
| Out-of-order sequence | OUT_OF_ORDER | OUT_OF_ORDER | PASS |
| Unknown action | ACTION_INVALID | ACTION_INVALID | PASS |
| Unknown target | TARGET_UNKNOWN | TARGET_UNKNOWN | PASS |
| Boolean is not integer | SCHEMA_INVALID | SCHEMA_INVALID | PASS |
| Duplicate JSON key | INVALID_JSON | INVALID_JSON | PASS |
| Malformed JSON | INVALID_JSON | INVALID_JSON | PASS |
| Unknown envelope field | SCHEMA_INVALID | SCHEMA_INVALID | PASS |
| Missing required field | SCHEMA_INVALID | SCHEMA_INVALID | PASS |
| Key order & whitespace invariance | ACCEPTED | ACCEPTED | PASS |
| Invalid telemetry preserves snapshot | PAYLOAD_INVALID | PAYLOAD_INVALID | PASS |
| Invalid high sequence | AUTH_FAILED | AUTH_FAILED | PASS |
| Valid after high-sequence rejection | ACCEPTED | ACCEPTED | PASS |
| Concurrent duplicate / 1 | ACCEPTED | ACCEPTED | PASS |
| Concurrent duplicate / 2 | REPLAY | REPLAY | PASS |
| Replay after engine restart | REPLAY | REPLAY | PASS |
| Database commit failure rollback | SERVICE_ERROR | SERVICE_ERROR | PASS |
| Database audit failure rollback | SERVICE_ERROR | SERVICE_ERROR | PASS |

## Scope and limitations

This is an educational local simulator. No hardware or live spacecraft connection was tested. Logs are persistent SQLite records, not immutable or tamper-proof. Restart coverage reinitializes the engine from disk rather than killing the running HTTP service during a request. Browser coverage uses Chromium only. No independent security audit, penetration test, long-duration load test, or production deployment review has been performed.

The backup walkthrough in `kavach-walkthrough.webm` is a real silent browser recording from the integration run.
