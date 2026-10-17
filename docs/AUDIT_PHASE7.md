# KAVACH — Phase 7: Audit & Evidence Workspace Redesign

## 1. Overview
The **Audit & Evidence Workspace** (`page === 'audit'`) has been redesigned into an aerospace evidence-inspection and cryptographic integrity environment matching the KAVACH design system (deep navy `#0b1018`, `#111923`, `#15202c`, electric-blue `#347de5`, `#5599ff`, thin borders `#293645`).

The workspace provides persistent decision record inspection, multi-dimensional filtering, forward SHA-256 hash-chain verification, and multi-format evidence exports (CSV, Session JSON, Decision JSON).

---

## 2. Implemented Capabilities

### A. Workspace Header & Freshness Tracking
- **Header Panel:**
  - Distinct aerospace icon and title with contextual subtitle.
  - Dynamic status indicators:
    - Scope badge: `Current Session Scope` vs `All Sessions Scope`
    - Decision count: `{total} Recorded Decisions`
    - Chain status badge: `Chain Verified` (green) or `Integrity Check Failed` (red)
  - Action controls:
    - **Refresh** (`RefreshCw`): Refreshes SQLite records from `/api/audit`.
    - **Export CSV** (`Download`): Exports filtered decision records as an RFC 4180 CSV artifact.
    - **Session JSON** (`FileJson`): Exports the complete session evidence bundle (`/api/export?session_id=...`).
    - **Verify Chain** (`ShieldCheck`): Triggers SHA-256 forward hash-chain verification (`/api/audit/verify`).

### B. Filter & Query Toolbar
- **Search field:** Filter by reason code (e.g. `AUTH_FAILED`) with clear button.
- **Verdict filter:** `ALL`, `ACCEPTED`, `REJECTED`.
- **Validation Stage filter:** `ALL`, `structure`, `identity`, `authentication`, `payload`, `time`, `permissions`, `replay`, `commit`.
- **Sender filter:** `ALL`, `operator-01`, `observer-01`, `satellite-01`.
- **Message Type filter:** `ALL`, `COMMAND`, `TELEMETRY`.
- **Session Scope filter:** `Current mission session`, `All historical sessions`.
- **Datetime Range filters:** `From` and `To` datetime-local inputs.
- **Active Filter Pills Bar:** Displays individual chips for every active filter with a one-click **"Clear all filters"** action.
- **Scope Note:** Accurately states current record population and export boundaries.

### C. High-Density Responsive Audit Table
- Columns:
  1. **Received At:** Formatted time (`fmtTime`) + local date.
  2. **Event ID:** Monospaced prefix with one-click UUID copy button.
  3. **Sender:** Identity icon + sender ID + verified checkmark badge.
  4. **Kind / Action:** Type tag (`COMMAND`/`TELEMETRY`) + action name.
  5. **Session:** `Current` (green) vs `Historical` + session ID code.
  6. **Verdict & Reason:** Verdict badge (`ACCEPTED` [green], `REJECTED` [red]) + reason code.
  7. **Failed Stage:** Distinct failed stage tag (e.g. `Stage 3: Authentication`) or `All stages passed`.
  8. **State Impact:** `State updated` (amber) vs `State unchanged` (neutral).
  9. **Inspect Action:** "Inspect" button opening the full decision modal.
- Empty states:
  - Clear message when no records match current filter criteria with "Clear all filters" button.
  - Helpful message when database has zero records with link to Mission Console.

### D. Pagination Controls
- Shows exact range: `Showing X–Y of Z recorded decisions`.
- Page size fixed at 15 items per page.
- Accessible "Previous" and "Next" controls with boundary disabled states.

### E. Tamper-Evident Audit-Chain Integrity Panel
- Prominently displays the outcome of `/api/audit/verify`:
  - Number of chained links checked from genesis.
  - Count of uncovered records (if any).
  - Detected problems list (with problem kind, explanation, and link index).
  - 17 covered SHA-256 properties displayed as chips.
  - **Limitations Drawer:** Collapsible section detailing local SQLite bounds, lack of external timestamping, and known cross-session behavior (**QA-01**).

### F. Preserved Known Behaviors & Honesty
- **QA-01 (Session-Scoped Chain Verification):** Transparently explained in the limitations drawer and problem rows without modifying `backend/engine.py`.
- **QA-05 (CSV Export Date Filtering):** Documented in the toolbar note that CSV exports up to 200 matching records with server-side query filters.
- **QA-04 (Evidence & Chain Snapshot Consistency):** Retained un-tampered transaction semantics.

---

## 3. Files Modified & Added
- [`web/src/components/AuditWorkspace.tsx`](../web/src/components/AuditWorkspace.tsx): New unified Audit & Evidence workspace component.
- [`web/src/audit.css`](../web/src/audit.css): Dedicated stylesheet implementing KAVACH aerospace styling tokens.
- [`web/src/main.tsx`](../web/src/main.tsx): Integrated `AuditWorkspace` on `page === 'audit'`.
- [`docs/AUDIT_PHASE7.md`](./AUDIT_PHASE7.md): Phase 7 documentation.

---

## 4. Verification & Test Results
- **TypeScript & Vite Build:** `npm run build` completed with 0 errors (`dist/` updated).
- **Scenario Suite:** `python -m scripts.run_scenarios` $\rightarrow$ **31/31 PASSED**.
- **Acceptance Suite:** `python tests/acceptance_scenario.py` $\rightarrow$ **9/9 PASSED**.
- **Pytest Suite (Engine & API):** `pytest tests/test_engine.py tests/test_api.py -q` $\rightarrow$ **56/56 PASSED**.
- **Pytest Suite (Phase 4):** `pytest tests/test_phase4.py -q` $\rightarrow$ **25/25 PASSED**.
- **Live Server:** Verified live and responsive at `http://127.0.0.1:8000/`.
