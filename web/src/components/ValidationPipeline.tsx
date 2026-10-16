import React from 'react';
import {Code2,Fingerprint,LockKeyhole,SlidersHorizontal,Clock3,Shield,RotateCcw,CheckCheck,LoaderCircle,Check,X,Info,ArrowUpRight,ChevronDown,ArrowRight} from 'lucide-react';
import type {Decision} from '../types';
import {AttackProofSummary} from './AttackProofSummary';
const stageMeta = [
 ['structure','Message structure','Strict schema and exact JSON envelope',Code2],
 ['identity','Sender identity','Registered key matches the claimed sender',Fingerprint],
 ['authentication','HMAC authentication','Authenticity and integrity of the message',LockKeyhole],
 ['payload','Payload & target','Allowed target, action and payload values',SlidersHorizontal],
 ['time','Timestamp validity','Lifetime and permitted clock skew',Clock3],
 ['permissions','Sender permissions','Receiver policy permits the requested action',Shield],
 ['replay','Replay protection','Previously accepted ID and sequence checks',RotateCcw],
 ['commit','State commit','Atomic state, replay and audit commit',CheckCheck],
] as const;
export function ValidationPipeline({result,busy,onInspect,onHelp,expectation=null,prototypeOnly=false}:{result:Decision|null;busy:string;onInspect:(d:Decision)=>void;onHelp:()=>void;expectation?:string|null;prototypeOnly?:boolean}){
 const accepted=result?.verdict==='ACCEPTED',rejected=result?.verdict==='REJECTED',pending=busy==='submit';
 const failed=result?.checks?.find(c=>c.status==='FAIL');
 const completed=result?.checks?.filter(c=>c.status==='PASS').length??0;
 return <section id="attempt-result" className={'panel validation-panel receiver-workstation '+(accepted?'has-accepted':rejected?'has-rejected':result?'has-error':'')} aria-busy={pending}>
  <div className="panel-heading"><div className="panel-title"><Shield size={18}/><h2>Receiver decision</h2></div><span className="receiver-source">{prototypeOnly?'Browser preview':'Python receiver'}</span></div>
  <div className={'verdict-banner '+(accepted?'accepted':rejected?'rejected':result?'service-error':'')} role="status" aria-live="polite">
   <div className="verdict-icon">{pending?<LoaderCircle size={25} className="spin"/>:accepted?<CheckCheck size={28}/>:rejected?<Shield size={28}/>:result?<Info size={28}/>:<Shield size={30} strokeWidth={1.25}/>}</div>
   <div><span className="decision-context">{pending?'Request in progress':result?'Observed result':'Awaiting submission'}</span><h3>{pending?'Verifying message':accepted?'Message accepted':rejected?'Message rejected':result?'Service unavailable':'Ready to verify'}</h3><p>{pending?'Waiting for the receiver. Individual stage timing is not reported.':result?result.reason_code==='OK'?(result.state_changed?'Protected state updated in a committed transaction.':'Validation passed. Protected spacecraft state unchanged.'):`${result.reason_code.replaceAll('_',' ').toLowerCase()}. ${failed?`Stopped at ${failed.label.toLowerCase()}.`:'No successful execution claimed.'}`:'Send a synthetic message through eight ordered security checks.'}</p></div>
  </div>
  {result&&<div className="decision-explanation">{result.explanation}</div>}
  <div className="trace-heading"><h3>Validation pipeline</h3><span>{pending?'Awaiting trace':result?`${completed} / 8 passed`:'8 ordered checks'}</span><button title="Read validation policy" onClick={onHelp}><Info size={14}/></button></div>
  <div className="receiver-route" aria-hidden="true"><span>Message integrity</span><ArrowRight size={12}/><span>Access & freshness</span><ArrowRight size={12}/><span>Commit</span></div>
  <div className="pipeline-list">{stageMeta.map(([key,label,description,Icon],i)=>{
   const check=result?.checks?.find(c=>c.stage===key),status=check?.status??'WAITING';
   return <details key={`${result?.event_id??result?.reason_code??'idle'}-${key}`} className={'pipeline-step '+status.toLowerCase()} open={status==='FAIL'}>
    <summary><span className="step-rail"><span className="step-icon">{status==='PASS'?<Check size={14}/>:status==='FAIL'?<X size={14}/>:<Icon size={14}/>}</span>{i<7&&<span className="rail-line"/>}</span><span className="stage-index">{String(i+1).padStart(2,'0')}</span><span className="step-name">{prototypeOnly&&key==='commit'?'Apply preview state':label}</span><span className={'step-status '+status.toLowerCase()}>{status==='WAITING'?'Ready':status==='NOT_RUN'?'Not run':status==='PASS'?'Passed':'Failed'}</span><ChevronDown className="stage-chevron" size={12}/></summary>
    <p className="stage-explanation">{check?.explanation??(prototypeOnly&&key==='commit'?'In-memory update; no database':description)}</p>
   </details>;
  })}</div>
  {result?<AttackProofSummary result={result} expectation={expectation} onInspect={onInspect}/>:<div className="receiver-empty"><LockKeyhole size={15}/><p>Authentication confirms authenticity.<br/><strong>Authorisation determines permission.</strong></p></div>}
  {result&&<button className="decision-link" onClick={()=>onInspect(result)}>Inspect full decision & state diff<ArrowUpRight size={15}/></button>}
 </section>;
}
