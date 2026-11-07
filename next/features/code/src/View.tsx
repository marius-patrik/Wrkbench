import {useCallback,useEffect,useState} from 'react';
import Editor,{loader} from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import {files,notify} from '../../../packages/client/src/services.ts';
import {useUI} from '../../../packages/client/src/state.ts';
import {ToolbarButton} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
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
 try{const updated=await files.save(path,d.content,d.revision);mark(path,updated.revision,d.content);notify(`Saved ${path}`)}catch(e){notify(String(e),'error')}},[path,mark]);
 return <div className="view vertical"><div className="view-toolbar"><span className="pathline">atlas-studio / {path}</span>{doc?.dirty&&<span className="unsaved">● Unsaved</span>}<div className="spacer"/><ToolbarButton title="Save this file (Ctrl/⌘ S)" icon="save" disabled={!doc?.dirty} onClick={()=>void save()}>Save</ToolbarButton></div>
 {loading?<div className="view-state">Loading file…</div>:error?<div className="view-state error">{error}</div>:<div className="editor-host"><Editor path={path} value={doc?.content??''} language={language(path)} theme={theme==='dark'?'vs-dark':'vs'} options={{minimap:{enabled:false},fontFamily:'JetBrains Mono, SFMono-Regular, Consolas, monospace',fontSize:13,lineHeight:21,scrollBeyondLastLine:false,smoothScrolling:true,padding:{top:14,bottom:12},automaticLayout:true,tabSize:2,wordWrap:'off',renderLineHighlight:'line',stickyScroll:{enabled:false}}} onChange={v=>edit(path,v??'')}/></div>}
 </div>;
}

export default function FeatureView(props:FeatureViewProps){return <CodeView path={props.path}/>;}
