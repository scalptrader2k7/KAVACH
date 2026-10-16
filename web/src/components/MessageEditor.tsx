import React,{useMemo,useRef,useEffect} from 'react';
/** Visual highlighting only. The textarea remains the exact submitted string. */
export function MessageEditor({value,onChange,inputRef}:{value:string;onChange:(value:string)=>void;inputRef:React.RefObject<HTMLTextAreaElement|null>}){
 const highlight=useRef<HTMLPreElement>(null),numbers=useRef<HTMLDivElement>(null);
 const tokens=useMemo(()=>value.split(/("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g).map((text,i)=><span key={i} className={text.startsWith('"')?(text.trimEnd().endsWith(':')?'json-key':'json-string'):/^-?\d/.test(text)?'json-number':/^(true|false|null)$/.test(text)?'json-literal':undefined}>{text}</span>),[value]);
 function syncScroll(){if(inputRef.current&&highlight.current&&numbers.current){highlight.current.scrollTop=inputRef.current.scrollTop;highlight.current.scrollLeft=inputRef.current.scrollLeft;numbers.current.scrollTop=inputRef.current.scrollTop;}}
 useEffect(syncScroll,[value]);
 return <div className="code-editor syntax-editor"><div ref={numbers} className="line-numbers" aria-hidden="true">{value.split('\n').map((_,i)=><span key={i}>{i+1}</span>)}</div><div className="syntax-viewport"><pre ref={highlight} aria-hidden="true">{tokens}{'\n'}</pre><textarea ref={inputRef} aria-label="Editable message JSON" value={value} onChange={e=>onChange(e.target.value)} onScroll={syncScroll} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" placeholder="Generate a signed sample to begin…"/></div></div>;
}
