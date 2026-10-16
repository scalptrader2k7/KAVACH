# Baseline audit — 16 October 2026

Read-only source inspection covered README, PRD, contract, demo, engine/app, React entry, Vite/package/run configuration, tests, preview builder/adapter/test, file metadata, and the available release archive. Baseline runs used isolated temporary runtime data. Original runtime file SHA-256 fingerprints are in runtime-integrity-before.json; no raw keys are reported.

## Reproduced gates

- `python -m pytest -q`: **FAIL**, exit 2 during collection; preview/test_offline.py requires Playwright on import. Source also starts Chromium at import if Playwright is installed. baseline-discovery.txt contains the actual failure.
- `python -m pytest tests/test_engine.py tests/test_api.py -q`: **PASS**, 56 cases, one upstream Starlette/httpx deprecation warning.
- `Engine(tempdir).scenarios()`: **PASS**, 29/29. Actual results: baseline-scenarios.json.
- `npm ci && npm run build`: **PASS**, TypeScript and Vite. npm install reported zero known vulnerabilities in its audit.
- `python tests/browser_smoke.py`: **PASS**, 16/16 actual Chromium assertions against loopback FastAPI with a separate KAVACH_DATA_DIR. baseline-browser.json records actual results.
- Preserved data/key-file bytes after baseline: unchanged.

## Exact findings

1. No allowlist-based, independently validated release build exists. An outer workspace export would contain runtime material. The available `/home/user/Kavach-source.zip` has 44 entries, no forbidden runtime-key/database names, and no occurrences of the current secret values. The user's separately described outer workspace ZIP is not accessible here; its contents cannot be independently verified. Do not redistribute workspace exports.
2. Runtime directory is 0755; sender-secrets.json and kavach.sqlite3 are 0644 after workspace restoration. Creation-time key mode alone does not enforce permissions after restore. Existing content must be preserved while modes are restricted.
3. Vite binds all interfaces with allowedHosts=true; npm dev/preview scripts force 0.0.0.0. Backend run.sh defaults to loopback, but arbitrary external host opt-in lacks an explicit acknowledgement gate.
4. preview/test_offline.py imports optional browser dependencies and launches a browser at import. Core pytest collection is not browser-independent. build_preview.py also executes builds on import (not collected, but maintainability risk).
5. JSON.parse + JSON.stringify formatter collapses duplicate keys and may round large numeric tokens. This changes attack evidence without a warning; malformed JSON is already preserved by its catch branch.
6. Engine.validate calls connect() outside its error boundary. Connection-open failure can escape instead of SERVICE_ERROR. Missing sessions are inconsistent across endpoints, and database exceptions outside the receiver can become unbounded framework errors.
7. app.py constructs Engine on module import, touching default runtime before tests can replace it. Readiness checks are minimal. Fixture payload accepts arbitrary dictionaries; malformed/deep/oversized fixture parameters and default framework validation errors need bounded handling.
8. The UI shows trace and state separately but lacks a compact attempt/expected/observed/authentication/replay/audit summary. Replaying without an accepted message performs a hidden status submission and claims success without inspecting that receiver response.
9. Frontend communication, editor logic, decision display, and audit table are concentrated in one large entry file with extensive any typing.
10. Offline HTML uses fresh browser-generated keys, not current server keys, and is labeled browser-only. Its independent validation must remain separate from Python/SQLite evidence.

## Priority

Release allowlist/secret scanning and safe local defaults → discovery/editor/API correctness → receiver-backed demonstration summary → focused typing/extraction. No canonicalization or replay-stream policy change is planned.
