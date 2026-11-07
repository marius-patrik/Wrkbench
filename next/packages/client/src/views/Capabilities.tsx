import {useState,useEffect} from 'react';
import type {ViewKind} from '../../../core/src/index.ts';
import {Icon} from '../icons.tsx';
import {notify} from '../services.ts';
import {ViewToolbar} from './Primitives.tsx';
export function CapabilityView({kind}:{kind:ViewKind}){
 const [refresh,setRefresh]=useState(0),[selection,setSelection]=useState('');
 const data:Record<string,{heading:string;summary:string;capabilities:string[];action:string}>={
 docker:{heading:'Docker Engine',summary:'No Docker daemon is connected. Container inventory and operations require an authorized backend.',capabilities:['Containers','Images','Compose','Logs'],action:'Check connection'},
 tailscale:{heading:'Tailscale',summary:'VPN and device information cannot be read from a browser without the external adapter.',capabilities:['Tailnet','Devices','Routes','Exit nodes'],action:'Inspect availability'},
 runtime:{heading:'Runtime Manager',summary:'Browser local is active. Remote SSH, containers and local agent runtimes are not connected.',capabilities:['Browser local','Remote SSH','Container','Local agent'],action:'Inspect runtimes'},
 models:{heading:'Inference endpoints',summary:'Model providers are external services. No provider credentials or connections are stored.',capabilities:['LiteLLM','Ollama','vLLM','LM Studio'],action:'Inspect endpoints'},
 approvals:{heading:'Permission center',summary:'Tool invocations that request restricted capabilities require consent. No agent has active privileges.',capabilities:['File access','Network','Execution','External services'],action:'Review policies'},
 debug:{heading:'Debug Sessions',summary:'Debugger adapters require a connected runtime and DAP server. No session is active.',capabilities:['Launch','Attach','Breakpoints','Scopes'],action:'Inspect adapter'},
 tests:{heading:'Test Explorer',summary:'Browser UI can inspect test results. Running project tests requires an authorized process runtime.',capabilities:['Unit tests','Integration','Browser','Coverage'],action:'Inspect runners'},
 cad:{heading:'CAD Workspace',summary:'Geometry kernel not selected. This UI is a capability entrypoint, not a working solid modeler.',capabilities:['Sketch','Extrude','Constraints','Export'],action:'Inspect engines'},
 news:{heading:'Research feeds',summary:'External news providers are not configured. Add a provider to retrieve dated, sourced articles.',capabilities:['Sources','Collections','Tags','Alerts'],action:'Inspect sources'},
 pdf:{heading:'PDF Viewer',summary:'Select a local PDF to preview using the browser PDF renderer. The file is not uploaded.',capabilities:['Open local file','View','Print','Save as'],action:'Browse PDF'},
 graphics:{heading:'Graphics',summary:'A local raster sketch surface. No remote asset generation engine is configured.',capabilities:['Brush','Eraser','Layers','Export PNG'],action:'Open sketch'},
 browser:{heading:'Web research',summary:'Open an external URL in a separate browser tab. Sites may block in-app embedding.',capabilities:['URLs','Bookmarks','Sessions','History'],action:'Open URL'},
 preview:{heading:'Preview',summary:'Choose a local image, audio or video for native browser playback. Content never leaves this device.',capabilities:['Image','Audio','Video','Local file'],action:'Choose file'}
 };
 const cfg=data[kind]??{heading:kind,summary:'Feature package ready for a service adapter.',capabilities:['Local UI','Tool contract','Context','Permissions'],action:'Inspect'};
 const [localURL,setLocalURL]=useState(''),[fileName,setFileName]=useState('');
 useEffect(()=>()=>{if(localURL)URL.revokeObjectURL(localURL)},[localURL]);
 const choose=()=>{if(kind==='pdf'||kind==='preview')document.getElementById('filepick-'+kind)?.click();else if(kind==='browser'){const url=prompt('Open URL in a new browser tab','https://developer.mozilla.org');if(url)try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw Error('Only HTTP(S) URLs are supported');window.open(u.toString(),'_blank','noopener,noreferrer')}catch(e){notify(String(e),'error')}}else setRefresh(v=>v+1)};
 return <div className="view vertical"><ViewToolbar label={kind}><span className="chip subtle">CAPABILITY</span></ViewToolbar><div className="capability-layout"><div className="capability-icon"><Icon name={kind==='docker'?'box':kind==='tailscale'?'network':kind==='runtime'?'server':kind==='models'?'cpu':'help'} size={31}/></div><h2>{cfg.heading}</h2><p>{cfg.summary}</p><div className="cap-list">{cfg.capabilities.map(x=><button title={`Select ${x}`} className={selection===x?'selected':''} onClick={()=>setSelection(x)} key={x}><Icon name="right" size={14}/>{x}</button>)}</div><button className="outline-button" title={cfg.action} onClick={choose}><Icon name="refresh" size={15}/>{cfg.action}</button>{refresh>0&&<p className="muted">No external adapter connected · checked locally {refresh} times</p>}
 {(kind==='pdf'||kind==='preview')&&<><input id={'filepick-'+kind} type="file" accept={kind==='pdf'?'application/pdf':'image/*,audio/*,video/*,application/pdf'} hidden onChange={e=>{const file=e.currentTarget.files?.[0];if(file){setLocalURL(URL.createObjectURL(file));setFileName(file.name)}}}/>{localURL&&<div className="local-preview"><strong>{fileName}</strong>{fileName.match(/\.(png|jpg|jpeg|webp|gif)$/i)?<img src={localURL} alt={fileName}/>:fileName.match(/\.(mp4|webm|mov)$/i)?<video src={localURL} controls/>:fileName.match(/\.(mp3|wav|ogg)$/i)?<audio src={localURL} controls/>:<iframe title="Local PDF preview" src={localURL}/>}</div>}</>}
 </div></div>;
}
