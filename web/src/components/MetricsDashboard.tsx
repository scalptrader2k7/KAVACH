import React, { useState, useMemo, useCallback } from 'react';
import {
  Activity,
  ShieldCheck,
  ShieldX,
  RotateCcw,
  Fingerprint,
  LockKeyhole,
  FlaskConical,
  AlertTriangle,
  BarChart3,
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Layers,
  Info,
  Clock,
  Radio,
  Satellite,
  CheckCheck,
} from 'lucide-react';
import type { Metrics, AnomalyReport } from '../types';
import { Badge, fmtTime } from './ui';
import '../metrics.css';

export type Page = 'console' | 'scenarios' | 'demo' | 'timeline' | 'compare' | 'metrics' | 'policy' | 'audit';

export interface MetricsDashboardProps {
  metrics: Metrics | null;
  anomalies: AnomalyReport | null;
  loading: boolean;
  onRefresh?: () => Promise<void> | void;
  onNavigate?: (page: Page) => void;
}

const STAGE_LABELS: Record<string, string> = {
  structure: '1. Structure & Envelope',
  identity: '2. Identity & Key Registry',
  authentication: '3. HMAC Authentication',
  payload: '4. Action & Payload Schema',
  time: '5. Lifetime & Freshness',
  permissions: '6. Role Authorization',
  replay: '7. Replay Stream Window',
  commit: '8. State Transition Commit',
};

