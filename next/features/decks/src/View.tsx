import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function DeckView({id}:{id:string}){const raw=useUI(s=>s.notes[id]??'Overview\nProblem\nArchitecture\nRoadmap'),set=useUI(s=>s.setNote),slides=raw.split('\n');const [selected,setSelected]=useState(0);
 return <div className="view vertical"><ViewToolbar label="Slides" actions={<ToolbarButton title="Add slide" icon="plus" onClick={()=>{set(id,[...slides,'Untitled'].join('\n'));setSelected(slides.length)}}>Slide</ToolbarButton>}/><div className="deck-space"><div className="slide-list">{slides.map((title,i)=><button key={i} title={`Select slide ${i+1}`} className={i===selected?'selected':''} onClick={()=>setSelected(i)}><span>{i+1}</span>{title||'Untitled'}</button>)}</div><div className="slide-stage"><div className="presentation-slide"><span>ATLAS STUDIO</span><textarea aria-label="Slide title" value={slides[selected]??''} onChange={e=>set(id,slides.map((line,i)=>i===selected?e.target.value:line).join('\n'))}/><small>WRKBENCH PRESENTATION</small></div></div></div></div>;
}
export default function FeatureView(props:FeatureViewProps){return <DeckView id={props.viewId}/>;}
