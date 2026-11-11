import {useEffect,useMemo,useState,type RefObject} from 'react';
import type {DockviewApi} from 'dockview-react';
import type {FeatureDefinition,ViewKind,WorkbenchId} from '../../../packages/core/src/index.ts';
import {WORKBENCHES} from '../../../packages/core/src/index.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {files,tools,invocationContext,notify} from '../../../packages/client/src/services.ts';
import type {WorkspaceFile} from '../../../packages/storage/src/index.ts';

export type LabelMode='text'|'both'|'icon';
export type ShellPreferences={workspaceLabel:LabelMode;contextLabel:LabelMode;primaryOpen:boolean;secondaryOpen:boolean};
const KEY='wrkbench-shell-preferences-v1';
const DEFAULTS:ShellPreferences={workspaceLabel:'text',contextLabel:'text',primaryOpen:true,secondaryOpen:false};
const MODES:LabelMode[]=['text','both','icon'];
function loadPreferences():ShellPreferences{
 try{
  const value=JSON.parse(localStorage.getItem(KEY)??'{}') as Partial<ShellPreferences>;
  return {workspaceLabel:MODES.includes(value.workspaceLabel as LabelMode)?value.workspaceLabel!:DEFAULTS.workspaceLabel,
   contextLabel:MODES.includes(value.contextLabel as LabelMode)?value.contextLabel!:DEFAULTS.contextLabel,
   primaryOpen:typeof value.primaryOpen==='boolean'?value.primaryOpen:DEFAULTS.primaryOpen,
   secondaryOpen:typeof value.secondaryOpen==='boolean'?value.secondaryOpen:DEFAULTS.secondaryOpen};
 }catch{return DEFAULTS}
}
export function useShellPreferences(){
 const [preferences,setPreferences]=useState<ShellPreferences>(loadPreferences);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(preferences))}catch(error){console.warn('Shell preferences could not be saved',error)}},[preferences]);
 return [preferences,setPreferences] as const;
}
export function SelectorLabel({mode,icon,text}:{mode:LabelMode;icon:string;text:string}){
 return <>{mode!=='text'&&<Icon name={icon} size={14}/>} {mode!=='icon'&&<span className="selector-label">{text}</span>}</>;
}
const FILE_VIEWS=new Set(['code','explorer','markdown','git','documents','sheets','pdf']);
export function PrimarySidebar({kind,workbench,features,onOpenFile,onOpenView}:{kind:string|undefined;workbench:WorkbenchId;features:FeatureDefinition[];onOpenFile:(path:string)=>void;onOpenView:(kind:ViewKind)=>void}){
 const [entries,setEntries]=useState<WorkspaceFile[]>([]);
 const selected=useUI(s=>s.filePath);
 const fileMode=FILE_VIEWS.has(kind??'');
 useEffect(()=>{
  let live=true;
  const refresh=()=>{void files.list().then(next=>{if(live)setEntries(next.sort((a,b)=>a.path.localeCompare(b.path)))}).catch(error=>notify('Unable to list local files: '+String(error),'error'))};
  refresh();const unsubscribe=files.subscribe(refresh);
  return ()=>{live=false;unsubscribe()};
 },[]);
 const relevant=WORKBENCHES[workbench].views.map(id=>features.find(feature=>feature.id===id)).filter((feature):feature is FeatureDefinition=>Boolean(feature));
 return <aside className="shell-sidebar primary-sidebar" aria-label="Primary navigation">
  <header className="sidebar-heading"><Icon name={fileMode?'folder':'grid'} size={16}/><strong>{fileMode?'Files':'Navigation'}</strong></header>
  <div className="sidebar-caption">{fileMode?'BROWSER-LOCAL WORKSPACE':WORKBENCHES[workbench].title.toUpperCase()}</div>
  <nav aria-label={fileMode?'Workspace files':'Workbench views'} className="sidebar-entries">
   {fileMode?entries.map(file=><button key={file.path} type="button" className={'sidebar-entry '+(file.path===selected?'selected':'')} title={file.path} onClick={()=>onOpenFile(file.path)}><Icon name={file.path.endsWith('.md')?'file-text':'file'} size={15}/><span>{file.path}</span></button>):
    relevant.map(feature=><button key={feature.id} type="button" className={'sidebar-entry '+(feature.id===kind?'selected':'')} title={feature.description} onClick={()=>onOpenView(feature.id)}><Icon name={feature.icon} size={15}/><span>{feature.title}</span></button>)}
   {fileMode&&entries.length===0&&<p className="sidebar-empty">No browser-local files yet.</p>}
   {!fileMode&&relevant.length===0&&<p className="sidebar-empty">No enabled views in this workbench.</p>}
  </nav>
 </aside>;
}
export function SecondarySidebar({kind,title,path,onSave}:{kind:string|undefined;title:string|undefined;path:string|undefined;onSave:()=>void}){
 const active=useUI(s=>s.activeViewId);
 const document=useUI(s=>path?s.documents[path]:undefined);
 const context=useUI(s=>s.context);
 const overrides=useUI(s=>s.contextOverrides);
 const effective=resolvedContext(active??undefined);
 const isOverride=Boolean(active&&overrides[active]&&Object.keys(overrides[active]).length);
 return <aside className="shell-sidebar secondary-sidebar" aria-label="Details">
  <header className="sidebar-heading"><Icon name="panel-right" size={16}/><strong>Details</strong></header>
  {kind?<div className="sidebar-details">
   <div className="sidebar-caption">ACTIVE VIEW</div>
   <strong className="details-title">{title??kind}</strong>
   <dl>
    <dt>Type</dt><dd>{kind}</dd>
    {path&&<><dt>Resource</dt><dd className="details-path" title={path}>{path}</dd><dt>State</dt><dd>{document?.dirty?'Unsaved edits':document?'Saved locally':'Opening'}</dd>{document&&<><dt>Revision</dt><dd>{document.revision}</dd></>}</>}
    <dt>Runtime</dt><dd>{RUNTIMES[effective.runtime]}</dd>
    <dt>Project</dt><dd>{effective.project}</dd>
    <dt>Session</dt><dd>{effective.session}</dd>
    <dt>Account</dt><dd>{effective.account}</dd>
    <dt>Context</dt><dd>{isOverride?'View override':'Inherited defaults'}</dd>
   </dl>
   {path&&document?.dirty&&<button className="sidebar-detail-action" onClick={onSave}><Icon name="save" size={14}/>Save document</button>}
   {effective.runtime!=='browser'&&<p className="sidebar-empty">This runtime is not connected; selecting it does not grant remote capabilities.</p>}
  </div>:<p className="sidebar-empty">Select an editor tab to inspect its context.</p>}
 </aside>;
}
type CommandItem={kind:'view'|'tool';id:string;title:string;detail:string;icon:string};
const SIMPLE_TOOLS=new Set(['layout.split','window.float','file.save','theme.toggle']);
function editable(target:EventTarget|null){
 return target instanceof HTMLElement&&Boolean(target.isContentEditable||target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],.monaco-editor,.xterm,.cm-editor'));
}
export function Omnibar({inputRef,features,openView}:{inputRef:RefObject<HTMLInputElement|null>;features:FeatureDefinition[];openView:(kind:ViewKind)=>void}){
 const [query,setQuery]=useState(''),[expanded,setExpanded]=useState(false),[selected,setSelected]=useState(0);
 const options=useMemo<CommandItem[]>(()=>[
  ...features.map(feature=>({kind:'view' as const,id:feature.id,title:feature.title,detail:feature.description,icon:feature.icon})),
  ...tools.list().filter(command=>SIMPLE_TOOLS.has(command.id)).map(command=>({kind:'tool' as const,id:command.id,title:command.label,detail:command.description,icon:'command'}))
 ],[features]);
 const filtered=options.filter(item=>!query||`${item.title} ${item.id} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0,12);
 useEffect(()=>{const onKey=(event:KeyboardEvent)=>{
  const accelerator=event.metaKey||event.ctrlKey;
  if(accelerator&&!event.altKey&&event.key.toLowerCase()==='k'){event.preventDefault();inputRef.current?.focus();setExpanded(true);return}
  if(event.defaultPrevented||accelerator||event.altKey||event.isComposing||event.key.length!==1||editable(event.target))return;
  if(event.target instanceof HTMLElement&&event.target.closest('button,a,[role="menu"],[role="listbox"]'))return;
  event.preventDefault();inputRef.current?.focus();setQuery(value=>value+event.key);setSelected(0);setExpanded(true);
 };document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[inputRef]);
 const execute=(item:CommandItem)=>{
  setQuery('');setExpanded(false);inputRef.current?.blur();
  if(item.kind==='view'){openView(item.id);return}
  void tools.invoke(item.id,{},invocationContext()).catch(error=>notify(String(error),'error'));
 };
 return <div className="omnibar" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setExpanded(false)}}>
  <Icon name="search" size={15}/>
  <input ref={inputRef} role="combobox" aria-label="Omnibar" aria-expanded={expanded} aria-controls="omnibar-options"
   aria-autocomplete="list" autoComplete="off" value={query} placeholder="Type a command, view, or search…"
   onFocus={()=>setExpanded(true)} onChange={event=>{setQuery(event.target.value);setSelected(0);setExpanded(true)}}
   onKeyDown={event=>{
    if(event.key==='ArrowDown'){event.preventDefault();setSelected(index=>Math.min(index+1,filtered.length-1))}
    if(event.key==='ArrowUp'){event.preventDefault();setSelected(index=>Math.max(0,index-1))}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setExpanded(false);setQuery('');inputRef.current?.blur()}
    if(event.key==='Enter'&&expanded&&filtered.length){event.preventDefault();execute(filtered[Math.min(selected,filtered.length-1)])}
   }}/>
  <kbd>⌘ K</kbd>
  {expanded&&<div className="omnibar-options" id="omnibar-options" role="listbox" aria-label="Available views and commands" onMouseDown={event=>event.preventDefault()}>
   {filtered.length?filtered.map((item,index)=><button key={item.kind+item.id} type="button" role="option" aria-selected={selected===index}
    className={'omnibar-option '+(selected===index?'selected':'')} onMouseEnter={()=>setSelected(index)} onClick={()=>execute(item)}>
     <Icon name={item.icon} size={15}/><span><strong>{item.title}</strong><small>{item.detail}</small></span><em>{item.kind}</em>
    </button>):<div className="sidebar-empty">No matching commands or views.</div>}
  </div>}
 </div>;
}
