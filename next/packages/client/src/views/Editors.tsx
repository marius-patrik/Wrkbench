import { useCallback,useEffect,useMemo,useRef,useState,type ReactNode } from 'react';
import Editor,{loader} from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {ToolbarButton} from './Primitives.tsx';
export {ToolbarButton} from './Primitives.tsx';
import { files, notify } from '../services.ts';
import { useUI } from '../state.ts';
import { Icon } from '../icons.tsx';
import type { WorkspaceFile } from '../../../storage/src/index.ts';
import type { ViewKind } from '../../../core/src/index.ts';
loader.config({monaco});
// Monaco workers are bundled from the real monaco-editor package, never a CDN.
type InlineWorkers = Partial<Record<'editor'|'typescript'|'json'|'css'|'html',string>>;
(globalThis as typeof globalThis & {MonacoEnvironment?:unknown}).MonacoEnvironment={
 getWorker:(_moduleId:string,label:string)=>{
  const key=label==='typescript'||label==='javascript'?'typescript':label==='json'?'json':label==='css'||label==='scss'||label==='less'?'css':label==='html'?'html':'editor';
  const source=(globalThis as typeof globalThis & {__WRKBENCH_EDITOR_WORKERS__?:InlineWorkers}).__WRKBENCH_EDITOR_WORKERS__?.[key];
  if(source)return new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})),{type:'module'});
  switch(key){
   case 'typescript':return new Worker(new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js',import.meta.url),{type:'module'});
   case 'json':return new Worker(new URL('monaco-editor/esm/vs/language/json/json.worker.js',import.meta.url),{type:'module'});
   case 'css':return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker.js',import.meta.url),{type:'module'});
   case 'html':return new Worker(new URL('monaco-editor/esm/vs/language/html/html.worker.js',import.meta.url),{type:'module'});
   default:return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js',import.meta.url),{type:'module'});
  }
 }
};
const language=(path:string)=>path.endsWith('.tsx')?'typescript':path.endsWith('.ts')?'typescript':path.endsWith('.json')?'json':path.endsWith('.css')?'css':path.endsWith('.md')?'markdown':'plaintext';
export function CodeView({path:requestedPath}:{path?:string}){
 const path=requestedPath||useUI(s=>s.filePath);const theme=useUI(s=>s.theme);
 const doc=useUI(s=>s.documents[path]);const cache=useUI(s=>s.cacheDocument);const edit=useUI(s=>s.editDocument);const mark=useUI(s=>s.markSaved);
 const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 useEffect(()=>{let active=true;setLoading(true);void files.get(path).then(file=>{if(!active)return;
   if(!file){setError('File not found');setLoading(false);return;}if(!useUI.getState().documents[path]?.dirty)cache(path,file.content,file.revision);setLoading(false);
 }).catch(e=>{setError(String(e));setLoading(false)});return()=>{active=false}},[path,cache]);
 const save=useCallback(async()=>{const d=useUI.getState().documents[path];if(!d?.dirty)return;
 try{const updated=await files.save(path,d.content,d.revision);mark(path,updated.revision);notify(`Saved ${path}`)}catch(e){notify(String(e),'error')}},[path,mark]);
 useEffect(()=>{const fn=(e:Event)=>{if((e as CustomEvent<string>).detail===path)void save()};window.addEventListener('wrkbench:savefile',fn);return()=>window.removeEventListener('wrkbench:savefile',fn)},[save,path]);
 return <div className="view vertical"><div className="view-toolbar"><span className="pathline">atlas-studio / {path}</span>{doc?.dirty&&<span className="unsaved">● Unsaved</span>}<div className="spacer"/><ToolbarButton title="Save this file (Ctrl/⌘ S)" icon="save" disabled={!doc?.dirty} onClick={()=>void save()}>Save</ToolbarButton></div>
 {loading?<div className="view-state">Loading file…</div>:error?<div className="view-state error">{error}</div>:<div className="editor-host"><Editor path={path} value={doc?.content??''} language={language(path)} theme={theme==='dark'?'vs-dark':'vs'} options={{minimap:{enabled:false},fontFamily:'JetBrains Mono, SFMono-Regular, Consolas, monospace',fontSize:13,lineHeight:21,scrollBeyondLastLine:false,smoothScrolling:true,padding:{top:14,bottom:12},automaticLayout:true,tabSize:2,wordWrap:'off',renderLineHighlight:'line',stickyScroll:{enabled:false}}} onChange={v=>edit(path,v??'')}/></div>}
 </div>;
}
export function ExplorerView({onOpen}:{onOpen:(path:string)=>void}){
 const [list,setList]=useState<WorkspaceFile[]>([]),[filter,setFilter]=useState(''),[collapsed,setCollapsed]=useState<Set<string>>(new Set()),[busy,setBusy]=useState(false),[selected,setSelected]=useState('');
 const refresh=useCallback(()=>{setBusy(true);void files.list().then(f=>setList(f.sort((a,b)=>a.path.localeCompare(b.path)))).catch(e=>notify(String(e),'error')).finally(()=>setBusy(false))},[]);
 useEffect(()=>{refresh();const handler=()=>refresh();window.addEventListener('wrkbench:fileschanged',handler);return()=>window.removeEventListener('wrkbench:fileschanged',handler)},[refresh]);
 const newFile=async()=>{const path=prompt('New file path (relative to workspace)', 'src/new-file.ts');if(!path)return;
 if(!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9_./\- ]+$/.test(path)){notify('Invalid file path','error');return}
 if(await files.get(path)){notify('File already exists','error');return}try{await files.save(path,'',0);refresh();onOpen(path)}catch(e){notify(String(e),'error')}};
 const rename=async(path:string)=>{const next=prompt('Rename file',path);if(!next||next===path)return;
 try{await files.rename(path,next);useUI.getState().moveDocument(path,next);window.dispatchEvent(new CustomEvent('wrkbench:filerename',{detail:{from:path,to:next}}));refresh();notify(`Renamed to ${next}`)}catch(e){notify(String(e),'error')}};
 const remove=async(path:string)=>{if(!confirm(`Delete ${path}? This cannot be undone.`))return;await files.remove(path);useUI.getState().removeDocument(path);window.dispatchEvent(new CustomEvent('wrkbench:filedelete',{detail:path}));refresh();notify(`${path} deleted`)};
 const folders=new Set<string>();list.forEach(f=>{const parts=f.path.split('/');for(let i=1;i<parts.length;i++)folders.add(parts.slice(0,i).join('/'))});
 const rows=[...Array.from(folders).map(path=>({path,isFolder:true})),...list.map(file=>({path:file.path,isFolder:false}))].sort((a,b)=>a.path.localeCompare(b.path));
 return <div className="view vertical"><div className="view-toolbar"><span className="section-label">FILES</span><div className="spacer"/><ToolbarButton title="New local file" icon="plus" onClick={()=>void newFile()}/><ToolbarButton title="Refresh file tree" icon="refresh" onClick={refresh}/></div>
 <div className="filter-wrap"><Icon name="search" size={14}/><input aria-label="Filter files" placeholder="Filter files" value={filter} onChange={e=>setFilter(e.target.value)}/></div>
 <div className="tree-title"><Icon name="chevron-down" size={13}/> ATLAS-STUDIO <span className="spacer"/>{busy?'…':''}</div>
 <div className="tree-scroll">{rows.filter(r=>r.path.toLowerCase().includes(filter.toLowerCase())||!filter).filter(r=>!r.path.split('/').slice(0,-1).some((_,i,arr)=>collapsed.has(arr.slice(0,i+1).join('/')))).map(({path,isFolder})=>{const depth=path.split('/').length-1;return <div key={path} className={'tree-row '+(selected===path?'selected':'')} style={{paddingLeft:14+depth*13}}>
 <button title={isFolder?`Toggle folder ${path}`:`Open ${path}`} className="tree-open" onClick={()=>{setSelected(path);if(isFolder)setCollapsed(old=>{const next=new Set(old);next.has(path)?next.delete(path):next.add(path);return next});else onOpen(path)}}><Icon name={isFolder?'folder':path.endsWith('.md')?'file-text':'code'} size={14}/><span>{path.split('/').at(-1)}</span></button>
 {!isFolder&&<><button className="tree-more" title={`Rename ${path}`} aria-label={`Rename ${path}`} onClick={()=>void rename(path)}><Icon name="more" size={13}/></button><button className="tree-more" title={`Delete ${path}`} aria-label={`Delete ${path}`} onClick={()=>void remove(path)}><Icon name="trash" size={13}/></button></>}
 </div>})}{!list.length&&<p className="muted pad">No files yet. Create one to begin.</p>}</div>
 </div>;
}
async function executeBrowserCommand(input:string):Promise<string>{const parts=input.trim().split(/\s+/),cmd=parts[0];if(!cmd)return '';
 switch(cmd){case 'help':return 'Browser commands: help, pwd, ls, cat <file>, echo <text>, date, whoami, clear.\r\nNo OS shell or remote process is connected.';
 case 'pwd':return '/atlas-studio';case 'whoami':return 'browser-local';case 'date':return new Date().toString();case 'echo':return parts.slice(1).join(' ');case 'ls':return (await files.list()).map(f=>f.path).join('\r\n');case 'cat':return (await files.get(parts[1]??''))?.content??'File not found';case 'clear':return '\u000c';default:return `Command unavailable in browser-only mode: ${cmd}\r\nConnect an authorized runtime in Phase 2 to execute system processes.`}
}
export function TerminalView({id}:{id:string}){
 const host=useRef<HTMLDivElement>(null);const terminal=useRef<XTerm|null>(null);
 useEffect(()=>{if(!host.current)return;const term=new XTerm({fontSize:12,fontFamily:'JetBrains Mono, monospace',cursorBlink:true,theme:{background:'#161616',foreground:'#cccccc',cursor:'#e5e5e5',green:'#76bf9b',yellow:'#d6b36e',red:'#dd8585'},convertEol:true});const fit=new FitAddon();term.loadAddon(fit);term.open(host.current);const observer=new ResizeObserver(()=>{try{fit.fit()}catch{}});observer.observe(host.current);
 term.writeln('\x1b[1;32mWrkbench local terminal\x1b[0m  ·  no OS process');term.writeln('Enter help for supported browser commands.');let current='';const prompt=()=>term.write('\r\n\x1b[38;5;114m~/atlas-studio\x1b[0m ❯ ');prompt();
 const subscription=term.onData(data=>{if(data==='\r'){const command=current;current='';term.write('\r\n');useUI.getState().appendTerminal(id,command);void executeBrowserCommand(command).then(output=>{if(output==='\u000c'){term.clear()}else if(output)term.writeln(output.replaceAll('\n','\r\n'));prompt()});}else if(data==='\u007f'){if(current.length){current=current.slice(0,-1);term.write('\b \b')}}else if(data==='\u0003'){current='';term.write('^C');prompt()}else if(data.length===1&&data>=' '){current+=data;term.write(data)}});
 terminal.current=term;return()=>{subscription.dispose();observer.disconnect();term.dispose();terminal.current=null}},[id]);
 return <div className="view vertical"><div className="view-toolbar"><span className="section-label">TERMINAL</span><span className="chip subtle">BROWSER LOCAL</span><div className="spacer"/><ToolbarButton title="Clear terminal output" icon="trash" onClick={()=>terminal.current?.clear()} /></div><div ref={host} className="xterm-host"/></div>;
}
export function MarkdownView({path}:{path?:string}){const current=path??'docs/notes.md';const [text,setText]=useState('');const [revision,setRevision]=useState(0);const [mode,setMode]=useState<'edit'|'preview'>('edit');
 useEffect(()=>{void files.get(current).then(f=>{setText(f?.content??'');setRevision(f?.revision??0)})},[current]);
 const save=async()=>{try{const f=await files.save(current,text,revision);setRevision(f.revision);notify(`Saved ${current}`)}catch(e){notify(String(e),'error')}};
 return <div className="view vertical"><div className="view-toolbar"><span className="pathline">{current}</span><div className="spacer"/><ToolbarButton title="Toggle markdown preview" icon="file-text" onClick={()=>setMode(m=>m==='edit'?'preview':'edit')}>{mode==='edit'?'Preview':'Edit'}</ToolbarButton><ToolbarButton title="Save markdown" icon="save" onClick={()=>void save()}/></div>
 {mode==='edit'?<textarea className="writing-area" value={text} onChange={e=>setText(e.target.value)} aria-label="Markdown editor"/>:<div className="markdown-preview">{text.split('\n').map((line,i)=>line.startsWith('# ')?<h1 key={i}>{line.slice(2)}</h1>:line.startsWith('## ')?<h2 key={i}>{line.slice(3)}</h2>:<p key={i}>{line}</p>)}</div>}</div>;
}
