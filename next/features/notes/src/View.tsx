import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function LocalNotes({id='personal'}:{id?:string}){const content=useUI(s=>s.notes[id]??''),set=useUI(s=>s.setNote);return <div className="view vertical"><ViewToolbar label="Notes"><span className="chip subtle">AUTOSAVED</span></ViewToolbar><textarea className="writing-area" aria-label="Notes editor" value={content} onChange={e=>set(id,e.target.value)} placeholder="Start writing…" /></div>}
export default function FeatureView(props:FeatureViewProps){return <LocalNotes id={props.viewId}/>;}
