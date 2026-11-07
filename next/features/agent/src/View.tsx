import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function AgentView({id}:{id:string}){
 const messages=useUI(s=>s.agentSessions[id]??EMPTY_AGENT_MESSAGES),append=useUI(s=>s.appendAgent),clear=useUI(s=>s.clearAgent);
 const [input,setInput]=useState(''),[backend,setBackend]=useState('Codex'),[model,setModel]=useState('gpt-6');const end=useRef<HTMLDivElement>(null);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[messages.length]);
 const submit=()=>{const prompt=input.trim();if(!prompt)return;append(id,{id:uniqueId('message'),role:'user',text:prompt,time:Date.now()});setInput('');append(id,{id:uniqueId('message'),role:'system',text:`${backend} is not connected. The message was saved locally; no model inference, external tool call or network request occurred. Configure an authorized agent backend in Phase 2.`,time:Date.now()})};
 return <div className="view vertical"><ViewToolbar label="Agent session" actions={<ToolbarButton icon="plus" title="Start new local conversation" onClick={()=>clear(id)}>New</ToolbarButton>}/>
 <div className="agent-config"><label>Backend <select aria-label="Agent backend" value={backend} onChange={e=>setBackend(e.target.value)}>{['Codex','Claude Code','OpenCode','DSH','AGY'].map(x=><option key={x}>{x}</option>)}</select></label><label>Model <select aria-label="Agent model" value={model} onChange={e=>setModel(e.target.value)}>{['gpt-6','Claude','Local model'].map(x=><option key={x}>{x}</option>)}</select></label><span className="status-dot warning"/> <span className="muted">Not connected</span></div>
 <div className="agent-messages">{messages.length===0?<div className="empty-feature"><div className="big-icon"><Icon name="bot" size={27}/></div><h2>Workspace agent</h2><p>Compose prompts, manage sessions and inspect tool permissions. No backend is connected.</p><span className="chip warning-chip">OFFLINE · MESSAGES ONLY</span></div>:messages.map(m=><div key={m.id} className={'chat-bubble '+m.role}><span className="chat-role">{m.role==='user'?'You':'Wrkbench'}</span><p>{m.text}</p></div>)}<div ref={end}/></div>
 <form className="composer" onSubmit={e=>{e.preventDefault();submit()}}><textarea aria-label="Agent message" value={input} onChange={e=>setInput(e.target.value)} placeholder="Message agent (saved locally; execution unavailable)" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit()}}}/><button className="send" title="Save message to local agent session" aria-label="Send message" disabled={!input.trim()}><Icon name="enter" size={16}/></button></form></div>;
}
export default function FeatureView(props:FeatureViewProps){return <AgentView id={props.viewId}/>;}
