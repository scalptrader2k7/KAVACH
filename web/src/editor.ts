/** Lossless formatting: validate syntax/duplicate keys, then indent original tokens.
 * Never stringify parsed values: duplicate keys and large integer lexemes are evidence.
 * Never signs, submits, or modifies any authenticated value.
 */
export interface FormatResult { text: string; changed: boolean; warning: string | null }
export function formatEditorJSON(raw: string): FormatResult {
  const unchanged=(warning:string):FormatResult=>({text:raw,changed:false,warning});
  if(new TextEncoder().encode(raw).length>8192)return unchanged('Formatting skipped: input exceeds 8 KiB. Original attack bytes preserved.');
  try { JSON.parse(raw); } catch { return unchanged('Malformed JSON left unchanged. Submit the exact input to inspect receiver rejection.'); }
  const tokens=raw.match(/"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g)??[];
  let cursor=0;
  function value(depth:number):void {
    if(depth>128)throw new Error('Nesting is too deep to format safely. Original input preserved.');
    const token=tokens[cursor++];
    if(token==='{'){
      const keys=new Set<string>();
      if(tokens[cursor]==='}'){cursor++;return;}
      do {
        const key=JSON.parse(tokens[cursor++]) as string;
        if(keys.has(key))throw new Error('Duplicate JSON key detected. Formatting refused; original attack bytes preserved.');
        keys.add(key);cursor++; // colon, already checked by native syntax validation
        value(depth+1);
      } while(tokens[cursor++ ]===',');
    }else if(token==='['){
      if(tokens[cursor]===']'){cursor++;return;}
      do {value(depth+1);} while(tokens[cursor++ ]===',');
    }
  }
  try {value(0);} catch(error) {return unchanged((error as Error).message);}
  let depth=0,output='';
  const indent=()=> '  '.repeat(Math.max(0,depth));
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i],previous=tokens[i-1];
    if(token==='{'||token==='['){
      output+=token;depth++;
      if(tokens[i+1]!=='}'&&tokens[i+1]!==']')output+='\n'+indent();
    } else if(token==='}'||token===']'){
      depth--;
      if(previous!=='{'&&previous!=='[')output+='\n'+indent();
      output+=token;
    } else if(token===',')output+=',\n'+indent();
    else if(token===':')output+=': ';
    else output+=token;
  }
  return {text:output,changed:output!==raw,warning:null};
}
