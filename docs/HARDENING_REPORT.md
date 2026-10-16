# KAVACH 1.0.1 — hardening report

**16 October 2026 · incremental hardening, not a replacement application.**

## 1. Scope and preserved invariants

React/TypeScript/Vite, FastAPI, Python HMAC-SHA256, and SQLite remain the stack. No new runtime framework, Redux, WebSockets, service, authentication subsystem, or production satellite integration was introduced. Small typed frontend modules replace only risk-prone portions of the existing entry point.

The original eight ordered checks and first-failure semantics, duplicate-key rejection, signing representation, time boundaries, permission rules, per-stream replay rules, independent telemetry, and atomic acceptance/state/replay/successful-audit transaction remain intact. The canonical signing function's AST matches the baseline. The original 56 engine/API tests still pass. Runtime scenarios include restart, rollback fault injection, and concurrent duplicates. Operational failures never masquerade as successful execution or durable acceptance.

Original `data/` key and database bytes are unchanged, verified by SHA-256 before and after QA/packaging. Only their POSIX permission metadata was restricted (directory 0700; files 0600). Tests and demonstrations use separate runtimes. No original keys, sessions, counters, or history were deleted, reset, or rotated. Fingerprints and comparison results, not secrets, are in `reports/sprint/runtime-integrity-before.json` and `runtime-preservation.json`.

## 2. Bugs and risk reductions — before → after

| Area | Before | After / independently exercised behavior |
|---|---|---|
| Release | Generic outer workspace could expose private runtime; no enforced release builder | Exact reviewed `release-files.json`; deterministic ZIP order/timestamps/modes and per-member hashes; forbidden paths, traversal, symlinks, databases/journals, `.env`, dependencies, nested archives, private-key markers, and known raw/hex/base64 secrets rejected. Synthetic regressions inject forbidden paths and secrets. |
| Network defaults | Vite all-interface bind and wildcard hosts | Backend and Vite supported launchers default to loopback, exact hosts; external binding requires acknowledgement and privileged-issuer warning. Actual sockets, foreign Host rejection, and unacknowledged external refusal tested. |
| Core test discovery | Importing the optional preview test required Playwright and could launch Chromium | Browser imports/launches guarded behind explicit commands. Fresh venv with no Playwright runs all 111 core tests, even with an unavailable Chromium path. Missing optional browser support reports BLOCKED/exit 2. |
| Formatter / editor | Parse/stringify discarded duplicate keys and could round numeric tokens | Lossless formatter preserves tokens; malformed/duplicate JSON is unchanged with warning. Current textarea bytes are sent verbatim, not the last issued fixture. Formatting never re-signs. Payload edits fail HMAC. Twelve direct editor regressions plus real HTTP browser assertions. |
| Replay UI | No prior accepted input could trigger hidden execution | Replay returns original persisted accepted bytes only; no accepted input returns 409. No hidden command, signing, or state advancement. |
| Storage / API | Import touched default runtime; connection-open errors and several bad inputs escaped bounded handling | Lazy/guarded engine, permissions repaired without content replacement, connection cleanup, bounded contention, safe fixture/body/session/storage errors, non-sensitive validation replies, transaction rollback and one-snapshot export. Corrupt stored JSON is 503, not mistaken for a missing session. |
| Presentation | Sender, decision trace, state, replay, and evidence were scattered | Receiver-backed Attempt proof receipt shows attempted action/claimed identity, fixture intent versus observed result, first failure, authenticated/unverified sender, before/after, replay advancement and persisted audit reference. Shortcuts support the six-step mission. |
| Frontend structure | Transport/editor/evidence logic concentrated in one entry file | Typed API/types/editor and small audit, validation and receipt components; no alternate engine in the online UI. |
| Offline claims | Browser fallback could be mistaken for server evidence | Explicit JavaScript/in-memory prototype labeling, no server keys, no claim of SQLite persistence, Python execution, server concurrency, or immutable audit. Eight browser-only cases are reported separately. |

During implementation, original-browser regression testing caught a stale new-session React closure. It was fixed with explicit session selection and a regression. Later checks also caught unreadable editor scroll offsets after long-token editing; loading a fresh signed fixture now resets the editor scroll. Neither defect is hidden as a security-engine improvement.

