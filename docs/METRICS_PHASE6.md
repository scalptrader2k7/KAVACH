# KAVACH — Phase 6: Metrics Dashboard Redesign

## 1. Overview
The **Metrics Dashboard** (`page === 'metrics'`) has been redesigned into an aerospace mission-operations environment matching the established KAVACH design system (deep navy `#0b1018`, `#111923`, `#15202c`, electric-blue `#347de5`, `#5599ff`, thin borders `#293645`).

The workspace displays real-time, traceable command-validation statistics retrieved from `/api/metrics` and `/api/anomalies`, computed directly from persistent SQLite audit records. Live operational counters are strictly decoupled from isolated scenario suites.

---

## 2. Implemented Capabilities

### A. Workspace Header & Freshness Tracking
- **Header Panel:**
  - Aerospace icon, title, and session scope badge (`Live Session` with status dot + `Session ID`).
  - Contextual explanation of underlying SQLite audit records.
  - **Live Freshness Indicator:** Displays formatted timestamp of the latest successful retrieval.
  - **Manual Refresh:** Integrated button with loading spinner state and retry handling.
  - **Export JSON:** One-click download of the complete metrics snapshot and anomaly observations.

### B. Executive KPI Ribbon (Top Summary Cards)
- **Messages Checked:** Total commands and telemetry records evaluated by the receiver (`live.messages_checked`).
- **Accepted:** Total accepted decisions (`live.accepted`) with dynamic acceptance rate tag (`live.acceptance_rate`).
- **Rejected:** Total rejected decisions (`live.rejected`) with dynamic rejection rate tag.
- **Replay Protection:** Replay attempts detected (`live.replay_attempts_detected`) plus out-of-order sequence counter (`live.out_of_order_rejected`).
- **Cryptographic Failures:** Authentication failures (`live.authentication_failures` due to HMAC tag mismatches).
- **Authorization Denials:** Role boundary violations (`live.authorisation_denials` under `kavach-policy/1.0`).
- **Safe Math:** Division by zero is prevented; empty sessions display `0.0%` gracefully.

### C. Validation Outcome Distribution Meter
- Proportional segmented bar visualizing the ratio of **Accepted** (`#5ec269`), **Rejected** (`#f2777b`), and **Service Errors** (`#f0b429`).
- Interactive legend with exact counts and percentages.
- Empty state displayed when zero decisions have been recorded in the current session.

### D. Rejection & Stage Analytics Grid (2-Column Layout)
1. **Rejection Reasons Breakdown:**
   - Visual distribution of rejection reason codes (`AUTH_FAILED`, `REPLAY`, `EXPIRED`, `CLOCK_SKEW`, `NOT_AUTHORISED`, `PAYLOAD_INVALID`, `KEY_UNKNOWN`, `INVALID_JSON`).
   - Relative proportional bar widths.
   - Exact count and percentage of total evaluations.
   - Interactive link navigating to Attack Timeline / Audit.
2. **First Failed Validation Stage:**
   - Visual distribution of failures across the 8 validation stages:
     `1. Structure & Envelope`, `2. Identity & Key Registry`, `3. HMAC Authentication`, `4. Action & Payload Schema`, `5. Lifetime & Freshness`, `6. Role Authorization`, `7. Replay Stream Window`, `8. State Transition Commit`.
   - Proportional bar fills with counts and percentages.
   - Interactive link navigating to Attack Timeline.

### E. Reason-Code Registry
- Comprehensive grid of all observed reason codes (`live.reason_code_breakdown`), highlighting `OK` in green and rejection codes in red/amber with counts and percentage shares.

### F. Isolated Scenario Suites Section
- Clearly separated with an **ISOLATED NAMESPACE** badge.
- Explicit notice: "Executes in an isolated session namespace with synthetic time injections. Benchmarks are never commingled into the live operational telemetry above."
- 4 Metric cards: Suite runs, Cases executed, Cases passed, Cases failed.
- **Protected-State Integrity Banner:** Displays count of state integrity violations (highlighted in green for 0 violations).
- One-click link to open Scenario Lab (`onNavigate('scenarios')`).

### G. Synthetic Telemetry Anomaly Detection
- Displays findings from `/api/anomalies` with rule badge, detail narrative, and SQLite event ID reference.
- Clean state indicator when no anomaly rules have fired on accepted telemetry.
- **Anomaly Rules Engine Reference Drawer:** Expandable section detailing all 5 defined rules (`OUT_OF_RANGE`, `SUDDEN_BATTERY_DROP`, `SUDDEN_TEMPERATURE_JUMP`, `MODE_WITHOUT_COMMAND`, `STALE_REPORT`) with their mathematical thresholds.

### H. Loading & Error States
- Sleek loading skeleton with spinner when metrics are being retrieved.
- Honest error state when the backend is unreachable, with a "Retry Connection" action.

---

## 3. Files Modified & Added
- [`web/src/components/MetricsDashboard.tsx`](../web/src/components/MetricsDashboard.tsx): Redesigned Metrics Dashboard component.
- [`web/src/metrics.css`](../web/src/metrics.css): Dedicated stylesheet implementing KAVACH aerospace styling tokens.
- [`web/src/main.tsx`](../web/src/main.tsx): Enhanced `loadMetrics` with busy state handling and wired `onRefresh` and `onNavigate` props.
- [`docs/METRICS_PHASE6.md`](./METRICS_PHASE6.md): Phase 6 documentation.

---

## 4. Verification & Test Results
- **TypeScript & Vite Build:** `npm run build` completed with 0 errors (`dist/` updated).
- **Scenario Suite:** `python -m scripts.run_scenarios` $\rightarrow$ **31/31 PASSED**.
- **Acceptance Suite:** `python tests/acceptance_scenario.py` $\rightarrow$ **9/9 PASSED**.
- **Pytest Suite (Engine & API):** `pytest tests/test_engine.py tests/test_api.py -q` $\rightarrow$ **56/56 PASSED**.
- **Pytest Suite (Phase 4):** `pytest tests/test_phase4.py -q` $\rightarrow$ **25/25 PASSED**.
- **Live Server:** Verified live and responsive at `http://127.0.0.1:8000/`.
