import {Suspense,createContext,useCallback,useContext,useEffect,useRef,useState,type MutableRefObject} from 'react';
import {DockviewReact,themeDark,themeLight,type DockviewReadyEvent,type DockviewApi,type IDockviewPanelProps} from 'dockview-react';
import type {FeatureDefinition,ViewKind,WorkbenchId,RuntimeId} from '../../../packages/core/src/index.ts';
import {WORKBENCHES,uniqueId} from '../../../packages/core/src/index.ts';
import {TabTransferQueue,type TabTransfer} from '../../../packages/core/src/transfers.ts';
import {createClientHost, type FeatureContribution} from '../../../packages/sdk/src/index.ts';
import {plugins} from './plugins.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {files,seedFiles,tools,invocationContext,notify,registerClientTools,bindToolRegistry} from '../../../packages/client/src/services.ts';
import {useLocation} from 'wouter';
const PLUGIN_PREFS_KEY='wrkbench-disabled-plugin-ids-v1';
function disabledFeatureIds():Set<string>{
 try{const value=JSON.parse(localStorage.getItem(PLUGIN_PREFS_KEY)??'[]');
  return new Set(Array.isArray(value)?value.filter((id:unknown)=>typeof id==='string'&&id!=='plugins'):[])}
 catch{return new Set()}
}
function setDisabledFeaturePreference(id:string,disabled:boolean){
 const ids=disabledFeatureIds();
 if(disabled)ids.add(id);else ids.delete(id);
 try{localStorage.setItem(PLUGIN_PREFS_KEY,JSON.stringify([...ids]))}
 catch(error){console.warn('Plugin preferences could not be saved',error)}
}
const BOOTSTRAP_KEY='wrkbench-real-dockview-v3-';
const transferQueue=new TabTransferQueue(localStorage);
function safeJSON(value:string|null){try{return value?JSON.parse(value):null}catch{return null}}
// Dockview remains the sole mutable layout owner. This tracks bounded serialized
// checkpoints for undo/redo without storing a competing group/panel graph.
type LayoutHistoryState={snapshots:string[];index:number;suspended:boolean};
const histories=new Map<WorkbenchId,LayoutHistoryState>();
function recordLayout(id:WorkbenchId,snapshot:string){
 let history=histories.get(id);
 if(!history){history={snapshots:[snapshot],index:0,suspended:false};histories.set(id,history);return}
 if(history.suspended||history.snapshots[history.index]===snapshot)return;
 history.snapshots=history.snapshots.slice(0,history.index+1);
 history.snapshots.push(snapshot);
 if(history.snapshots.length>60)history.snapshots.shift();
 history.index=history.snapshots.length-1;
}
function travelLayout(id:WorkbenchId,api:DockviewApi|null,offset:-1|1){
 const history=histories.get(id),next=(history?.index??0)+offset;
 if(!api||!history||next<0||next>=history.snapshots.length)return false;
 const previous=history.index;
 history.index=next;history.suspended=true;
 try{
  const snapshot=history.snapshots[next];
  api.fromJSON(JSON.parse(snapshot),{reuseExistingPanels:false});
  localStorage.setItem(BOOTSTRAP_KEY+id,snapshot);
 }catch(error){history.index=previous;console.error('Could not restore layout checkpoint',error);return false}
 finally{requestAnimationFrame(()=>{history.suspended=false})}
 return true;
}
function preset(api:DockviewApi,id:WorkbenchId){const list=WORKBENCHES[id].views;let main:string|null=null;
 list.forEach((kind,index)=>{const panelId=`preset-${id}-${kind}`;const direction=index===0?undefined:index===1?'right':index===2?'right':index===3?'below':'within';
 api.addPanel({id:panelId,component:'feature',title:kind==='git'?'Source Control':kind.charAt(0).toUpperCase()+kind.slice(1),params:kind==='code'?{kind,path:'src/App.tsx'}:{kind},...(main&&direction?{position:{referencePanel:main,direction:direction as 'right'|'below'|'within'}}:{})});if(index===1)main=panelId;else if(index===0)main=panelId;});}
