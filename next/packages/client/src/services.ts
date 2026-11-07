import { z } from 'zod';
import { type ToolContext, type ViewKind, uniqueId } from '../../core/src/index.ts';
import { BrowserFiles } from '../../storage/src/index.ts';
import { useUI } from './state.ts';
export const files=new BrowserFiles();
let toolRegistry:import('../../core/src/index.ts').ToolRegistry|null=null;
export function bindToolRegistry(registry:import('../../core/src/index.ts').ToolRegistry|null){toolRegistry=registry;}
export const tools={list:()=>toolRegistry?.list()??[],invoke:async(id:string,input:unknown,ctx:ToolContext)=>{if(!toolRegistry)throw new Error('Tool service unavailable');return toolRegistry.invoke(id,input,ctx)},register:<T,R>(t:import('../../core/src/index.ts').ToolDefinition<T,R>)=>{if(!toolRegistry)throw new Error('Tool service unavailable');return toolRegistry.register(t)}};
const output=z.object({message:z.string()});
export function notify(message:string,mode:'info'|'error'='info') {document.dispatchEvent(new CustomEvent('wrkbench:toast',{detail:{message,mode}}));}
export function registerClientTools(actions:{open:(kind:ViewKind)=>void;split:()=>void;float:()=>void;save:()=>Promise<void>}){
 const stop=[
  tools.register({id:'view.open',label:'Open view',description:'Open a plugin editor in the active group',input:z.object({kind:z.string()}),output,run:({kind})=>{actions.open(kind as ViewKind);return {message:`Opened ${kind}`}}}),
  tools.register({id:'layout.split',label:'Split editor group',description:'Create an empty drop target beside active group',input:z.object({}),output,run:()=>{actions.split();return {message:'Editor group split'}}}),
  tools.register({id:'window.float',label:'Float current tab',description:'Detach a tab to a Dockview floating group',input:z.object({}),output,run:()=>{actions.float();return {message:'Tab floated'}}}),
  tools.register({id:'file.save',label:'Save active file',description:'Save through IndexedDB with revision check',input:z.object({}),output,run:async()=>{await actions.save();return {message:'File saved'}}}),
  tools.register({id:'theme.toggle',label:'Toggle appearance',description:'Switch between dark and light neutral themes',input:z.object({}),output,run:()=>{useUI.getState().themeToggle();return {message:'Theme updated'}}}),
  tools.register({id:'context.setRuntime',label:'Select runtime',description:'Change current runtime context (no remote connection is made)',input:z.object({runtime:z.enum(['browser','remote-ssh','container','local-agent'])}),output,run:({runtime},ctx)=>{useUI.getState().setContext({runtime},ctx.viewId);return {message:`Context set to ${runtime}`}}})
 ];return ()=>stop.forEach(s=>s());
}
export function invocationContext():ToolContext{const s=useUI.getState();return {viewId:s.activeViewId??undefined,workbench:s.workbench,context:{...s.context,...(s.activeViewId?s.contextOverrides[s.activeViewId]:{})},requestApproval:async message=>window.confirm(message)}};
export const seedFiles={
 'README.md':'# Atlas Studio\n\nWelcome to Wrkbench. Your workspace files are saved in IndexedDB.\n\nOpen a document from Explorer or add an editor with **Add view**.\n',
 'src/App.tsx':'import { useState } from "react";\n\nexport function App() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;\n}\n',
 'src/styles.css':':root {\n  color-scheme: dark;\n  font-family: Inter, sans-serif;\n}\n',
 'package.json':'{\n  "name": "atlas-studio",\n  "private": true,\n  "version": "0.1.0"\n}\n',
 'docs/architecture.md':'# Architecture\n\nPlugins own services; the window manager owns placement.\n',
 'docs/notes.md':'# Notes\n\nAll browser-only data stays on this device.\n'
};
