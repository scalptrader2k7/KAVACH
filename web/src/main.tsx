import React, {useEffect, useState, useRef, useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {Shield, Radio, ArrowUpRight, ArrowRight, ChevronRight, ChevronDown, Check, CheckCheck, X, Plus, Download, RefreshCw, Send, Copy, Code2, SlidersHorizontal, LockKeyhole, Fingerprint, Clock3, CircleCheck, CircleX, CircleDot, Satellite, Activity, FileJson, FlaskConical, Terminal, Wifi, ExternalLink, Play, RotateCcw, AlertTriangle, Search, Filter, BatteryMedium, Thermometer, MoreHorizontal, Menu, Zap, CheckCircle2, BookOpen, LoaderCircle, Link2, Maximize2, Eye, Info, ListOrdered, FileDiff, BarChart3, Users} from 'lucide-react';
import './tokens.css';
import './styles.css';
import './console.css';
import {api,post,submitEditor} from './api';
import {toCsv} from './csv';
import {formatEditorJSON} from './editor';
import type {Health,StateSnapshot,Decision,AuditRecord,AuditPage,FixtureResponse,ScenarioReport,ScenarioResult} from './types';
import {Badge,fmtTime} from './components/ui';
import {AuditTable} from './components/AuditTable';
import {ValidationPipeline} from './components/ValidationPipeline';
import {MessageEditor} from './components/MessageEditor';
import {ThreatPanel} from './components/ThreatPanel';
import {AttackTimeline} from './components/AttackTimeline';
import {ComparisonView} from './components/ComparisonView';
import {MetricsDashboard} from './components/MetricsDashboard';
import {AuditIntegrity} from './components/AuditIntegrity';
import {AuditWorkspace} from './components/AuditWorkspace';
import {GuidedDemo,DEMO_STEPS} from './components/GuidedDemo';
import type {DemoStep} from './components/GuidedDemo';
import type {ScenarioMeta} from './components/ThreatPanel';
import {ScenarioLab} from './components/ScenarioLab';
import './scenarios.css';
import {LandingPage} from './components/LandingPage';


type Any = any;
type Page = 'console'|'scenarios'|'audit'|'timeline'|'compare'|'metrics'|'demo'|'policy';
const scenarios = [
  {id:'valid',name:'Valid command',desc:'Send a signed operator command. Watch the simulated mode change.',icon:CheckCircle2,expected:'ACCEPTED',tone:'green',intent:'Baseline: a correctly signed, authorised, in-lifetime command.',threat:'This is the control case. Every stage must pass and the protected state must change exactly as the payload requests.',changed:'Nothing. The message is submitted exactly as the fixture issuer signed it.'},
  {id:'tampered',name:'Tampered payload',desc:'Change the payload after signing, without generating a new signature.',icon:Fingerprint,expected:'AUTH_FAILED',tone:'red',intent:'Modify the signed payload so it no longer matches its authentication tag.',threat:'An attacker who can reach the channel alters the command in transit. The HMAC covers the payload, so any change breaks the tag.',changed:'The payload mode value. The original authentication tag is deliberately retained.'},
  {id:'unknown_key',name:'Unknown sender / key',desc:'Name a key the receiver has never registered.',icon:Fingerprint,expected:'KEY_UNKNOWN',tone:'red',intent:'Claim a key identifier that does not exist in the receiver registry.',threat:'A forged envelope naming an unregistered key. The receiver refuses before any cryptographic work, so the sender stays unverified.',changed:'The key_id field. The otherwise-valid signed envelope is left intact.'},
  {id:'bad_tag',name:'Invalid authentication tag',desc:'A well-formed but wrong HMAC tag.',icon:Shield,expected:'AUTH_FAILED',tone:'red',intent:'Submit a structurally valid 64-hex tag that does not match the message.',threat:'The tag parses cleanly, so only cryptographic verification can catch it. Structure and identity pass; authentication fails.',changed:'The final hex character of the auth_tag. Length and format are preserved.'},
  {id:'malformed',name:'Malformed JSON',desc:'Duplicate keys in an otherwise valid envelope.',icon:Code2,expected:'INVALID_JSON',tone:'red',intent:'Exploit parsers that silently collapse duplicate JSON keys.',threat:'Most JSON parsers keep the last duplicate value. The receiver rejects the raw bytes before any value is trusted.',changed:'A duplicate "version" key is injected into the raw text. No re-signing occurs.'},
  {id:'replay',name:'Replay attack',desc:'Resend an accepted message with its original ID and sequence.',icon:RotateCcw,expected:'REPLAY',tone:'red',intent:'Resubmit the exact bytes of a previously accepted message.',threat:'The attacker replays a genuine, correctly signed command. Time validation runs first, so an expired original reports EXPIRED.',changed:'Nothing. The original accepted bytes are resent verbatim.'},
  {id:'expired',name:'Expired message',desc:'Submit a correctly signed message outside its validity window.',icon:Clock3,expected:'EXPIRED',tone:'amber',intent:'Delay a valid signed command past its 60-second lifetime.',threat:'Freshness is checked before replay. A stale command is refused even though its signature is perfectly valid.',changed:'The issued_at timestamp is backdated by 65 seconds.'},
  {id:'future',name:'Future timestamp',desc:'Exceed the permitted five seconds of future clock skew.',icon:Clock3,expected:'CLOCK_SKEW',tone:'amber',intent:'Issue a command dated in the future.',threat:'Bounds how far a clock may run ahead of the receiver, so a pre-dated command cannot be held back and used later.',changed:'The issued_at timestamp is advanced by 30 seconds.'},
  {id:'unauthorised',name:'Unauthorised command',desc:'An authenticated observer attempts to change spacecraft mode.',icon:Shield,expected:'NOT_AUTHORISED',tone:'red',intent:'A correctly authenticated sender requests an action its role does not permit.',threat:'This is the core identity-versus-authorisation demonstration. HMAC PASS is not permission.',changed:'The sender is observer-01, which may only request GET_STATUS.'},
  {id:'invalid',name:'Invalid payload',desc:'Request a reporting interval outside the 1–60 second range.',icon:Code2,expected:'PAYLOAD_INVALID',tone:'red',intent:'A correctly signed command carrying an out-of-range payload value.',threat:'Authentication proves who sent it, not that the request is sane. Payload bounds are enforced separately.',changed:'The requested interval is set to 90 seconds.'},
  {id:'telemetry',name:'Valid telemetry',desc:'Receive a synthetic status snapshot without issuing a command.',icon:Radio,expected:'ACCEPTED',tone:'green',intent:'A correctly signed telemetry report from the satellite identity.',threat:'Telemetry updates the received-data channel only. It must never overwrite protected spacecraft state.',changed:'Nothing. A fresh signed telemetry fixture.'},
];
const pretty=(s:string)=>s.replaceAll('_',' ');
const modeShort=(s:string)=>s==='POWER_SAVING'?'Power saving':s==='SAFE'?'Safe mode':'Normal';

function App(){
 const [page,setPage]=useState<Page>('console');
 const [health,setHealth]=useState<Health|null>(null),[state,setState]=useState<StateSnapshot|null>(null),[audit,setAudit]=useState<AuditRecord[]>([]),[auditTotal,setAuditTotal]=useState(0);
 const [editor,setEditor]=useState(''),[signed,setSigned]=useState(''),[issuedSession,setIssuedSession]=useState(''),[sender,setSender]=useState('operator-01'),[kind,setKind]=useState('COMMAND'),[action,setAction]=useState('SET_MODE'),[mode,setMode]=useState('POWER_SAVING'),[seconds,setSeconds]=useState(15),[battery,setBattery]=useState(87),[temp,setTemp]=useState(24);
 const [result,setResult]=useState<Decision|null>(null),[busy,setBusy]=useState(''),[toast,setToast]=useState(''),[detail,setDetail]=useState<Decision|null>(null),[help,setHelp]=useState(false),[confirm,setConfirm]=useState(false),[report,setReport]=useState<ScenarioReport|null>(null),[view,setView]=useState('json'),[filter,setFilter]=useState('ALL'),[senderFilter,setSenderFilter]=useState('ALL'),[typeFilter,setTypeFilter]=useState('ALL'),[sessionFilter,setSessionFilter]=useState('current'),[query,setQuery]=useState(''),[pageOffset,setPageOffset]=useState(0),[copied,setCopied]=useState(false),[now,setNow]=useState(Date.now());
 const [suiteError,setSuiteError]=useState('');
 const [auditError,setAuditError]=useState(''),[submitError,setSubmitError]=useState('');
 const [metrics,setMetrics]=useState<import('./types').Metrics|null>(null),[anomalies,setAnomalies]=useState<import('./types').AnomalyReport|null>(null);
 const [chain,setChain]=useState<import('./types').AuditChainReport|null>(null),[chainError,setChainError]=useState('');
 const [policy,setPolicy]=useState<import('./types').PolicySnapshot|null>(null);
 const [navOpen,setNavOpen]=useState(false),[demoIndex,setDemoIndex]=useState(0),[compareNormal,setCompareNormal]=useState<import('./types').Decision|null>(null),[compareAttack,setCompareAttack]=useState<import('./types').Decision|null>(null);
 const [stageFilter,setStageFilter]=useState('ALL'),[sinceFilter,setSinceFilter]=useState(''),[untilFilter,setUntilFilter]=useState('');
 const [expectation,setExpectation]=useState<string|null>(null),[selectedScenario,setSelectedScenario]=useState<string|null>(null),[resultExpectation,setResultExpectation]=useState<string|null>(null),[issuedText,setIssuedText]=useState('');
 const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
 const editorRef=useRef<HTMLTextAreaElement>(null);
 const first=useRef(false),toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const notify=useCallback((text:string)=>{setToast(text);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),4500)},[]);
 const refresh=useCallback(async()=>{
  const [h,s]=await Promise.all([api<Health>('/health'),api<StateSnapshot>('/state')]);setHealth(h);setState(s);return s;
 },[]);
 const loadAudit=useCallback(async()=>{
  if(!state)return;
  const params=new URLSearchParams({limit:page==='audit'?'15':'6',offset:String(page==='audit'?pageOffset:0)});
  if(page!=='audit'||sessionFilter==='current')params.set('session_id',state.session_id);
  if(page==='audit'){
   if(filter!=='ALL')params.set('verdict',filter);
   if(senderFilter!=='ALL')params.set('sender',senderFilter);
   if(typeFilter!=='ALL')params.set('message_type',typeFilter);
   if(stageFilter!=='ALL')params.set('stage',stageFilter);
   if(query.trim())params.set('reason',query.trim().toUpperCase().replaceAll(' ','_'));
   const toEpoch=(v:string)=>{const t=Date.parse(v);return Number.isNaN(t)?'':String(Math.floor(t/1000))};
   const since=toEpoch(sinceFilter),until=toEpoch(untilFilter);
   if(since)params.set('since',since);
   if(until)params.set('until',until);
  }
  const a=await api<AuditPage>('/audit?'+params);setAudit(a.events);setAuditTotal(a.total);setAuditError('');
 },[state?.session_id,page,filter,senderFilter,typeFilter,stageFilter,sessionFilter,query,sinceFilter,untilFilter,pageOffset]);
 async function generate(scenario='valid',explicit=true,sessionOverride?:string){
  setBusy('generate');setSelectedScenario(scenario);
  try{
   let payload:Any={};
   if(kind==='TELEMETRY')payload={battery_pct:battery,temperature_c:temp,mode};
   else if(action==='SET_MODE')payload={mode};
   else if(action==='SET_REPORT_INTERVAL')payload={seconds};
   const f=await post<FixtureResponse>('/demo/issue',{sender_id:sender,message_type:kind,action:kind==='TELEMETRY'?'TELEMETRY_STATUS':action,payload,scenario,session_id:sessionOverride??state?.session_id});
   const text=f.raw_text??JSON.stringify(f.message,null,2);setExpectation(f.expected_outcome??null);setIssuedText(text);setSender(f.message.sender_id);setKind(f.message.message_type);setAction(f.message.message_type==='TELEMETRY'?'TELEMETRY_STATUS':f.message.action);if(typeof f.message.payload.mode==='string')setMode(f.message.payload.mode);if(typeof f.message.payload.seconds==='number')setSeconds(f.message.payload.seconds);setEditor(text);setSigned(f.modified?'modified-fixture':text);setIssuedSession(f.session_id);setResult(null);
   if(explicit)notify(scenario==='valid'?'Fresh sample signed. Ready for validation.':scenario==='tampered'?'Payload altered after signing. Original authentication tag retained.':'Scenario fixture ready. Submit to inspect the decision.');
  }catch(e){notify((e as Error).message)}finally{setBusy('')}
 }
 useEffect(()=>{if(first.current)return;first.current=true;refresh().catch(()=>{setHealth({status:'offline'});notify('Local API is unavailable. Check that the Python server is running.');});},[]);
 useEffect(()=>{loadAudit().catch(()=>setAuditError('Audit history could not be refreshed. Displayed records may be out of date.'));},[loadAudit,result]);
 useEffect(()=>{if(editorRef.current){editorRef.current.scrollTop=0;editorRef.current.scrollLeft=0;const numbers=editorRef.current.previousElementSibling;if(numbers)numbers.scrollTop=0;}},[issuedText]);
 useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setDetail(null);setHelp(false);setConfirm(false)}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);
 useEffect(()=>{const clock=setInterval(()=>setNow(Date.now()),1000);const timer=setInterval(()=>{refresh().catch(()=>setHealth({status:'offline'}));},10000);return()=>{clearInterval(timer);clearInterval(clock)}},[refresh]);
 async function submit(){
  if(!editor.trim())return notify('Generate or enter a message first.');
  setBusy('submit');setResult(null);setSubmitError('');
  const start=performance.now();
  try{const r=await submitEditor<Decision>(issuedSession,editor);setResultExpectation(editor===issuedText?expectation:null);r.roundtrip_ms=Math.round(performance.now()-start);setResult(r);await refresh();if(window.innerWidth<900)requestAnimationFrame(()=>document.getElementById('attempt-result')?.scrollIntoView({block:'start',behavior:'instant'}));}catch(e){setSubmitError((e as Error).message);notify((e as Error).message)}finally{setBusy('')}
 }
 async function runSuite(){setBusy('suite');setSuiteError('');try{const r=await post<ScenarioReport>('/scenarios/run');setReport(r);notify(`${r.passed} of ${r.total} scenarios passed. Mission session unchanged.`)}catch(e){setSuiteError((e as Error).message);notify((e as Error).message)}finally{setBusy('')}}
 async function resetDemo(){setBusy('reset');try{const r=await post<{session_id:string;preserved:Record<string,number>;note:string}>('/demo/reset');setState(await api<import('./types').StateSnapshot>('/state'));setResult(null);setReport(null);setChain(null);setMetrics(null);setCompareNormal(null);setCompareAttack(null);setEditor('');setSigned('');setIssuedSession(r.session_id);setDemoIndex(0);notify(`Reset to the documented initial state. Preserved: ${r.preserved.sessions} sessions, ${r.preserved.audit_events} audit events, ${r.preserved.chain_links} chain links, ${r.preserved.signing_keys} signing keys.`)}catch(e){notify((e as Error).message)}finally{setBusy('')}}
 async function newSession(){setBusy('session');try{const s=await post<StateSnapshot>('/demo/sessions');setState(s);setResult(null);setReport(null);setConfirm(false);setEditor('');setSigned('');setIssuedSession(s.session_id);await generate('valid',false,s.session_id);notify('New isolated demo session created. Previous history is preserved.')}catch(e){notify((e as Error).message)}finally{setBusy('')}}
 async function loadMetrics(){setBusy('metrics');try{const [m,a]=await Promise.all([api<import('./types').Metrics>('/metrics'),api<import('./types').AnomalyReport>('/anomalies')]);setMetrics(m);setAnomalies(a)}catch(e){notify((e as Error).message)}finally{setBusy('')}}
 async function verifyChain(){setBusy('chain');setChainError('');try{const r=await api<import('./types').AuditChainReport>('/audit/verify');setChain(r);notify(r.status==='VERIFIED'?'Audit chain verified. No covered record was altered.':'Integrity check failed. Inspect the reported problems.')}catch(e){setChainError((e as Error).message);notify((e as Error).message)}finally{setBusy('')}}
 async function loadPolicy(){try{setPolicy(await api<import('./types').PolicySnapshot>('/policy'))}catch(e){notify((e as Error).message)}}
 function rememberForCompare(which:'normal'|'attack'){if(!result)return notify('Submit a message first, then capture it into the comparison.');if(which==='normal'){setCompareNormal(result);notify('Captured as the normal side of the comparison.')}else{setCompareAttack(result);notify('Captured as the attack side of the comparison.')}}
 function runDemoStep(step:DemoStep){setDemoIndex(DEMO_STEPS.findIndex(x=>x.id===step.id));generate(step.scenario)}
 function exportAuditCsv(){
  const params=new URLSearchParams({limit:'200',offset:'0'});
  if(sessionFilter!=='all')params.set('session_id',state!.session_id);
  if(filter!=='ALL')params.set('verdict',filter);
  if(senderFilter!=='ALL')params.set('sender',senderFilter);
  if(typeFilter!=='ALL')params.set('message_type',typeFilter);
  if(stageFilter!=='ALL')params.set('stage',stageFilter);
  if(query.trim())params.set('reason',query.trim().toUpperCase().replaceAll(' ','_'));
  api<import('./types').AuditPage>('/audit?'+params).then(page=>{
   const head=['event_id','session_id','received_at','verdict','reason_code','first_failed_stage','sender','message_type','action','sender_verified','state_changed','replay_state_advanced','audit_persisted','input_sha256'];
   const rows=page.events.map(e=>[e.event_id,e.session_id,new Date(e.received_at*1000).toISOString(),e.verdict,e.reason_code,e.first_failed_stage??'',e.message?.sender_id??'unverified',e.message?.message_type??'UNKNOWN',e.message?.action??'',e.sender_verified,e.state_changed,e.replay_state_advanced,e.audit_persisted,e.input_sha256??'']);
   const csv=toCsv([head,...rows]);
   const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='kavach-decisions-'+state!.session_id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   notify(`Exported ${page.events.length} decision records as CSV. No secret material is included.`);
  }).catch(e=>notify((e as Error).message));
 }
 async function exportEvidence(){try{const data=await api<unknown>('/export?session_id='+state!.session_id);download(data,'kavach-evidence-'+state!.session_id+'.json');notify('Session evidence exported as JSON.')}catch(e){notify((e as Error).message)}}
 function download(data:Any,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 function chooseScenario(id:string){setPage('console');generate(id);window.scrollTo({top:0,behavior:'smooth'});}
 async function copy(){try{await navigator.clipboard.writeText(editor);setCopied(true);setTimeout(()=>setCopied(false),2000)}catch{notify('Select the editor text and use your browser’s copy shortcut.')}}
 let parsed:Any=null;try{parsed=JSON.parse(editor)}catch{}
 const modified=!!signed&&editor!==signed;
 const expires=parsed?.expires_at?Math.max(0,parsed.expires_at-Math.floor(now/1000)):0;
 const accepted=result?.verdict==='ACCEPTED',rejected=result?.verdict==='REJECTED';
 const counts={accepted:audit.filter(e=>e.verdict==='ACCEPTED').length,rejected:audit.filter(e=>e.verdict==='REJECTED').length};
 const activeScenario=scenarios.find(x=>x.id===selectedScenario)??null;
 const threatMeta:ScenarioMeta|null=activeScenario?{id:activeScenario.id,name:activeScenario.name,desc:activeScenario.desc,expected:activeScenario.expected,tone:activeScenario.tone,intent:activeScenario.intent,threat:activeScenario.threat,changed:activeScenario.changed}:null;
 const isOnline=health?.status==='online';
 // Metrics, anomalies and policy are fetched on navigation, not on a timer, so the
 // numbers on screen always match the records behind them.
 useEffect(()=>{
  setNavOpen(false);
  if(page==='metrics')loadMetrics();
  if(page==='policy')loadPolicy();
 },[page]);

 useEffect(()=>{
  if(!detail&&!help&&!confirm)return;
  const previous=document.activeElement as HTMLElement|null;
  const dialog=document.querySelector<HTMLElement>('[role="dialog"]');
  const background=[document.querySelector('header'),document.querySelector('main')];
  background.forEach(el=>{if(el)el.inert=true});
  const controls=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]')??[]);
  controls()[0]?.focus();
  const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const items=controls();const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}};
  document.addEventListener('keydown',trap);
  return()=>{document.removeEventListener('keydown',trap);background.forEach(el=>{if(el)el.inert=false});previous?.focus()};
 },[detail,help,confirm]);
 return <div className={'app-shell page-'+page+(sidebarCollapsed?' sidebar-collapsed':'')}>
  <header className="topbar">
   <a className="brand" href="#" onClick={e=>{e.preventDefault();setPage('console')}} aria-label="Kavach mission console"><span className="brandmark"><Shield size={18} strokeWidth={1.7}/><span className="brand-dot"/></span><span>KAVACH</span><span className="brand-subtitle">Satellite security<br/>Command validation simulator</span></a>
   <nav id="mission-navigation" aria-label="Main navigation" className={navOpen?'open':''} onClick={()=>setNavOpen(false)}>{([{id:'console',label:'Console',icon:Terminal},{id:'demo',label:'Demo',icon:Play},{id:'scenarios',label:'Scenarios',icon:FlaskConical},{id:'timeline',label:'Timeline',icon:ListOrdered},{id:'compare',label:'Compare',icon:FileDiff},{id:'metrics',label:'Metrics',icon:BarChart3},{id:'audit',label:'Audit',icon:FileJson},{id:'policy',label:'Policy',icon:Users}] as const).map(n=><button key={n.id} aria-label={n.label} title={n.label} aria-current={page===n.id?'page':undefined} className={page===n.id?'nav-item active':'nav-item'} onClick={()=>{setPage(n.id);setPageOffset(0);setQuery('');setToast('')}}><n.icon size={16}/><span className="nav-label">{page==='console'?({console:'Mission Console',demo:'Guided Demo',scenarios:'Scenario Lab',timeline:'Attack Timeline',compare:'Comparison',metrics:'Metrics',audit:'Audit & Evidence',policy:'Policy'}[n.id]):n.label}</span>{page===n.id&&<span className="nav-dot"/>}</button>)}</nav>
   <div className="top-right">{page==='console'&&<button className="icon-btn sidebar-toggle" aria-label={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'} aria-expanded={!sidebarCollapsed} aria-controls="mission-navigation" onClick={()=>setSidebarCollapsed(v=>!v)}><Menu size={17}/></button>}<span className="local-label"><span className="live-dot"/>Local simulation</span><span className="header-divider"/><button className="icon-btn nav-toggle" aria-expanded={navOpen} aria-label="Toggle navigation" title="Navigation" onClick={()=>setNavOpen(o=>!o)}><Menu size={17}/></button><button className="icon-btn help-button" title="About this simulator" onClick={()=>setHelp(true)}><BookOpen size={17}/></button></div>
  </header>
  <main>
   <section className="page-heading">
    <div><div className="heading-line"><h1>{page==='console'?'Mission Console':page==='demo'?'Guided Demo':page==='scenarios'?'Scenario Lab':page==='timeline'?'Attack Timeline':page==='compare'?'Normal vs Attack':page==='metrics'?'Security Metrics':page==='policy'?'Policy Model':'Audit & Evidence'}</h1><span className="version-label">V1.0</span></div><p>{page==='console'?'Compose message / Validate security / Inspect receiver decision':page==='demo'?'A 90-second walkthrough of the core security story. You press submit.':page==='scenarios'?'Test command validation and telemetry in the local simulator.':page==='timeline'?'The receiver’s ordered checks, in the order they actually run.':page==='compare'?'A valid message beside a malicious one, both real submissions.':page==='metrics'?'Counters computed from persisted records. Nothing is hardcoded.':page==='policy'?'Server-authoritative roles and permissions. Read-only.':'A traceable record of every accepted and rejected message.'}</p></div>
    <div className="heading-actions"><button className="btn secondary" onClick={()=>setConfirm(true)}><Plus size={15}/>New demo session</button><button className="btn secondary" onClick={resetDemo} disabled={!!busy} title="Reset to the documented initial state. History and keys are preserved."><RotateCcw size={15}/>Reset</button><button className="btn secondary" onClick={exportEvidence} disabled={!state}><Download size={15}/>Export JSON<ArrowUpRight size={13} className="muted"/></button>
      {page==='audit'&&<button className="btn secondary" onClick={exportAuditCsv} disabled={!state||!audit.length}><Download size={15}/>Export CSV</button>}</div>
   </section>
   <div className="status-strip">
    <div className="strip-item"><span className={'status-dot '+(isOnline?'online':'offline')}/><span>API <strong>{isOnline?'Connected':health?'Offline':'Connecting'}</strong></span></div>
    <div className="strip-item"><Satellite size={14}/><span>Target <strong className="mono">KAVACH-SAT-01</strong></span></div>
    <div className="strip-item"><LockKeyhole size={13}/><span>Authentication <strong>HMAC-SHA256</strong></span></div>
    <div className="strip-item session-item"><span>Session</span><code>{state?.session_id||'CONNECTING'}</code><button className="small-icon" title="Show simulator information" onClick={()=>setHelp(true)}><Info size={12}/></button></div>
    <div className="synthetic-label"><span/>SYNTHETIC DATA ONLY</div>
   </div>
   {page==='console'&&<>
    <div className="console-grid">
     <section className="panel builder-panel">
      <div className="panel-heading"><div className="panel-title"><Terminal size={17}/><h2>Message builder</h2></div><span className="workstation-label">Compose</span></div>
      <div className="builder-body">
       <div className="segmented" role="group" aria-label="Message type"><button aria-pressed={kind==='COMMAND'} className={kind==='COMMAND'?'selected':''} onClick={()=>{setKind('COMMAND');setSender('operator-01');setAction('SET_MODE')}}><Terminal size={14}/>Command</button><button aria-pressed={kind==='TELEMETRY'} className={kind==='TELEMETRY'?'selected':''} onClick={()=>{setKind('TELEMETRY');setSender('satellite-01')}}><Radio size={14}/>Telemetry</button></div>
       <div className="field"><label htmlFor="sender">Synthetic sender <span title="Permissions are enforced by the receiver, not the builder."><Info size={12}/></span></label><div className="select-wrap"><span className="select-prefix"><Fingerprint size={15}/></span><select id="sender" value={sender} onChange={e=>setSender(e.target.value)}><option value="operator-01">operator-01</option><option value="observer-01">observer-01</option><option value="satellite-01">satellite-01</option></select><ChevronDown size={13}/></div></div>
       <div className="fields-row"><div className="field action-field"><label htmlFor="action">{kind==='COMMAND'?'Command':'Action'}</label><div className="select-wrap"><select id="action" value={kind==='TELEMETRY'?'TELEMETRY_STATUS':action} onChange={e=>setAction(e.target.value)}>{kind==='TELEMETRY'?<option>TELEMETRY_STATUS</option>:<><option>SET_MODE</option><option>GET_STATUS</option><option>SET_REPORT_INTERVAL</option></>}</select><ChevronDown size={13}/></div></div>
       {(action==='SET_MODE'||kind==='TELEMETRY')&&<div className="field mode-field"><label htmlFor="mode">Mode</label><div className="select-wrap"><select id="mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="POWER_SAVING">Power saving</option><option value="NORMAL">Normal</option><option value="SAFE">Safe</option></select><ChevronDown size={13}/></div></div>}
       {action==='SET_REPORT_INTERVAL'&&kind==='COMMAND'&&<div className="field mode-field"><label htmlFor="seconds">Interval · seconds</label><input id="seconds" type="number" min={1} max={60} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></div>}
       </div>
       {kind==='TELEMETRY'&&<div className="fields-row telemetry-fields"><div className="field"><label htmlFor="battery">Battery · %</label><input id="battery" type="number" value={battery} onChange={e=>setBattery(Number(e.target.value))}/></div><div className="field"><label htmlFor="temperature">Temperature · °C</label><input id="temperature" type="number" value={temp} onChange={e=>setTemp(Number(e.target.value))}/></div></div>}
       <button className="btn generate-btn" onClick={()=>generate()} disabled={!!busy||!isOnline}>{busy==='generate'?<LoaderCircle size={14} className="spin"/>:<RefreshCw size={14}/>}Generate fresh signed sample<Plus size={14}/></button>
      </div>
      <div className="editor-section"><div className="editor-toolbar"><div className="editor-tabs"><button aria-pressed={view==='json'} className={view==='json'?'selected':''} onClick={()=>setView('json')}><Code2 size={13}/>JSON payload</button><button aria-pressed={view==='info'} className={view==='info'?'selected':''} onClick={()=>setView('info')}>Contract</button></div><div className="editor-actions"><button title="Format JSON without re-signing" onClick={()=>{const formatted=formatEditorJSON(editor);if(formatted.warning)notify(formatted.warning);else setEditor(formatted.text)}}><span className="format-icon">{'{ }'}</span></button><button title="Copy exact message" onClick={copy}>{copied?<Check size={13}/>:<Copy size={13}/>}</button></div></div>
       {view==='json'?<MessageEditor value={editor} onChange={setEditor} inputRef={editorRef}/>:<div className="contract-view"><h3>Message contract · v1</h3><p>Exact envelope fields. ASCII strings and strict integers. Maximum 8 KiB.</p><dl><dt>Lifetime</dt><dd>1–60 seconds</dd><dt>Future clock skew</dt><dd>Up to 5 seconds</dd><dt>Sequence</dt><dd>Strictly increasing per stream</dd><dt>Signing</dt><dd>Sorted keys, compact JSON, UTF-8</dd></dl><p>Editing never re-signs a message. Whitespace and key order do not change its HMAC.</p></div>}
       <div className={'signature-status '+(modified?'modified':'')}><span>{modified?<AlertTriangle size={12}/>:<LockKeyhole size={12}/>} {modified?'Modified since signing':signed?'Signed by local fixture issuer':'No signed fixture loaded'}</span><span className={editor&&parsed&&expires===0?'expired-label':''}>{parsed?(expires?`${expires}s left`:'Expired')+' · ':''}{editor?`${new Blob([editor]).size} B`:'—'}</span></div>
      </div>
      <div className="builder-footer">{submitError&&<p className="inline-error" role="alert">{submitError}</p>}<button className="btn primary submit-btn" disabled={!!busy||!isOnline||!editor} onClick={submit}>{busy==='submit'?<LoaderCircle size={15} className="spin"/>:<Send size={15}/>} {busy==='submit'?'Validating message…':'Submit for validation'}<ArrowRight size={16}/></button><p><Shield size={11}/>Exact editor bytes sent. Never silently re-signed.</p></div>
     </section>
     <ValidationPipeline operational result={result} expectation={resultExpectation} busy={busy} onInspect={setDetail} onHelp={()=>setHelp(true)}/>
     <aside className="state-column">
      <section className="panel spacecraft-panel"><div className="panel-heading"><div className="panel-title"><Satellite size={16}/><h2>Spacecraft state</h2></div><span className="model-label">Simulated</span></div>

       <div className="spacecraft-meta"><span className="tiny-caps">PROTECTED SIMULATED STATE</span><h3>KAVACH-SAT-01 <ArrowUpRight size={13}/></h3></div>
       <div className="state-values"><div><span>Operating mode</span><Badge tone={state?.protected_state?.mode==='SAFE'?'amber':'blue'}>{state?modeShort(state.protected_state.mode):'Unavailable'}</Badge></div><div><span>Reporting interval</span><strong className="mono">{state?.protected_state.report_interval_s??'Unavailable'}<small> sec</small></strong></div></div>
       <div className="model-values"><div><span>Antenna <span title="Synthetic model output derived from mode. Not settable by any message.">?</span></span><strong className="mono">{state?.protected_state.antenna_status??'Unavailable'}</strong></div><div><span>Power level <span title="Synthetic model output derived from mode. Not settable by any message.">?</span></span><strong className="mono">{state?.protected_state.power_level_pct??'Unavailable'}<small> %</small></strong></div></div>
       <div className="state-schema-note"><Info size={11}/><span>Synthetic model fields, derived from operating mode. State schema v{state?.state_schema_version??'—'}.</span></div>
       {result&&<div className={'state-proof '+(result.state_changed?'changed':'')}><CheckCheck size={13}/>{result.state_changed?'Committed state update verified':result.protected_state_before&&result.protected_state_after?'Protected spacecraft state unchanged':'State snapshot unavailable'}</div>}
      </section>
      <section className="panel telemetry-panel"><div className="panel-heading"><div className="panel-title"><Radio size={15}/><h2>Received telemetry</h2></div><span className="subtle-dot"/></div>
       {state?.latest_telemetry?<><div className="telemetry-reading"><div><span><BatteryMedium size={13}/>Battery</span><strong>{state.latest_telemetry.battery_pct}<small>%</small></strong><div className="battery-bar"><span style={{width:state.latest_telemetry.battery_pct+'%'}}/></div></div><div><span><Thermometer size={13}/>Temperature</span><strong>{state.latest_telemetry.temperature_c}<small>°C</small></strong><div className="temperature-range" title="Synthetic simulator bounds: −50°C to 120°C"><span style={{left:Math.max(0,Math.min(100,(state.latest_telemetry.temperature_c+50)/170*100))+'%'}}/></div></div></div><div className="telemetry-bottom"><span>Reported mode</span><span>{modeShort(state.latest_telemetry.mode)}</span></div><div className="telemetry-note"><span className="status-dot online"/>{state.latest_telemetry.source} · {fmtTime(state.latest_telemetry.received_at)}</div></>:<div className="telemetry-empty"><Activity size={26} strokeWidth={1}/><p>Awaiting first snapshot</p><span>Accepted telemetry will appear here.</span><button onClick={()=>generate('telemetry')}>Generate telemetry<ArrowRight size={12}/></button></div>}
       <div className="telemetry-disclaimer"><Info size={11}/><span>Received data only. Does not overwrite spacecraft state.</span></div>
      </section>

     </aside>
    </div>
      <div className="quick-lab"><div><FlaskConical size={15}/><h3>Load a test fixture</h3><span className="tiny-caps">SCENARIO LAB</span></div><p>Choose a scenario, then submit to see the actual decision.</p><div className="quick-actions"><button onClick={()=>generate('tampered')}><Fingerprint size={12}/>Tamper</button><button onClick={()=>generate('replay')}><RotateCcw size={12}/>Replay</button><button title="Open all scenarios" onClick={()=>setPage('scenarios')}><ArrowUpRight size={14}/></button></div><div className="quick-actions scenario-shortcuts"><button onClick={()=>generate('unauthorised')}><Shield size={12}/>Unauthorised</button><button onClick={()=>generate('telemetry')}><Radio size={12}/>Telemetry fixture</button><button onClick={()=>generate('unknown_key')}><Fingerprint size={12}/>Unknown key</button><button onClick={()=>generate('malformed')}><Code2 size={12}/>Malformed JSON</button></div>
       <div className="quick-actions scenario-shortcuts"><span className="tiny-caps">COMPARE</span><button onClick={()=>rememberForCompare('normal')} disabled={!result}><CheckCircle2 size={12}/>Capture normal</button><button onClick={()=>rememberForCompare('attack')} disabled={!result}><Fingerprint size={12}/>Capture attack</button><button onClick={()=>setPage('compare')} title="Open the side-by-side comparison"><ArrowUpRight size={12}/></button></div></div>
    {threatMeta&&<details className="scenario-context"><summary>Scenario context & expected outcome<ChevronDown size={14}/></summary><ThreatPanel scenario={threatMeta} result={result} expectation={resultExpectation}/></details>}
    <section className="panel audit-panel console-audit"><div className="audit-heading"><div className="panel-title"><Activity size={16}/><h2>Recent activity</h2><span className="count-pill">{auditTotal}</span></div><div className="audit-heading-right"><span className="legend"><i className="green-dot"/>{counts.accepted} accepted<i className="red-dot"/>{counts.rejected} rejected<span className="recent-label">in view</span></span><button className="text-btn" onClick={()=>setPage('audit')}>View all activity<ArrowUpRight size={13}/></button></div></div><AuditTable events={audit} onDetail={setDetail}/>{!audit.length&&<div className="table-empty"><span className="empty-orbit"><Activity size={20}/></span><div><strong>Your mission starts here</strong><p>Submit a signed message to create your first audit event.</p></div><span className="mono">AWAITING UPLINK</span></div>}</section>
   </>}
   {page==='scenarios'&&<ScenarioLab scenarios={scenarios} busy={busy} online={isOnline} report={report} error={suiteError} decision={result} onLoad={chooseScenario} onRunSuite={runSuite} onInspect={setDetail} onExport={()=>download(report,'kavach-scenario-results.json')}/>}
   {page==='demo'&&<GuidedDemo index={demoIndex} result={result} expected={resultExpectation??expectation} busy={busy} onNavigate={setDemoIndex} onRunStep={runDemoStep}/>}
   {page==='timeline'&&<div className="timeline-page"><AttackTimeline result={result} currentSession={state?.session_id} onInspect={setDetail} onNavigate={setPage}/></div>}
   {page==='compare'&&<ComparisonView normal={{label:'Normal message',result:compareNormal,raw:compareNormal?.submitted_text??''}} attack={{label:'Attack message',result:compareAttack,raw:compareAttack?.submitted_text??''}} currentResult={result} onCaptureNormal={()=>rememberForCompare('normal')} onCaptureAttack={()=>rememberForCompare('attack')} onClearNormal={()=>{setCompareNormal(null);notify('Baseline capture cleared.')}} onClearAttack={()=>{setCompareAttack(null);notify('Comparison capture cleared.')}} onClearBoth={()=>{setCompareNormal(null);setCompareAttack(null);notify('Both comparison records cleared.')}} onSwap={()=>{setCompareNormal(compareAttack);setCompareAttack(compareNormal);notify('Swapped Baseline and Comparison captures.')}} onInspect={setDetail} onNavigate={setPage}/>}
   {page==='metrics'&&<MetricsDashboard metrics={metrics} anomalies={anomalies} loading={busy==='metrics'} onRefresh={loadMetrics} onNavigate={setPage}/>}
   {page==='policy'&&<section className="panel policy-panel" aria-label="Policy model"><div className="panel-heading"><div className="panel-title"><Users size={17}/><h2>Policy model</h2></div><span className="workstation-label">Read-only</span></div>
    {!policy?<div className="metrics-empty"><Users size={22} strokeWidth={1}/><p>Policy is unavailable. The local API may be offline.</p></div>:<>
     <p className="metrics-note">{policy.note} Policy version <code>{policy.policy_version}</code>. Roles are evaluated by the receiver; no message field can grant one.</p>
     <div className="policy-roles">{policy.roles.map(r=><div key={r.role} className="policy-role"><div className="policy-role-head"><h3>{r.role}</h3><Badge tone={r.senders.length?'blue':'neutral'}>{r.senders.length?r.senders.join(', '):'no default sender'}</Badge></div><p>{r.label}</p>
      <div className="policy-perms">{Object.entries(r.permissions).map(([kind,actions])=><div key={kind}><span className="tiny-caps">{kind}</span><div>{actions.length?actions.map(a=><code key={a}>{a}</code>):<em>none</em>}</div></div>)}</div></div>)}</div>
     <div className="policy-boundary"><Shield size={14}/><div><strong>Administrative boundary</strong><p>Modifying roles requires <code>KAVACH_ALLOW_POLICY_ADMIN=1</code> on a trusted loopback launch. It is disabled by default, is not public authorization, and is never exposed to an untrusted client. Every accepted change is versioned, attributed, audited, and chained.</p></div></div>
    </>}</section>}
   {page==='audit'&&<AuditWorkspace
      events={audit}
      total={auditTotal}
      loading={busy==='audit'}
      currentSession={state?.session_id}
      query={query}
      setQuery={setQuery}
      filter={filter}
      setFilter={setFilter}
      stageFilter={stageFilter}
      setStageFilter={setStageFilter}
      senderFilter={senderFilter}
      setSenderFilter={setSenderFilter}
      typeFilter={typeFilter}
      setTypeFilter={setTypeFilter}
      sessionFilter={sessionFilter}
      setSessionFilter={setSessionFilter}
      sinceFilter={sinceFilter}
      setSinceFilter={setSinceFilter}
      untilFilter={untilFilter}
      setUntilFilter={setUntilFilter}
      pageOffset={pageOffset}
      setPageOffset={setPageOffset}
      onRefresh={()=>loadAudit().catch(()=>setAuditError('Audit history is unavailable. Retry when the local API is connected.'))}
      onExportCsv={exportAuditCsv}
      onExportEvidence={exportEvidence}
      chainReport={chain}
      onVerifyChain={verifyChain}
      chainBusy={busy==='chain'}
      chainError={chainError}
      onInspect={setDetail}
      onNavigate={setPage}
      auditError={auditError}
   />}
   {auditError&&<div className="inline-error" role="alert">{auditError}<button className="btn secondary" onClick={()=>loadAudit().catch(()=>setAuditError('Audit history is still unavailable. Check the local API and retry.'))}>Retry audit</button></div>}<footer className="page-footer"><span><span className="footer-logo">◈</span>KAVACH<span className="footer-slash">/</span>LOCAL SATELLITE SECURITY SIMULATOR</span><span><span className="tiny-green-dot"/>No live command channel<span className="footer-divider">·</span><button onClick={()=>setHelp(true)}>Policy v1.0<ArrowUpRight size={10}/></button></span></footer>
  </main>
  {toast&&<div role="status" className="toast"><CircleCheck size={17}/><span>{toast}</span><button onClick={()=>setToast('')} aria-label="Dismiss notification"><X size={14}/></button></div>}
  {detail&&<div className="modal-backdrop" onClick={()=>setDetail(null)}><section className="detail-modal" role="dialog" aria-modal="true" aria-label="Validation decision" onClick={e=>e.stopPropagation()}><div className="modal-heading"><div><h2>Every check. On record.</h2></div><button className="icon-btn" onClick={()=>setDetail(null)} aria-label="Close decision"><X size={20}/></button></div><div className="detail-content"><div className="detail-verdict"><Badge tone={detail.verdict==='ACCEPTED'?'green':'red'}>{detail.verdict}</Badge><code>{detail.reason_code}</code><span>{detail.received_at?fmtTime(detail.received_at):''}</span></div><p className="detail-explanation">{detail.explanation}</p><div className="detail-id"><span>EVENT ID</span><code>{detail.event_id||'Not persisted — service failure'}</code></div><div className="detail-id"><span>SESSION</span><code>{detail.session_id||'Fault-injection database — not persisted'}</code></div><div className="state-comparison"><div><span>PROTECTED STATE · BEFORE</span><pre>{JSON.stringify(detail.protected_state_before,null,2)}</pre></div><ArrowRight size={16}/><div><span>PROTECTED STATE · AFTER</span><pre>{JSON.stringify(detail.protected_state_after,null,2)}</pre></div></div>
       <p className="detail-disclaimer">Antenna status and power level are synthetic model outputs derived from the operating mode. No message can set them, and they are not spacecraft telemetry.</p><div className="detail-proof"><Shield size={13}/>{detail.state_changed?'Protected state changed in committed transaction.':'No protected spacecraft state change.'} · {detail.sender_verified?'Sender verified':'Sender unverified'}</div><h3 className="detail-subtitle">Validation trace</h3><div className="detail-trace">{detail.checks?.map((c:import('./types').ValidationCheck)=><div key={c.stage}><span className={c.status==='PASS'?'green':c.status==='FAIL'?'red':'muted'}>{c.status==='PASS'?<CircleCheck size={15}/>:c.status==='FAIL'?<CircleX size={15}/>:<CircleDot size={15}/>}</span><div><strong>{c.label}</strong><p>{c.explanation}</p></div><code>{c.status}</code></div>)}</div>{detail.message&&<><h3 className="detail-subtitle">Bounded submitted message</h3><pre className="message-preview">{JSON.stringify(detail.message,null,2)}</pre></>}<div className="detail-id"><span>POLICY</span><code>{detail.policy_version}</code></div><div className="detail-id hash"><span>INPUT SHA-256</span><code>{detail.input_sha256||'Unavailable'}</code></div><p className="detail-disclaimer">Synthetic application record. Not immutable or tamper-proof. No secret key is included.</p></div><div className="modal-footer"><button className="btn secondary" onClick={()=>download(detail,'kavach-decision-'+(detail.event_id||'error')+'.json')}><Download size={14}/>Export decision</button><button className="btn primary" onClick={()=>setDetail(null)}>Done<Check size={14}/></button></div></section></div>}
  {help&&<div className="modal-backdrop" onClick={()=>setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-label="About Kavach" onClick={e=>e.stopPropagation()}><div className="modal-heading"><div><h2>A simulator. Not a live uplink.</h2></div><button className="icon-btn" onClick={()=>setHelp(false)} aria-label="Close information"><X size={19}/></button></div><div className="help-body"><p>Kavach validates synthetic satellite commands and telemetry before applying them to a protected local model. All verdicts and state changes come from the Python backend.</p><div className="help-block"><LockKeyhole size={19}/><div><h3>Every command verified</h3><p>Strict schemas, HMAC-SHA256, 60-second lifetimes, receiver permissions, and persistent replay protection. Rejected messages never change protected state.</p></div></div><div className="help-block"><Activity size={19}/><div><h3>Every decision traceable</h3><p>State, replay records, and acceptance logs commit in one SQLite transaction. Ordinary reloads retain your session. A new demo session creates an isolated namespace.</p></div></div><div className="help-block"><FlaskConical size={19}/><div><h3>Deliberately synthetic</h3><p>The privileged fixture issuer can create signed but unauthorised messages. No physical spacecraft, RF link, external feed, or production identity service is involved.</p></div></div><div className="help-limitations">HMAC provides integrity and shared-key authentication, not encryption or proof of physical reality. Audit records are not tamper-proof. Passing scenarios covers these cases only.</div></div><div className="modal-footer"><span className="mono">kavach-policy/1.0</span><button className="btn primary" onClick={()=>setHelp(false)}>Back to mission<ArrowRight size={14}/></button></div></section></div>}
  {confirm&&<div className="modal-backdrop" onClick={()=>setConfirm(false)}><section className="confirm-modal" role="dialog" aria-modal="true" aria-label="New demo session" onClick={e=>e.stopPropagation()}><div className="confirm-icon"><Plus size={25}/></div><h2>Start a fresh mission?</h2><p>This creates a new isolated session with normal mode, a 10-second reporting interval, and a fresh replay stream. Existing audit history, chain links, and signing keys are preserved. For a reset to the documented initial state instead, use <strong>Reset</strong> in the header.</p><div className="confirm-buttons"><button className="btn secondary" onClick={()=>setConfirm(false)}>Keep current session</button><button className="btn primary" onClick={newSession} disabled={!!busy}>{busy==='session'?<LoaderCircle size={14} className="spin"/>:<Plus size={14}/>}Create session</button></div></section></div>}
 </div>
}

function Spacecraft({mode}:{mode:string}){return <div className="spacecraft-visual"><span className="visual-coord top">LOCAL MODEL / 001</span><span className="visual-coord bottom">SIMULATED · NOT TO SCALE</span><span className="visual-cross c1">+</span><span className="visual-cross c2">+</span><span className="visual-cross c3">+</span><span className="visual-cross c4">+</span><svg viewBox="0 0 320 194" role="img" aria-label="Synthetic satellite diagram"><defs><pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M 22 0 L 0 0 0 22" fill="none" stroke="#536273" strokeWidth=".35" opacity=".25"/></pattern><radialGradient id="spaceglow"><stop offset="0" stopColor="#244758" stopOpacity=".3"/><stop offset="1" stopColor="#121922" stopOpacity="0"/></radialGradient><linearGradient id="panel" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#233647"/><stop offset="1" stopColor="#111c28"/></linearGradient><linearGradient id="body" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#e0cfa7"/><stop offset="1" stopColor="#968361"/></linearGradient></defs><rect width="320" height="194" fill="url(#grid)"/><ellipse cx="160" cy="103" rx="133" ry="90" fill="url(#spaceglow)"/><ellipse cx="160" cy="103" rx="111" ry="39" fill="none" stroke="#445364" strokeWidth=".7" strokeDasharray="3 5" transform="rotate(-22 160 103)"/><ellipse cx="160" cy="103" rx="76" ry="68" fill="none" stroke="#293d4a" strokeWidth=".6" transform="rotate(35 160 103)"/><path d="M74 151A111 39 -22 0 1 249 55" fill="none" stroke="#ce855d" strokeWidth=".7" strokeOpacity=".5"/><circle cx="250" cy="55" r="3" fill="#f18a58"/><circle cx="250" cy="55" r="6" fill="none" stroke="#f18a58" strokeOpacity=".2"/><g transform="translate(160 100) rotate(-27)"><path d="M-84 -20H-28V20H-84Z" fill="url(#panel)" stroke="#607e96" strokeWidth="1"/><path d="M28 -20H84V20H28Z" fill="url(#panel)" stroke="#607e96" strokeWidth="1"/>{[-70,-56,-42,42,56,70].map(x=><path key={x} d={`M${x} -20V20`} stroke="#577b96" strokeWidth=".6"/>)}<path d="M-84 -7H-28M-84 7H-28M28 -7H84M28 7H84" stroke="#577b96" strokeWidth=".6"/><path d="M-28 0H28" stroke="#d1c3a6" strokeWidth="3"/><path d="M-18 -23 5 -29 22 -18V20L0 28 -18 18Z" fill="url(#body)" stroke="#e9d5a8" strokeWidth=".8"/><path d="M-18 -23 0 -13 22 -18M0 -13V28" fill="none" stroke="#4d463a" strokeWidth="1"/><path d="M-13 -14-5 -10V17L-13 13Z" fill="#736d5b" stroke="#a99b7a" strokeWidth=".5"/><path d="M4 -7 17 -10V13L4 18Z" fill="#b3a17e" stroke="#d5c198" strokeWidth=".5"/><circle cx="10" cy="3" r="5" fill="#14212a" stroke="#635b4b" strokeWidth="1.4"/><circle cx="10" cy="3" r="2.1" fill={mode==='SAFE'?'#efbd72':'#76bbac'}/><path d="M0 -27V-40M-8 -41Q0 -33 8 -41" fill="none" stroke="#d2d7d5" strokeWidth="1.2"/><path d="M-8 -43Q0 -48 8 -43" fill="none" stroke="#e1e5de" strokeWidth="1"/><path d="M3 28 3 35 11 37" fill="none" stroke="#c3c9c8" strokeWidth="1"/></g><path d="M259 158H275M267 150V166" stroke="#45515f" strokeWidth=".8"/><circle cx="59" cy="54" r="1" fill="#7896a6"/><circle cx="281" cy="100" r="1" fill="#7896a6"/></svg></div>}

function Website(){
 const [entered,setEntered]=useState(false);
 function enter(){setEntered(true);window.scrollTo({top:0,behavior:'instant'});requestAnimationFrame(()=>{const heading=document.querySelector<HTMLElement>('.app-shell h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}})}
 return entered?<div className="mission-entry"><App/></div>:<LandingPage onEnter={enter}/>;
}

createRoot(document.getElementById('root')!).render(<Website/>);
