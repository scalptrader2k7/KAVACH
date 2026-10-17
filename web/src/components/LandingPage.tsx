import React, {useRef} from 'react';
import {ArrowDown,ArrowRight,ArrowUpRight,ShieldCheck,Radio,FileCheck2} from 'lucide-react';
import {EarthGlobe} from './EarthGlobe';
import '../landing.css';

const capabilities=[
 {number:'01',title:'Command Validation',icon:ShieldCheck,description:'Every command faces eight ordered checks. Verify message integrity, sender permissions, freshness, and replay protection before the local model changes.',detail:'VERIFY BEFORE EXECUTION'},
 {number:'02',title:'Telemetry Intelligence',icon:Radio,description:'Inspect synthetic telemetry with transparent, rule-based anomaly findings. Keep received observations separate from protected spacecraft state.',detail:'UNDERSTAND EVERY SIGNAL'},
 {number:'03',title:'Audit & Evidence',icon:FileCheck2,description:'Follow each decision through its validation trace and state snapshots. Inspect persistent records, verify the audit chain, and export session evidence.',detail:'TRACE EVERY DECISION'},
];

export function LandingPage({onEnter}:{onEnter:()=>void}){
 const capabilitiesRef=useRef<HTMLElement>(null);
 function explore(){capabilitiesRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});capabilitiesRef.current?.focus({preventScroll:true})}
 return <div className="landing-page">
  <a className="landing-skip" href="#landing-capabilities">Skip to capabilities</a>
  <header className="landing-header">
   <a className="landing-brand" href="#landing-top" aria-label="KAVACH home"><span className="landing-mark" aria-hidden="true">K<span/></span>KAVACH</a>
   <div className="landing-header-right"><span className="landing-environment"><i/>LOCAL SIMULATION</span><button type="button" onClick={onEnter}>Mission control<ArrowUpRight size={15}/></button></div>
  </header>
  <main className="landing-main">
   <section className="landing-hero" id="landing-top" aria-labelledby="landing-title">
    <EarthGlobe/>
    <div className="landing-hero-shade" aria-hidden="true"/>
    <div className="landing-hero-copy">
     <p className="landing-eyebrow"><span/>MISSION ASSURANCE SYSTEM</p>
     <h1 id="landing-title">One mission.<br/>One command<br/><span>center.</span></h1>
     <p className="landing-description">Secure command validation. Intelligent telemetry analysis. Explainable mission decisions.</p>
     <div className="landing-actions"><button type="button" className="landing-primary" onClick={onEnter}>ENTER MISSION CONTROL<ArrowUpRight size={17}/></button><button type="button" className="landing-secondary" onClick={explore}>EXPLORE CAPABILITIES<ArrowDown size={15}/></button></div>
     <p className="landing-support">LOCAL SIMULATION <span>·</span> COMMAND VALIDATION <span>·</span> AUDITABLE DECISIONS</p>
    </div>
    <div className="landing-hero-bottom"><span><i/>ASSURANCE STARTS WITH EVERY COMMAND.</span><button type="button" onClick={explore} aria-label="Scroll to capabilities">DISCOVER KAVACH<ArrowDown size={13}/></button></div>
   </section>
   <section ref={capabilitiesRef} tabIndex={-1} className="landing-capabilities" id="landing-capabilities" aria-labelledby="capabilities-title">
    <div className="landing-section-heading"><p className="landing-eyebrow">BUILT FOR CLARITY. DESIGNED FOR TRUST.</p><div><h2 id="capabilities-title">Confidence at<br/>every checkpoint.</h2><p>A clear view of what was received, why it was accepted or rejected, and what changed. All inside one local simulator.</p></div></div>
    <div className="landing-capability-grid">{capabilities.map(({number,title,icon:Icon,description,detail})=><article key={number}><div className="landing-capability-top"><span>{number} /</span><Icon size={23} strokeWidth={1.25}/></div><h3>{title}</h3><p>{description}</p><span className="landing-capability-detail">{detail}</span></article>)}</div>
    <div className="landing-continue"><p>Your mission. A verifiable decision trail.</p><button type="button" className="landing-primary" onClick={onEnter}>ENTER MISSION CONTROL<ArrowRight size={17}/></button></div>
   </section>
  </main>
  <footer className="landing-footer"><span>KAVACH <span>/</span> MISSION ASSURANCE</span><p>Synthetic data. Local simulation. No live satellite connection.</p><a href={new URL('../assets/earth/ATTRIBUTION.md?no-inline',import.meta.url).href} target="_blank" rel="noreferrer">Earth imagery: NASA<ArrowUpRight size={11}/></a></footer>
 </div>;
}