## 3. Executed verification

Environment: Python **3.13.16**, Node **20.20.2**, npm **10.8.2**, Linux/POSIX. Dependency installation requires network; the built local UI/API and standalone fallback do not require external resources.

| Command / check | Observed result | Evidence |
|---|---|---|
| `python -m pytest -q --junitxml=reports/sprint/full-pytest.xml` after candidate ZIP creation | **111 passed, zero skipped**; one upstream Starlette/httpx deprecation warning | `full-pytest.txt`, `full-pytest.xml` |
| `python -m pytest tests/test_engine.py tests/test_api.py -q` | **56 passed** | `final-original56.txt` |
| `python -m scripts.run_scenarios --output reports/sprint/runtime-scenarios.json` | **29/29**, isolated active state unchanged | `runtime-scenarios.json` |
| `npm run test:editor` | **12/12** | `editor-unit.txt` |
| `npm run build` | TypeScript and production Vite build **PASS** | `build.txt`; clean-extraction `clean-build.txt` |
| `python tests/browser_smoke.py` | Original **16/16**, real API, no JavaScript errors | `browser-original16.txt`, `reports/browser-results.json`, actual walkthrough video |
| `python tests/browser_hardening.py` | **30/30**, real production API, no JavaScript errors | `browser-hardening.json`, `browser-hardening.txt`, desktop/mobile proof screenshots |
| `KAVACH_URL=http://127.0.0.1:5173 python tests/browser_hardening.py` | **30/30** on actual Vite development server | `browser-vite.json` |
| `python preview/build_preview.py` then `python preview/test_offline.py` | Fallback **8/8**, no runtime errors, no external requests | `reports/offline-prototype-tests.json`, `offline-browser.txt` |
| Optional fallback with nonexistent Chromium installation | **BLOCKED, exit 2**, not a browser pass; installed-browser rerun passed | `optional-browser-missing.txt` |
| Fresh candidate extraction: fresh venv, `pip install -r requirements-dev.txt`, `npm ci`, build, full pytest | **111 passed**, no Playwright installed, unavailable Chromium path; supported launcher starts and actual UI/health/accept/replay/tamper/export requests pass | `clean-extraction.json`, `clean-pytest.txt`, `clean-build.txt`, `clean-npm-ci.txt` |
| Optional browser command in that no-Playwright venv | **BLOCKED, exit 2**, correct installation guidance | `clean-optional-browser.txt` |
| Actual backend/Vite bind and hostile Host probes | loopback sockets; allowed Host 200, hostile backend 400/Vite 403; unacknowledged external Vite exit 1 | `bindings.json` |
| `npm audit --json` | **0 known vulnerabilities** at execution; not a security certification | `npm-audit-final.json` |
| Original runtime / signing representation comparison | Unchanged key/DB bytes; canonical AST unchanged; 0700/0600 | `runtime-preservation.json` |

Unqualified evidence filenames above are under `reports/sprint/`. Counts overlap; 56 is a subset of 111, and the browser's Scenario Lab also runs the 29-case suite. Do not sum these as distinct security requirements. Full pytest's release gate initially skipped while the ZIP was absent; the included 111-pass run was obtained only after creating and inspecting a real candidate archive.

### Final artifact sealing

The report and selected raw evidence are frozen into the release. Final ZIP inspection, reproducibility hashes, final core rerun, and final exact-archive clean-extraction follow-up are **sidecars outside the ZIP**, avoiding a self-referential hash/test-log cycle:

- `reports/sprint/final-release-validation.json`: final SHA-256 and packager inspection, scanning original and isolated test key sets without printing values.
- `reports/sprint/archive-independent.json`: separate ZIP/allowlist/path/hash/source/secret inspection that does not import the release builder.
- `reports/sprint/reproducibility.json`: two builds from the sealed input bytes have the same SHA-256.
- `reports/sprint/final-pytest.txt`: full core run against the final ZIP with unavailable browser-binary path.
- `reports/sprint/final-clean-extraction.json` and `final-clean-pytest.txt`: final exact-archive follow-up in another fresh venv without Playwright.

These artifacts must say PASS before distribution; a candidate hash is not the final release hash. Included clean-install evidence is explicitly the candidate-stage execution, not silently relabeled as the final exact archive.

