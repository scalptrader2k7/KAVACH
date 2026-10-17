import React, {useEffect, useRef, useState} from 'react';
import {Pause, Play} from 'lucide-react';

/** Decorative scene. The mission application never depends on WebGL or imagery. */
export function EarthGlobe(){
 const host=useRef<HTMLDivElement>(null);
 const scene=useRef<{dispose:()=>void;setPaused:(paused:boolean)=>void}|null>(null);
 const [status,setStatus]=useState<'loading'|'ready'|'unavailable'>('loading');
 const [paused,setPaused]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>setPaused(motion.matches);motion.addEventListener('change',update);
  return()=>motion.removeEventListener('change',update);
 },[]);
 useEffect(()=>{
  let cancelled=false;
  import('./earthScene').then(({createEarthScene})=>{
   if(cancelled||!host.current)return;
   scene.current=createEarthScene(host.current,()=>{if(!cancelled)setStatus('ready')},()=>{if(!cancelled)setStatus('unavailable')});
  }).catch(()=>{if(!cancelled)setStatus('unavailable')});
  return()=>{cancelled=true;scene.current?.dispose();scene.current=null};
 },[]);
 return <div className="landing-earth" data-earth-status={status}>
  <div className="landing-earth-fallback" aria-hidden="true"/>
  <div ref={host} className="landing-earth-canvas" role="img" aria-label="Earth rendered in three dimensions using NASA satellite imagery"/>
  <div className="landing-earth-caption">
   <span>{status==='ready'?'EARTH / NASA BLUE MARBLE':status==='loading'?'EARTH / LOADING IMAGERY':'EARTH PREVIEW / 3D UNAVAILABLE'}</span>
   {status==='ready'&&<button type="button" aria-label={paused?'Resume Earth rotation':'Pause Earth rotation'} onClick={()=>{const next=!paused;setPaused(next);scene.current?.setPaused(next)}}>{paused?<Play size={12}/>:<Pause size={12}/>}</button>}
  </div>
 </div>;
}
