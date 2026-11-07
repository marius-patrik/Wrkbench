import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultContext, type ViewContext, type WorkbenchId, type RuntimeId } from '../../core/src/index.ts';
export type ChatMessage={id:string;role:'user'|'system';text:string;time:number};
export type TimelineClip={id:string;name:string;start:number;duration:number;track:number;kind:'audio'|'video'};
export type CanvasNode={id:string;label:string;x:number;y:number};
export type Task={id:string;title:string;done:boolean};
interface UIState {
 theme:'dark'|'light';workbench:WorkbenchId;context:ViewContext;contextOverrides:Record<string,Partial<ViewContext>>;
 activeViewId:string|null; filePath:string; documents:Record<string,{content:string;revision:number;dirty:boolean}>;
 terminalHistories:Record<string,string[]>; agentSessions:Record<string,ChatMessage[]>;
 clips:TimelineClip[];playhead:number;playing:boolean;mutes:Record<number,boolean>;volumes:Record<number,number>;
 nodes:CanvasNode[];tasks:Task[];watchlist:string[]; notes:Record<string,string>;
 themeToggle:()=>void;switchWorkbench:(id:WorkbenchId)=>void;setActiveView:(id:string|null)=>void;
 setContext:(value:Partial<ViewContext>,viewId?:string)=>void;resetContext:(viewId:string)=>void;
 selectFile:(path:string)=>void;cacheDocument:(path:string,content:string,revision:number)=>void;editDocument:(path:string,content:string)=>void;
 markSaved:(path:string,revision:number,savedContent:string)=>void;moveDocument:(from:string,to:string)=>void;removeDocument:(path:string)=>void;
 appendTerminal:(id:string,line:string)=>void;clearTerminal:(id:string)=>void;appendAgent:(id:string,msg:ChatMessage)=>void;clearAgent:(id:string)=>void;
 addClip:(clip:TimelineClip)=>void;updateClip:(id:string,change:Partial<TimelineClip>)=>void;removeClip:(id:string)=>void;
 setPlayhead:(v:number)=>void;setPlaying:(v:boolean)=>void;setVolume:(i:number,v:number)=>void;toggleMute:(i:number)=>void;
 addNode:(node:CanvasNode)=>void;updateNode:(id:string,x:number,y:number)=>void;
 addTask:(title:string)=>void;toggleTask:(id:string)=>void;removeTask:(id:string)=>void;
 setNote:(id:string,v:string)=>void;toggleWatch:(symbol:string)=>void;
}
const seedClips:TimelineClip[]=[{id:'clip-1',name:'Opening scene',start:0,duration:7,track:0,kind:'video'},{id:'clip-2',name:'Ambient bed',start:0,duration:18,track:1,kind:'audio'},{id:'clip-3',name:'Cutaway',start:9,duration:6,track:0,kind:'video'}];
export const useUI=create<UIState>()(persist((set,get)=>({
 theme:'dark',workbench:'development',context:defaultContext,contextOverrides:{},activeViewId:null,filePath:'src/App.tsx',documents:{},terminalHistories:{},agentSessions:{},
 clips:seedClips,playhead:0,playing:false,mutes:{},volumes:{0:75,1:60},nodes:[{id:'node-1',label:'Input',x:75,y:95},{id:'node-2',label:'Transform',x:305,y:145},{id:'node-3',label:'Output',x:545,y:95}],
 tasks:[{id:'t1',title:'Review workspace layout',done:true},{id:'t2',title:'Organize local files',done:false},{id:'t3',title:'Define agent permissions',done:false}],watchlist:['AAPL','NVDA','MSFT'],notes:{'personal':'# Scratchpad\n\nIdeas and quick notes live locally.'},
 themeToggle:()=>set(s=>({theme:s.theme==='dark'?'light':'dark'})),switchWorkbench:(workbench)=>set({workbench,activeViewId:null}),setActiveView:(activeViewId)=>set({activeViewId}),
 setContext:(change,viewId)=>set(s=>viewId?({contextOverrides:{...s.contextOverrides,[viewId]:{...s.contextOverrides[viewId],...change}}}):({context:{...s.context,...change}})),
 resetContext:(viewId)=>set(s=>{const next={...s.contextOverrides};delete next[viewId];return {contextOverrides:next}}),
 selectFile:(filePath)=>set({filePath}),cacheDocument:(path,content,revision)=>set(s=>{const current=s.documents[path];if(current?.dirty||(current&&current.revision>revision))return s;return {documents:{...s.documents,[path]:{content,revision,dirty:false}}}}),
 editDocument:(path,content)=>set(s=>({documents:{...s.documents,[path]:{content,revision:s.documents[path]?.revision??0,dirty:true}}})),
 markSaved:(path,revision,savedContent)=>set(s=>{const current=s.documents[path];if(!current)return s;return {documents:{...s.documents,[path]:{...current,revision,dirty:current.content!==savedContent}}}}),
 moveDocument:(from,to)=>set(s=>{const documents={...s.documents};if(documents[from]){documents[to]={...documents[from],revision:documents[from].revision+1};delete documents[from]}return {documents,filePath:s.filePath===from?to:s.filePath}}),
 removeDocument:(path)=>set(s=>{const documents={...s.documents};delete documents[path];return {documents}}),
 appendTerminal:(id,line)=>set(s=>({terminalHistories:{...s.terminalHistories,[id]:[...(s.terminalHistories[id]??[]),line].slice(-500)}})),
 clearTerminal:(id)=>set(s=>({terminalHistories:{...s.terminalHistories,[id]:[]}})),
 appendAgent:(id,msg)=>set(s=>({agentSessions:{...s.agentSessions,[id]:[...(s.agentSessions[id]??[]),msg]}})),
 clearAgent:(id)=>set(s=>({agentSessions:{...s.agentSessions,[id]:[]}})),
 addClip:(clip)=>set(s=>({clips:[...s.clips,clip]})),updateClip:(id,change)=>set(s=>({clips:s.clips.map(c=>c.id===id?{...c,...change}:c)})),removeClip:(id)=>set(s=>({clips:s.clips.filter(c=>c.id!==id)})),
 setPlayhead:(playhead)=>set({playhead}),setPlaying:(playing)=>set({playing}),setVolume:(i,v)=>set(s=>({volumes:{...s.volumes,[i]:v}})),toggleMute:(i)=>set(s=>({mutes:{...s.mutes,[i]:!s.mutes[i]}})),
 addNode:(node)=>set(s=>({nodes:[...s.nodes,node]})),updateNode:(id,x,y)=>set(s=>({nodes:s.nodes.map(n=>n.id===id?{...n,x,y}:n)})),
 addTask:(title)=>set(s=>({tasks:[...s.tasks,{id:crypto.randomUUID(),title,done:false}]})),toggleTask:(id)=>set(s=>({tasks:s.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)})),removeTask:(id)=>set(s=>({tasks:s.tasks.filter(t=>t.id!==id)})),
 setNote:(id,v)=>set(s=>({notes:{...s.notes,[id]:v}})),toggleWatch:(symbol)=>set(s=>({watchlist:s.watchlist.includes(symbol)?s.watchlist.filter(s=>s!==symbol):[...s.watchlist,symbol]})),
}),{name:'wrkbench-ui-v3',version:3,partialize:s=>({theme:s.theme,workbench:s.workbench,context:s.context,contextOverrides:s.contextOverrides,filePath:s.filePath,documents:Object.fromEntries(Object.entries(s.documents).filter(([,doc])=>doc.dirty)),terminalHistories:s.terminalHistories,agentSessions:s.agentSessions,clips:s.clips,playhead:s.playhead,mutes:s.mutes,volumes:s.volumes,nodes:s.nodes,tasks:s.tasks,watchlist:s.watchlist,notes:s.notes})}));
export function resolvedContext(viewId?:string):ViewContext{const s=useUI.getState();return {...s.context,...(viewId?s.contextOverrides[viewId]:{})};}
export const RUNTIMES:Record<RuntimeId,string>={browser:'Browser local','remote-ssh':'SSH · not connected',container:'Container · not connected','local-agent':'Local agent · not connected'};
