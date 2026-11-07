import {useCallback,useEffect,useState} from 'react';
import {files,notify} from '../../../packages/client/src/services.ts';
import {useUI} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {ToolbarButton} from '../../../packages/client/src/views/Primitives.tsx';
import type {WorkspaceFile} from '../../../packages/storage/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function ExplorerView({onOpen}:{onOpen:(path:string)=>void}){
 const [list,setList]=useState<WorkspaceFile[]>([]),[filter,setFilter]=useState(''),[collapsed,setCollapsed]=useState<Set<string>>(new Set()),[busy,setBusy]=useState(false),[selected,setSelected]=useState('');
 const refresh=useCallback(()=>{setBusy(true);void files.list().then(f=>setList(f.sort((a,b)=>a.path.localeCompare(b.path)))).catch(e=>notify(String(e),'error')).finally(()=>setBusy(false))},[]);
 useEffect(()=>{refresh();return files.subscribe(()=>refresh())},[refresh]);
 const newFile=async()=>{const path=prompt('New file path (relative to workspace)', 'src/new-file.ts');if(!path)return;
 if(!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9_./\- ]+$/.test(path)){notify('Invalid file path','error');return}
 if(await files.get(path)){notify('File already exists','error');return}try{await files.save(path,'',0);refresh();onOpen(path)}catch(e){notify(String(e),'error')}};
 const rename=async(path:string)=>{if(useUI.getState().documents[path]?.dirty){notify('Save changes before renaming','error');return;}const next=prompt('Rename file',path);if(!next||next===path)return;
 try{await files.rename(path,next,list.find(f=>f.path===path)?.revision);notify(`Renamed to ${next}`)}catch(e){notify(String(e),'error')}};
 const remove=async(path:string)=>{if(useUI.getState().documents[path]?.dirty){notify('Save changes before deleting','error');return;}if(!confirm(`Delete ${path}? This cannot be undone.`))return;try{await files.remove(path,list.find(f=>f.path===path)?.revision);notify(`${path} deleted`)}catch(e){notify(String(e),'error')}};
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

export default function FeatureView(props:FeatureViewProps){return <ExplorerView onOpen={props.openFile}/>;}