export function MetricsDashboard({
  metrics,
  anomalies,
  loading,
  onRefresh,
  onNavigate,
}: MetricsDashboardProps) {
  const [showRules, setShowRules] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>(() => new Date().toLocaleTimeString());

  const handleRefresh = useCallback(async () => {
    if (onRefresh) {
      await onRefresh();
      setLastUpdated(new Date().toLocaleTimeString());
    }
  }, [onRefresh]);

  const handleExport = useCallback(() => {
    if (!metrics) return;
    const payload = {
      label: 'KAVACH Operations & Security Metrics — Local Simulation',
      exported_at: new Date().toISOString(),
      scope: metrics.scope,
      session_id: metrics.session_id,
      live_metrics: metrics.live,
      scenario_suites: metrics.scenario_suites,
      anomalies: anomalies
        ? {
            finding_count: anomalies.finding_count,
            findings: anomalies.findings,
            rules: anomalies.rules,
            disclaimer: anomalies.disclaimer,
          }
        : null,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `kavach-metrics-${metrics.session_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [metrics, anomalies]);

  // Loading state
  if (loading && !metrics) {
    return (
      <section className="metrics-workspace panel metrics-panel" aria-label="Security metrics">
        <div className="metrics-loading-state">
          <div className="metrics-state-icon">
            <Activity size={24} className="spin" />
          </div>
          <h3>Retrieving Persisted Metrics…</h3>
          <p>Compiling live verification counters and scenario benchmarks from local SQLite records.</p>
        </div>
      </section>
    );
  }

  // Error / Offline state
  if (!metrics) {
    return (
      <section className="metrics-workspace panel metrics-panel" aria-label="Security metrics">
        <div className="metrics-error-state">
          <div className="metrics-state-icon error">
            <AlertTriangle size={24} />
          </div>
          <h3>Metrics Unavailable</h3>
          <p>Unable to retrieve operational metrics. The local Python backend service may be offline or initializing.</p>
          {onRefresh && (
            <button className="metrics-action-btn primary" onClick={handleRefresh}>
              <RefreshCw size={13} />
              Retry Connection
            </button>
          )}
        </div>
      </section>
    );
  }

  const live = metrics.live;
  const suite = metrics.scenario_suites;

  // Relative max for bar charts
  const maxReason = Math.max(1, ...Object.values(live.rejection_reasons));
  const maxStage = Math.max(1, ...Object.values(live.first_failed_stages));

  // Acceptance & Rejection calculations
  const totalDecisions = live.messages_checked;
  const acceptedRateStr =
    live.acceptance_rate != null
      ? (live.acceptance_rate * 100).toFixed(1) + '%'
      : totalDecisions > 0
      ? ((live.accepted / totalDecisions) * 100).toFixed(1) + '%'
      : '0.0%';
  const rejectionRateStr =
    totalDecisions > 0 ? ((live.rejected / totalDecisions) * 100).toFixed(1) + '%' : '0.0%';

  const acceptedPct = totalDecisions > 0 ? (live.accepted / totalDecisions) * 100 : 0;
  const rejectedPct = totalDecisions > 0 ? (live.rejected / totalDecisions) * 100 : 0;
  const errorPct = totalDecisions > 0 ? (live.service_errors / totalDecisions) * 100 : 0;

  return (
    <section className="metrics-workspace panel metrics-panel" aria-label="Security metrics">
      {/* ==================== 1. HEADER PANEL ==================== */}
      <div className="metrics-header-panel">
        <div className="metrics-header-top">
          <div className="metrics-header-left">
            <div className="metrics-header-icon">
              <BarChart3 size={22} />
            </div>
            <div>
              <div className="metrics-title-row">
                <h2>Operations & Security Metrics</h2>
                <span className="metrics-scope-pill workstation-label">
                  <span className="metrics-scope-dot" />
                  {metrics.scope}
                </span>
                <Badge tone="neutral">Session: {metrics.session_id}</Badge>
              </div>
              <p className="metrics-header-desc">
                Derived directly from persistent SQLite audit records. Live command counters are strictly decoupled from
                isolated scenario-suite benchmarks.
              </p>
            </div>
          </div>

          <div className="metrics-header-actions">
            <span className="metrics-last-updated">
              <Clock size={11} />
              Updated {lastUpdated}
            </span>
            {onRefresh && (
              <button
                className="metrics-action-btn"
                onClick={handleRefresh}
                disabled={loading}
                title="Refresh metrics from backend"
              >
                <RefreshCw size={12} className={loading ? 'spin' : ''} />
                Refresh
              </button>
            )}
            <button className="metrics-action-btn" onClick={handleExport} title="Download metrics snapshot JSON">
              <Download size={12} />
              Export JSON
            </button>
          </div>
        </div>
      </div>

      {/* ==================== 2. EXECUTIVE KPI CARDS ==================== */}
      <div className="metrics-kpi-grid metric-cards">
        {/* Messages Checked */}
        <div className="kpi-card blue metric-card">
          <div className="kpi-top-row">
            <span className="kpi-label metric-label">Evaluated</span>
            <Activity size={16} className="kpi-icon" />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-value metric-value">{live.messages_checked}</span>
          </div>
          <span className="kpi-subtext">Total commands checked</span>
        </div>

        {/* Accepted */}
        <div className="kpi-card green metric-card green">
          <div className="kpi-top-row">
            <span className="kpi-label metric-label">Accepted</span>
            <ShieldCheck size={16} className="kpi-icon" />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-value metric-value">{live.accepted}</span>
            <span className="kpi-rate-tag green">{acceptedRateStr}</span>
          </div>
          <span className="kpi-subtext">Passed 8/8 stages</span>
        </div>

        {/* Rejected */}
        <div className="kpi-card red metric-card red">
          <div className="kpi-top-row">
            <span className="kpi-label metric-label">Rejected</span>
            <ShieldX size={16} className="kpi-icon" />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-value metric-value">{live.rejected}</span>
            <span className="kpi-rate-tag red">{rejectionRateStr}</span>
          </div>
          <span className="kpi-subtext">Halted before state commit</span>
        </div>

        {/* Replay Protection */}
        <div className="kpi-card amber metric-card amber">
          <div className="kpi-top-row">
            <span className="kpi-label metric-label">Replay Events</span>
            <RotateCcw size={16} className="kpi-icon" />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-value metric-value">{live.replay_attempts_detected}</span>
            {live.out_of_order_rejected > 0 && (
              <span className="kpi-rate-tag" title="Out of order sequence rejections">
                +{live.out_of_order_rejected} order
              </span>
            )}
          </div>
          <span className="kpi-subtext">Stream window duplicates</span>
        </div>

        {/* Cryptographic Failures */}
        <div className="kpi-card red metric-card red">
          <div className="kpi-top-row">
            <span className="kpi-label metric-label">Auth Failures</span>
            <Fingerprint size={16} className="kpi-icon" />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-value metric-value">{live.authentication_failures}</span>
          </div>
          <span className="kpi-subtext">HMAC tag mismatches</span>
        </div>

        {/* Authorization Denials */}
        <div className="kpi-card red metric-card red">
          <div className="kpi-top-row">
            <span className="kpi-label metric-label">Policy Denials</span>
            <LockKeyhole size={16} className="kpi-icon" />
          </div>
          <div className="kpi-val-row">
            <span className="kpi-value metric-value">{live.authorisation_denials}</span>
          </div>
          <span className="kpi-subtext">Role boundary violations</span>
        </div>
      </div>

      {/* ==================== 3. OUTCOME PROPORTION METER ==================== */}
      <div className="metrics-outcome-meter-panel">
        <div className="outcome-meter-header">
          <span className="outcome-meter-title">
            <Layers size={13} />
            Command Validation Outcome Distribution
          </span>
          <span>
            {totalDecisions > 0
              ? `${totalDecisions} total decision${totalDecisions === 1 ? '' : 's'} recorded`
              : 'Awaiting first evaluation'}
          </span>
        </div>

        <div className="outcome-meter-bar">
          {totalDecisions > 0 ? (
            <>
              {acceptedPct > 0 && (
                <div
                  className="meter-seg accepted"
                  style={{ width: `${acceptedPct}%` }}
                  title={`Accepted: ${live.accepted} (${acceptedPct.toFixed(1)}%)`}
                />
              )}
              {rejectedPct > 0 && (
                <div
                  className="meter-seg rejected"
                  style={{ width: `${rejectedPct}%` }}
                  title={`Rejected: ${live.rejected} (${rejectedPct.toFixed(1)}%)`}
                />
              )}
              {errorPct > 0 && (
                <div
                  className="meter-seg error"
                  style={{ width: `${errorPct}%` }}
                  title={`Service Errors: ${live.service_errors} (${errorPct.toFixed(1)}%)`}
                />
              )}
            </>
          ) : (
            <div className="meter-seg empty" title="No decisions evaluated yet in current session" />
          )}
        </div>

        <div className="outcome-meter-legend">
          <div className="meter-legend-item">
            <span className="meter-dot accepted" />
            <span>Accepted:</span>
            <strong>{live.accepted}</strong>
            <small>({acceptedRateStr})</small>
          </div>
          <div className="meter-legend-item">
            <span className="meter-dot rejected" />
            <span>Rejected:</span>
            <strong>{live.rejected}</strong>
            <small>({rejectionRateStr})</small>
          </div>
          <div className="meter-legend-item">
            <span className="meter-dot error" />
            <span>Service Errors:</span>
            <strong>{live.service_errors}</strong>
          </div>
        </div>
      </div>

      {/* ==================== 4. REJECTION & STAGE ANALYTICS GRID ==================== */}
      <div className="metrics-analysis-grid metrics-columns">
        {/* Rejection Reasons */}
        <div className="analytics-card metric-block">
          <div className="analytics-card-header">
            <div className="analytics-header-title">
              <ShieldX size={15} style={{ color: '#f2777b' }} />
              <h3>Rejection Reasons</h3>
            </div>
            <Badge tone="red">{Object.keys(live.rejection_reasons).length} active codes</Badge>
          </div>

          <div className="analytics-card-body">
            {Object.keys(live.rejection_reasons).length > 0 ? (
              Object.entries(live.rejection_reasons)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, count]) => {
                  const pct = totalDecisions > 0 ? ((count / totalDecisions) * 100).toFixed(1) : '0';
                  return (
                    <div
                      key={reason}
                      className="analytics-bar-row bar-row clickable"
                      onClick={() => onNavigate && onNavigate('timeline')}
                      title={`Filter ${reason} in Attack Timeline`}
                    >
                      <span className="analytics-bar-label bar-label mono">{reason}</span>
                      <div className="analytics-bar-track bar-track">
                        <div
                          className="analytics-bar-fill bar-fill red"
                          style={{ width: `${(count / maxReason) * 100}%` }}
                        />
                      </div>
                      <span className="analytics-bar-count bar-value">
                        {count} <small>({pct}%)</small>
                      </span>
                    </div>
                  );
                })
            ) : (
              <div className="analytics-empty-message">
                <ShieldCheck size={26} strokeWidth={1.5} style={{ color: '#5ec269' }} />
                <p className="metric-none">No command rejections recorded in this session yet.</p>
                <small>Submitted messages have satisfied all 8 verification stages.</small>
              </div>
            )}
          </div>
        </div>

        {/* First Failed Validation Stage */}
        <div className="analytics-card metric-block">
          <div className="analytics-card-header">
            <div className="analytics-header-title">
              <Layers size={15} style={{ color: '#f0b429' }} />
              <h3>First Failed Validation Stage</h3>
            </div>
            <Badge tone="amber">{Object.keys(live.first_failed_stages).length} stages failed</Badge>
          </div>

          <div className="analytics-card-body">
            {Object.keys(live.first_failed_stages).length > 0 ? (
              Object.entries(live.first_failed_stages)
                .sort((a, b) => b[1] - a[1])
                .map(([stage, count]) => {
                  const pct = totalDecisions > 0 ? ((count / totalDecisions) * 100).toFixed(1) : '0';
                  return (
                    <div
                      key={stage}
                      className="analytics-bar-row bar-row clickable"
                      onClick={() => onNavigate && onNavigate('timeline')}
                      title={`Inspect stage failures in Attack Timeline`}
                    >
                      <span className="analytics-bar-label bar-label">{STAGE_LABELS[stage] ?? stage}</span>
                      <div className="analytics-bar-track bar-track">
                        <div
                          className="analytics-bar-fill bar-fill amber"
                          style={{ width: `${(count / maxStage) * 100}%` }}
                        />
                      </div>
                      <span className="analytics-bar-count bar-value">
                        {count} <small>({pct}%)</small>
                      </span>
                    </div>
                  );
                })
            ) : (
              <div className="analytics-empty-message">
                <CheckCircle2 size={26} strokeWidth={1.5} style={{ color: '#5ec269' }} />
                <p className="metric-none">No validation stage has halted in this session yet.</p>
                <small>Every evaluated command completed the full validation pipeline.</small>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ==================== 5. COMPLETE REASON CODE REGISTRY ==================== */}
      <div className="analytics-card metric-block">
        <div className="analytics-card-header">
          <div className="analytics-header-title">
            <Radio size={15} style={{ color: '#347de5' }} />
            <h3>Reason-Code Distribution Registry</h3>
          </div>
          <span className="metrics-last-updated">
            Total outcomes: <strong>{totalDecisions}</strong>
          </span>
        </div>

        <div className="analytics-card-body">
          {Object.keys(live.reason_code_breakdown).length > 0 ? (
            <div className="reason-registry-grid code-grid">
              {Object.entries(live.reason_code_breakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([code, count]) => {
                  const isOk = code === 'OK';
                  const pct = totalDecisions > 0 ? ((count / totalDecisions) * 100).toFixed(1) : '0';
                  return (
                    <div key={code} className={`registry-cell ${isOk ? 'ok' : ''}`}>
                      <code>{code}</code>
                      <strong>
                        {count} <small>({pct}%)</small>
                      </strong>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="metric-none" style={{ margin: 0 }}>
              No messages have been evaluated to establish a reason-code distribution yet.
            </p>
          )}
        </div>
      </div>

      {/* ==================== 6. ISOLATED SCENARIO SUITES ==================== */}
      <div className="scenario-suites-section">
        <div className="suites-header">
          <div className="suites-title-group">
            <h3>
              <FlaskConical size={16} />
              Isolated Scenario Benchmark Suites
            </h3>
            <span className="isolation-badge">ISOLATED NAMESPACE</span>
          </div>
          {onNavigate && (
            <button className="metrics-action-btn sm" onClick={() => onNavigate('scenarios')}>
              Open Scenario Lab
              <ExternalLink size={12} />
            </button>
          )}
        </div>

        <p className="suites-desc metric-note">
          {suite.note ||
            'Executes in an isolated session namespace with synthetic time injections. Benchmarks are never commingled into the live operational telemetry above.'}
        </p>

        <div className="suites-kpi-row metric-cards compact">
          <div className="suite-kpi-box metric-card">
            <span className="suite-kpi-label metric-label">Suite Runs</span>
            <span className="suite-kpi-val metric-value">{suite.runs}</span>
          </div>
          <div className="suite-kpi-box metric-card">
            <span className="suite-kpi-label metric-label">Cases Executed</span>
            <span className="suite-kpi-val metric-value">{suite.cases_executed}</span>
          </div>
          <div className="suite-kpi-box metric-card">
            <span className="suite-kpi-label metric-label">Cases Passed</span>
            <span className="suite-kpi-val green metric-value">{suite.cases_passed}</span>
          </div>
          <div className="suite-kpi-box metric-card">
            <span className="suite-kpi-label metric-label">Cases Failed</span>
            <span
              className={`suite-kpi-val ${suite.cases_failed > 0 ? 'red' : 'green'} metric-value`}
            >
              {suite.cases_failed}
            </span>
          </div>
        </div>

        <div className="suite-integrity-banner integrity-flag">
          <span>Protected-State Integrity Violations Reported by Suites</span>
          <Badge tone={suite.protected_state_integrity_violations ? 'red' : 'green'}>
            {suite.protected_state_integrity_violations === 0
              ? '0 Violations (Integrity Verified)'
              : `${suite.protected_state_integrity_violations} Violations Detected`}
          </Badge>
        </div>
      </div>

      {/* ==================== 7. ANOMALY DETECTION PANEL ==================== */}
      {anomalies && (
        <div className="anomalies-section metric-block anomaly-block">
          <div className="anomalies-header">
            <div className="anomalies-title-group">
              <h3>
                <AlertTriangle size={16} style={{ color: '#f0b429' }} />
                Synthetic Telemetry Anomaly Detection
              </h3>
              <Badge tone={anomalies.finding_count > 0 ? 'amber' : 'green'}>
                {anomalies.finding_count} {anomalies.finding_count === 1 ? 'Finding' : 'Findings'}
              </Badge>
            </div>
            {onNavigate && (
              <button className="metrics-action-btn sm" onClick={() => onNavigate('timeline')}>
                Inspect in Timeline
                <ExternalLink size={12} />
              </button>
            )}
          </div>

          <p className="anomalies-disclaimer-text metric-note">{anomalies.disclaimer}</p>

          {anomalies.finding_count > 0 ? (
            <div className="anomalies-list anomaly-list">
              {anomalies.findings.map((f, i) => (
                <div key={i} className="anomaly-finding-item anomaly-row">
                  <div className="anomaly-finding-left">
                    <Badge tone="amber">{f.rule}</Badge>
                    <span className="anomaly-desc">{f.detail}</span>
                  </div>
                  <code className="anomaly-event-ref">
                    {f.event_id ? f.event_id.slice(0, 8) + '…' : '—'}
                  </code>
                </div>
              ))}
            </div>
          ) : (
            <div className="anomaly-clean-state">
              <CheckCheck size={16} />
              <span>No anomaly rules fired on the accepted telemetry in this session.</span>
            </div>
          )}

          {/* Anomaly Rules Engine Reference Drawer */}
          {anomalies.rules && anomalies.rules.length > 0 && (
            <div className="anomaly-rules-drawer">
              <button
                className="rules-toggle-btn"
                onClick={() => setShowRules(!showRules)}
                aria-expanded={showRules}
              >
                {showRules ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>
                  {showRules ? 'Hide' : 'View'} rule detection boundaries ({anomalies.rules.length} rules)
                </span>
              </button>

              {showRules && (
                <div className="rules-definitions-grid">
                  {anomalies.rules.map((r) => (
                    <div key={r.rule} className="rule-def-card">
                      <div className="rule-def-header">
                        <span className="rule-def-name">{r.rule}</span>
                      </div>
                      <p>{r.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
