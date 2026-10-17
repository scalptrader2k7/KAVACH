# KAVACH — Phase 5: Comparison Workspace Redesign

## 1. Overview
The **Comparison Workspace** (`page === 'compare'`) has been completely redesigned to match the established KAVACH aerospace mission-control design system (deep navy `#0b1018`, `#111923`, `#15202c`, electric-blue `#347de5`, hairline borders `#293645`).

The workspace provides real-time, side-by-side comparative analysis of two genuine command validation submissions processed by the local Python receiver. No verdicts or outcomes are predicted or fabricated.

---

## 2. Implemented Capabilities

### A. Workspace Header & Capture Assistant
- **Header Panel:**
  - Distinct aerospace icon and title with contextual subtitle.
  - Dynamic status indicator:
    - `Ready for analysis (2 of 2)` (Green badge)
    - `Partial comparison (1 of 2)` (Amber badge)
    - `Awaiting captures (0 of 2)` (Neutral badge)
  - Diff count counter showing exact number of differing fields.
  - Action buttons:
    - **Swap sides** (`ArrowLeftRight`): Swaps Baseline $\leftrightarrow$ Comparison slots.
    - **Clear all** (`Trash2`): Resets both captures with confirmation notification.
    - **Export JSON** (`Download`): Exports structured comparison artifact.
- **Quick-Capture Assistant Bar:**
  - Displays real-time status of the current submission from Mission Console.
  - If a submission exists: Displays `[VERDICT] reason_code`, event ID, roundtrip duration, and one-click capture buttons (`Capture as Baseline`, `Capture as Comparison`).
  - If no submission is pending: Displays guidance with quick shortcut links to Mission Console and Scenario Lab.

### B. Side-by-Side Comparison Columns
- **Baseline (Normal) & Comparison (Attack) Columns:**
  - Visual status borders (green for `ACCEPTED`, red for `REJECTED`, dashed for empty).
  - Column header with side type badge (`Baseline` vs `Comparison`), scenario label, and individual clear button.
  - Verdict banner contrasting reason codes and full explanatory narratives.
  - Four key metadata indicators:
    1. **Sender Verified** (`Yes` / `No`)
    2. **Spacecraft State** (`Committed update` / `Unchanged`)
    3. **Replay Stream** (`Advanced` / `Unchanged`)
    4. **Audit Persistence** (`Persisted in SQLite` / `Not persisted`)
  - **Protected State Transition:** Before vs After state snapshot preview.
  - **Validation Stage Chips:** 8 compact stage chips (`structure`, `identity`, `authentication`, `payload`, `time`, `permissions`, `replay`, `commit`) showing pass/fail/not-run status.
  - **Card Footer:** Persistent SQLite event ID, timestamp, and one-click **Inspect** button to view full decision modal.

### C. Detailed Analysis Tabs
Activated when both submissions are loaded:
1. **Changed Fields Diff (`tab === 'fields'`):**
   - Granular comparison across all message envelope keys (`version`, `message_id`, `message_type`, `sender_id`, `target_id`, `key_id`, `sequence`, `issued_at`, `expires_at`, `action`, `auth_tag`) plus deep payload properties (`mode`, `seconds`, etc.).
   - Security-sensitive fields (`auth_tag`, `sequence`, `action`, `sender_id`, `expires_at`) marked with warning tags.
   - Filter toggle between **Differences only** and **All fields**.
   - Clear message if messages are byte-identical.
2. **Validation Trace Diff (`tab === 'trace'`):**
   - Side-by-side row-by-row breakdown of all 8 validation stages.
   - Contrasts exact stage explanations and identifies the first failed stage for rejected payloads.
3. **Spacecraft State Diff (`tab === 'state'`):**
   - Contrasts the protected state before and after for both submissions: Operating mode, report interval, synthetic antenna status, and power level.
4. **Raw JSON Bytes (`tab === 'raw'`):**
   - Monospaced exact submitted bytes for both sides.
   - Copy exact bytes button with clipboard confirmation.

### D. Export Comparison Evidence
- **Export Comparison JSON:** Downloads `kavach-comparison.json` containing:
  - Synthetic comparison disclaimer.
  - ISO-8601 generation timestamp.
  - List of changed fields.
  - Complete Baseline and Comparison scenario labels, decisions, and raw submitted bytes.
  - First-failure analysis and state transition outcomes.

---

## 3. Files Modified & Added
- [`web/src/components/ComparisonView.tsx`](../web/src/components/ComparisonView.tsx): Redesigned comparison workspace component.
- [`web/src/comparison.css`](../web/src/comparison.css): Dedicated stylesheet implementing KAVACH aerospace styling tokens.
- [`web/src/main.tsx`](../web/src/main.tsx): Integrated full capture, swap, clear, inspect, and navigation callbacks with `ComparisonView`.
- [`docs/COMPARISON_PHASE5.md`](./COMPARISON_PHASE5.md): Phase 5 documentation.

---

## 4. Verification & Test Results
- **TypeScript & Vite Build:** `npm run build` completed with 0 errors.
- **Scenario Suite:** `python -m scripts.run_scenarios` $\rightarrow$ **31/31 PASSED**.
- **Acceptance Suite:** `python tests/acceptance_scenario.py` $\rightarrow$ **9/9 PASSED**.
- **Pytest Suite (Engine & API):** `pytest tests/test_engine.py tests/test_api.py -q` $\rightarrow$ **56/56 PASSED**.
- **Pytest Suite (Phase 4):** `pytest tests/test_phase4.py -q` $\rightarrow$ **25/25 PASSED**.
- **Backend & Production Bundle:** Verified live on `http://127.0.0.1:8000`.
