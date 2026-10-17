import React, { useState, useMemo, useCallback } from 'react';
import {
  FileDiff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  ShieldAlert,
  Database,
  Download,
  ArrowRight,
  ArrowLeftRight,
  Copy,
  Check,
  RotateCcw,
  SlidersHorizontal,
  Layers,
  Radio,
  Satellite,
  Code2,
  Info,
  ExternalLink,
  Trash2,
  Fingerprint,
  Clock,
  Activity,
  CheckCheck,
  Maximize2,
  ChevronRight,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { Decision, ValidationCheck, Stage } from '../types';
import { Badge, fmtTime } from './ui';
import '../comparison.css';

export interface Side {
  label: string;
  result: Decision | null;
  raw: string;
}

export type Page = 'console' | 'scenarios' | 'demo' | 'timeline' | 'compare' | 'metrics' | 'policy' | 'audit';

export interface ComparisonViewProps {
  normal: Side;
  attack: Side;
  currentResult?: Decision | null;
  onCaptureNormal?: () => void;
  onCaptureAttack?: () => void;
  onClearNormal?: () => void;
  onClearAttack?: () => void;
  onClearBoth?: () => void;
  onSwap?: () => void;
  onInspect?: (decision: Decision) => void;
  onNavigate?: (page: Page) => void;
}

const ENVELOPE_KEYS = [
  'version',
  'message_id',
  'message_type',
  'sender_id',
  'target_id',
  'key_id',
  'sequence',
  'issued_at',
  'expires_at',
  'action',
  'payload',
  'auth_tag',
] as const;

interface DiffEntry {
  key: string;
  category: 'envelope' | 'payload';
  valA: unknown;
  valB: unknown;
  valAText: string;
  valBText: string;
  status: 'changed' | 'identical';
  isSecuritySensitive: boolean;
}

function computeDiff(a: Decision | null, b: Decision | null): DiffEntry[] {
  if (!a?.message && !b?.message) return [];

  const msgA = (a?.message ?? {}) as Record<string, unknown>;
  const msgB = (b?.message ?? {}) as Record<string, unknown>;
  const entries: DiffEntry[] = [];

  // Check envelope fields
  for (const key of ENVELOPE_KEYS) {
    if (key === 'payload') continue; // Handled separately for granular diff
    const valA = msgA[key] ?? null;
    const valB = msgB[key] ?? null;
    const strA = JSON.stringify(valA);
    const strB = JSON.stringify(valB);
    const isSecuritySensitive = ['auth_tag', 'sequence', 'action', 'sender_id', 'expires_at'].includes(key);

    entries.push({
      key,
      category: 'envelope',
      valA,
      valB,
      valAText: valA !== null ? strA : 'null',
      valBText: valB !== null ? strB : 'null',
      status: strA !== strB ? 'changed' : 'identical',
      isSecuritySensitive,
    });
  }

  // Deep inspect payload fields if both or either are objects
  const payloadA = (msgA.payload && typeof msgA.payload === 'object' ? msgA.payload : {}) as Record<string, unknown>;
  const payloadB = (msgB.payload && typeof msgB.payload === 'object' ? msgB.payload : {}) as Record<string, unknown>;
  const allPayloadKeys = Array.from(new Set([...Object.keys(payloadA), ...Object.keys(payloadB)]));

  if (allPayloadKeys.length > 0) {
    for (const pKey of allPayloadKeys) {
      const valA = payloadA[pKey] ?? null;
      const valB = payloadB[pKey] ?? null;
      const strA = JSON.stringify(valA);
      const strB = JSON.stringify(valB);

      entries.push({
        key: `payload.${pKey}`,
        category: 'payload',
        valA,
        valB,
        valAText: valA !== null ? strA : 'not set',
        valBText: valB !== null ? strB : 'not set',
        status: strA !== strB ? 'changed' : 'identical',
        isSecuritySensitive: ['mode', 'seconds'].includes(pKey),
      });
    }
  } else {
    // If payload is empty or not an object, record payload as a whole
    const strA = JSON.stringify(msgA.payload ?? null);
    const strB = JSON.stringify(msgB.payload ?? null);
    entries.push({
      key: 'payload',
      category: 'envelope',
      valA: msgA.payload,
      valB: msgB.payload,
      valAText: strA,
      valBText: strB,
      status: strA !== strB ? 'changed' : 'identical',
      isSecuritySensitive: false,
    });
  }

  return entries;
}

const ALL_STAGES: { stage: Stage; label: string; num: number }[] = [
  { stage: 'structure', label: '1. Structure & Envelope Bounds', num: 1 },
  { stage: 'identity', label: '2. Identity & Sender Key Registry', num: 2 },
  { stage: 'authentication', label: '3. Authentication & HMAC-SHA256', num: 3 },
  { stage: 'payload', label: '4. Action & Payload Schema', num: 4 },
  { stage: 'time', label: '5. Lifetime & Clock Freshness', num: 5 },
  { stage: 'permissions', label: '6. Role & Permission Authorization', num: 6 },
  { stage: 'replay', label: '7. Anti-Replay Stream Window', num: 7 },
  { stage: 'commit', label: '8. State Transition & Audit Commit', num: 8 },
];

export function ComparisonView({
  normal,
  attack,
  currentResult,
  onCaptureNormal,
  onCaptureAttack,
  onClearNormal,
  onClearAttack,
  onClearBoth,
  onSwap,
  onInspect,
  onNavigate,
}: ComparisonViewProps) {
  const [tab, setTab] = useState<'fields' | 'trace' | 'state' | 'raw'>('fields');
  const [filterDiffOnly, setFilterDiffOnly] = useState<boolean>(true);
  const [copiedSide, setCopiedSide] = useState<'normal' | 'attack' | null>(null);

  const diffList = useMemo(() => computeDiff(normal.result, attack.result), [normal.result, attack.result]);
  const changedEntries = useMemo(() => diffList.filter((d) => d.status === 'changed'), [diffList]);
  const displayedDiffs = useMemo(
    () => (filterDiffOnly ? changedEntries : diffList),
    [filterDiffOnly, changedEntries, diffList]
  );

  const ready = !!normal.result && !!attack.result;
  const capturedCount = (normal.result ? 1 : 0) + (attack.result ? 1 : 0);

  const handleCopyRaw = useCallback((side: 'normal' | 'attack', text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSide(side);
    setTimeout(() => setCopiedSide(null), 2500);
  }, []);

  const handleDownload = useCallback(() => {
    const payload = {
      label: 'Synthetic comparison — local simulation only. Not tamper-proof.',
      generated_at: new Date().toISOString(),
      changed_fields: changedEntries.map((e) => e.key),
      normal: {
        scenario: normal.label,
        decision: normal.result,
        submitted_text: normal.result?.submitted_text ?? null,
      },
      attack: {
        scenario: attack.label,
        decision: attack.result,
        submitted_text: attack.result?.submitted_text ?? null,
      },
      analysis: {
        first_failure_normal: normal.result?.checks?.find((c) => c.status === 'FAIL')?.label ?? 'none',
        first_failure_attack: attack.result?.checks?.find((c) => c.status === 'FAIL')?.label ?? 'none',
        state_changed_normal: normal.result?.state_changed ?? false,
        state_changed_attack: attack.result?.state_changed ?? false,
      },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kavach-comparison.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [normal, attack, changedEntries]);

  return (
    <section className="comparison-workspace panel compare-panel" aria-label="Normal versus attack comparison">
      {/* ==================== PAGE HEADER ==================== */}
      <div className="compare-header-panel">
        <div className="compare-header-top">
          <div className="compare-header-left">
            <div className="compare-header-icon">
              <FileDiff size={22} />
            </div>
            <div>
              <div className="compare-title-row">
                <h2>Comparison Workspace</h2>
                {capturedCount === 2 ? (
                  <span className="compare-status-pill ready">
                    <CheckCircle2 size={11} /> Ready for analysis (2 of 2)
                  </span>
                ) : capturedCount === 1 ? (
                  <span className="compare-status-pill partial">
                    <AlertTriangle size={11} /> Partial comparison (1 of 2)
                  </span>
                ) : (
                  <span className="compare-status-pill empty">
                    <Clock size={11} /> Awaiting captures (0 of 2)
                  </span>
                )}
                {ready && (
                  <span className="tab-badge diff-count">
                    {changedEntries.length} field{changedEntries.length === 1 ? '' : 's'} differ
                  </span>
                )}
              </div>
              <p className="compare-header-desc">
                Evaluate validation outcomes, side-by-side verification traces, and spacecraft state transitions.
                Both columns reflect real receiver decisions computed by the local Python kernel.
              </p>
            </div>
          </div>

          <div className="compare-header-actions">
            {ready && (
              <button
                className="compare-btn"
                onClick={onSwap}
                title="Swap Baseline and Comparison columns"
              >
                <ArrowLeftRight size={13} />
                Swap sides
              </button>
            )}
            {capturedCount > 0 && (
              <button
                className="compare-btn danger"
                onClick={onClearBoth}
                title="Clear both comparison records"
              >
                <Trash2 size={13} />
                Clear all
              </button>
            )}
            <button
              className="compare-btn"
              onClick={handleDownload}
              disabled={!capturedCount}
              title="Export comparison evidence JSON"
            >
              <Download size={13} />
              Export JSON
            </button>
          </div>
        </div>

        {/* Quick Capture Assistant Bar */}
        <div className="compare-assistant">
          <div className="assistant-info">
            <span className={`assistant-dot ${currentResult ? 'online' : 'idle'}`} />
            <div className="assistant-text">
              <strong>
                <Terminal size={13} />
                {currentResult ? (
                  <>
                    Console submission available: <code>{currentResult.verdict}</code> ·{' '}
                    <span className="mono">{currentResult.reason_code}</span>
                  </>
                ) : (
                  'No submission currently pending in Mission Console'
                )}
              </strong>
              <span>
                {currentResult
                  ? `Event ID: ${currentResult.event_id ?? 'service failure'} · Duration: ${currentResult.duration_ms ?? currentResult.roundtrip_ms ?? '—'}ms`
                  : 'Submit a command in Mission Console or run a scenario in Scenario Lab to capture.'}
              </span>
            </div>
          </div>

          <div className="assistant-actions">
            {currentResult ? (
              <>
                <button
                  className="compare-btn primary sm"
                  onClick={onCaptureNormal}
                  title="Capture this result as Baseline"
                >
                  <CheckCircle2 size={12} />
                  Capture as Baseline
                </button>
                <button
                  className="compare-btn primary sm"
                  onClick={onCaptureAttack}
                  title="Capture this result as Comparison"
                >
                  <Fingerprint size={12} />
                  Capture as Comparison
                </button>
              </>
            ) : (
              onNavigate && (
                <>
                  <button className="compare-btn sm" onClick={() => onNavigate('console')}>
                    Go to Mission Console
                    <ChevronRight size={12} />
                  </button>
                  <button className="compare-btn sm" onClick={() => onNavigate('scenarios')}>
                    Open Scenario Lab
                    <ExternalLink size={12} />
                  </button>
                </>
              )
            )}
          </div>
        </div>
      </div>

      {/* ==================== SIDE-BY-SIDE COLUMNS ==================== */}
      <div className="compare-columns-grid">
        {/* Baseline (Normal) Column */}
        <div
          className={`compare-side-card compare-col ${
            normal.result?.verdict === 'ACCEPTED' ? 'accepted' : normal.result ? 'rejected' : 'empty-side'
          }`}
        >
          <div className="side-card-header compare-col-head">
            <div className="side-label-group">
              <span className="side-type-badge baseline">Baseline</span>
              <h3 className="tiny-caps">{normal.label}</h3>
            </div>
            <div className="side-header-actions">
              {normal.result ? (
                <>
                  <Badge tone={normal.result.verdict === 'ACCEPTED' ? 'green' : 'red'}>
                    {normal.result.verdict}
                  </Badge>
                  {onClearNormal && (
                    <button
                      className="compare-btn sm"
                      onClick={onClearNormal}
                      title="Clear Baseline record"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </>
              ) : (
                <span className="compare-pending">Awaiting capture</span>
              )}
            </div>
          </div>

          {normal.result ? (
            <div className="side-card-body">
              {/* Verdict banner */}
              <div
                className={`side-verdict-banner ${
                  normal.result.verdict === 'ACCEPTED' ? 'accepted' : 'rejected'
                }`}
              >
                <div className="verdict-banner-icon">
                  {normal.result.verdict === 'ACCEPTED' ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <ShieldAlert size={18} />
                  )}
                </div>
                <div className="verdict-banner-content">
                  <div className="verdict-code-row">
                    <span>REASON</span>
                    <code>{normal.result.reason_code}</code>
                  </div>
                  <p className="compare-explanation">{normal.result.explanation}</p>
                </div>
              </div>

              {/* Decision Metadata Grid */}
              <div className="side-meta-grid compare-meta">
                <div className="side-meta-item">
                  <span className="side-meta-label">Sender verified</span>
                  <strong className={`side-meta-value ${normal.result.sender_verified ? 'green' : 'red'}`}>
                    {normal.result.sender_verified ? 'Yes (Verified)' : 'No (Unverified)'}
                  </strong>
                </div>
                <div className="side-meta-item">
                  <span className="side-meta-label">Spacecraft state</span>
                  <strong className={`side-meta-value ${normal.result.state_changed ? 'amber' : 'green'}`}>
                    {normal.result.state_changed ? 'Committed update' : 'Unchanged'}
                  </strong>
                </div>
                <div className="side-meta-item">
                  <span className="side-meta-label">Replay stream</span>
                  <strong className="side-meta-value">
                    {normal.result.replay_state_advanced ? 'Advanced' : 'Unchanged'}
                  </strong>
                </div>
                <div className="side-meta-item">
                  <span className="side-meta-label">Audit persistence</span>
                  <strong className="side-meta-value">
                    {normal.result.event_id ? 'Persisted in SQLite' : 'Not persisted'}
                  </strong>
                </div>
              </div>

              {/* State transition preview */}
              <div className="side-state-block compare-state">
                <div className="side-state-header">
                  <span>Protected State Transition</span>
                  {normal.result.state_changed ? (
                    <Badge tone="amber">Mode modified</Badge>
                  ) : (
                    <Badge tone="neutral">Preserved</Badge>
                  )}
                </div>
                <div className="state-before-after">
                  <pre className="state-snapshot-box" title="Protected state before message execution">
                    {JSON.stringify(normal.result.protected_state_before, null, 1)}
                  </pre>
                  <ArrowRight size={13} className="state-arrow" />
                  <pre className="state-snapshot-box" title="Protected state after message execution">
                    {JSON.stringify(normal.result.protected_state_after, null, 1)}
                  </pre>
                </div>
              </div>

              {/* Validation stages chips */}
              {normal.result.checks && (
                <div className="side-stages-flow compare-stages">
                  <span className="side-stages-title">Validation stages (8/8)</span>
                  <div className="stage-pills-row">
                    {normal.result.checks.map((c) => (
                      <span
                        key={c.stage}
                        className={`stage-pill ${
                          c.status === 'PASS' ? 'pass' : c.status === 'FAIL' ? 'fail' : 'notrun'
                        }`}
                        title={`${c.label}: ${c.explanation}`}
                      >
                        {c.status === 'PASS' ? (
                          <Check size={10} />
                        ) : c.status === 'FAIL' ? (
                          <XCircle size={10} />
                        ) : (
                          '—'
                        )}
                        {c.stage}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="side-empty-container compare-empty">
              <div className="side-empty-icon">
                <Shield size={26} strokeWidth={1.5} />
              </div>
              <h4>No Baseline Message Captured</h4>
              <p>
                Baseline records typically represent nominal, authorized commands to benchmark security validation
                rules.
              </p>
              {currentResult && onCaptureNormal && (
                <button className="compare-btn primary sm" onClick={onCaptureNormal}>
                  <CheckCircle2 size={13} />
                  Capture current console submission
                </button>
              )}
            </div>
          )}

          {normal.result && (
            <div className="side-card-footer compare-event">
              <div className="side-event-id">
                <Database size={12} />
                <code>{normal.result.event_id ?? 'Fault-injection — not persisted'}</code>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {normal.result.received_at && <span>{fmtTime(normal.result.received_at)}</span>}
                {onInspect && (
                  <button
                    className="compare-btn sm"
                    onClick={() => onInspect(normal.result!)}
                    title="Inspect decision audit trace"
                  >
                    <Maximize2 size={11} />
                    Inspect
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Comparison (Attack) Column */}
        <div
          className={`compare-side-card compare-col ${
            attack.result?.verdict === 'ACCEPTED' ? 'accepted' : attack.result ? 'rejected' : 'empty-side'
          }`}
        >
          <div className="side-card-header compare-col-head">
            <div className="side-label-group">
              <span className="side-type-badge comparison">Comparison</span>
              <h3 className="tiny-caps">{attack.label}</h3>
            </div>
            <div className="side-header-actions">
              {attack.result ? (
                <>
                  <Badge tone={attack.result.verdict === 'ACCEPTED' ? 'green' : 'red'}>
                    {attack.result.verdict}
                  </Badge>
                  {onClearAttack && (
                    <button
                      className="compare-btn sm"
                      onClick={onClearAttack}
                      title="Clear Comparison record"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </>
              ) : (
                <span className="compare-pending">Awaiting capture</span>
              )}
            </div>
          </div>

          {attack.result ? (
            <div className="side-card-body">
              {/* Verdict banner */}
              <div
                className={`side-verdict-banner ${
                  attack.result.verdict === 'ACCEPTED' ? 'accepted' : 'rejected'
                }`}
              >
                <div className="verdict-banner-icon">
                  {attack.result.verdict === 'ACCEPTED' ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <ShieldAlert size={18} />
                  )}
                </div>
                <div className="verdict-banner-content">
                  <div className="verdict-code-row">
                    <span>REASON</span>
                    <code>{attack.result.reason_code}</code>
                  </div>
                  <p className="compare-explanation">{attack.result.explanation}</p>
                </div>
              </div>

              {/* Decision Metadata Grid */}
              <div className="side-meta-grid compare-meta">
                <div className="side-meta-item">
                  <span className="side-meta-label">Sender verified</span>
                  <strong className={`side-meta-value ${attack.result.sender_verified ? 'green' : 'red'}`}>
                    {attack.result.sender_verified ? 'Yes (Verified)' : 'No (Unverified)'}
                  </strong>
                </div>
                <div className="side-meta-item">
                  <span className="side-meta-label">Spacecraft state</span>
                  <strong className={`side-meta-value ${attack.result.state_changed ? 'amber' : 'green'}`}>
                    {attack.result.state_changed ? 'Committed update' : 'Unchanged'}
                  </strong>
                </div>
                <div className="side-meta-item">
                  <span className="side-meta-label">Replay stream</span>
                  <strong className="side-meta-value">
                    {attack.result.replay_state_advanced ? 'Advanced' : 'Unchanged'}
                  </strong>
                </div>
                <div className="side-meta-item">
                  <span className="side-meta-label">Audit persistence</span>
                  <strong className="side-meta-value">
                    {attack.result.event_id ? 'Persisted in SQLite' : 'Not persisted'}
                  </strong>
                </div>
              </div>

              {/* State transition preview */}
              <div className="side-state-block compare-state">
                <div className="side-state-header">
                  <span>Protected State Transition</span>
                  {attack.result.state_changed ? (
                    <Badge tone="amber">Mode modified</Badge>
                  ) : (
                    <Badge tone="neutral">Preserved</Badge>
                  )}
                </div>
                <div className="state-before-after">
                  <pre className="state-snapshot-box" title="Protected state before message execution">
                    {JSON.stringify(attack.result.protected_state_before, null, 1)}
                  </pre>
                  <ArrowRight size={13} className="state-arrow" />
                  <pre className="state-snapshot-box" title="Protected state after message execution">
                    {JSON.stringify(attack.result.protected_state_after, null, 1)}
                  </pre>
                </div>
              </div>

              {/* Validation stages chips */}
              {attack.result.checks && (
                <div className="side-stages-flow compare-stages">
                  <span className="side-stages-title">Validation stages (8/8)</span>
                  <div className="stage-pills-row">
                    {attack.result.checks.map((c) => (
                      <span
                        key={c.stage}
                        className={`stage-pill ${
                          c.status === 'PASS' ? 'pass' : c.status === 'FAIL' ? 'fail' : 'notrun'
                        }`}
                        title={`${c.label}: ${c.explanation}`}
                      >
                        {c.status === 'PASS' ? (
                          <Check size={10} />
                        ) : c.status === 'FAIL' ? (
                          <XCircle size={10} />
                        ) : (
                          '—'
                        )}
                        {c.stage}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="side-empty-container compare-empty">
              <div className="side-empty-icon">
                <Fingerprint size={26} strokeWidth={1.5} />
              </div>
              <h4>No Comparison Message Captured</h4>
              <p>
                Comparison records typically evaluate suspect, tampered, replayed, or altered payloads against the
                baseline.
              </p>
              {currentResult && onCaptureAttack && (
                <button className="compare-btn primary sm" onClick={onCaptureAttack}>
                  <Fingerprint size={13} />
                  Capture current console submission
                </button>
              )}
            </div>
          )}

          {attack.result && (
            <div className="side-card-footer compare-event">
              <div className="side-event-id">
                <Database size={12} />
                <code>{attack.result.event_id ?? 'Fault-injection — not persisted'}</code>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {attack.result.received_at && <span>{fmtTime(attack.result.received_at)}</span>}
                {onInspect && (
                  <button
                    className="compare-btn sm"
                    onClick={() => onInspect(attack.result!)}
                    title="Inspect decision audit trace"
                  >
                    <Maximize2 size={11} />
                    Inspect
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==================== DETAILED ANALYSIS TABS ==================== */}
      {ready ? (
        <div className="compare-analysis-panel">
          <div className="compare-tabs-bar compare-tabs">
            <div className="compare-tabs-group">
              <button
                className={`compare-tab-btn ${tab === 'fields' ? 'active selected' : ''}`}
                onClick={() => setTab('fields')}
                aria-pressed={tab === 'fields'}
              >
                <FileDiff size={14} />
                Changed Fields
                <span className="tab-badge diff-count">{changedEntries.length}</span>
              </button>
              <button
                className={`compare-tab-btn ${tab === 'trace' ? 'active selected' : ''}`}
                onClick={() => setTab('trace')}
                aria-pressed={tab === 'trace'}
              >
                <Layers size={14} />
                Validation Trace Diff
              </button>
              <button
                className={`compare-tab-btn ${tab === 'state' ? 'active selected' : ''}`}
                onClick={() => setTab('state')}
                aria-pressed={tab === 'state'}
              >
                <Satellite size={14} />
                Spacecraft State Diff
              </button>
              <button
                className={`compare-tab-btn ${tab === 'raw' ? 'active selected' : ''}`}
                onClick={() => setTab('raw')}
                aria-pressed={tab === 'raw'}
              >
                <Code2 size={14} />
                Raw JSON Bytes
              </button>
            </div>

            {tab === 'fields' && (
              <div className="tab-toolbar-actions">
                <button
                  className={`diff-toggle-btn ${filterDiffOnly ? 'active' : ''}`}
                  onClick={() => setFilterDiffOnly(true)}
                >
                  Differences only ({changedEntries.length})
                </button>
                <button
                  className={`diff-toggle-btn ${!filterDiffOnly ? 'active' : ''}`}
                  onClick={() => setFilterDiffOnly(false)}
                >
                  All fields ({diffList.length})
                </button>
              </div>
            )}
          </div>

          <div className="compare-analysis-body">
            {/* TAB 1: CHANGED FIELDS DIFF */}
            {tab === 'fields' && (
              <div className="diff-table-container compare-diff">
                <div className="diff-filter-bar">
                  <span className="diff-stats-summary">
                    Showing <strong>{displayedDiffs.length}</strong> of {diffList.length} message fields (
                    <strong>{changedEntries.length}</strong> altered)
                  </span>
                  <div className="diff-stats-summary">
                    <span>Baseline: <code>{normal.result?.message?.message_type ?? '—'}</code></span>
                    {' · '}
                    <span>Comparison: <code>{attack.result?.message?.message_type ?? '—'}</code></span>
                  </div>
                </div>

                {displayedDiffs.length > 0 ? (
                  <div className="diff-rows-list">
                    {displayedDiffs.map((entry) => (
                      <div
                        key={entry.key}
                        className={`diff-card-row diff-row ${entry.status} ${
                          entry.isSecuritySensitive && entry.status === 'changed' ? 'security-critical' : ''
                        }`}
                      >
                        <div className="diff-card-header">
                          <div className="diff-key-group">
                            <span className="diff-key-name">{entry.key}</span>
                            <span className="diff-category-tag">{entry.category}</span>
                            {entry.isSecuritySensitive && (
                              <Badge tone="amber">Security sensitive</Badge>
                            )}
                          </div>
                          <span
                            className={`diff-status-tag ${
                              entry.status === 'changed' ? (entry.isSecuritySensitive ? 'critical' : 'changed') : 'identical'
                            }`}
                          >
                            {entry.status === 'changed' ? 'Altered' : 'Identical'}
                          </span>
                        </div>

                        <div className="diff-values-comparison">
                          <div className="diff-val-box">
                            <span className="diff-val-label">Baseline (Normal)</span>
                            <pre className="diff-val-content">{entry.valAText}</pre>
                          </div>
                          <ArrowRight size={14} className="state-arrow" />
                          <div className="diff-val-box">
                            <span className="diff-val-label">Comparison (Attack)</span>
                            <pre
                              className={`diff-val-content diff-after ${
                                entry.status === 'changed'
                                  ? entry.isSecuritySensitive
                                    ? 'critical-change'
                                    : 'after-change'
                                  : ''
                              }`}
                            >
                              {entry.valBText}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="compare-none" style={{ margin: '16px 0', color: 'var(--ink-subtle)' }}>
                    The submitted messages are byte-identical across all envelope and payload fields.
                  </p>
                )}
              </div>
            )}

            {/* TAB 2: VALIDATION TRACE DIFF */}
            {tab === 'trace' && (
              <div className="trace-comparison-table">
                {ALL_STAGES.map((s) => {
                  const checkA = normal.result?.checks?.find((c) => c.stage === s.stage);
                  const checkB = attack.result?.checks?.find((c) => c.stage === s.stage);

                  return (
                    <div key={s.stage} className="trace-stage-row">
                      <div className="trace-stage-info">
                        <span className="stage-title">{s.stage}</span>
                        <span className="stage-num">{s.label}</span>
                      </div>

                      {/* Outcome A */}
                      <div
                        className={`stage-outcome-col ${
                          checkA?.status === 'PASS' ? 'pass' : checkA?.status === 'FAIL' ? 'fail' : 'notrun'
                        }`}
                      >
                        <div className="outcome-text">
                          <span
                            className={`outcome-status-badge ${
                              checkA?.status === 'PASS' ? 'pass' : checkA?.status === 'FAIL' ? 'fail' : 'notrun'
                            }`}
                          >
                            {checkA?.status === 'PASS' ? (
                              <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} />
                            ) : checkA?.status === 'FAIL' ? (
                              <XCircle size={12} style={{ display: 'inline', marginRight: 4 }} />
                            ) : null}
                            {checkA?.status ?? 'NOT_RUN'}
                          </span>
                          <p>{checkA?.explanation ?? 'Not evaluated or execution halted prior to this stage.'}</p>
                        </div>
                      </div>

                      {/* Outcome B */}
                      <div
                        className={`stage-outcome-col ${
                          checkB?.status === 'PASS' ? 'pass' : checkB?.status === 'FAIL' ? 'fail' : 'notrun'
                        }`}
                      >
                        <div className="outcome-text">
                          <span
                            className={`outcome-status-badge ${
                              checkB?.status === 'PASS' ? 'pass' : checkB?.status === 'FAIL' ? 'fail' : 'notrun'
                            }`}
                          >
                            {checkB?.status === 'PASS' ? (
                              <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} />
                            ) : checkB?.status === 'FAIL' ? (
                              <XCircle size={12} style={{ display: 'inline', marginRight: 4 }} />
                            ) : null}
                            {checkB?.status ?? 'NOT_RUN'}
                          </span>
                          <p>{checkB?.explanation ?? 'Not evaluated or execution halted prior to this stage.'}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* TAB 3: SPACECRAFT STATE DIFF */}
            {tab === 'state' && (
              <div className="state-comparison-grid">
                <div className="state-overview-card">
                  <div className="state-overview-title">
                    <h4>Baseline State Impact</h4>
                    <Badge tone={normal.result?.state_changed ? 'amber' : 'green'}>
                      {normal.result?.state_changed ? 'State updated' : 'State unchanged'}
                    </Badge>
                  </div>
                  <div className="state-fields-table">
                    <div className="state-field-row">
                      <span className="state-field-name">Mode</span>
                      <span className="state-field-val">
                        {normal.result?.protected_state_before?.mode ?? '—'}
                        {' → '}
                        {normal.result?.protected_state_after?.mode ?? '—'}
                      </span>
                    </div>
                    <div className="state-field-row">
                      <span className="state-field-name">Report Interval</span>
                      <span className="state-field-val">
                        {normal.result?.protected_state_before?.report_interval_s ?? '—'}s
                        {' → '}
                        {normal.result?.protected_state_after?.report_interval_s ?? '—'}s
                      </span>
                    </div>
                    <div className="state-field-row">
                      <span className="state-field-name">Antenna Status</span>
                      <span className="state-field-val">
                        {normal.result?.protected_state_after?.antenna_status ?? '—'}
                      </span>
                    </div>
                    <div className="state-field-row">
                      <span className="state-field-name">Power Level</span>
                      <span className="state-field-val">
                        {normal.result?.protected_state_after?.power_level_pct ?? '—'}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="state-overview-card">
                  <div className="state-overview-title">
                    <h4>Comparison State Impact</h4>
                    <Badge tone={attack.result?.state_changed ? 'amber' : 'green'}>
                      {attack.result?.state_changed ? 'State updated' : 'State unchanged'}
                    </Badge>
                  </div>
                  <div className="state-fields-table">
                    <div className="state-field-row">
                      <span className="state-field-name">Mode</span>
                      <span className="state-field-val">
                        {attack.result?.protected_state_before?.mode ?? '—'}
                        {' → '}
                        {attack.result?.protected_state_after?.mode ?? '—'}
                      </span>
                    </div>
                    <div className="state-field-row">
                      <span className="state-field-name">Report Interval</span>
                      <span className="state-field-val">
                        {attack.result?.protected_state_before?.report_interval_s ?? '—'}s
                        {' → '}
                        {attack.result?.protected_state_after?.report_interval_s ?? '—'}s
                      </span>
                    </div>
                    <div className="state-field-row">
                      <span className="state-field-name">Antenna Status</span>
                      <span className="state-field-val">
                        {attack.result?.protected_state_after?.antenna_status ?? '—'}
                      </span>
                    </div>
                    <div className="state-field-row">
                      <span className="state-field-name">Power Level</span>
                      <span className="state-field-val">
                        {attack.result?.protected_state_after?.power_level_pct ?? '—'}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: RAW JSON BYTES */}
            {tab === 'raw' && (
              <div className="raw-comparison-grid compare-raw">
                <div className="raw-column">
                  <div className="raw-column-header">
                    <span>Baseline · Submitted Bytes</span>
                    <button
                      className="compare-btn sm"
                      onClick={() => handleCopyRaw('normal', normal.result?.submitted_text ?? '')}
                    >
                      {copiedSide === 'normal' ? <Check size={11} /> : <Copy size={11} />}
                      {copiedSide === 'normal' ? 'Copied' : 'Copy exact bytes'}
                    </button>
                  </div>
                  <pre className="raw-json-viewer">
                    {normal.result?.submitted_text ?? 'Not retained for this decision'}
                  </pre>
                </div>

                <div className="raw-column">
                  <div className="raw-column-header">
                    <span>Comparison · Submitted Bytes</span>
                    <button
                      className="compare-btn sm"
                      onClick={() => handleCopyRaw('attack', attack.result?.submitted_text ?? '')}
                    >
                      {copiedSide === 'attack' ? <Check size={11} /> : <Copy size={11} />}
                      {copiedSide === 'attack' ? 'Copied' : 'Copy exact bytes'}
                    </button>
                  </div>
                  <pre className="raw-json-viewer">
                    {attack.result?.submitted_text ?? 'Not retained for this decision'}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Footer summary */}
          <div className="compare-summary-footer compare-foot">
            <div className="footer-failure-summary">
              <Shield size={14} />
              <span>
                First failure — Baseline:{' '}
                <strong>{normal.result?.checks?.find((c) => c.status === 'FAIL')?.label ?? 'none (accepted)'}</strong>
                {' · '}
                Comparison:{' '}
                <strong>{attack.result?.checks?.find((c) => c.status === 'FAIL')?.label ?? 'none (accepted)'}</strong>
              </span>
            </div>

            <div className="footer-actions">
              <button className="compare-btn primary" onClick={handleDownload}>
                <Download size={13} />
                Export comparison
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="compare-disclaimer-note">
          <Info size={13} />
          <span>
            Comparison analysis tabs will become active as soon as both Baseline and Comparison payloads are captured.
          </span>
        </div>
      )}
    </section>
  );
}
