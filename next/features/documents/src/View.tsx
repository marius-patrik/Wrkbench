import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function DocumentView({id}:{id:string}){const value=useUI(s=>s.notes[id]??'<h1>Untitled document</h1><p>Start editing.</p>'),set=useUI(s=>s.setNote),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(ref.current&&ref.current.innerHTML!==value)ref.current.innerHTML=value},[id]);
 return <div className="view vertical"><ViewToolbar label="Document" actions={<><ToolbarButton title="Bold selection" onClick={()=>document.execCommand('bold')}>B</ToolbarButton><ToolbarButton title="Italicize selection" onClick={()=>document.execCommand('italic')}>I</ToolbarButton><ToolbarButton title="Heading" onClick={()=>document.execCommand('formatBlock',false,'h2')}>H2</ToolbarButton></>}><span className="chip subtle">LOCAL DRAFT</span></ViewToolbar><div className="document-wrap"><div ref={ref} contentEditable suppressContentEditableWarning className="page-paper" aria-label="Rich text document editor" onInput={e=>set(id,e.currentTarget.innerHTML)} /></div></div>;
}
export default function FeatureView(props:FeatureViewProps){return <DocumentView id={props.viewId}/>;}
