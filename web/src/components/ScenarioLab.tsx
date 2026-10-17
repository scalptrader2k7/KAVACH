import React, {useState, useMemo} from 'react';
import {
  FlaskConical, CheckCircle2, CircleX, CircleDot, Play, ArrowRight,
  ArrowUpRight, Shield, Fingerprint, LockKeyhole, RotateCcw, Clock3,
  Code2, SlidersHorizontal, Radio, Search, Filter, Download, LoaderCircle,
  Check, X, Info, ChevronDown, ChevronRight, AlertTriangle, Layers,
  Terminal, Sparkles, Database, CheckCheck
} from 'lucide-react';
import type {Decision, ScenarioReport, ScenarioResult} from '../types';
import {Badge, fmtTime} from './ui';

export interface ScenarioItem {
  id: string;
  name: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  expected: string;
  tone: string;
  intent: string;
  threat: string;
  changed: string;
}

export interface ScenarioLabProps {
  scenarios: ScenarioItem[];
  busy: string;
  online: boolean;
  report: ScenarioReport | null;
  error: string;
  decision: Decision | null;
  onLoad: (id: string) => void;
  onRunSuite: () => void;
  onInspect: (decision: Decision) => void;
  onExport: () => void;
}

const CATEGORIES = [
  { id: 'ALL', label: 'All Scenarios' },
  { id: 'AUTH', label: 'Auth & Identity' },
  { id: 'PAYLOAD', label: 'Structure & Payload' },
  { id: 'REPLAY', label: 'Time & Replay' },
  { id: 'PERMS', label: 'Permissions' },
  { id: 'BASELINE', label: 'Baseline & Telemetry' },
] as const;

function getScenarioCategory(id: string): string {
  switch (id) {
    case 'tampered':
    case 'unknown_key':
    case 'bad_tag':
      return 'AUTH';
    case 'malformed':
    case 'invalid':
      return 'PAYLOAD';
    case 'replay':
    case 'expired':
    case 'future':
      return 'REPLAY';
    case 'unauthorised':
      return 'PERMS';
    case 'valid':
    case 'telemetry':
      return 'BASELINE';
    default:
      return 'ALL';
  }
}

const SCENARIO_STAGES: Record<string, { stage: string; label: string; index: number }> = {
  valid: { stage: 'commit', label: 'Stage 8: State commit', index: 8 },
  tampered: { stage: 'authentication', label: 'Stage 3: HMAC authentication', index: 3 },
  unknown_key: { stage: 'identity', label: 'Stage 2: Sender identity', index: 2 },
  bad_tag: { stage: 'authentication', label: 'Stage 3: HMAC authentication', index: 3 },
  malformed: { stage: 'structure', label: 'Stage 1: Message structure', index: 1 },
  replay: { stage: 'replay', label: 'Stage 7: Replay protection', index: 7 },
  expired: { stage: 'time', label: 'Stage 5: Timestamp validity', index: 5 },
  future: { stage: 'time', label: 'Stage 5: Timestamp validity', index: 5 },
  unauthorised: { stage: 'permissions', label: 'Stage 6: Sender permissions', index: 6 },
  invalid: { stage: 'payload', label: 'Stage 4: Payload & target', index: 4 },
  telemetry: { stage: 'commit', label: 'Stage 8: State commit', index: 8 },
};