interface AppContextType{features:FeatureDefinition[];openFile:(path:string)=>void;openView:(kind:ViewKind)=>void;getFeature:(kind:ViewKind)=>FeatureContribution|undefined;disableFeature:(id:string)=>void;enableFeature:(id:string)=>void;}
const FeatureContext=createContext<AppContextType>({features:[],openFile:()=>{},openView:()=>{},getFeature:()=>undefined,disableFeature:()=>{},enableFeature:()=>{}});
function FeaturePanel(props:IDockviewPanelProps){
 const {features,openFile,openView,getFeature,disableFeature,enableFeature}=useContext(FeatureContext);
 const kind=(props.params.kind as ViewKind)??'notes';
 const contribution=getFeature(kind);
 if(!contribution)return <div className="view vertical"><div className="view-state error" role="status">{kind} plugin is unavailable. The tab and its resource identity are preserved; enable the feature from Extensions to recover it.</div></div>;
 return <Suspense fallback={<div className="view-state">Loading {contribution.title}…</div>}>{contribution.render({viewId:props.api.id,path:props.params.path as string|undefined,params:props.params as Record<string,unknown>,features,availableFeatures:plugins.map(p=>p.definition),isFeatureEnabled:(id:string)=>!!getFeature(id as ViewKind),enableFeature,openFile,openView,disableFeature})}</Suspense>;
}
const COMPONENTS={feature:FeaturePanel};
function DockWorkspace({workbench,apiRef,onMoveTab}:{workbench:WorkbenchId;apiRef:MutableRefObject<DockviewApi|null>;onMoveTab:(id:string,target:WorkbenchId)=>void}){
 const [error,setError]=useState('');
 const unsubscribe=useRef<(()=>void)|null>(null);
 useEffect(()=>()=>{unsubscribe.current?.();unsubscribe.current=null;apiRef.current=null},[apiRef]);
 const onReady=useCallback((event:DockviewReadyEvent)=>{const api=event.api;apiRef.current=api;
   const snap=safeJSON(localStorage.getItem(BOOTSTRAP_KEY+workbench));
   try{if(snap)api.fromJSON(snap,{reuseExistingPanels:false});else preset(api,workbench);}catch(e){console.error(e);setError('Saved layout could not be loaded. The default layout was restored.');api.clear();preset(api,workbench)}
   try {
     for(const transfer of transferQueue.departures(workbench)){
       const duplicate=api.getPanel(transfer.id);
       if(duplicate)api.removePanel(duplicate,{removeEmptyGroup:false});
     }
     for(const transfer of transferQueue.arrivals(workbench)){
       if(!api.getPanel(transfer.id))api.addPanel({id:transfer.id,component:'feature',title:transfer.title,params:transfer.params,...(api.activePanel?{position:{referencePanel:api.activePanel.id,direction:'within'}}:{})});
       // Commit the destination layout before clearing the durable transfer journal.
       localStorage.setItem(BOOTSTRAP_KEY+workbench,JSON.stringify(api.toJSON()));
       transferQueue.acknowledge(transfer.id,workbench);
     }
   }catch(error){console.error('Tab recovery',error);setError('Tab transfer recovery was interrupted. The pending record is preserved: '+String(error));}
   recordLayout(workbench,JSON.stringify(api.toJSON()));
   const a=api.onDidLayoutChange(()=>{try{const snapshot=JSON.stringify(api.toJSON());recordLayout(workbench,snapshot);localStorage.setItem(BOOTSTRAP_KEY+workbench,snapshot)}catch(e){console.warn('Layout persistence unavailable',e)}});
   const b=api.onDidActivePanelChange(e=>useUI.getState().setActiveView(e.panel?.id??null));
   const c=api.onDidOpenPopoutWindowFail(()=>notify('Popout blocked. Allow popups for this origin.','error'));
   useUI.getState().setActiveView(api.activePanel?.id??null);
   unsubscribe.current?.();unsubscribe.current=()=>{a.dispose();b.dispose();c.dispose()};
 },[workbench,apiRef]);
 return <div className="dock-root">{error&&<div role="alert" className="layout-error">{error}<button onClick={()=>setError('')} title="Dismiss layout error"><Icon name="x"/></button></div>}<DockviewReact className="wrkbench-dockview" theme={useUI(s=>s.theme)==='dark'?themeDark:themeLight} components={COMPONENTS} onReady={onReady} closeEmptyGroups={false} floatingGroupDragHandle="titlebar" defaultHeaderPosition="top" getTabContextMenuItems={(p)=>['close','closeOthers','separator',{label:'Float this tab',action:()=>p.api.addFloatingGroup(p.panel,{position:{left:70,top:70},width:510,height:360})},{label:'Pop out group',action:()=>void p.api.addPopoutGroup(p.group,{popoutUrl:'./popout.html'})},'separator',...Object.keys(WORKBENCHES).filter(id=>id!==workbench).map(id=>({label:`Move to ${WORKBENCHES[id as WorkbenchId].title}`,action:()=>onMoveTab(p.panel.id,id as WorkbenchId)})),'separator','maximize']}/></div>
}
function ToastHost(){const [items,setItems]=useState<{id:string;message:string;mode:string}[]>([]);
 useEffect(()=>{const on=(e:Event)=>{const msg=(e as CustomEvent<{message:string;mode:string}>).detail;const id=uniqueId('toast');setItems(s=>[...s.slice(-3),{...msg,id}]);setTimeout(()=>setItems(s=>s.filter(t=>t.id!==id)),3800)};document.addEventListener('wrkbench:toast',on);return()=>document.removeEventListener('wrkbench:toast',on)},[]);
 return <div className="toast-host" aria-live="polite">{items.map(t=><div key={t.id} className={'toast '+t.mode}><Icon name={t.mode==='error'?'x':'done'}/>{t.message}</div>)}</div>;
}
function ContextMenu({close}:{close:()=>void}){const active=useUI(s=>s.activeViewId),current=useUI(s=>s.context),overrides=useUI(s=>s.contextOverrides),set=useUI(s=>s.setContext),reset=useUI(s=>s.resetContext);
 const [scope,setScope]=useState<'global'|'view'>(active?'view':'global');const resolved=scope==='view'&&active?{...current,...overrides[active]}:current;
 return <div className="popover context-menu" role="menu" onClick={e=>e.stopPropagation()}><header><strong>Execution context</strong><button title="Close context menu" onClick={close}><Icon name="x" size={14}/></button></header><div className="segmented"><button title="Change default context for new views" className={scope==='global'?'selected':''} onClick={()=>setScope('global')}>Default</button><button title="Override this view only" disabled={!active} className={scope==='view'?'selected':''} onClick={()=>setScope('view')}>This view</button></div><span className="menu-label">RUNTIME</span>{Object.entries(RUNTIMES).map(([id,label])=><button className="menu-item" title={`Set runtime to ${label}`} key={id} onClick={()=>{set({runtime:id as RuntimeId},scope==='view'?active??undefined:undefined);close()}}><span className={'status-dot '+(id==='browser'?'success':'warning')}/><span>{label}</span><span className="spacer"/>{resolved.runtime===id&&<Icon name="done" size={15}/>}</button>)}<div className="menu-separator"/><span className="menu-label">SESSION</span>{['personal','research','team-preview'].map(s=><button className="menu-item" title={`Select session ${s}`} key={s} onClick={()=>{set({session:s},scope==='view'?active??undefined:undefined);close()}}><Icon name="folder" size={14}/>{s}{resolved.session===s&&<span className="spacer"/>}{resolved.session===s&&<Icon name="done" size={14}/>}</button>)}{scope==='view'&&active&&<><div className="menu-separator"/><button className="menu-item" title="Use workspace context without overrides" onClick={()=>{reset(active);close()}}><Icon name="refresh"/> Reset view overrides</button></>}<footer>Context switching does not connect to external runtimes.</footer></div>;
}
function DisplayMenu({onPopout,close}:{onPopout:()=>void;close:()=>void}){return <div className="popover display-menu" role="menu" onClick={e=>e.stopPropagation()}><header><strong>Display manager</strong><button title="Close display manager" onClick={close}><Icon name="x" size={14}/></button></header><div className="display-item"><Icon name="monitor" size={19}/><div><strong>Browser window</strong><small>Primary · active · 1 display detected</small></div><span className="status-dot success"/></div><div className="display-item disabled"><Icon name="monitor" size={19}/><div><strong>Additional monitors</strong><small>Enumeration requires browser permission or native shell</small></div></div><div className="menu-separator"/><button className="menu-item" title="Pop out active editor group into a browser window" onClick={()=>{onPopout();close()}}><Icon name="external"/>Pop out active group</button><footer>Browser popouts need an HTTP origin and permission.</footer></div>}
function Palette({close,features,openView,openAddMenu}:{close:()=>void;features:FeatureDefinition[];openView:(id:ViewKind)=>void;openAddMenu:()=>void}){const [query,setQuery]=useState(''),input=useRef<HTMLInputElement>(null);useEffect(()=>input.current?.focus(),[]);
 const commands=tools.list().map(t=>({id:t.id,title:t.label,detail:t.description,kind:'tool'}));const filtered=commands.filter(x=>`${x.title} ${x.id} ${x.detail}`.toLowerCase().includes(query.toLowerCase())).slice(0,45);
 const run=(item:(typeof filtered)[number])=>{close();if(item.kind==='view')openView(item.id as ViewKind);else if(item.id==='view.open'){openAddMenu()}else void tools.invoke(item.id,{},invocationContext()).catch(e=>notify(String(e),'error'))};
 return <div className="palette-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="palette" role="dialog" aria-label="Tool palette"><div className="palette-search"><Icon name="search"/><input ref={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search tools, features and commands…" aria-label="Search tools" onKeyDown={e=>{if(e.key==='Escape')close();if(e.key==='Enter'&&filtered[0])run(filtered[0])}}/><kbd>ESC</kbd></div><div className="palette-results">{filtered.map(x=><button key={x.kind+x.id} className="palette-result" title={x.detail} onClick={()=>run(x)}><Icon name={x.kind==='tool'?'command':'grid'}/><div><strong>{x.title}</strong><small>{x.detail}</small></div><span className="spacer"/><span className="chip subtle">{x.kind}</span></button>)}{!filtered.length&&<div className="view-state">No matching tools</div>}</div><footer>One ToolRegistry · toolbar, palette and feature plugins</footer></div></div>;
}
export function App(){const theme=useUI(s=>s.theme),toggle=useUI(s=>s.themeToggle),wb=useUI(s=>s.workbench),switchWorkbench=useUI(s=>s.switchWorkbench),active=useUI(s=>s.activeViewId),context=useUI(s=>s.context),override=useUI(s=>s.contextOverrides);
 const [location,navigate]=useLocation();
 const [catalog,setCatalog]=useState<FeatureDefinition[]>([]),[ready,setReady]=useState(false),[menu,setMenu]=useState<'none'|'workbench'|'add'|'context'|'display'>('none'),[palette,setPalette]=useState(false),[filter,setFilter]=useState('');
 const apiRef=useRef<DockviewApi|null>(null);const hostRef=useRef<Awaited<ReturnType<typeof createClientHost>>|null>(null);
 useEffect(()=>{let mounted=true;let host:Awaited<ReturnType<typeof createClientHost>>|undefined;let unsubscribe:(()=>void)|undefined;void createClientHost(plugins,{disabledFeatures:disabledFeatureIds()}).then(h=>{host=h;if(!mounted){void h.dispose();return}hostRef.current=h;bindToolRegistry(h.toolRegistry);unsubscribe=h.catalog.subscribe(()=>setCatalog(h.catalog.list()));setCatalog(h.catalog.list());setReady(true)}).catch(e=>{console.error(e);notify(`Cordis startup failed: ${String(e)}`,'error')});return()=>{mounted=false;unsubscribe?.();bindToolRegistry(null);if(host)void host.dispose();hostRef.current=null}},[]);
 useEffect(()=>{void files.seed(seedFiles).catch(e=>notify(`Local storage unavailable: ${String(e)}`,'error'))},[]);
 const selectWorkbench=useCallback((id:WorkbenchId)=>{switchWorkbench(id);navigate('/workbench/'+id)},[switchWorkbench,navigate]);
 useEffect(()=>{const match=location.match(/^\/workbench\/(development|research|audio|video|operations|agents|trading)$/);if(match&&match[1]!==wb)switchWorkbench(match[1] as WorkbenchId)},[location,wb,switchWorkbench]);
 useEffect(()=>files.subscribe(change=>{
   if(change.type==='saved'){
    if(!change.external)return;
    void files.get(change.path).then(file=>{
     if(!file)return;
     const current=useUI.getState().documents[file.path];
     if(current?.dirty){
      notify(`${file.path} changed in another browser tab. Your unsaved edits are preserved; compare before saving.`,'error');
      return;
     }
     useUI.getState().cacheDocument(file.path,file.content,file.revision);
    }).catch(error=>notify(`Could not refresh ${change.path}: ${String(error)}`,'error'));
    return;
   }
   if(change.type==='renamed'){
    if(change.external&&useUI.getState().documents[change.from]?.dirty){
     notify(`${change.from} was renamed in another tab. Unsaved edits were preserved.`,'error');return;
    }
    useUI.getState().moveDocument(change.from,change.to);
    for(const panel of apiRef.current?.panels??[]){
     const params=panel.api.getParameters() as {path?:string;kind?:ViewKind};
     if(params.path===change.from){
      panel.api.updateParameters({...params,path:change.to});
      panel.api.setTitle(change.to.split('/').at(-1)??change.to);
     }
    }
   }else if(change.type==='deleted'){
    if(change.external&&useUI.getState().documents[change.path]?.dirty){
     notify(`${change.path} was deleted in another tab. Unsaved edits were preserved.`,'error');return;
    }
    useUI.getState().removeDocument(change.path);
    for(const panel of [...(apiRef.current?.panels??[])]){
     const params=panel.api.getParameters() as {path?:string};
     if(params.path===change.path)panel.api.close();
    }
   }
  }),[]);
 const transferTab=useCallback((panelId:string,target:WorkbenchId)=>{
   const api=apiRef.current,panel=api?.getPanel(panelId);
   if(!api||!panel||target===wb)return;
   const record:TabTransfer={id:panel.id,title:panel.title??panel.id,params:panel.api.getParameters() as Record<string,unknown>,source:wb,target,createdAt:Date.now()};
   try{
     // Journaling first: recoverability must precede removal from Dockview.
     transferQueue.stage(record);
     api.removePanel(panel,{removeEmptyGroup:false});
     localStorage.setItem(BOOTSTRAP_KEY+wb,JSON.stringify(api.toJSON()));
     selectWorkbench(target);
   }catch(error){
     notify('Tab transfer interrupted; its recovery record was preserved: '+String(error),'error');
   }
 },[wb,selectWorkbench]);
 const openView=useCallback((kind:ViewKind)=>{const api=apiRef.current;if(!api)return;if(!hostRef.current?.catalog.get(kind)){notify(`Plugin disabled: ${kind}`,'error');return}
 const panel=api.addPanel({id:uniqueId(kind),component:'feature',title:hostRef.current.catalog.get(kind)?.title??kind,params:{kind},...(api.activePanel?{position:{referencePanel:api.activePanel.id,direction:'within'}}:{})});panel.api.setActive();setMenu('none');setFilter('')},[]);
 const openFile=useCallback((path:string)=>{const api=apiRef.current;if(!api)return;useUI.getState().selectFile(path);
 const existing=api.panels.find(p=>(p.api.getParameters() as {path?:string}).path===path);if(existing){existing.api.setActive();return}
 const kind:ViewKind=path.endsWith('.md')?'markdown':'code';const p=api.addPanel({id:uniqueId('file'),title:path.split('/').at(-1)||path,component:'feature',params:{kind,path},...(api.activePanel?{position:{referencePanel:api.activePanel.id,direction:'within'}}:{})});p.api.setActive();setMenu('none')},[]);
 const split=useCallback(()=>{const api=apiRef.current;if(!api)return;api.addGroup(api.activeGroup?{referenceGroup:api.activeGroup,direction:'right'}:{direction:'right'});notify('Empty editor group created — drag any tab here')},[]);
 const float=useCallback(()=>{const api=apiRef.current;if(api?.activePanel)api.addFloatingGroup(api.activePanel,{position:{top:70,left:90},width:490,height:340})},[]);
 const popout=useCallback(()=>{const api=apiRef.current;if(api?.activeGroup)void api.addPopoutGroup(api.activeGroup,{popoutUrl:'./popout.html'}).then(success=>{if(!success)notify('Browser popout was blocked or unavailable','error')}).catch(e=>notify(String(e),'error'))},[]);
 const save=useCallback(async()=>{const s=useUI.getState(),id=s.activeViewId,api=apiRef.current,p=id?api?.getPanel(id):null;const path=(p?.api.getParameters() as {path?:string}|undefined)?.path??'src/App.tsx';const doc=s.documents[path];if(!doc?.dirty){notify('No unsaved changes');return}try{const result=await files.save(path,doc.content,doc.revision);useUI.getState().markSaved(path,result.revision,doc.content);notify(`Saved ${path}`)}catch(e){notify(String(e),'error')}},[]);
 useEffect(()=>{if(!ready)return;const host=hostRef.current;if(!host)return;const detach=host.viewActions.attach(openView);const unregister=registerClientTools({open:openView,split,float,save});return()=>{unregister();detach()}},[ready,openView,split,float,save]);
 const disableFeature=useCallback((id:string)=>{if(id==='plugins'){notify('Extensions is required for plugin recovery','error');return}void hostRef.current?.disable(id as ViewKind).then(()=>setDisabledFeaturePreference(id,true)).catch(e=>notify(String(e),'error'))},[]);
 const enableFeature=useCallback((id:string)=>{void hostRef.current?.enable(id as ViewKind).then(()=>setDisabledFeaturePreference(id,false)).catch(e=>notify(String(e),'error'))},[]);
 const getFeature=useCallback((kind:ViewKind)=>hostRef.current?.catalog.get(kind),[]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const accel=e.metaKey||e.ctrlKey;if(accel&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(true)}else if(accel&&e.key.toLowerCase()==='s'){e.preventDefault();void save()}else if(accel&&e.key.toLowerCase()==='\\'){e.preventDefault();split()}else if(e.key==='Escape'){setPalette(false);setMenu('none')}};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[save,split]);
 useEffect(()=>{const onBefore=(e:BeforeUnloadEvent)=>{if(Object.values(useUI.getState().documents).some(d=>d.dirty)){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',onBefore);return()=>window.removeEventListener('beforeunload',onBefore)},[]);
 const chosen=active?{...context,...override[active]}:context;
 return <div className={'app '+theme} onClick={()=>{if(menu!=='none')setMenu('none')}}>
 <header className="titlebar"><div className="workspace-crumb"><button className="workspace-selector" title="Current local workspace" onClick={e=>e.stopPropagation()}><Icon name="folder" size={16}/> <strong>Atlas Studio</strong><span className="subcrumb">/ platform / main</span><Icon name="chevron-down" size={13}/></button></div>
 <button className="title-search" title="Open tool palette (⌘/Ctrl+K)" onClick={()=>setPalette(true)}><Icon name="search" size={16}/><span>Search tools, views, workbenches…</span><kbd>⌘ K</kbd></button>
 <div className="title-actions"><button title={theme==='dark'?'Switch to light mode':'Switch to dark mode'} onClick={toggle}><Icon name={theme==='dark'?'sun':'moon'} size={18}/></button><button title="Open extensions" onClick={()=>openView('plugins')}><Icon name="puzzle" size={18}/></button><button className="avatar" title="Local profile · no account connected">PM</button></div></header>
 <div className="app-center"><nav className="activity-bar" aria-label="Workbenches">{(Object.keys(WORKBENCHES) as WorkbenchId[]).map(id=><button key={id} title={`Open ${WORKBENCHES[id].title} workbench`} aria-label={`${WORKBENCHES[id].title} workbench`} className={wb===id?'active':''} onClick={()=>selectWorkbench(id)}><Icon name={WORKBENCHES[id].icon} size={21}/></button>)}</nav>
 <main className="workspace"><div className="workspace-toolbar"><div className="toolbar-start"><button className="toolbar-icon" title="Undo layout change" onClick={()=>{if(!travelLayout(wb,apiRef.current,-1))notify('No earlier layout checkpoint')}}><Icon name="undo"/></button><button className="toolbar-icon" title="Redo layout change" onClick={()=>{if(!travelLayout(wb,apiRef.current,1))notify('No later layout checkpoint')}}><Icon name="redo"/></button><div className="menu-wrap"><button className="workbench-picker" title="Choose workbench preset" onClick={e=>{e.stopPropagation();setMenu(menu==='workbench'?'none':'workbench')}}><Icon name={WORKBENCHES[wb].icon}/>{WORKBENCHES[wb].title}<Icon name="chevron-down" size={12}/></button>{menu==='workbench'&&<div className="popover toolbar-menu" onClick={e=>e.stopPropagation()}><span className="menu-label">WORKBENCHES</span>{(Object.keys(WORKBENCHES) as WorkbenchId[]).map(id=><button key={id} className="menu-item" title={WORKBENCHES[id].description} onClick={()=>{selectWorkbench(id);setMenu('none')}}><Icon name={WORKBENCHES[id].icon}/><div><strong>{WORKBENCHES[id].title}</strong><small>{WORKBENCHES[id].description}</small></div>{id===wb&&<Icon name="done" size={14}/>}</button>)}</div>}</div><span className="toolbar-divider"/><button className="toolbar-button" title="Create empty editor group (Ctrl/⌘ + \\)" onClick={split}><Icon name="split" size={15}/>Split</button><button className="toolbar-icon" title="Save current document (Ctrl/⌘ S)" onClick={()=>void save()}><Icon name="save" size={16}/></button></div>
 <div className="toolbar-end"><button className="toolbar-button subtle" title="Float active editor as a Dockview window" onClick={float}><Icon name="external" size={15}/> Float</button><div className="menu-wrap"><button className="primary-button" title="Add plugin view to active tab group" onClick={e=>{e.stopPropagation();setMenu(menu==='add'?'none':'add')}}><Icon name="plus" size={16}/> Add view</button>{menu==='add'&&<div className="popover add-menu" onClick={e=>e.stopPropagation()}><div className="add-search"><Icon name="search" size={15}/><input autoFocus aria-label="Filter available features" placeholder="Find a view…" value={filter} onChange={e=>setFilter(e.target.value)}/></div><div className="add-list">{catalog.filter(f=>`${f.title} ${f.category}`.toLowerCase().includes(filter.toLowerCase())).map(f=><button title={f.description} className="menu-item" key={f.id} onClick={()=>openView(f.id)}><Icon name={f.icon}/><div><strong>{f.title}</strong><small>{f.category}</small></div><Icon name="plus" size={14}/></button>)}</div></div>}</div></div></div>
 <FeatureContext.Provider value={{features:catalog,openFile,openView,getFeature,disableFeature,enableFeature}}><div className="workspace-interior">{ready?<DockWorkspace key={wb} workbench={wb} apiRef={apiRef} onMoveTab={transferTab}/>:<div className="loading-screen"><Icon name="grid" size={30}/><h2>Starting Cordis plugins…</h2><p>Initializing window manager and local services</p></div>}</div></FeatureContext.Provider>
 </main></div>
 <footer className="statusbar" onClick={e=>e.stopPropagation()}><div className="status-left"><div className="status-wrap"><button className="status-button" title="Open context switcher" onClick={()=>setMenu(menu==='context'?'none':'context')}><Icon name="globe" size={14}/><span>{RUNTIMES[chosen.runtime]} · {chosen.session}</span><Icon name="chevron-down" size={12}/></button>{menu==='context'&&<ContextMenu close={()=>setMenu('none')}/>}</div><span className="status-sep"/><span className="status-live"><i/> Browser-local workspace</span></div><div className="status-right"><span className="status-workbench">{WORKBENCHES[wb].title}</span><span className="status-sep"/><div className="status-wrap"><button className="status-button" title="Open display manager" onClick={()=>setMenu(menu==='display'?'none':'display')}><Icon name="monitor" size={14}/> Browser window <Icon name="chevron-down" size={12}/></button>{menu==='display'&&<DisplayMenu close={()=>setMenu('none')} onPopout={popout}/>}</div><span className="status-sep"/><span className="status-saved"><Icon name="done" size={13}/> Local state</span></div></footer>
 <ToastHost/>{palette&&<Palette close={()=>setPalette(false)} features={catalog} openView={openView} openAddMenu={()=>setMenu('add')}/>}</div>;
}
