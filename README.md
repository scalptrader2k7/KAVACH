# KAVACH

**Every command verified. Every decision traceable.**

Local satellite command-validation and telemetry simulator: React/TypeScript/Vite, FastAPI, Python standard-library HMAC-SHA256, and SQLite. There is no physical satellite, live command channel, external feed, or production-security certification.

This is an incremental hardening of the existing application, **not a rebuild**. The original eight receiver stages, signing representation, permission policy, replay-stream semantics, and transactional protected state are retained. The separate standalone HTML is explicitly browser-only and is not the Python security boundary.

## Local startup — safe defaults

Requirements: Python 3.11+ and Node.js 20.19+. Tested environment and current results are in `docs/HARDENING_REPORT.md`.

```bash
cd kavach
python -m venv .venv
source .venv/bin/activate                 # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
npm ci
npm run build
python -m backend
```

Open **http://127.0.0.1:8000**. The supported launcher defaults to loopback. It serves the built UI, bundled local fonts, and API. After dependencies/build are available, no external network access is required. On subsequent runs, `bash run.sh` rebuilds and starts the same loopback service. `python -m backend --port 8001` changes the port.

### Development

Terminal 1, after installing Python dependencies:
```bash
python -m backend
```
Terminal 2:
```bash
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies relative `/api` calls to loopback port 8000. Browser code does not address another service using localhost. `npm run preview` also defaults to loopback; the normal submitted-app startup is the Python-served production build above.

**Privileged fixture issuer:** `/api/demo/issue` can sign operator commands intentionally. It is not public-user authentication. Wildcard host acceptance and default all-interface binding have been removed. The supported launchers require `KAVACH_ALLOW_EXTERNAL=1` for a deliberate external bind and print a warning. Exact hostname/origin exceptions, their limitations, and an unimplemented public-demo security model are documented in `docs/SECURITY.md`. Do not expose this MVP on an untrusted network. Platform tunnels can publish even a loopback service; local defaults are not a firewall.

## Two-minute first mission

1. Generate a fresh **operator SET_MODE → Power saving** fixture and submit. The Python trace accepts it; protected mode changes and replay advances. The new **Attempt proof** receipt shows action/sender, fixture expectation versus observed outcome, first failure (if any), authentication, before/after protected state, replay advancement, and the persisted audit reference.
2. Click **Tamper**, then submit. Authentication fails; protected spacecraft state, accepted telemetry, and replay records do not change.
3. Click **Replay**, then submit. Original accepted bytes are loaded without re-signing or hidden execution. Time checks still precede replay; an expired original reports EXPIRED. If there is no accepted message, the UI asks you to accept one first rather than secretly executing a status command.
4. Click **Unauthorised**, then submit. A correctly authenticated observer is denied by receiver policy. HMAC PASS is not permission.
5. Click **Telemetry fixture**, then submit. Received telemetry updates separately; it does not overwrite protected mode.
6. Open **Audit & Evidence**, filter/open the decision, compare snapshots, and export JSON.

Fixtures expire after 60 seconds. Generate them just before submission. **Editing or formatting never re-signs the message**. Formatting preserves malformed/duplicate-key attack input and warns instead of collapsing evidence. Valid formatting only changes whitespace around original JSON tokens, preserving values, numeric lexemes, and the HMAC tag. The receiver always receives the exact current editor string as UTF-8 bytes.

See `docs/DEMO.md` for timing, preparation, and Q&A.

## Scenario Lab and evidence

- Eight interactive fixture presets, plus the **29-case Python runtime suite**, use real receiver decisions.
- The suite uses an isolated namespace; database fault injection uses separate temporary databases. It checks expected/observed outcomes and protected state/telemetry/replay invariants. The current mission is unchanged by a suite run.
- The restart case reinitializes the engine without stopping HTTP. An additional subprocess regression test verifies replay across separate Python processes.
- Audit views support verdict, sender, type, exact reason-code, and current/all-session filters, pagination, keyboard inspection, and JSON export.
- Evidence export reads state, events, and suite results in one consistent SQLite snapshot. Logs are persistent records, **not immutable or tamper-proof**.
- Expected outcome in the console is a fixture-issuer **preset intent**, not a predicted frontend decision or a substitute for validation. Edited/custom inputs may have no expectation. All observed verdicts, checks, state/replay changes, and audit-persistence flags come from Python.

## Verification commands

Core tests do **not** require Playwright or browser binaries:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
npm run test:editor
npm run build
```

A release-specific pytest gate is explicitly pending/skipped until the actual release ZIP exists. Build and verify the archive below, then rerun `python -m pytest tests/test_release.py -q`; the sprint's final full-discovery run includes that actual archive gate. No missing-browser run is treated as a pass.

Optional real-browser checks, with the API/production build running in a **separate test data directory**:

