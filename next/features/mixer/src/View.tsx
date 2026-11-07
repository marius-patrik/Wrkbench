import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function MixerView(){const mutes=useUI(s=>s.mutes),volumes=useUI(s=>s.volumes),setVolume=useUI(s=>s.setVolume),toggleMute=useUI(s=>s.toggleMute);
 return <div className="view vertical"><ViewToolbar label="Mixer"><span className="chip subtle">LOCAL MIX STATE</span></ViewToolbar><div className="mixers">{['Music','Voice','Ambience','Effects'].map((name,i)=><div className="mixer-strip" key={name}><div className="meter"><span style={{height:`${mutes[i]?0:volumes[i]??65}%`}}/></div><label>{name}</label><input type="range" aria-label={`Volume ${name}`} title={`Volume ${name}`} min="0" max="100" value={volumes[i]??65} onChange={e=>setVolume(i,+e.target.value)} /><span>{volumes[i]??65}%</span><button title={`${mutes[i]?'Unmute':'Mute'} ${name}`} onClick={()=>toggleMute(i)} className={mutes[i]?'muted-button':''}>{mutes[i]?'Muted':'Mute'}</button></div>)}</div><div className="view-notice">Mixer settings are local. No audio engine is connected.</div></div>;
}
export default function FeatureView(props:FeatureViewProps){return <MixerView />;}