## 4. Submission, recovery, and startup

Distribute **`Kavach-hardened-release.zip` only**, not the workspace or an outer export. It contains reviewed source, tests, docs, locally bundled font assets, selected non-secret evidence, and the browser-only fallback, plus `RELEASE_MANIFEST.json`. No runtime data, credentials, environment files, dependencies, caches, or compiled production `dist/` are included. Install/build instructions are in `README.md`; browser-only usage is in `preview/README.md`.

If a prior environment might have been exposed, do not delete or rewrite its evidence. Preserve it privately, restrict access, and create a **new isolated synthetic environment** with a new empty private data directory and newly generated synthetic keys. Do not reuse compromised keys. `docs/SECURITY.md` gives exact commands and the fail-closed missing-key behavior. No recovery/reset was applied to the original runtime in this sprint.

Startup after extraction:

```bash
cd kavach
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm ci
npm run build
python -m backend
# Open http://127.0.0.1:8000
```

## 5. Two-minute demonstration and honest fallback

Use a fresh demo session, not a data reset. Primary sequence: **valid command → tamper → original-byte replay → valid-HMAC unauthorised command → independent telemetry → persisted audit/export**. Generate fresh fixtures immediately before submission so time checks do not pre-empt the intended failure. `docs/DEMO.md` supplies the timed script and where to point in the receiver-authored receipt. Approximately two minutes is a presentation target, not a measured first-time-user usability guarantee.

`preview/Kavach-interactive-prototype.html` is self-contained and zero-external-network. It executes an independent JavaScript/in-memory validator, not Python, SQLite, or server-secret verification. Its browser audit is not durable SQLite evidence. The downloadable fallback and actual silent walkthrough video are contingency presentation tools, not proof of a public deployment.

## 6. Remaining limitations / not fixed by this sprint

- **Local synthetic simulator only.** No public-user authentication/authorization, tenant isolation, production signing infrastructure, satellite integration, or production-security certification. The privileged fixture issuer can sign commands; state/audit/export/session/scenario endpoints are not access-controlled for hostile clients.
- Loopback and exact Host/Origin rules reduce exposure; they are **not a firewall or authorization**. The Arena platform has forwarding listeners separate from application loopback sockets. Do not publish this service untrusted. Raw manual Uvicorn invocation can bypass the supported launcher's acknowledgement check.
- Public deployment would separately need authenticated isolated runtimes, signer/issuer restrictions, session-scoped authorization, CSRF controls for cookie authentication, TLS, quotas/rate/concurrency controls, lifecycle/backup/key management and review. A concrete unimplemented model is in `SECURITY.md`; this sprint deliberately adds no ad-hoc login.
- SQLite audit is persistent, not immutable, signed or tamper-proof. Canonical HMAC and these tests do not establish resistance to every attack. Known-secret scanning is not a universal secret detector. Windows owner-only ACL enforcement was not tested; POSIX chmod is not a Windows security guarantee.
- Two-second default SQLite contention timeout (bounded configuration) is not a universal hardware/I/O latency guarantee. Oversize receiver input records an explicitly labeled bounded prefix, not a false full-body hash.
- One upstream Starlette/httpx deprecation warning remains. Optional browser tools need separately installed Playwright/Chromium/system libraries; those tools are deliberately absent from core requirements and submission dependencies.
- Historical Arena browser-ingress 403 was not resolved or reclassified as a pass. Verified browser execution uses actual loopback HTTP. Safe binding/host rules were not weakened to force a public preview.
- The separately described outer workspace archive was unavailable for inspection. The original 44-member source ZIP was inspected, but does not prove any inaccessible outer export safe. Preserved runtime material intentionally remains private in the working environment; distribute only the sanitized release.

## 7. Complete changed-file register

`docs/CHANGELOG.md` and machine-readable `reports/sprint/changed-files.json` enumerate modified, added, and removed source/docs/test/evidence files relative to the saved pre-sprint manifest, with per-file reasons. Generated dependencies/build/cache and private runtime are not represented as source changes; original runtime permission repair is stated separately. Final hash-bearing sidecars are registered but excluded from the exact ZIP allowlist.
