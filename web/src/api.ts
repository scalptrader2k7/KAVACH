/** Single HTTP boundary. No signing, predicted verdicts, or optimistic protected state. */
export async function api<T>(path:string, options:RequestInit={}):Promise<T> {
 let res:Response;
 try {res=await fetch('/api'+path,options);} catch {throw new Error('Local API is unavailable. Start the Python service and retry.');}
 let data:unknown;
 try {data=await res.json();} catch {throw new Error('Local API returned an unreadable response. No successful execution is assumed.');}
 const error=data as {verdict?:string;detail?:unknown};
 if(!res.ok&&error?.verdict!=='SERVICE_ERROR')throw new Error(typeof error?.detail==='string'?error.detail:'The request contains invalid fixture values.');
 return data as T;
}
export function post<T>(path:string,body?:unknown):Promise<T> {
 return api<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
/** The receiver gets the current editor string verbatim, including malformed/duplicate-key JSON. */
export function submitEditor<T>(session:string,editor:string):Promise<T> {
 return api<T>('/messages?session_id='+encodeURIComponent(session),{method:'POST',headers:{'Content-Type':'application/json'},body:editor});
}
