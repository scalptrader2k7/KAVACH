import React from 'react';
export const fmtTime=(n:number)=>new Date(n*1000).toLocaleTimeString('en-GB',{hour12:false});
export function Badge({children,tone='neutral',dot=false}: {children:React.ReactNode,tone?:string,dot?:boolean}){return <span className={'badge '+tone}>{dot&&<i/>}{children}</span>}
