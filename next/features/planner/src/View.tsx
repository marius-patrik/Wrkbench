import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function PlannerView(){const tasks=useUI(s=>s.tasks),add=useUI(s=>s.addTask),toggle=useUI(s=>s.toggleTask),remove=useUI(s=>s.removeTask);const [newTask,setNewTask]=useState('');
 return <div className="view vertical"><ViewToolbar label="Tasks"><span className="chip subtle">{tasks.filter(t=>t.done).length} / {tasks.length} complete</span></ViewToolbar><form className="add-line" onSubmit={e=>{e.preventDefault();if(newTask.trim()){add(newTask.trim());setNewTask('')}}}><input title="New task" aria-label="New task" placeholder="Add a task…" value={newTask} onChange={e=>setNewTask(e.target.value)}/><button title="Create task" aria-label="Create task"><Icon name="plus"/></button></form><div className="task-list">{tasks.map(t=><div className="task-row" key={t.id}><input title={`Mark ${t.title} complete`} type="checkbox" checked={t.done} onChange={()=>toggle(t.id)}/><span className={t.done?'checked':''}>{t.title}</span><div className="spacer"/><ToolbarButton title={`Remove ${t.title}`} icon="trash" onClick={()=>remove(t.id)}/></div>)}</div></div>;
}
export default function FeatureView(props:FeatureViewProps){return <PlannerView />;}
