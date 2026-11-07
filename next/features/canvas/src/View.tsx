import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function CanvasView(){const nodes=useUI(s=>s.nodes),add=useUI(s=>s.addNode),move=useUI(s=>s.updateNode),canvas=useRef<HTMLDivElement>(null),moving=useRef<{id:string;ox:number;oy:number}|null>(null);
 useEffect(()=>{const onMove=(e:PointerEvent)=>{if(!moving.current||!canvas.current)return;const b=canvas.current.getBoundingClientRect();move(moving.current.id,e.clientX-b.left-moving.current.ox,e.clientY-b.top-moving.current.oy)};const up=()=>{moving.current=null};window.addEventListener('pointermove',onMove);window.addEventListener('pointerup',up);return()=>{window.removeEventListener('pointermove',onMove);window.removeEventListener('pointerup',up)}},[move]);
 return <div className="view vertical"><ViewToolbar label="Canvas" actions={<ToolbarButton title="Add node" icon="plus" onClick={()=>add({id:uniqueId('node'),label:'New node',x:80+Math.random()*260,y:90+Math.random()*180})}>Node</ToolbarButton>}/><div className="canvas-board" ref={canvas}><svg className="canvas-wires"><path d="M 224 134 L 305 178 L 545 134" fill="none" stroke="currentColor" strokeWidth="2"/></svg>{nodes.map(n=><div className="canvas-node" key={n.id} style={{left:Math.max(10,n.x),top:Math.max(10,n.y)}} onPointerDown={e=>{if(e.button!==0)return;moving.current={id:n.id,ox:e.nativeEvent.offsetX,oy:e.nativeEvent.offsetY}}}><span className="node-dot"/><span>{n.label}</span><Icon name="grip" size={14}/></div>)}</div></div>;
}
export default function FeatureView(props:FeatureViewProps){return <CanvasView />;}
