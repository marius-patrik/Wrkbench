import {useEffect,useState} from 'react';
import {files,notify} from '../../../packages/client/src/services.ts';
import {ToolbarButton} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function MarkdownView({path}:{path?:string}){const current=path??'docs/notes.md';const [text,setText]=useState('');const [revision,setRevision]=useState(0);const [mode,setMode]=useState<'edit'|'preview'>('edit');
 useEffect(()=>{void files.get(current).then(f=>{setText(f?.content??'');setRevision(f?.revision??0)})},[current]);
 const save=async()=>{try{const f=await files.save(current,text,revision);setRevision(f.revision);notify(`Saved ${current}`)}catch(e){notify(String(e),'error')}};
 return <div className="view vertical"><div className="view-toolbar"><span className="pathline">{current}</span><div className="spacer"/><ToolbarButton title="Toggle markdown preview" icon="file-text" onClick={()=>setMode(m=>m==='edit'?'preview':'edit')}>{mode==='edit'?'Preview':'Edit'}</ToolbarButton><ToolbarButton title="Save markdown" icon="save" onClick={()=>void save()}/></div>
 {mode==='edit'?<textarea className="writing-area" value={text} onChange={e=>setText(e.target.value)} aria-label="Markdown editor"/>:<div className="markdown-preview">{text.split('\n').map((line,i)=>line.startsWith('# ')?<h1 key={i}>{line.slice(2)}</h1>:line.startsWith('## ')?<h2 key={i}>{line.slice(3)}</h2>:<p key={i}>{line}</p>)}</div>}</div>;
}

export default function FeatureView(props:FeatureViewProps){return <MarkdownView path={props.path}/>;}
