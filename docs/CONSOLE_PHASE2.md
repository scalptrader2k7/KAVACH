# Mission Console — Phase 2

Implemented 2026-10-17. Scope: existing Mission Console presentation only.

The console now uses charcoal/navy panels, a collapsible desktop sidebar, a compact mobile menu, an aligned command/editor and receiver workspace, and compact protected-state and telemetry panels. Scenario explanations are available in a keyboard-accessible disclosure below the workspace. No telemetry history is invented. The decorative satellite illustration is no longer rendered on this page.

References reviewed: [NASA Open MCT](https://nasa.github.io/openmct/) for inspection-oriented mission workspaces and [OpenC3 COSMOS](https://openc3.com/) for command/telemetry organization. These are design references, not integrations or claims of mission readiness.

## Files and scope

| File | Change |
| --- | --- |
| `web/src/main.tsx` | Import scoped stylesheet; console-only sidebar collapse state; expanded console navigation labels using the existing navigation map and handlers; remove rendered decorative spacecraft diagram; move existing ThreatPanel into scenario disclosure; opt console into pending stage presentation. |
| `web/src/console.css` | All selectors scoped to `.page-console`; desktop, tablet, mobile, focus, reduced-motion, editor overlay, panel and dialog presentation. |
| `web/src/components/ValidationPipeline.tsx` | Optional `operational` presentation flag distinguishes Pending from Ready while awaiting submission. Default remains false for other callers. Backend PASS/FAIL/NOT_RUN checks remain authoritative. |
| `tests/browser_console.py` | 75 browser outcome checks using existing Chrome/Playwright and real FastAPI handlers with a disposable Engine. |
| `docs/CONSOLE_PHASE2.md` | This behavior map and verification report. |

No dependency additions. Existing Phase 1 package and landing changes were already present when this phase began. Other internal pages retain their existing layouts and navigation presentation. The shared nav buttons gained wrappers, titles and explicit accessible names; their original destination handlers remain unchanged.

## Behavior map inspected before implementation

| Existing feature | Source of behavior | Preserved outcome |
| --- | --- | --- |
| Eight navigation destinations | App `page`, existing button map and page effect | Same pages, filter reset behavior and on-navigation API reads. Sidebar is console-only. |
| API/session header | `refresh`, GET `/api/health` and `/api/state`, existing ten-second refresh | Connecting/connected/offline and current session. Explicit local simulation labels. |
| Command/telemetry, sender, action, mode, interval, battery, temperature | App local builder state; `generate`; POST `/api/demo/issue` | Same payload construction, sender changes, supported options and generated fixture behavior. |
| Generate and scenario shortcuts | Existing `generate(scenario)` | Fixture issuance only; no automatic validation. Same signed/raw fixture, expiry and modification indications. |
| JSON / Contract tabs | Existing `view`, MessageEditor | Exact textarea string retained, contract text unchanged. |
| Format and Copy | `formatEditorJSON`, existing clipboard handler | Formatting rejects malformed/duplicate-key content; whitespace formatting does not re-sign. Copy uses original text. Windows clipboard line endings may normalize. |
| Submit | `submit`, `submitEditor`, POST `/api/messages?session_id=...` | Exact current editor bytes, same disabled conditions, pending request, backend result and state refresh. No optimistic acceptance. |
| Validation stages and proof | ValidationPipeline, AttackProofSummary, Decision model | Actual PASS, FAIL and NOT_RUN trace; Pending while waiting; descriptions expand; full decision and state snapshots remain inspectable. |
| Protected state and telemetry | StateSnapshot from GET `/api/state` | Actual mode, interval, derived antenna/power, latest received battery/temperature/source/time; empty state when missing. No synthetic history added. |
| Recent activity | `loadAudit`, GET `/api/audit` with current session, six-record limit; AuditTable | Same events/counts, mouse and Enter inspection, navigation to Audit & Evidence. |
| Capture normal/attack | `rememberForCompare` | Existing decision objects populate existing Comparison page. |
| New session / Reset | Existing confirmation and handlers | Same API calls and local reset behavior; new session remains explicit. |
| JSON export / decision export | Existing GET `/api/export`, `download` | Unchanged payload and export calculations. Tests compare downloaded JSON with API response. |
| Help, decision and session dialogs | Existing App dialog state, focus trap, Escape handler | Same contents, closure, focus restoration and exports. |
| Audit retry and error toast | Existing error state and handlers | Same error messages and retry path; dismissible toast. |

Inspected `backend/app.py`, `backend/engine.py`, `web/src/api.ts`, `web/src/types.ts`, existing editor/CSV tests, and the reused React components. No backend, API contract, validation, signing, replay, policy, audit-chain, export-calculation or database-schema implementation changed.

## Verification

| Check | Result | Evidence / limit |
| --- | --- | --- |
| TypeScript | PASS | `tsc --noEmit --incremental false`; production build also runs `tsc --noEmit`. |
| Production build | PASS | `npm.cmd run build`, existing dependencies. Final main JS 350.16 kB (102.57 kB gzip), CSS 82.80 kB (14.77 kB gzip). |
| Console browser suite | PASS | `python -B tests/browser_console.py`: 75 checks, zero failures in final run. |
| Landing regression | PASS | `python -B tests/browser_landing.py --channel chrome`: 46 checks, zero failures on final build. |
| Editor / CSV npm launchers | FAIL — existing QA-10 | Both stop at the Windows esbuild process launch before assertions execute. Launchers deliberately unchanged. |
| Editor / CSV assertions | PASS with alternate harness | All original 22 assertions executed unchanged using TypeScript transpilation and in-memory data-URL modules. This does not make the npm launchers pass. |
| Desktop/tablet/mobile overflow | PASS | 1440, 1024, 768, 390 and 320 px; no document horizontal overflow. Wide audit table retains its own scroll area. |
| Dialog width | PASS | Session dialog at all five widths; decision dialog at 1440, 768, 390, 320. Focus trap, Escape, close buttons and focus restoration exercised. |
| Visual inspection | PASS | Chrome screenshots inspected at 1440, 768 and 390 px, including empty and fixture-loaded layouts. |
| Browser/network errors | PASS | No uncaught JS errors, failed requests or unexpected intercepted API HTTP errors. Injected 503 cases intentionally produce browser resource errors and visible application errors. |
| Landing source preservation | PASS | SHA-256 comparison of landing page, Earth components/renderer, CSS, image and attribution: identical to phase start. Entry function preserved. |
| Backend source preservation | PASS | All four backend Python files match phase-start SHA-256. Git shows no backend changes. |
| Live application persistence | PASS for exercised surface | Console suite intercepts every API request and dispatches it to a separate FastAPI TestClient with a temporary Engine. Live landing suite permits only reads and confirms identical live state and audit count before/after. No live write request was sent. |
| Database file byte comparison | NOT TESTED | Runtime `data/` is inaccessible to this tool account. No claim of database-file hashing is made. |
| Firefox/WebKit, physical mobile, comprehensive screen-reader audit | NOT TESTED | Chrome desktop emulation and keyboard checks only. |

The console suite covers accepted SET_REPORT_INTERVAL and SET_MODE commands, accepted telemetry, tampering, replay, permissions rejection, unknown keys and malformed JSON using actual receiver responses. Service failure and transport/offline/audit failure cases are deliberately injected. It also checks pending disabled controls, exact downloads, comparison capture outcomes, all eight navigation destinations, fixture shortcuts, proof disclosures and editor formatting/copy behavior.

The browser test owns its disposable runtime directory, which is cleaned up at exit. Static production assets come from the running local server; API traffic never reaches that server in the console suite. The test uses the installed system Python libraries; it is not a dependency-installing script or a complete backend regression run.

## Unresolved findings and limits

- QA-01 through QA-14 were not remediated. In particular, audit export integrity scope, additive built-in permissions, export filtering/calculations and ThreatPanel expectation wording remain as previously implemented. Moving ThreatPanel into a disclosure does not change its logic or contents.
- Existing behavior observed during isolated testing: `submitError` survives generating another fixture, reset and creating a session. A previous transport error can remain under a new editor until another submit clears it. Left unchanged for a separate functional fix.
- Existing Windows clipboard behavior can normalize LF to CRLF when read back. Copy was verified for text equality after line-ending normalization; byte-for-byte clipboard equality is not claimed.
- Vite retains the Phase 1 warning for the lazy Three.js chunk (526.45 kB, 132.29 kB gzip). No build configuration or warning threshold changed.
- Existing TestClient emits a Starlette/httpx deprecation notice in the system Python environment. No packages were installed or upgraded.
- Small displays and expanded traces require vertical scrolling. Primary desktop controls and the eight initial validation stages remain visible together on the tested 1440 x 1000 viewport.
- Standalone/offline packaging and release archives were not regenerated. No commits or staging performed.

Phase 2 stops here; other internal page redesigns are deferred.
