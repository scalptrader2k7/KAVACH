export type MessageType='COMMAND'|'TELEMETRY';
export type Mode='NORMAL'|'POWER_SAVING'|'SAFE';
export type Action='GET_STATUS'|'SET_MODE'|'SET_REPORT_INTERVAL'|'TELEMETRY_STATUS';
export type JsonValue=string|number|boolean|null|JsonValue[]|{[key:string]:JsonValue};
export interface MessageEnvelope {
 version:1;message_id:string;message_type:MessageType;sender_id:string;target_id:string;
 key_id:string;sequence:number;issued_at:number;expires_at:number;action:Action;
 payload:Record<string,JsonValue>;auth_tag:string;
}
export interface ProtectedState {mode:Mode;report_interval_s:number}
export interface Telemetry {battery_pct:number;temperature_c:number;mode:Mode;received_at:number;source:string;message_id?:string}
export interface StateSnapshot {session_id:string;protected_state:ProtectedState;latest_telemetry:Telemetry|null;target_id:string;policy_version:string}
export interface Health {status:string;database?:string;session_id?:string}
export type Stage='structure'|'identity'|'authentication'|'payload'|'time'|'permissions'|'replay'|'commit';
export interface ValidationCheck {stage:Stage;label:string;status:'PASS'|'FAIL'|'NOT_RUN';explanation:string}
export interface Decision {
 event_id?:string;session_id?:string;verdict:'ACCEPTED'|'REJECTED'|'SERVICE_ERROR';reason_code:string;explanation:string;
 checks?:ValidationCheck[];sender_verified:boolean;received_at?:number;protected_state_before?:ProtectedState|null;
 protected_state_after?:ProtectedState|null;state_changed:boolean;telemetry_before?:Telemetry|null;telemetry_after?:Telemetry|null;
 policy_version:string;input_sha256?:string;message:Partial<MessageEnvelope>|null;submitted_text?:string;duration_ms?:number;
 audit_persisted?:boolean;replay_state_advanced?:boolean;replay_sequence_before?:number|null;replay_sequence_after?:number|null;
 roundtrip_ms?:number;input_truncated?:boolean;input_hash_scope?:string;prototype_only?:boolean;
}
export interface AuditRecord extends Decision {event_id:string;session_id:string;received_at:number}
export interface AuditPage {events:AuditRecord[];total:number}
export interface FixtureResponse {message:MessageEnvelope;raw_text?:string;modified:boolean;session_id:string;expected_outcome?:string;expectation_source?:string}
export interface ScenarioResult {name:string;expected:string;observed:string;passed:boolean;state_preserved:boolean;result:Decision;event_id?:string;note?:string}
export interface ScenarioReport {suite_id:string;session_id:string;executed_at:number;clock:string;passed:number;total:number;results:ScenarioResult[];isolated:boolean}
