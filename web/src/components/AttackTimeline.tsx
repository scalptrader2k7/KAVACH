import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {
  ListOrdered, Shield, AlertTriangle, CheckCircle2, CircleX, CircleDot,
  ArrowRight, ArrowUpRight, Search, Filter, RefreshCw, LoaderCircle,
  Terminal, Radio, Clock3, Fingerprint, LockKeyhole, SlidersHorizontal,
  RotateCcw, CheckCheck, Database, FileText, ChevronDown, ChevronRight,
  Inbox, Code2, Copy, Check, X, ExternalLink, ArrowDownUp, Layers, Activity
} from 'lucide-react';
import {api} from '../api';
import type {AuditPage, AuditRecord, Decision, ValidationCheck, Stage} from '../types';
import {Badge, fmtTime} from './ui';
import '../timeline.css';

export interface AttackTimelineProps {
  result?: Decision | null;
  currentSession?: string;
  onInspect?: (d: Decision) => void;
  onNavigate?: (p: 'console' | 'audit' | 'scenarios' | 'demo') => void;
}

const NODES = [
  { key: 'received', label: 'Message received', detail: 'Exact editor bytes delivered to the Python receiver', Icon: Inbox },
  { key: 'structure', label: 'Structure check', detail: 'Strict JSON, exact envelope, types, size', Icon: Code2 },
  { key: 'identity', label: 'Identity', detail: 'Registered key matches the claimed sender', Icon: Fingerprint },
  { key: 'authentication', label: 'Authentication', detail: 'HMAC-SHA256, constant-time comparison', Icon: LockKeyhole },
  { key: 'payload', label: 'Payload', detail: 'Target, action, and value bounds', Icon: SlidersHorizontal },
  { key: 'time', label: 'Freshness', detail: 'Lifetime and permitted clock skew', Icon: Clock3 },
  { key: 'permissions', label: 'Authorization', detail: 'Receiver policy permits the action', Icon: Shield },
  { key: 'replay', label: 'Replay', detail: 'New message ID and strictly increasing sequence', Icon: RotateCcw },
  { key: 'commit', label: 'Commit / rejection', detail: 'Atomic state, replay, and audit — or nothing', Icon: CheckCheck },
  { key: 'audit', label: 'Audit evidence', detail: 'Persisted decision with a chained integrity link', Icon: Database },
] as const;

