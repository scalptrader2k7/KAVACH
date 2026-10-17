import React, { useState, useCallback, useMemo } from 'react';
import {
  FileText,
  Activity,
  Search,
  Filter,
  RefreshCw,
  Download,
  FileJson,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Calendar,
  Satellite,
  Fingerprint,
  Radio,
  Terminal,
  Check,
  X,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Info,
  ExternalLink,
  Copy,
  ArrowRight,
  FileWarning,
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react';
import type { AuditRecord, AuditChainReport, Decision, Stage } from '../types';
import { Badge, fmtTime } from './ui';
import '../audit.css';

export type Page = 'console' | 'scenarios' | 'demo' | 'timeline' | 'compare' | 'metrics' | 'policy' | 'audit';

export interface AuditWorkspaceProps {
  events: AuditRecord[];
  total: number;
  loading: boolean;
  currentSession?: string;
  query: string;
  setQuery: (q: string) => void;
  filter: string;
  setFilter: (f: string) => void;
  stageFilter: string;
  setStageFilter: (s: string) => void;
  senderFilter: string;
  setSenderFilter: (s: string) => void;
  typeFilter: string;
  setTypeFilter: (t: string) => void;
  sessionFilter: string;
  setSessionFilter: (s: string) => void;
  sinceFilter: string;
  setSinceFilter: (s: string) => void;
  untilFilter: string;
  setUntilFilter: (u: string) => void;
  pageOffset: number;
  setPageOffset: (o: number) => void;
  onRefresh: () => void;
  onExportCsv: () => void;
  onExportEvidence: () => void;
  chainReport: AuditChainReport | null;
  onVerifyChain: () => void;
  chainBusy: boolean;
  chainError: string;
  onInspect: (decision: Decision) => void;
  onNavigate: (page: Page) => void;
  auditError?: string;
}

const STAGE_LABELS: Record<string, string> = {
  structure: 'Structure',
  identity: 'Identity',
  authentication: 'Authentication',
  payload: 'Payload',
  time: 'Freshness',
  permissions: 'Authorization',
  replay: 'Replay',
  commit: 'Commit',
};

export function AuditWorkspace({
  events,
  total,
  loading,
  currentSession,
  query,
  setQuery,
  filter,
  setFilter,
  stageFilter,
  setStageFilter,
  senderFilter,
  setSenderFilter,
  typeFilter,
  setTypeFilter,
  sessionFilter,
  setSessionFilter,
  sinceFilter,
  setSinceFilter,
  untilFilter,
  setUntilFilter,
  pageOffset,
  setPageOffset,
  onRefresh,
  onExportCsv,
  onExportEvidence,
  chainReport,
  onVerifyChain,
  chainBusy,
  chainError,
  onInspect,
  onNavigate,
  auditError,
}: AuditWorkspaceProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showLimitations, setShowLimitations] = useState<boolean>(false);

  const handleCopyId = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const clearAllFilters = useCallback(() => {
    setQuery('');
    setFilter('ALL');
    setStageFilter('ALL');
    setSenderFilter('ALL');
    setTypeFilter('ALL');
    setSessionFilter('current');
    setSinceFilter('');
    setUntilFilter('');
    setPageOffset(0);
  }, [
    setQuery,
    setFilter,
    setStageFilter,
    setSenderFilter,
    setTypeFilter,
    setSessionFilter,
    setSinceFilter,
    setUntilFilter,
    setPageOffset,
  ]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (query.trim()) count++;
    if (filter !== 'ALL') count++;
    if (stageFilter !== 'ALL') count++;
    if (senderFilter !== 'ALL') count++;
    if (typeFilter !== 'ALL') count++;
    if (sessionFilter !== 'current') count++;
    if (sinceFilter) count++;
    if (untilFilter) count++;
    return count;
  }, [query, filter, stageFilter, senderFilter, typeFilter, sessionFilter, sinceFilter, untilFilter]);

  const pageSize = 15;
  const startIdx = total ? pageOffset + 1 : 0;
  const endIdx = Math.min(pageOffset + events.length, total);

  const verified = chainReport?.status === 'VERIFIED';
  const chainChecked = !!chainReport;

  return (
    <div className="audit-workspace" aria-label="Audit and evidence workspace">
      {/* ==================== 1. HEADER PANEL ==================== */}
      <div className="audit-header-panel">
        <div className="audit-header-top">
          <div className="audit-header-left">
            <div className="audit-header-icon">
              <FileText size={22} />
            </div>
            <div>
              <div className="audit-title-row">
                <h2>Audit & Evidence Workspace</h2>
                <span className="audit-scope-pill">
                  <span className="audit-scope-dot" />
                  {sessionFilter === 'current' ? 'Current Session Scope' : 'All Sessions Scope'}
                </span>
                <Badge tone="neutral">{total} Recorded Decisions</Badge>
                {chainChecked && (
                  <Badge tone={verified ? 'green' : 'red'}>
                    {verified ? 'Chain Verified' : 'Integrity Check Failed'}
                  </Badge>
                )}
              </div>
              <p className="audit-header-desc">
                Committed validation traces, cryptographic fingerprints, and state transitions recorded persistently in
                local SQLite. Read-only audit verification verifies tamper-evidence.
              </p>
            </div>
          </div>

          <div className="audit-header-actions">
            <button
              className="audit-btn"
              onClick={onRefresh}
              disabled={loading}
              title="Refresh audit history from backend"
            >
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button
              className="audit-btn"
              onClick={onExportCsv}
              title="Export filtered records as CSV (up to 200 records)"
            >
              <Download size={12} />
              Export CSV
            </button>
            <button
              className="audit-btn"
              onClick={onExportEvidence}
              title="Export complete session evidence artifact as JSON"
            >
              <FileJson size={12} />
              Session JSON
            </button>
            <button
              className="audit-btn primary"
              onClick={onVerifyChain}
              disabled={chainBusy}
              title="Run cryptographic hash-chain verification"
            >
              <ShieldCheck size={12} className={chainBusy ? 'spin' : ''} />
              {chainBusy ? 'Verifying…' : 'Verify Chain'}
            </button>
          </div>
        </div>
      </div>

      {/* ==================== 2. FILTER & QUERY TOOLBAR ==================== */}
      <div className="audit-controls-panel">
        <div className="audit-filters-grid audit-filters">
          {/* Reason search */}
          <div className="audit-search-field filter-search">
            <Search size={13} />
            <input
              aria-label="Filter by exact reason code"
              placeholder="Search reason code (e.g. AUTH_FAILED)…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPageOffset(0);
              }}
            />
            {query && (
              <button
                className="clear-filters-btn"
                onClick={() => {
                  setQuery('');
                  setPageOffset(0);
                }}
                style={{ fontSize: 10 }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Verdict selector */}
          <div className="audit-select-field filter-select">
            <select
              aria-label="Filter by verdict"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPageOffset(0);
              }}
            >
              <option value="ALL">All verdicts</option>
              <option value="ACCEPTED">Accepted only</option>
              <option value="REJECTED">Rejected only</option>
            </select>
            <Filter size={12} />
          </div>

          {/* Validation Stage */}
          <div className="audit-select-field filter-select">
            <select
              aria-label="Filter by first failed validation stage"
              value={stageFilter}
              onChange={(e) => {
                setStageFilter(e.target.value);
                setPageOffset(0);
              }}
            >
              <option value="ALL">All validation stages</option>
              <option value="structure">Stage 1: Structure</option>
              <option value="identity">Stage 2: Identity</option>
              <option value="authentication">Stage 3: Authentication</option>
              <option value="payload">Stage 4: Payload</option>
              <option value="time">Stage 5: Freshness</option>
              <option value="permissions">Stage 6: Authorization</option>
              <option value="replay">Stage 7: Replay Window</option>
              <option value="commit">Stage 8: State Commit</option>
            </select>
            <Filter size={12} />
          </div>

          {/* Sender */}
          <div className="audit-select-field filter-select">
            <select
              aria-label="Filter by sender"
              value={senderFilter}
              onChange={(e) => {
                setSenderFilter(e.target.value);
                setPageOffset(0);
              }}
            >
              <option value="ALL">All senders</option>
              <option value="operator-01">operator-01</option>
              <option value="observer-01">observer-01</option>
              <option value="satellite-01">satellite-01</option>
            </select>
            <Filter size={12} />
          </div>

          {/* Message Type */}
          <div className="audit-select-field filter-select">
            <select
              aria-label="Filter by message type"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPageOffset(0);
              }}
            >
              <option value="ALL">All message kinds</option>
              <option value="COMMAND">COMMAND</option>
              <option value="TELEMETRY">TELEMETRY</option>
            </select>
            <Filter size={12} />
          </div>

          {/* Session Scope */}
          <div className="audit-select-field filter-select">
            <select
              aria-label="Session scope"
              value={sessionFilter}
              onChange={(e) => {
                setSessionFilter(e.target.value);
                setPageOffset(0);
              }}
            >
              <option value="current">Current mission session</option>
              <option value="all">All historical sessions</option>
            </select>
            <Filter size={12} />
          </div>

          {/* Date interval */}
          <div className="audit-datetime-field filter-range">
            <label htmlFor="audit-since">From</label>
            <input
              id="audit-since"
              type="datetime-local"
              value={sinceFilter}
              onChange={(e) => {
                setSinceFilter(e.target.value);
                setPageOffset(0);
              }}
            />
            <label htmlFor="audit-until">To</label>
            <input
              id="audit-until"
              type="datetime-local"
              value={untilFilter}
              onChange={(e) => {
                setUntilFilter(e.target.value);
                setPageOffset(0);
              }}
            />
          </div>
        </div>

        {/* Active filter chips & scope footnote */}
        <div className="audit-active-filters">
          <div className="filter-pills-list">
            <span style={{ color: 'var(--ink-tertiary)' }}>Scope:</span>
            <span className="filter-chip">
              Session: <strong>{sessionFilter === 'current' ? currentSession ?? 'Active' : 'All'}</strong>
            </span>
            {filter !== 'ALL' && (
              <span className="filter-chip">
                Verdict: <strong>{filter}</strong>
                <button onClick={() => setFilter('ALL')}>×</button>
              </span>
            )}
            {stageFilter !== 'ALL' && (
              <span className="filter-chip">
                Stage: <strong>{stageFilter}</strong>
                <button onClick={() => setStageFilter('ALL')}>×</button>
              </span>
            )}
            {senderFilter !== 'ALL' && (
              <span className="filter-chip">
                Sender: <strong>{senderFilter}</strong>
                <button onClick={() => setSenderFilter('ALL')}>×</button>
              </span>
            )}
            {typeFilter !== 'ALL' && (
              <span className="filter-chip">
                Type: <strong>{typeFilter}</strong>
                <button onClick={() => setTypeFilter('ALL')}>×</button>
              </span>
            )}
            {query.trim() && (
              <span className="filter-chip">
                Reason: <strong>{query.trim().toUpperCase()}</strong>
                <button onClick={() => setQuery('')}>×</button>
              </span>
            )}
            {activeFilterCount > 0 && (
              <button className="clear-filters-btn" onClick={clearAllFilters}>
                Clear all filters
              </button>
            )}
          </div>

          <span className="audit-scope" style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>
            Showing {sessionFilter === 'current' ? 'active session' : 'all sessions'}. Note: CSV export downloads up to
            200 records.
          </span>
        </div>
      </div>

      {auditError && (
        <div className="inline-error" role="alert" style={{ margin: 0 }}>
          {auditError}
          <button className="audit-btn sm" onClick={onRefresh} style={{ marginLeft: 8 }}>
            Retry audit
          </button>
        </div>
      )}

      {/* ==================== 3. AUDIT EVENT TABLE PANEL ==================== */}
      <section className="audit-table-panel panel audit-full" aria-label="Decision history">
        <div className="table-responsive-wrapper table-scroll">
          <table className="audit-records-table audit-table">
            <thead>
              <tr>
                <th>Received At</th>
                <th>Event ID</th>
                <th>Sender</th>
                <th>Kind / Action</th>
                <th>Session</th>
                <th>Verdict & Reason</th>
                <th>Failed Stage</th>
                <th>State Impact</th>
                <th style={{ textAlign: 'right' }}>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const isAccepted = e.verdict === 'ACCEPTED';
                const isCurrent = e.session_id === currentSession;
                const isCopied = copiedId === e.event_id;

                return (
                  <tr
                    key={e.event_id}
                    onClick={() => onInspect(e)}
                    tabIndex={0}
                    onKeyDown={(k) => {
                      if (k.key === 'Enter') {
                        k.preventDefault();
                        onInspect(e);
                      }
                    }}
                    aria-label={`Inspect ${e.reason_code} decision for ${e.event_id}`}
                  >
                    {/* Timestamp */}
                    <td>
                      <div className="time-col time-cell">
                        <span className="time-val mono">{fmtTime(e.received_at)}</span>
                        <span className="date-val utc-label">
                          {new Date(e.received_at * 1000).toLocaleDateString()}
                        </span>
                      </div>
                    </td>

                    {/* Event ID with copy */}
                    <td>
                      <div className="event-id-cell">
                        <code>{e.event_id.slice(0, 8)}…</code>
                        <button
                          className="audit-btn sm"
                          style={{ padding: '2px 5px', fontSize: 10 }}
                          onClick={(ev) => handleCopyId(e.event_id, ev)}
                          title="Copy full event UUID"
                        >
                          {isCopied ? <Check size={10} /> : <Copy size={10} />}
                        </button>
                      </div>
                    </td>

                    {/* Sender */}
                    <td>
                      <div className="sender-badge sender-cell">
                        {e.message?.sender_id === 'satellite-01' ? (
                          <Satellite size={13} />
                        ) : (
                          <Fingerprint size={13} />
                        )}
                        <span className="mono">{e.message?.sender_id || 'unverified'}</span>
                        {e.sender_verified && (
                          <CheckCircle2 size={12} className="verified-icon sender-check" />
                        )}
                      </div>
                    </td>

                    {/* Message Type & Action */}
                    <td>
                      <div className="type-action-cell">
                        <span className="type-tag message-kind">
                          {e.message?.message_type === 'TELEMETRY' ? (
                            <Radio size={12} />
                          ) : (
                            <Terminal size={12} />
                          )}
                          {e.message?.message_type || 'UNKNOWN'}
                        </span>
                        <span className="action-name mono action-cell">{e.message?.action || '—'}</span>
                      </div>
                    </td>

                    {/* Session */}
                    <td>
                      <div className="session-tag session-cell">
                        <span className={isCurrent ? 'current' : ''}>
                          {isCurrent ? 'Current' : 'Historical'}
                        </span>
                        <code>{e.session_id.slice(0, 8)}</code>
                      </div>
                    </td>

                    {/* Verdict & Reason */}
                    <td>
                      <div className="verdict-reason-cell">
                        <Badge tone={isAccepted ? 'green' : 'red'}>
                          {isAccepted ? <Check size={10} /> : <X size={10} />} {e.verdict}
                        </Badge>
                        <span
                          className={`reason-code-text reason-cell ${
                            e.reason_code === 'OK' ? 'ok' : 'mono'
                          }`}
                        >
                          {e.reason_code === 'OK' ? 'All checks passed' : e.reason_code}
                        </span>
                      </div>
                    </td>

                    {/* First failed stage */}
                    <td>
                      <div className="stage-pill-cell">
                        {e.first_failed_stage ? (
                          <span className="stage-tag failed">
                            {STAGE_LABELS[e.first_failed_stage] ?? e.first_failed_stage}
                          </span>
                        ) : (
                          <span className="stage-tag passed">All stages passed</span>
                        )}
                      </div>
                    </td>

                    {/* State change effect */}
                    <td>
                      <span
                        className={`state-effect-pill ${
                          e.state_changed ? 'updated' : 'unchanged'
                        }`}
                      >
                        {e.state_changed ? 'State updated' : 'State unchanged'}
                      </span>
                    </td>

                    {/* Inspect button */}
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="audit-btn sm row-arrow"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onInspect(e);
                        }}
                        title="Open decision inspection modal"
                      >
                        Inspect
                        <ArrowRight size={11} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Empty state */}
        {!events.length && (
          <div className="audit-empty-view audit-empty">
            <Search size={32} strokeWidth={1.5} />
            <h3>No Recorded Decisions Found</h3>
            <p>
              No audit records match the current filter query. Clear your filters or submit a command in Mission
              Console to create your first event.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {activeFilterCount > 0 && (
                <button className="audit-btn" onClick={clearAllFilters}>
                  Clear all filters
                </button>
              )}
              <button className="audit-btn primary" onClick={() => onNavigate('console')}>
                Go to Mission Console
                <ArrowRight size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Pagination */}
        <div className="audit-pagination-bar pagination">
          <span>
            Showing {startIdx}–{endIdx} of {total} recorded decisions
          </span>
          <div className="pagination-nav-group">
            <button
              className="audit-btn sm"
              disabled={pageOffset === 0}
              onClick={() => setPageOffset(Math.max(0, pageOffset - pageSize))}
            >
              <ChevronLeft size={13} />
              Previous
            </button>
            <button
              className="audit-btn sm"
              disabled={pageOffset + pageSize >= total}
              onClick={() => setPageOffset(pageOffset + pageSize)}
            >
              Next
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </section>

      {/* ==================== 4. AUDIT-CHAIN INTEGRITY PANEL ==================== */}
      <section className="audit-integrity-panel panel integrity-panel" aria-label="Audit integrity">
        <div className="integrity-panel-header">
          <div className="integrity-title-group">
            <ShieldCheck size={18} style={{ color: '#347de5' }} />
            <h3>Tamper-Evident Audit Chain Integrity</h3>
          </div>
          <button
            className="audit-btn primary sm"
            onClick={onVerifyChain}
            disabled={chainBusy}
            title="Execute SHA-256 forward hash-chain verification"
          >
            <RefreshCw size={12} className={chainBusy ? 'spin' : ''} />
            {chainBusy ? 'Verifying…' : 'Run Verification'}
          </button>
        </div>

        {chainError && (
          <p className="inline-error" role="alert" style={{ margin: 0 }}>
            {chainError}
          </p>
        )}

        {/* Verification Status Card */}
        {chainReport ? (
          <>
            <div
              className={`integrity-status-card integrity-result ${
                verified ? 'verified' : 'failed'
              }`}
              role="status"
            >
              <div className="integrity-status-left">
                {verified ? (
                  <ShieldCheck size={26} style={{ color: '#5ec269' }} />
                ) : (
                  <ShieldAlert size={26} style={{ color: '#f2777b' }} />
                )}
                <div className="integrity-status-info">
                  <strong>
                    {verified
                      ? 'Hash-Linked Audit Chain Verified'
                      : 'Audit Chain Anomaly / Integrity Check Failed'}
                  </strong>
                  <span>
                    {chainReport.links_checked} chained record{chainReport.links_checked === 1 ? '' : 's'} verified
                    from genesis
                    {chainReport.uncovered_records > 0 &&
                      ` · ${chainReport.uncovered_records} uncovered records`}
                  </span>
                </div>
              </div>
              <Badge tone={verified ? 'green' : 'red'}>{chainReport.status}</Badge>
            </div>

            {chainReport.uncovered_records > 0 && (
              <p className="integrity-uncovered" style={{ fontSize: 11, color: '#f0b429', margin: 0 }}>
                <Info size={12} style={{ display: 'inline', marginRight: 4 }} />
                <span>{chainReport.uncovered_note}</span>
              </p>
            )}

            {/* Reported Problems (e.g. QA-01) */}
            {chainReport.problems && chainReport.problems.length > 0 && (
              <div className="integrity-problems-box integrity-problems">
                <h4>
                  <FileWarning size={14} />
                  Reported Verification Problems ({chainReport.problems.length})
                </h4>
                {chainReport.problems.map((p, i) => (
                  <div key={i} className="problem-row integrity-problem">
                    <Badge tone="red">{p.kind}</Badge>
                    <span>{p.detail}</span>
                    {p.link != null && <code>Link #{p.link}</code>}
                  </div>
                ))}
              </div>
            )}

            {/* Covered Fields */}
            <div className="covered-fields-section integrity-covered">
              <span className="covered-fields-title">Covered Fields (17 SHA-256 Hashed Properties)</span>
              <div className="covered-fields-grid code-grid">
                {chainReport.covered_fields.map((f) => (
                  <span key={f} className="covered-field-tag">
                    <code>{f}</code>
                  </span>
                ))}
              </div>
            </div>

            {/* Limitations Drawer */}
            <div className="integrity-limitations-drawer">
              <button
                className="limitations-toggle-btn text-btn"
                onClick={() => setShowLimitations(!showLimitations)}
              >
                {showLimitations ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>{showLimitations ? 'Hide' : 'View'} verification scope & security limitations</span>
              </button>

              {showLimitations && (
                <>
                  <ul className="limitations-list integrity-limitations">
                    {chainReport.limitations.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                    <li>
                      <strong>Known verification boundary (QA-01):</strong> Cross-session verification requires global
                      continuity. Session-scoped exports evaluate records within their namespace.
                    </li>
                  </ul>
                  <p className="limitations-disclaimer integrity-disclaimer">
                    A hash chain detects post-commit alterations, missing links, and structural tampering. It operates
                    locally within SQLite and does not encrypt message contents or prove physical transmission reality.
                  </p>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="audit-empty-view integrity-empty" style={{ padding: '24px 16px' }}>
            <Shield size={28} strokeWidth={1.5} />
            <p>
              Verify the SHA-256 hash-linked audit log to verify that no recorded decision, timestamp, or state snapshot
              was altered after SQLite commit.
            </p>
            <button className="audit-btn primary sm" onClick={onVerifyChain} disabled={chainBusy}>
              {chainBusy ? 'Verifying…' : 'Execute Initial Verification'}
            </button>
          </div>
        )}
      </section>

      {/* ==================== 5. LEGAL FOOTNOTE ==================== */}
      <div className="audit-legal-footnote evidence-footnote">
        <Shield size={14} style={{ color: '#5599ff', flexShrink: 0 }} />
        <span>
          Application records are persistent in SQLite. Exports contain synthetic simulation data only. HMAC
          authenticates message integrity and sender identity; it does not encrypt payloads.
        </span>
      </div>
    </div>
  );
}

