/* Self-contained browser-only prototype adapter. Never uses production keys or APIs.
   This is deliberately NOT the Python/SQLite security boundary. Runtime data is in memory. */
(() => {
'use strict';
const TARGET='KAVACH-SAT-01', POLICY='browser-prototype/1.0';
const registry={'operator-key-01':'operator-01','observer-key-01':'observer-01','satellite-key-01':'satellite-01'};
const fieldList=['version','message_id','message_type','sender_id','target_id','key_id','sequence','issued_at','expires_at','action','payload','auth_tag'];
const labels=['Message structure','Sender identity','HMAC authentication','Payload & target','Timestamp validity','Sender permissions','Replay protection','State commit'];
const stageIds=['structure','identity','authentication','payload','time','permissions','replay','commit'];
const MODES=['NORMAL','POWER_SAVING','SAFE'];
const bytes=new TextEncoder();
const clone=x=>JSON.parse(JSON.stringify(x));
const uuid=()=>{const b=crypto.getRandomValues(new Uint8Array(16)); b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`};
const now=()=>Math.floor(Date.now()/1000);
const sessions=new Map();let active;const events=[],suites=[];const keyMap=new Map();
const keysReady=(async()=>{for(const id of Object.keys(registry)){const seed=crypto.getRandomValues(new Uint8Array(32));keyMap.set(id,await crypto.subtle.importKey('raw',seed,{name:'HMAC',hash:'SHA-256'},false,['sign']));}})();
function newSession(activate=true){const id='WEB-'+uuid().slice(0,8).toUpperCase();sessions.set(id,{state:{mode:'NORMAL',report_interval_s:10},telemetry:null,issued:{},streams:{},ids:{}});if(activate)active=id;return id}
newSession();
function session(id=active){const s=sessions.get(id);if(!s)throw Error('Unknown browser prototype session');return s}
function state(id=active){const s=session(id);return{session_id:id,protected_state:clone(s.state),latest_telemetry:clone(s.telemetry),target_id:TARGET,policy_version:POLICY}}
function sorted(v){if(v&&typeof v==='object'&&!Array.isArray(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]));return v}
function canonical(m){return JSON.stringify(sorted(Object.fromEntries(Object.entries(m).filter(([k])=>k!=='auth_tag'))))}
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
async function sign(m){await keysReady;return hex(await crypto.subtle.sign('HMAC',keyMap.get(m.key_id),bytes.encode(canonical(m))))}
async function hash(raw){return hex(await crypto.subtle.digest('SHA-256',bytes.encode(raw)))}
async function issue(opts={},id=active){
 const sender=opts.sender_id||'operator-01',kind=opts.message_type||'COMMAND',s=session(id),key=Object.keys(registry).find(k=>registry[k]===sender);
 if(!key)throw Error('Unknown synthetic sender');
 const stream=sender+'|'+TARGET+'|'+kind;const seq=Math.max(s.issued[stream]||0,s.streams[stream]||0)+1;s.issued[stream]=seq;
 const issued=now()+(opts.offset||0);
 const m={version:1,message_id:uuid(),message_type:kind,sender_id:sender,target_id:TARGET,key_id:key,sequence:seq,issued_at:issued,expires_at:issued+60,action:opts.action||'SET_MODE',payload:opts.payload===undefined?{mode:'POWER_SAVING'}:opts.payload};
 m.auth_tag=await sign(m);return m;
}
function invalid(code,text){throw Object.assign(new Error(text),{code})}
function strictParse(text){
 JSON.parse(text); // Native syntax validation first.
 let pos=0;
 const ws=()=>{while(/\s/.test(text[pos]||'')&&pos<text.length)pos++};
 function read(depth){
  if(depth>4)invalid('SCHEMA_INVALID','Maximum nesting depth is four levels.');
  ws();const c=text[pos];
  if(c==='"'){const start=pos++;while(pos<text.length){if(text[pos]==='\\'){pos+=2;continue}if(text[pos++]==='"')break}return JSON.parse(text.slice(start,pos))}
  if(c==='{'){pos++;ws();const obj=Object.create(null),seen=new Set();if(text[pos]==='}'){pos++;return obj}while(true){ws();const k=read(depth+1);if(seen.has(k))invalid('INVALID_JSON','Duplicate JSON key: '+k);seen.add(k);ws();pos++;obj[k]=read(depth+1);ws();if(text[pos++]==='}')break}return obj}
  if(c==='['){pos++;ws();const out=[];if(text[pos]===']'){pos++;return out}while(true){out.push(read(depth+1));ws();if(text[pos++]===']')break}return out}
  const match=text.slice(pos).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/);
  if(!match)invalid('INVALID_JSON','Invalid JSON value.');pos+=match[0].length;return JSON.parse(match[0]);
 }
 return read(1);
}
function shape(v,depth=1){
 if(depth>4)invalid('SCHEMA_INVALID','Maximum nesting depth is four levels.');
 if(v&&typeof v==='object'&&!Array.isArray(v)){for(const[k,x]of Object.entries(v)){if(!/^[\x00-\x7F]*$/.test(k))invalid('SCHEMA_INVALID','ASCII field names required.');shape(x,depth+1)}return}
 if(typeof v==='string'&&/^[\x00-\x7F]*$/.test(v))return;
 if(typeof v==='number'&&Number.isSafeInteger(v))return;
 invalid('SCHEMA_INVALID','Only safe integers, ASCII strings, and objects are supported in this browser prototype. No coercion.');
}
function equalFields(obj,fields){return obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).sort().join('|')===[...fields].sort().join('|')}
function safeMessage(m){if(!m||typeof m!=='object'||Array.isArray(m))return null;return Object.fromEntries(Object.entries(m).filter(([k])=>fieldList.includes(k)))}
async function validate(raw,id=active){
 const started=performance.now(),s=session(id),before=clone(s.state),telemetryBefore=clone(s.telemetry),received=now();
 const checks=stageIds.map((stage,i)=>({stage,label:labels[i],status:'NOT_RUN',explanation:'Waiting for preceding checks.'}));
 let replayBefore=null;
 let idx=0,m=null,verified=false,verdict='REJECTED',code='SCHEMA_INVALID',explanation='',after=clone(before),telemetryAfter=clone(telemetryBefore);
 const pass=text=>Object.assign(checks[idx],{status:'PASS',explanation:text});
 try{
  if(bytes.encode(raw).length>8192)invalid('BODY_TOO_LARGE','Message exceeds the 8 KiB limit.');
  try{m=strictParse(raw)}catch(e){if(e.code)throw e;invalid('INVALID_JSON','Invalid JSON: '+e.message)}
  if(!equalFields(m,fieldList))invalid('SCHEMA_INVALID','Envelope must contain exactly the documented fields.');
  shape(m);
  for(const k of ['version','sequence','issued_at','expires_at'])if(!Number.isSafeInteger(m[k]))invalid('SCHEMA_INVALID',k+' must be an integer.');
  if(m.version!==1||m.sequence<1||m.sequence>Number.MAX_SAFE_INTEGER)invalid('SCHEMA_INVALID','Unsupported version or sequence.');
  for(const k of ['message_id','message_type','sender_id','target_id','key_id','action','auth_tag'])if(typeof m[k]!=='string')invalid('SCHEMA_INVALID',k+' must be a string.');
  for(const k of ['sender_id','key_id'])if(!/^[A-Za-z0-9_-]{1,64}$/.test(m[k]))invalid('SCHEMA_INVALID',k+' must be a bounded ASCII identifier.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.message_id))invalid('SCHEMA_INVALID','message_id must be a UUID.');
  if(!['COMMAND','TELEMETRY'].includes(m.message_type)||!m.payload||Array.isArray(m.payload)||typeof m.payload!=='object')invalid('SCHEMA_INVALID','Invalid message type or payload object.');
  if(!/^[0-9a-f]{64}$/.test(m.auth_tag))invalid('SCHEMA_INVALID','auth_tag must be 64 lowercase hexadecimal characters.');
  pass('Exact envelope, strict values, duplicate keys, nesting, and size checked in browser.');idx=1;
  if(!Object.hasOwn(registry,m.key_id))invalid('KEY_UNKNOWN','Key identifier is not registered in this preview.');
  if(registry[m.key_id]!==m.sender_id)invalid('IDENTITY_MISMATCH','Key does not match the claimed sender.');
  pass('Ephemeral browser fixture key matches the claimed synthetic sender.');idx=2;
  const expected=await sign(m);let difference=0;for(let i=0;i<64;i++)difference|=m.auth_tag.charCodeAt(i)^expected.charCodeAt(i);
  if(difference)invalid('AUTH_FAILED','HMAC does not match. Message was modified after signing.');
  verified=true;pass('Web Crypto HMAC-SHA256 verified. Browser-only demonstration, not a server trust boundary.');idx=3;
  if(m.target_id!==TARGET)invalid('TARGET_UNKNOWN','Only KAVACH-SAT-01 is a supported target.');
  const actions=m.message_type==='COMMAND'?['GET_STATUS','SET_MODE','SET_REPORT_INTERVAL']:['TELEMETRY_STATUS'];
  if(!actions.includes(m.action))invalid('ACTION_INVALID','Action is not valid for this message type.');
  const p=m.payload;
  if(m.action==='GET_STATUS'&&!equalFields(p,[]))invalid('PAYLOAD_INVALID','GET_STATUS requires an empty object.');
  if(m.action==='SET_MODE'&&(!equalFields(p,['mode'])||!MODES.includes(p.mode)))invalid('PAYLOAD_INVALID','mode must be NORMAL, POWER_SAVING, or SAFE with no extra fields.');
  if(m.action==='SET_REPORT_INTERVAL'&&(!equalFields(p,['seconds'])||!Number.isInteger(p.seconds)||p.seconds<1||p.seconds>60))invalid('PAYLOAD_INVALID','seconds must be an integer from 1 to 60.');
  if(m.action==='TELEMETRY_STATUS'&&(!equalFields(p,['battery_pct','temperature_c','mode'])||!Number.isInteger(p.battery_pct)||p.battery_pct<0||p.battery_pct>100||!Number.isInteger(p.temperature_c)||p.temperature_c< -50||p.temperature_c>120||!MODES.includes(p.mode)))invalid('PAYLOAD_INVALID','Telemetry requires exact fields; battery 0–100, temperature −50–120, and a valid mode.');
  pass('Target, action, exact payload fields, and simulator bounds checked.');idx=4;
  if(m.issued_at>received+5)invalid('CLOCK_SKEW','issued_at exceeds permitted 5-second future clock skew.');
  if(m.expires_at-m.issued_at<=0||m.expires_at-m.issued_at>60)invalid('LIFETIME_INVALID','Lifetime must be 1–60 seconds.');
  if(received>=m.expires_at||received-m.issued_at>60)invalid('EXPIRED','Message has expired at receiver time.');
  pass('Message is within its lifetime and permitted clock skew.');idx=5;
  const allowed=m.message_type==='TELEMETRY'?m.sender_id==='satellite-01':m.sender_id==='operator-01'||(m.sender_id==='observer-01'&&m.action==='GET_STATUS');
  if(!allowed)invalid('NOT_AUTHORISED','Authenticated '+m.sender_id+' is not permitted to perform '+m.action+'. A valid HMAC does not grant permission.');
  pass('Synthetic sender is authorised under the fixed preview policy.');idx=6;
  const stream=m.sender_id+'|'+TARGET+'|'+m.message_type;
  replayBefore=s.streams[stream]||0;
  if(s.ids[stream]?.has(m.message_id))invalid('REPLAY','This message ID was already accepted in this stream.');
  if(m.sequence<=(s.streams[stream]||0))invalid('OUT_OF_ORDER','Sequence must be greater than the accepted maximum.');
  pass('Message ID is new and sequence strictly increases in this in-memory stream.');idx=7;
  if(m.action==='SET_MODE')after.mode=p.mode;
  if(m.action==='SET_REPORT_INTERVAL')after.report_interval_s=p.seconds;
  if(m.message_type==='TELEMETRY')telemetryAfter={...p,received_at:received,source:'Accepted browser fixture',message_id:m.message_id};
  else if(JSON.stringify(before)!==JSON.stringify(after))telemetryAfter={battery_pct:87,temperature_c:24,mode:after.mode,received_at:received,source:'Browser satellite model'};
  s.state=clone(after);s.telemetry=clone(telemetryAfter);s.streams[stream]=m.sequence;(s.ids[stream]??=new Set()).add(m.message_id);
  pass('Applied in preview memory only. No Python transaction or SQLite persistence is claimed.');
  verdict='ACCEPTED';code='OK';explanation='All browser checks passed. '+(JSON.stringify(before)!==JSON.stringify(after)?'Simulated state updated.':'No protected state change.');
 }catch(e){code=e.code||'SERVICE_ERROR';explanation=e.message;checks[idx].status='FAIL';checks[idx].explanation=explanation;after=clone(before);telemetryAfter=clone(telemetryBefore);if(!e.code)verdict='SERVICE_ERROR'}
 const event={audit_persisted:false,replay_state_advanced:verdict==='ACCEPTED',replay_sequence_before:replayBefore,replay_sequence_after:verdict==='ACCEPTED'?m.sequence:replayBefore,event_id:uuid(),session_id:id,verdict,reason_code:code,explanation,checks,sender_verified:verified,received_at:received,protected_state_before:before,protected_state_after:after,state_changed:JSON.stringify(before)!==JSON.stringify(after),telemetry_before:telemetryBefore,telemetry_after:telemetryAfter,policy_version:POLICY,input_sha256:await hash(raw),message:safeMessage(m),duration_ms:Math.round((performance.now()-started)*100)/100,prototype_only:true};
 if(verdict==='ACCEPTED')event.submitted_text=raw;
 events.push(event);return clone(event);
}
async function fixture(opts={},id=active){
 opts={...opts};const scenario=opts.scenario||'valid';
 if(scenario==='replay'){
  const accepted=[...events].reverse().find(e=>e.session_id===id&&e.verdict==='ACCEPTED'&&e.submitted_text);
  if(!accepted)throw Error('Accept a valid signed message first; no hidden command is executed.');
  return {message:clone(accepted.message),raw_text:accepted.submitted_text,modified:false,session_id:id,expected_outcome:now()>=accepted.message.expires_at?'EXPIRED':'REPLAY'};
 }

 if(scenario==='expired')opts.offset=-65;
 if(scenario==='future')opts.offset=30;
 if(scenario==='unauthorised')Object.assign(opts,{sender_id:'observer-01',message_type:'COMMAND',action:'SET_MODE',payload:{mode:'SAFE'}});
 if(scenario==='invalid')Object.assign(opts,{message_type:'COMMAND',action:'SET_REPORT_INTERVAL',payload:{seconds:90}});
 if(scenario==='telemetry')Object.assign(opts,{sender_id:'satellite-01',message_type:'TELEMETRY',action:'TELEMETRY_STATUS',payload:{battery_pct:87,temperature_c:24,mode:'NORMAL'}});
 const m=await issue(opts,id);
 if(scenario==='tampered')m.payload={mode:m.payload.mode==='SAFE'?'NORMAL':'SAFE'};
 return{message:m,modified:scenario==='tampered',session_id:id,expected_outcome:({tampered:'AUTH_FAILED',expired:'EXPIRED',future:'CLOCK_SKEW',unauthorised:'NOT_AUTHORISED',invalid:'PAYLOAD_INVALID',telemetry:'ACCEPTED'})[scenario]||'ACCEPTED'};
}
async function suite(){
 const id=newSession(false),owner=active,results=[];
 const add=async(name,expected,m)=>{const before=state(id),result=await validate(typeof m==='string'?m:JSON.stringify(m),id),unchanged=result.verdict==='ACCEPTED'||JSON.stringify(before)===JSON.stringify(state(id)),observed=result.verdict==='ACCEPTED'?'ACCEPTED':result.reason_code;results.push({name,expected,observed,passed:expected===observed&&unchanged,state_preserved:unchanged,event_id:result.event_id,result})};
 const valid=(await fixture({},id)).message;await add('Valid operator command','ACCEPTED',valid);
 await add('Tampered payload','AUTH_FAILED',(await fixture({scenario:'tampered'},id)).message);
 await add('Replay original message','REPLAY',valid);
 await add('Expired message','EXPIRED',(await fixture({scenario:'expired'},id)).message);
 await add('Future timestamp','CLOCK_SKEW',(await fixture({scenario:'future'},id)).message);
 await add('Unauthorised observer','NOT_AUTHORISED',(await fixture({scenario:'unauthorised'},id)).message);
 await add('Invalid reporting interval','PAYLOAD_INVALID',(await fixture({scenario:'invalid'},id)).message);
 await add('Valid telemetry','ACCEPTED',(await fixture({scenario:'telemetry'},id)).message);
 const report={suite_id:uuid(),session_id:id,owner_session_id:owner,executed_at:now(),clock:'Browser wall clock; NOT the Python injected-clock suite',passed:results.filter(r=>r.passed).length,total:results.length,results,isolated:true,prototype_only:true,limitations:'No Python, SQLite, concurrent transaction, restart persistence, or database failure tests in this browser-only preview.'};suites.push(report);return report;
}
function exportSession(id){return{label:'BROWSER-ONLY INTERACTIVE PROTOTYPE — synthetic data; in-memory records, not Python/SQLite evidence.',schema_version:1,policy_version:POLICY,exported_at:now(),session_id:id,state:state(id),events:events.filter(e=>e.session_id===id),scenario_results:suites.filter(r=>r.owner_session_id===id),prototype_only:true}}
let queue=Promise.resolve();
window.fetch=async function(input,options={}){
 await keysReady;
 const url=new URL(typeof input==='string'?input:input.url,'https://kavach-prototype.invalid/'),p=url.pathname,q=url.searchParams;
 const requested=q.get('session_id')||active;
 let data;
 try{
  if(p==='/api/health')data={status:'online',database:'not used — browser memory',local_simulation:true,session_id:active,prototype_only:true};
  else if(p==='/api/state')data=state(requested);
  else if(p==='/api/demo/sessions'){newSession();data=state()}
  else if(p==='/api/demo/issue'){const args=JSON.parse(options.body||'{}');data=await fixture(args,args.session_id||active)}
  else if(p==='/api/messages'){const task=queue.then(()=>validate(String(options.body||''),requested));queue=task.catch(()=>{});data=await task}
  else if(p==='/api/scenarios/run')data=await suite();
  else if(p==='/api/export')data=exportSession(requested);
  else if(p==='/api/audit'){
   let rows=events.filter(e=>(!q.get('session_id')||e.session_id===q.get('session_id'))&&(!q.get('verdict')||e.verdict===q.get('verdict'))&&(!q.get('sender')||e.message?.sender_id===q.get('sender'))&&(!q.get('message_type')||e.message?.message_type===q.get('message_type'))&&(!q.get('reason')||e.reason_code===q.get('reason'))).reverse();
   const start=Number(q.get('offset')||0),limit=Number(q.get('limit')||50);data={total:rows.length,events:rows.slice(start,start+limit)};
  }else throw Error('Network calls are disabled in this self-contained prototype.');
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 }catch(e){return new Response(JSON.stringify({detail:e.message}),{status:400,headers:{'Content-Type':'application/json'}})}
};
// Arena's file viewer disallows downloads. Offer the same local evidence as an on-screen JSON dialog.
const previewBlobs=new Map(), nativeObjectURL=URL.createObjectURL.bind(URL);
URL.createObjectURL=function(blob){const url=nativeObjectURL(blob);previewBlobs.set(url,blob);return url};
const nativeClick=HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click=function(){
 if(window.top===window||!this.href.startsWith('blob:'))return nativeClick.call(this);
 const originalURL=this.href,name=this.download||'evidence.json';
 const blob=previewBlobs.get(originalURL);if(!blob)return;
 blob.text().then(exportText=>{
  const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:#040911dd;display:grid;place-items:center;padding:24px';
  const panel=document.createElement('section');panel.style.cssText='width:min(880px,95vw);max-height:90vh;background:#111a26;border:1px solid #40506a;border-radius:10px;padding:22px;display:flex;flex-direction:column;gap:14px;color:#c4d4e8';
  const title=document.createElement('h2');title.textContent='Export evidence · '+name;title.style.cssText='font:16px system-ui;margin:0';
  const note=document.createElement('p');note.textContent='Browser-prototype evidence only. Copy the JSON below. Download the HTML and open it in your browser to enable file exports.';note.style.cssText='font:12px/1.7 system-ui;color:#91a5bd;margin:0';
  const text=document.createElement('textarea');text.value=exportText;text.readOnly=true;text.style.cssText='width:100%;height:55vh;resize:none;background:#09111c;color:#a6c0dc;border:1px solid #34475d;border-radius:5px;padding:14px;font:10px/1.8 monospace';
  const buttons=document.createElement('div');buttons.style.cssText='display:flex;gap:10px;justify-content:flex-end';
  for(const[label,fn]of [['Select JSON',()=>{text.focus();text.select()}],['Close',()=>overlay.remove()]]){const button=document.createElement('button');button.textContent=label;button.style.cssText='padding:9px 15px;border:1px solid #51627a;border-radius:5px;background:#25374d;color:#dce9f7;cursor:pointer';button.onclick=fn;buttons.append(button)}
  panel.append(title,note,text,buttons);overlay.append(panel);document.body.append(overlay);
 });
};
})();