export function ScenarioLab({
  scenarios,
  busy,
  online,
  report,
  error,
  decision,
  onLoad,
  onRunSuite,
  onInspect,
  onExport,
}: ScenarioLabProps) {
  const [selectedId, setSelectedId] = useState<string>(scenarios[0]?.id ?? 'valid');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [presetSearch, setPresetSearch] = useState<string>('');
  const [suiteFilter, setSuiteFilter] = useState<'ALL' | 'PASSED' | 'FAILED'>('ALL');
  const [suiteSearch, setSuiteSearch] = useState<string>('');

  const activeScenario = useMemo(() => {
    return scenarios.find(s => s.id === selectedId) ?? scenarios[0];
  }, [scenarios, selectedId]);

  const filteredScenarios = useMemo(() => {
    return scenarios.filter(s => {
      const catMatch = categoryFilter === 'ALL' || getScenarioCategory(s.id) === categoryFilter;
      const q = presetSearch.trim().toLowerCase();
      const textMatch = !q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || s.expected.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
      return catMatch && textMatch;
    });
  }, [scenarios, categoryFilter, presetSearch]);

  const suiteResults = useMemo(() => {
    if (!report?.results) return [];
    return report.results.filter(r => {
      const statusMatch =
        suiteFilter === 'ALL' ||
        (suiteFilter === 'PASSED' && r.passed) ||
        (suiteFilter === 'FAILED' && !r.passed);
      const q = suiteSearch.trim().toLowerCase();
      const textMatch =
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.expected.toLowerCase().includes(q) ||
        r.observed.toLowerCase().includes(q) ||
        (r.note && r.note.toLowerCase().includes(q));
      return statusMatch && textMatch;
    });
  }, [report, suiteFilter, suiteSearch]);

  const activeStage = activeScenario ? SCENARIO_STAGES[activeScenario.id] : null;

  // Derive execution matching: check if decision matches the active scenario
  const isDecisionMatching = useMemo(() => {
    if (!decision || !activeScenario) return false;
    if (activeScenario.id === 'telemetry') {
      return decision.message?.message_type === 'TELEMETRY';
    }
    if (activeScenario.id === 'unauthorised') {
      return decision.message?.sender_id === 'observer-01' && decision.reason_code === 'NOT_AUTHORISED';
    }
    if (activeScenario.id === 'invalid') {
      return decision.message?.action === 'SET_REPORT_INTERVAL' && decision.reason_code === 'PAYLOAD_INVALID';
    }
    return decision.reason_code === activeScenario.expected;
  }, [decision, activeScenario]);

  const isSuiteRunning = busy === 'suite';
  const totalInvariantsCount = report?.total ?? 31;

  return (
    <div className="scenario-lab-workspace" aria-label="Scenario Lab Workspace">
      {/* ===== SECTION 1: LAB OVERVIEW BANNER ===== */}
      <section className="lab-overview-banner panel">
        <div className="banner-left">
          <div className="banner-icon-badge">
            <FlaskConical size={22} className="banner-icon" />
          </div>
          <div>
            <div className="banner-title-row">
              <h2>Scenario Lab</h2>
              <span className="count-pill">{scenarios.length} Interactive Presets</span>
              <span className="count-pill">{totalInvariantsCount} Automated Invariants</span>
            </div>
            <p className="banner-desc">
              Comprehensive testbed for satellite command validation. Evaluate real-time signature integrity,
              authorisation constraints, replay defenses, and execute isolated multi-invariant test suites.
            </p>
          </div>
        </div>

        <div className="banner-right">
          <button
            type="button"
            className="btn primary run-suite-btn"
            onClick={onRunSuite}
            disabled={isSuiteRunning || !online}
            title="Execute all 31 security invariants in an isolated runtime"
          >
            {isSuiteRunning ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}
            Run full test suite
          </button>
          {report && (
            <button
              type="button"
              className="btn secondary export-btn"
              onClick={onExport}
              disabled={isSuiteRunning}
              title="Download full verification suite report as JSON"
            >
              <Download size={14} />
              Export suite report
            </button>
          )}
        </div>
      </section>

      {error && (
        <div className="suite-error-banner" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button type="button" className="btn secondary small-btn" onClick={onRunSuite}>
            Retry suite
          </button>
        </div>
      )}

      {/* ===== SECTION 2: INTERACTIVE SCENARIOS WORKBENCH ===== */}
      <div className="scenario-grid-container">
        {/* Left column: Inventory & filters */}
        <section className="panel scenario-inventory-panel" aria-label="Scenario Inventory">
          <div className="panel-heading">
            <div className="panel-title">
              <Layers size={16} />
              <h2>Scenario Inventory</h2>
              <span className="inventory-count-badge">{filteredScenarios.length} of {scenarios.length}</span>
            </div>
            <span className="workstation-label">Interactive</span>
          </div>

          <div className="inventory-controls">
            <div className="filter-search-wrap">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Search scenarios by name, intent, or outcome…"
                value={presetSearch}
                onChange={e => setPresetSearch(e.target.value)}
                aria-label="Search scenarios"
              />
              {presetSearch && (
                <button
                  type="button"
                  className="clear-search-btn"
                  onClick={() => setPresetSearch('')}
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="category-pills" role="tablist" aria-label="Scenario Categories">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={categoryFilter === cat.id}
                  className={`category-pill ${categoryFilter === cat.id ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="scenario-card-list" role="listbox" aria-label="Available Scenarios">
            {filteredScenarios.length === 0 ? (
              <div className="no-scenarios-found">
                <Search size={20} />
                <p>No scenarios match &ldquo;{presetSearch}&rdquo;</p>
                <button
                  type="button"
                  className="btn secondary small-btn"
                  onClick={() => {
                    setCategoryFilter('ALL');
                    setPresetSearch('');
                  }}
                >
                  Reset filters
                </button>
              </div>
            ) : (
              filteredScenarios.map(s => {
                const Icon = s.icon;
                const isSelected = s.id === activeScenario?.id;
                const stageInfo = SCENARIO_STAGES[s.id];

                return (
                  <div
                    key={s.id}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    className={`scenario-item-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedId(s.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(s.id);
                      }
                    }}
                  >
                    <div className="scenario-item-icon">
                      <Icon size={16} />
                    </div>

                    <div className="scenario-item-info">
                      <div className="scenario-item-head">
                        <strong className="scenario-name">{s.name}</strong>
                        <Badge tone={s.tone}>{s.expected}</Badge>
                      </div>
                      <p className="scenario-desc">{s.desc}</p>
                      <div className="scenario-item-meta">
                        <span className="stage-tag">
                          {stageInfo ? stageInfo.label : 'Validation'}
                        </span>
                        <span className="scenario-id-tag">#{s.id}</span>
                      </div>
                    </div>

                    <ChevronRight size={14} className="select-arrow" />
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right column: Scenario Details & Inspector */}
        <section className="panel scenario-details-panel" aria-label="Scenario Details & Action">
          <div className="panel-heading">
            <div className="panel-title">
              <Shield size={16} />
              <h2>Scenario Details</h2>
              {activeScenario && <span className="active-id-badge">#{activeScenario.id}</span>}
            </div>
            <span className="workstation-label">Inspection</span>
          </div>

          {activeScenario ? (
            <div className="details-body">
              <div className="details-header-card">
                <div className="details-header-icon">
                  <activeScenario.icon size={22} />
                </div>
                <div className="details-header-text">
                  <h3>{activeScenario.name}</h3>
                  <p>{activeScenario.desc}</p>
                </div>
              </div>

              {/* Specification vs Reality grid */}
              <div className="verdict-comparison-grid">
                <div className="outcome-card expected">
                  <span className="outcome-label">EXPECTED RESULT</span>
                  <div className="outcome-badge-wrap">
                    <Badge tone={activeScenario.tone}>{activeScenario.expected}</Badge>
                  </div>
                  <span className="outcome-caption">Preset simulator specification</span>
                </div>

                <div className="outcome-card observed">
                  <span className="outcome-label">OBSERVED RESULT</span>
                  <div className="outcome-badge-wrap">
                    {isDecisionMatching && decision ? (
                      <Badge tone={decision.verdict === 'ACCEPTED' ? 'green' : 'red'}>
                        {decision.verdict === 'ACCEPTED' ? 'ACCEPTED' : decision.reason_code}
                      </Badge>
                    ) : (
                      <span className="status-badge not-run">
                        <CircleDot size={12} /> Not submitted yet
                      </span>
                    )}
                  </div>
                  <span className="outcome-caption">
                    {isDecisionMatching && decision
                      ? `Observed: ${decision.verdict} (${decision.reason_code})`
                      : 'Load & submit in console to observe'}
                  </span>
                </div>
              </div>

              {/* Key Validation Stage */}
              {activeStage && (
                <div className="stage-focus-box">
                  <span className="focus-label">PRIMARY VALIDATION STAGE</span>
                  <div className="focus-row">
                    <span className="stage-number">{activeStage.index}</span>
                    <span className="stage-name">{activeStage.label}</span>
                    <span className="stage-badge">Target Stage</span>
                  </div>
                </div>
              )}

              {/* Analysis dl */}
              <dl className="analysis-facts">
                <div className="fact-item">
                  <dt>
                    <CrosshairIcon size={13} />
                    Attack Intent
                  </dt>
                  <dd>{activeScenario.intent}</dd>
                </div>
                <div className="fact-item">
                  <dt>
                    <SlidersHorizontal size={13} />
                    What is Changed
                  </dt>
                  <dd>{activeScenario.changed}</dd>
                </div>
                <div className="fact-item">
                  <dt>
                    <AlertTriangle size={13} />
                    Security Rationale
                  </dt>
                  <dd>{activeScenario.threat}</dd>
                </div>
              </dl>

              {/* Action Box */}
              <div className="details-action-box">
                <div className="action-guidance">
                  <Terminal size={14} />
                  <span>
                    Loads this signed fixture into the Mission Console builder. The exact bytes can be inspected or submitted to observe the live decision trace.
                  </span>
                </div>

                <div className="action-buttons-row">
                  <button
                    type="button"
                    className="btn primary load-console-btn"
                    onClick={() => onLoad(activeScenario.id)}
                    title={`Open ${activeScenario.name} in Mission Console`}
                  >
                    <Play size={14} />
                    Load into Mission Console
                    <ArrowUpRight size={14} />
                  </button>

                  {isDecisionMatching && decision && (
                    <button
                      type="button"
                      className="btn secondary inspect-decision-btn"
                      onClick={() => onInspect(decision)}
                      title="Inspect full recorded validation decision"
                    >
                      <Info size={14} />
                      Inspect decision
                    </button>
                  )}
                </div>
              </div>

              {/* Observed Decision Card (if matches) */}
              {isDecisionMatching && decision && (
                <div className="matching-decision-card">
                  <div className="decision-card-head">
                    <CheckCheck size={14} className="green" />
                    <strong>Current Active Decision Matches</strong>
                    <span className="mono event-id">{decision.event_id || 'unpersisted'}</span>
                  </div>
                  <p className="decision-explanation">{decision.explanation}</p>
                  <div className="decision-meta-row">
                    <span>
                      State: {decision.state_changed ? 'Committed update' : 'Unchanged'}
                    </span>
                    <span>
                      Replay advanced: {decision.replay_state_advanced ? 'Yes' : 'No'}
                    </span>
                    <span>
                      Sender verified: {decision.sender_verified ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="no-selection-placeholder">
              <p>Select a scenario from the inventory to inspect its parameters.</p>
            </div>
          )}
        </section>
      </div>

      {/* ===== SECTION 3: AUTOMATED VERIFICATION SUITE ===== */}
      <section className="panel automated-suite-panel" aria-label="Automated Verification Suite">
        <div className="panel-heading">
          <div className="panel-title">
            <FlaskConical size={16} />
            <h2>Full Receiver Verification Suite</h2>
            <span className="count-pill">{totalInvariantsCount} Cases</span>
          </div>
          <div className="heading-actions-right">
            <button
              type="button"
              className="btn primary run-suite-btn"
              onClick={onRunSuite}
              disabled={isSuiteRunning || !online}
              title="Execute all 31 security invariants"
            >
              {isSuiteRunning ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
              Run full test suite
            </button>
            {report && (
              <button
                type="button"
                className="btn secondary export-btn"
                onClick={onExport}
                disabled={isSuiteRunning}
                title="Download scenario report as JSON"
              >
                <Download size={14} />
                Export JSON
              </button>
            )}
          </div>
        </div>

        <div className="suite-body">
          <div className="suite-intro-bar">
            <p className="suite-intro-text">
              The full receiver verification suite exercises 31 rigorous security invariants against an isolated SQLite test database.
              Covers strict schema bounds, duplicate JSON keys, clock skew boundaries, thread synchronization barriers,
              database rollback fault injections, and restart persistence.
            </p>
            <div className="suite-isolation-pill">
              <Shield size={12} />
              <span>Isolated test namespace · Mission session unchanged</span>
            </div>
          </div>

          {/* Suite Scoreboard */}
          <div className="suite-scoreboard">
            <div className="scoreboard-card score-main">
              <span className="card-label">SUITE VERDICT</span>
              <div className="suite-score">
                {report ? `${report.passed} / ${report.total}` : `${totalInvariantsCount}`}
              </div>
              <span className="score-subtitle">
                {report
                  ? report.passed === report.total
                    ? 'All security invariants passed'
                    : `${report.total - report.passed} invariants failed`
                  : '31 Invariants Ready to Run'}
              </span>
            </div>

            <div className="scoreboard-card">
              <span className="card-label">PASSED</span>
              <div className="metric-val green">{report ? report.passed : '—'}</div>
              <span className="metric-sub">Passing invariants</span>
            </div>

            <div className="scoreboard-card">
              <span className="card-label">FAILED</span>
              <div className="metric-val red">{report ? report.total - report.passed : '—'}</div>
              <span className="metric-sub">Violations detected</span>
            </div>

            <div className="scoreboard-card">
              <span className="card-label">SKIPPED</span>
              <div className="metric-val muted">0</div>
              <span className="metric-sub">Zero skipped checks</span>
            </div>

            <div className="scoreboard-card">
              <span className="card-label">STATE INTEGRITY</span>
              <div className="metric-val blue">
                {report ? (report.results.every(r => r.state_preserved) ? '100%' : 'Failed') : '—'}
              </div>
              <span className="metric-sub">Protected state invariant</span>
            </div>
          </div>

          {/* Running State */}
          {isSuiteRunning && (
            <div className="suite-running-indicator" role="status" aria-live="polite">
              <LoaderCircle size={22} className="spin" />
              <div>
                <strong>Executing verification suite…</strong>
                <p>Running 31 checks against isolated temporary database.</p>
              </div>
            </div>
          )}

          {/* Report Results */}
          {report ? (
            <div className="suite-results-container">
              <div className="suite-results-toolbar">
                <div className="suite-filter-tabs" role="tablist" aria-label="Suite Result Filters">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={suiteFilter === 'ALL'}
                    className={`suite-tab ${suiteFilter === 'ALL' ? 'active' : ''}`}
                    onClick={() => setSuiteFilter('ALL')}
                  >
                    All ({report.total})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={suiteFilter === 'PASSED'}
                    className={`suite-tab ${suiteFilter === 'PASSED' ? 'active' : ''}`}
                    onClick={() => setSuiteFilter('PASSED')}
                  >
                    Passed ({report.passed})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={suiteFilter === 'FAILED'}
                    className={`suite-tab ${suiteFilter === 'FAILED' ? 'active' : ''}`}
                    onClick={() => setSuiteFilter('FAILED')}
                  >
                    Failed ({report.total - report.passed})
                  </button>
                </div>

                <div className="suite-search-wrap">
                  <Search size={13} />
                  <input
                    type="text"
                    placeholder="Filter suite cases…"
                    value={suiteSearch}
                    onChange={e => setSuiteSearch(e.target.value)}
                    aria-label="Filter suite cases"
                  />
                  {suiteSearch && (
                    <button
                      type="button"
                      className="clear-search-btn"
                      onClick={() => setSuiteSearch('')}
                      aria-label="Clear filter"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              <div className="suite-case-list" role="list" aria-label="Suite Test Cases">
                {suiteResults.length === 0 ? (
                  <div className="no-cases-found">
                    <p>No test cases match your filter criteria.</p>
                  </div>
                ) : (
                  suiteResults.map((c: ScenarioResult, idx: number) => {
                    const isPassed = c.passed;
                    const stageCount = c.result?.checks?.filter(k => k.status === 'PASS').length ?? 0;

                    return (
                      <div
                        key={c.name + idx}
                        className={`test-row ${isPassed ? 'passed' : 'failed'}`}
                        role="listitem"
                      >
                        <div className="test-row-main">
                          <div className="test-status-col">
                            <span className={`case-verdict-pill ${isPassed ? 'pass' : 'fail'}`}>
                              {isPassed ? <CheckCircle2 size={13} /> : <CircleX size={13} />}
                              {isPassed ? 'PASS' : 'FAIL'}
                            </span>
                          </div>

                          <div className="test-info-col">
                            <div className="test-title-row">
                              <strong className="case-name">{c.name}</strong>
                              <span className="case-index-label">#{idx + 1}</span>
                            </div>

                            {c.note && <p className="case-note">{c.note}</p>}

                            <div className="case-outcomes-row">
                              <span className="outcome-pill">
                                Expected: <code>{c.expected}</code>
                              </span>
                              <ArrowRight size={11} className="outcome-arrow" />
                              <span className="outcome-pill">
                                Observed: <code className={isPassed ? 'green' : 'red'}>{c.observed}</code>
                              </span>
                              <span className={`state-integrity-tag ${c.state_preserved ? 'preserved' : 'altered'}`}>
                                {c.state_preserved ? 'State preserved' : 'State altered'}
                              </span>
                              {c.event_id && (
                                <span className="event-tag mono">
                                  {c.event_id.slice(0, 8)}…
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="test-actions-col">
                            {c.result && (
                              <button
                                type="button"
                                className="btn secondary small-btn inspect-trace-btn"
                                onClick={() => onInspect(c.result)}
                                title="Inspect decision trace and stage details"
                              >
                                Inspect trace
                                <ArrowUpRight size={12} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Expandable validation trace disclosure */}
                        {c.result?.checks && c.result.checks.length > 0 && (
                          <details className="case-trace-disclosure">
                            <summary>
                              <span>Validation stages ({stageCount}/8 passed)</span>
                              <ChevronDown size={12} />
                            </summary>
                            <div className="trace-stages-grid">
                              {c.result.checks.map(chk => (
                                <div key={chk.stage} className={`trace-stage-cell ${chk.status.toLowerCase()}`}>
                                  <span className="stage-check-icon">
                                    {chk.status === 'PASS' ? (
                                      <Check size={11} />
                                    ) : chk.status === 'FAIL' ? (
                                      <X size={11} />
                                    ) : (
                                      <CircleDot size={11} />
                                    )}
                                  </span>
                                  <span className="stage-cell-label">{chk.label}</span>
                                  <span className="stage-cell-status">{chk.status}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="suite-footer-meta">
                <span>Clock: {report.clock}</span>
                <span>·</span>
                <span>Executed: {fmtTime(report.executed_at)}</span>
                <span>·</span>
                <span>Suite ID: <code className="mono">{report.suite_id.slice(0, 13)}…</code></span>
                <span>·</span>
                <span>Isolated session: <code className="mono">{report.session_id}</code></span>
              </div>
            </div>
          ) : (
            <div className="suite-empty-state">
              <FlaskConical size={32} strokeWidth={1.25} className="empty-flask-icon" />
              <h3>Suite Ready for Execution</h3>
              <p>
                Run the 31-case verification suite to validate that every security boundary, parser invariant,
                and database rollback operates as specified. No application data or active mission state will be altered.
              </p>
              <button
                type="button"
                className="btn primary run-suite-btn"
                onClick={onRunSuite}
                disabled={isSuiteRunning || !online}
              >
                {isSuiteRunning ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}
                Run full test suite
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CrosshairIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="22" y1="12" x2="18" y2="12" />
      <line x1="6" y1="12" x2="2" y2="12" />
      <line x1="12" y1="6" x2="12" y2="2" />
      <line x1="12" y1="22" x2="12" y2="18" />
    </svg>
  );
}