```bash
# Terminal 1: use a new path, never reset the presenter's runtime.
KAVACH_DATA_DIR="$HOME/kavach-qa-private" python -m backend
# Terminal 2:
python -m pip install playwright
python -m playwright install chromium
# Linux may additionally require:
python -m playwright install-deps chromium
python tests/browser_smoke.py
python tests/browser_hardening.py
python preview/build_preview.py
python preview/test_offline.py
```

The original baseline (56 engine/API cases, 29 runtime scenarios, 16 Chromium assertions) was reproduced before changes. Final executed commands/results, newly added regressions, warnings, blocked gates, and before/after behavior are recorded in **`docs/HARDENING_REPORT.md`** and **`reports/sprint/`**. Browser scripts return exit 2 and write BLOCKED when optional packages/binaries are unavailable; failed/blocked runs replace stale success reports rather than masquerading as old passing results.

## Runtime data and recovery

Default ignored runtime directory: `data/`. `KAVACH_DATA_DIR` can select a private directory elsewhere. Keys/database remain paired:

- `sender-secrets.json`: per-sender randomly generated 256-bit synthetic secrets, server-side only.
- `kavach.sqlite3`: sessions, protected state, telemetry, issue counters, replay streams/accepted IDs, audit events, and suite results.

POSIX runtime directory mode is enforced as 0700; key/database/journal/WAL/SHM files are owner-only (0600). Restrict equivalent ACLs on Windows. Existing key/database **contents are not rewritten** by permission repair. Ordinary restarts/reloads retain the active session and replay state. **New demo session** creates an isolated namespace but does not rotate keys or delete history.

If the database exists without its keys, startup fails closed instead of replacing keys. Importing the API module no longer initializes runtime files. Connection-open, audit-write, commit, lock, and malformed-storage failures return bounded operational errors without raw inputs, secrets, or stack traces in responses.

If any workspace ZIP exposed keys, treat them as compromised. Preserve a private forensic copy of the old runtime and launch a **fresh empty data directory** with new synthetic keys; do not delete or rotate the old keys in place. Detailed recovery steps are in `docs/SECURITY.md`.

## Sanitized release — do not submit a workspace ZIP

```bash
npm ci
npm run build
python preview/build_preview.py
python scripts/release.py --output ../Kavach-hardened-release.zip
python scripts/release.py --verify ../Kavach-hardened-release.zip
python -m pytest tests/test_release.py -q
```

The archive uses the reviewed, exact `release-files.json` allowlist. It includes source/configuration, tests, PRD/docs, licensed local assets, standalone HTML, and permitted demonstration evidence. It excludes all runtime keys/databases/journals, `.env`/credentials, dependencies, virtual environments, caches, unrelated uploads, and outer/nested workspace archives. The builder fails closed on forbidden paths, symlinks, missing files, private-key markers, or known signing-secret values, and independently inspects the finished ZIP. Per-file hashes are included in `RELEASE_MANIFEST.json`. Known-secret scanning is not a universal secret detector.

Existing runtime data is deliberately preserved and can still exist in the workspace. **A generic workspace export is not the sanitized submission. Distribute only the validated release ZIP.** Old archives are retained for inspection and are not updated releases.

## Standalone HTML fallback

After `python preview/build_preview.py`, open **`preview/Kavach-interactive-prototype.html`**, directly or in a compatible file viewer. It embeds all UI code, CSS, fonts, and its independent JavaScript validator; it makes no external requests. In a sandbox that blocks file downloads, exports open a selectable JSON dialog.

The banner accurately labels it **browser-only**: fresh ephemeral browser keys, in-memory records, reset on reopening. It does not claim server-side secrets, SQLite persistence, the 29-case Python suite, concurrent transactions, or restart durability. Its eight browser scenarios are different from the real receiver's suite. See `preview/README.md`. A local app/browser check does not prove Arena's authenticated iframe works on a remote user's browser.

## Architecture and limitations

```text
React/TypeScript → relative HTTP, exact editor bytes → FastAPI
  → strict JSON → registry → HMAC → target/payload → time → policy
  → replay → atomic state/telemetry + replay + audit commit → verdict
SQLite backs protected state and evidence; keys never enter UI/evidence/release.
```

`web/src/api.ts`, `editor.ts`, `types.ts`, and the extracted validation, proof-summary, and audit components isolate the highest-risk UI responsibilities without replacing the existing styling/workflows or adding state-management frameworks. `backend/engine.py` retains the security boundary. HMAC canonicalization and strictly increasing replay sequences are unchanged.

Synthetic operating bounds are not spacecraft engineering limits. HMAC is integrity/shared-key authentication, not encryption, named-human identity, or physical truth. Local model telemetry is a labeled invented snapshot (87% / 24°C). There are no accounts, public authorization, cloud controls, hardware integration, orbital accuracy, formal accessibility certification, or independent security audit.

Font assets: DM Sans and IBM Plex Mono (SIL Open Font License notices in `web/public/fonts/`). Icons: lucide-react (ISC). Other dependencies retain their licenses. No new runtime dependency or microservice was added by this sprint.