export function AttackTimeline({
  result,
  currentSession,
  onInspect,
  onNavigate,
}: AttackTimelineProps) {
  const [events, setEvents] = useState<AuditRecord[]>([]);
  const [totalEvents, setTotalEvents] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Filter state
  const [verdictFilter, setVerdictFilter] = useState<string>('ALL');
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [senderFilter, setSenderFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [reasonQuery, setReasonQuery] = useState<string>('');
  const [sessionScope, setSessionScope] = useState<'current' | 'all'>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [copiedId, setCopiedId] = useState<boolean>(false);

  // Fetch events from receiver audit history
  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '60', offset: '0' });

      if (sessionScope === 'current' && currentSession) {
        params.set('session_id', currentSession);
      }
      if (verdictFilter !== 'ALL') {
        params.set('verdict', verdictFilter);
      }
      if (senderFilter !== 'ALL') {
        params.set('sender', senderFilter);
      }
      if (typeFilter !== 'ALL') {
        params.set('message_type', typeFilter);
      }
      if (stageFilter !== 'ALL') {
        params.set('stage', stageFilter);
      }
      if (reasonQuery.trim()) {
        params.set('reason', reasonQuery.trim().toUpperCase().replaceAll(' ', '_'));
      }

      const res = await api<AuditPage>('/audit?' + params.toString());
      setEvents(res.events);
      setTotalEvents(res.total);

      // If no event is selected yet, select the first returned event or result
      if (!selectedEventId && res.events.length > 0) {
        setSelectedEventId(res.events[0].event_id);
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to load timeline events from receiver.');
    } finally {
      setLoading(false);
    }
  }, [sessionScope, currentSession, verdictFilter, senderFilter, typeFilter, stageFilter, reasonQuery, selectedEventId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // When result changes (e.g. from active submission), update selection
  useEffect(() => {
    if (result?.event_id) {
      setSelectedEventId(result.event_id);
    }
  }, [result]);

  // Sorted events
  const displayedEvents = useMemo(() => {
    const list = [...events];
    if (sortOrder === 'asc') {
      return list.reverse();
    }
    return list;
  }, [events, sortOrder]);

  // Find currently selected event (check audit events or active result)
  const selectedEvent: AuditRecord | Decision | null = useMemo(() => {
    if (selectedEventId) {
      const found = events.find(e => e.event_id === selectedEventId);
      if (found) return found;
    }
    if (result && (!selectedEventId || result.event_id === selectedEventId)) {
      return result;
    }
    return events[0] ?? null;
  }, [selectedEventId, events, result]);

  // Derived metrics from events
  const summaryMetrics = useMemo(() => {
    const accepted = events.filter(e => e.verdict === 'ACCEPTED').length;
    const rejected = events.filter(e => e.verdict === 'REJECTED').length;
    const errors = events.filter(e => e.verdict === 'SERVICE_ERROR').length;
    const rate = events.length > 0 ? Math.round((rejected / events.length) * 100) : 0;
    return { accepted, rejected, errors, rate };
  }, [events]);

  const hasActiveFilters = verdictFilter !== 'ALL' || stageFilter !== 'ALL' || senderFilter !== 'ALL' || typeFilter !== 'ALL' || reasonQuery.trim() !== '' || sessionScope !== 'all';

  function resetFilters() {
    setVerdictFilter('ALL');
    setStageFilter('ALL');
    setSenderFilter('ALL');
    setTypeFilter('ALL');
    setReasonQuery('');
    setSessionScope('all');
  }

  async function copyEventId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // fallback
    }
  }

  // 10-node status calculator for inspected event
  const checks = selectedEvent?.checks ?? [];
  const statusFor = (key: string): 'PASS' | 'FAIL' | 'NOT_RUN' | 'PENDING' => {
    if (!selectedEvent) return 'NOT_RUN';
    if (key === 'received') return 'PASS';
    if (key === 'audit') {
      return selectedEvent.event_id && selectedEvent.audit_persisted ? 'PASS' : selectedEvent.verdict === 'SERVICE_ERROR' ? 'FAIL' : 'NOT_RUN';
    }
    return (checks.find(c => c.stage === key)?.status as 'PASS' | 'FAIL' | 'NOT_RUN') ?? 'NOT_RUN';
  };

  const passedStagesCount = checks.filter(c => c.status === 'PASS').length;

  return (
    <div className="timeline-workspace" aria-label="Attack Timeline Workspace">
      {/* ===== 1. HEADER & METRICS PANEL ===== */}
      <section className="panel timeline-header-panel">
        <div className="timeline-header-top">
          <div className="timeline-header-left">
            <div className="timeline-header-icon">
              <ListOrdered size={22} />
            </div>
            <div>
              <div className="timeline-title-row">
                <h2>Attack Timeline</h2>
                <span className="count-pill">{totalEvents} Recorded Decisions</span>
                <span className="count-pill">{events.length} in View</span>
              </div>
              <p className="timeline-header-desc">
                Chronological security audit and incident analysis workspace. Trace ordered receiver validation checks,
                pinpoint rejected uplinks and authentication failures, and inspect cryptographic evidence.
              </p>
            </div>
          </div>

          <div className="timeline-header-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={loadEvents}
              disabled={loading}
              title="Refresh timeline records from receiver"
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            {onNavigate && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => onNavigate('console')}
                title="Open Mission Console to submit messages"
              >
                <Terminal size={14} />
                Mission Console
              </button>
            )}
          </div>
        </div>

        {/* Real Summary Metrics */}
        <div className="timeline-metrics-strip" aria-label="Timeline Summary Counters">
          <div className="timeline-metric-card">
            <span className="t-metric-label">TOTAL EVENTS</span>
            <div className="t-metric-val">{totalEvents}</div>
            <span className="t-metric-sub">Across persisted sessions</span>
          </div>

          <div className="timeline-metric-card">
            <span className="t-metric-label">ACCEPTED UPLINKS</span>
            <div className="t-metric-val green">{summaryMetrics.accepted}</div>
            <span className="t-metric-sub">Verified & committed</span>
          </div>

          <div className="timeline-metric-card">
            <span className="t-metric-label">REJECTED / ATTACKS</span>
            <div className="t-metric-val red">{summaryMetrics.rejected}</div>
            <span className="t-metric-sub">Interception & violations</span>
          </div>

          <div className="timeline-metric-card">
            <span className="t-metric-label">REJECTION RATE</span>
            <div className="t-metric-val blue">{summaryMetrics.rate}%</div>
            <span className="t-metric-sub">Filtered sample ratio</span>
          </div>
        </div>
      </section>

      {/* ===== 2. FILTER & SEARCH CONTROLS ===== */}
      <section className="timeline-filter-bar" aria-label="Timeline Filters">
        <div className="timeline-filter-row-primary">
          <div className="timeline-search-box">
            <Search size={14} className="t-search-icon" />
            <input
              type="text"
              placeholder="Search by reason code (e.g. AUTH_FAILED, REPLAY)…"
              value={reasonQuery}
              onChange={e => setReasonQuery(e.target.value)}
              aria-label="Filter timeline events by reason code"
            />
          </div>

          <div className="t-select-wrap">
            <select
              aria-label="Filter by verdict"
              value={verdictFilter}
              onChange={e => setVerdictFilter(e.target.value)}
            >
              <option value="ALL">All Verdicts</option>
              <option value="ACCEPTED">Accepted Only</option>
              <option value="REJECTED">Rejected Only</option>
            </select>
            <ChevronDown size={13} className="select-arrow" />
          </div>

          <div className="t-select-wrap">
            <select
              aria-label="Filter by validation stage"
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value)}
            >
              <option value="ALL">All Stages</option>
              <option value="structure">Stage 1: Structure</option>
              <option value="identity">Stage 2: Identity</option>
              <option value="authentication">Stage 3: Authentication</option>
              <option value="payload">Stage 4: Payload</option>
              <option value="time">Stage 5: Freshness</option>
              <option value="permissions">Stage 6: Permissions</option>
              <option value="replay">Stage 7: Replay</option>
              <option value="commit">Stage 8: Commit</option>
            </select>
            <ChevronDown size={13} className="select-arrow" />
          </div>

          <div className="t-select-wrap">
            <select
              aria-label="Filter by sender"
              value={senderFilter}
              onChange={e => setSenderFilter(e.target.value)}
            >
              <option value="ALL">All Senders</option>
              <option value="operator-01">operator-01</option>
              <option value="observer-01">observer-01</option>
              <option value="satellite-01">satellite-01</option>
            </select>
            <ChevronDown size={13} className="select-arrow" />
          </div>

          <div className="t-select-wrap">
            <select
              aria-label="Filter by message type"
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
            >
              <option value="ALL">All Types</option>
              <option value="COMMAND">Command</option>
              <option value="TELEMETRY">Telemetry</option>
            </select>
            <ChevronDown size={13} className="select-arrow" />
          </div>

          <div className="t-select-wrap">
            <select
              aria-label="Filter by session scope"
              value={sessionScope}
              onChange={e => setSessionScope(e.target.value as 'current' | 'all')}
            >
              <option value="all">All Sessions</option>
              {currentSession && <option value="current">Current Session</option>}
            </select>
            <ChevronDown size={13} className="select-arrow" />
          </div>
        </div>

        <div className="timeline-filter-row-secondary">
          <div className="filter-pills-row">
            <button
              type="button"
              className={`filter-pill ${verdictFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setVerdictFilter('ALL')}
            >
              All Events ({events.length})
            </button>
            <button
              type="button"
              className={`filter-pill ${verdictFilter === 'REJECTED' ? 'active' : ''}`}
              onClick={() => setVerdictFilter('REJECTED')}
            >
              Rejections ({summaryMetrics.rejected})
            </button>
            <button
              type="button"
              className={`filter-pill ${verdictFilter === 'ACCEPTED' ? 'active' : ''}`}
              onClick={() => setVerdictFilter('ACCEPTED')}
            >
              Accepted ({summaryMetrics.accepted})
            </button>
            {hasActiveFilters && (
              <button type="button" className="text-btn" onClick={resetFilters}>
                Clear filters
              </button>
            )}
          </div>

          <button
            type="button"
            className="sort-toggle-btn"
            onClick={() => setSortOrder(o => (o === 'desc' ? 'asc' : 'desc'))}
            title={`Currently showing ${sortOrder === 'desc' ? 'newest first' : 'oldest first'}`}
          >
            <ArrowDownUp size={12} />
            {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>
      </section>

      {error && (
        <div className="suite-error-banner" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button type="button" className="btn secondary small-btn" onClick={loadEvents}>
            Retry
          </button>
        </div>
      )}

      {/* ===== 3. MAIN WORKSPACE GRID ===== */}
      <div className="timeline-main-grid">
        {/* Left Column: Chronological Event Stream */}
        <section className="panel timeline-stream-panel" aria-label="Chronological Event Stream">
          <div className="timeline-stream-heading">
            <div className="panel-title">
              <Clock3 size={16} />
              <h2>Chronological Events</h2>
              <span className="stream-count-badge">
                {displayedEvents.length} {displayedEvents.length === 1 ? 'event' : 'events'}
              </span>
            </div>
            <span className="workstation-label">{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
          </div>

          <div className="timeline-stream-body">
            {loading && events.length === 0 ? (
              <div className="timeline-loading-state" role="status" aria-live="polite">
                <LoaderCircle size={26} className="spin" />
                <span>Loading recorded events from receiver…</span>
              </div>
            ) : displayedEvents.length === 0 ? (
              hasActiveFilters ? (
                <div className="timeline-empty-state">
                  <Search size={30} className="timeline-empty-icon" />
                  <h3>No Events Match Filters</h3>
                  <p>No recorded decisions match your active filter settings. Try relaxing your criteria or clearing filters.</p>
                  <button type="button" className="btn secondary" onClick={resetFilters}>
                    Clear all filters
                  </button>
                </div>
              ) : (
                <div className="timeline-empty-state">
                  <Activity size={32} strokeWidth={1.25} className="timeline-empty-icon" />
                  <h3>No Recorded Decisions Yet</h3>
                  <p>
                    The local simulator has not processed any command or telemetry messages yet.
                    Submit a fixture in the Mission Console to record your first chronological timeline event.
                  </p>
                  {onNavigate && (
                    <button type="button" className="btn primary" onClick={() => onNavigate('console')}>
                      <Terminal size={14} /> Go to Mission Console
                    </button>
                  )}
                </div>
              )
            ) : (
              <ol className="timeline-event-list" role="list" aria-label="Event Timeline Stream">
                {displayedEvents.map((evt, idx) => {
                  const isAccepted = evt.verdict === 'ACCEPTED';
                  const isRejected = evt.verdict === 'REJECTED';
                  const isServiceError = evt.verdict === 'SERVICE_ERROR';
                  const isSelected = selectedEvent?.event_id === evt.event_id;
                  const toneClass = isAccepted ? 'accepted' : isRejected ? 'rejected' : 'service-error';

                  return (
                    <li
                      key={evt.event_id || idx}
                      className={`timeline-event-item ${toneClass} ${isSelected ? 'selected' : ''}`}
                      role="listitem"
                      tabIndex={0}
                      onClick={() => setSelectedEventId(evt.event_id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedEventId(evt.event_id);
                        }
                      }}
                      aria-selected={isSelected}
                    >
                      {/* Left vertical rail */}
                      <div className="event-rail-col">
                        <span className="event-node-dot">
                          {isAccepted ? (
                            <CheckCircle2 size={13} />
                          ) : isRejected ? (
                            <CircleX size={13} />
                          ) : (
                            <AlertTriangle size={13} />
                          )}
                        </span>
                        {idx < displayedEvents.length - 1 && <span className="event-rail-line" />}
                      </div>

                      {/* Event Card Content */}
                      <div className="event-card-content">
                        <div className="event-card-head">
                          <div className="event-time-wrap">
                            <span>{fmtTime(evt.received_at)}</span>
                            <span className="event-id-short mono">#{evt.event_id.slice(0, 8)}</span>
                          </div>

                          <div className="event-badges-row">
                            <span className={`verdict-tag ${toneClass}`}>
                              {evt.verdict}
                            </span>
                            <span className="reason-tag">{evt.reason_code}</span>
                          </div>
                        </div>

                        <div className="event-action-line">
                          <span className="action-sender">
                            {evt.message?.sender_id ?? 'unverified'}
                          </span>
                          <span className="action-divider">/</span>
                          <span className="action-name">
                            {evt.message?.message_type === 'TELEMETRY'
                              ? 'TELEMETRY_STATUS'
                              : evt.message?.action ?? 'COMMAND'}
                          </span>
                        </div>

                        <p className="event-explanation-text">{evt.explanation}</p>

                        <div className="event-card-foot">
                          <div className="foot-invariants">
                            <span className={`invariant-pill ${evt.state_changed ? 'changed' : 'unchanged'}`}>
                              {evt.state_changed ? 'State updated' : 'State unchanged'}
                            </span>
                            <span>·</span>
                            <span className={`invariant-pill ${evt.replay_state_advanced ? 'changed' : 'unchanged'}`}>
                              {evt.replay_state_advanced ? 'Replay advanced' : 'Replay held'}
                            </span>
                            {evt.first_failed_stage && (
                              <>
                                <span>·</span>
                                <span className="failed-stage-pill">
                                  Failed at {evt.first_failed_stage}
                                </span>
                              </>
                            )}
                          </div>

                          <span className="inspect-pill-link">
                            Inspect <ChevronRight size={12} />
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>

        {/* Right Column: Detailed Event Inspector */}
        <section className="panel timeline-inspector-panel" aria-label="Event Inspection Details">
          <div className="panel-heading">
            <div className="panel-title">
              <Shield size={16} />
              <h2>Event Inspector</h2>
              {selectedEvent?.event_id && (
                <span className="count-pill mono">
                  #{selectedEvent.event_id.slice(0, 8)}
                </span>
              )}
            </div>
            <span className="workstation-label">Full Trace</span>
          </div>

          {selectedEvent ? (
            <div className="inspector-body">
              {/* Event Header Card */}
              <div className="inspector-header-card">
                <div
                  className={`inspector-header-icon ${
                    selectedEvent.verdict === 'ACCEPTED'
                      ? 'accepted'
                      : selectedEvent.verdict === 'REJECTED'
                      ? 'rejected'
                      : 'service-error'
                  }`}
                >
                  {selectedEvent.verdict === 'ACCEPTED' ? (
                    <CheckCheck size={20} />
                  ) : selectedEvent.verdict === 'REJECTED' ? (
                    <Shield size={20} />
                  ) : (
                    <AlertTriangle size={20} />
                  )}
                </div>

                <div className="inspector-header-text">
                  <h3>
                    {selectedEvent.verdict} · {selectedEvent.reason_code}
                  </h3>
                  <p>{selectedEvent.explanation}</p>
                </div>
              </div>

              {/* Event Metadata Grid */}
              <div className="inspector-meta-grid">
                <div className="inspector-meta-item">
                  <span className="meta-label">EVENT ID</span>
                  <div className="meta-value flex-row">
                    <span>{selectedEvent.event_id?.slice(0, 14)}…</span>
                    {selectedEvent.event_id && (
                      <button
                        type="button"
                        className="small-icon"
                        onClick={() => copyEventId(selectedEvent.event_id!)}
                        title="Copy full event UUID"
                      >
                        {copiedId ? <Check size={11} className="green" /> : <Copy size={11} />}
                      </button>
                    )}
                  </div>
                </div>

                <div className="inspector-meta-item">
                  <span className="meta-label">TIMESTAMP</span>
                  <span className="meta-value">
                    {selectedEvent.received_at
                      ? `${fmtTime(selectedEvent.received_at)} (UTC ${selectedEvent.received_at})`
                      : 'Unavailable'}
                  </span>
                </div>

                <div className="inspector-meta-item">
                  <span className="meta-label">SESSION</span>
                  <span className="meta-value">{selectedEvent.session_id || 'Active mission'}</span>
                </div>

                <div className="inspector-meta-item">
                  <span className="meta-label">SENDER & KEY</span>
                  <span className="meta-value">
                    {selectedEvent.message?.sender_id ?? 'unverified'} /{' '}
                    {selectedEvent.message?.key_id ?? 'none'}
                  </span>
                </div>

                <div className="inspector-meta-item">
                  <span className="meta-label">MESSAGE ACTION</span>
                  <span className="meta-value">
                    {selectedEvent.message?.action ?? 'None'}
                  </span>
                </div>

                <div className="inspector-meta-item">
                  <span className="meta-label">LATENCY</span>
                  <span className="meta-value">
                    {selectedEvent.duration_ms != null ? `${selectedEvent.duration_ms} ms` : '—'}
                  </span>
                </div>
              </div>

              {/* 10-Node Validation Pipeline Execution Flow */}
              <div className="inspector-trace-section">
                <div className="trace-section-head">
                  <span>Receiver Validation Stages</span>
                  <span>{passedStagesCount} of 8 passed</span>
                </div>

                <div className="trace-nodes-list" role="list" aria-label="10-stage execution pipeline">
                  {NODES.map(node => {
                    const status = statusFor(node.key);
                    const check = checks.find(c => c.stage === node.key);
                    const tone = status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'notrun';

                    return (
                      <div key={node.key} className={`trace-node-row ${tone}`} role="listitem">
                        <span className="node-status-icon">
                          {status === 'PASS' ? (
                            <Check size={11} />
                          ) : status === 'FAIL' ? (
                            <X size={11} />
                          ) : (
                            <CircleDot size={11} />
                          )}
                        </span>
                        <span className="node-label">{node.label}</span>
                        <span className="node-explanation">
                          {check?.explanation ?? node.detail}
                        </span>
                        <span className="node-status-badge">{status}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Protected Spacecraft State Comparison */}
              <div className="inspector-state-section">
                <span className="snap-title">Protected State Impact</span>
                <div className="state-diff-grid">
                  <div className="state-snap-col">
                    <span className="snap-title">BEFORE</span>
                    <pre className="snap-pre">
                      {JSON.stringify(selectedEvent.protected_state_before ?? { mode: 'UNAVAILABLE' }, null, 2)}
                    </pre>
                  </div>
                  <div className="state-snap-col">
                    <span className="snap-title">AFTER</span>
                    <pre className="snap-pre">
                      {JSON.stringify(selectedEvent.protected_state_after ?? { mode: 'UNAVAILABLE' }, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Cryptographic & Persistence Invariants */}
              <div className="inspector-invariants-box">
                <div className="invariant-line">
                  <span>Protected State Change</span>
                  <strong className={selectedEvent.state_changed ? 'green' : ''}>
                    {selectedEvent.state_changed ? 'Committed in transaction' : 'Unchanged'}
                  </strong>
                </div>

                <div className="invariant-line">
                  <span>Replay Sequence Stream</span>
                  <strong className={selectedEvent.replay_state_advanced ? 'green' : ''}>
                    {selectedEvent.replay_state_advanced
                      ? `Advanced (${selectedEvent.replay_sequence_before ?? 0} → ${selectedEvent.replay_sequence_after ?? 0})`
                      : 'Held unchanged'}
                  </strong>
                </div>

                <div className="invariant-line">
                  <span>Audit Record Status</span>
                  <strong className={selectedEvent.audit_persisted ? 'green' : 'amber'}>
                    {selectedEvent.audit_persisted ? 'Committed to SQLite' : 'Unpersisted'}
                  </strong>
                </div>

                <div className="invariant-line">
                  <span>Input SHA-256</span>
                  <code className="mono" style={{ fontSize: 10 }}>
                    {selectedEvent.input_sha256 ? `${selectedEvent.input_sha256.slice(0, 16)}…` : 'Unavailable'}
                  </code>
                </div>
              </div>

              {/* Related Navigation Actions */}
              <div className="inspector-actions-row">
                {onInspect && (
                  <button
                    type="button"
                    className="btn primary inspector-action-btn"
                    onClick={() => onInspect(selectedEvent)}
                    title="Open full decision details in modal"
                  >
                    <FileText size={14} />
                    Inspect full decision modal
                  </button>
                )}

                {onNavigate && (
                  <button
                    type="button"
                    className="btn secondary inspector-action-btn"
                    onClick={() => onNavigate('audit')}
                    title="Jump to Audit & Evidence records"
                  >
                    <Database size={14} />
                    View in Audit & Evidence
                    <ArrowUpRight size={13} />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="timeline-empty-state">
              <p>Select an event from the timeline stream to inspect its complete execution trace.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
