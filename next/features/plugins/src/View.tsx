import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function PluginsView({features,enabled,enable,disable}:{features:FeatureDefinition[];enabled:(id:string)=>boolean;enable:(id:string)=>void;disable:(id:string)=>void}){
 return <div className="view vertical"><ViewToolbar label="Extensions"><span className="chip subtle">CORDIS · MANAGED</span></ViewToolbar><div className="plugin-list">{features.map(feature=><div className="plugin-row" key={feature.id}><div className="plugin-glyph"><Icon name={feature.icon}/></div><div><strong>{feature.title}</strong><small>{feature.description}</small></div><button title={'Toggle '+feature.title+' plugin'} aria-label={'Toggle '+feature.title} disabled={feature.id==='plugins'} onClick={()=>enabled(feature.id)?disable(feature.id):enable(feature.id)}>{enabled(feature.id)?'Disable':'Enable'}</button></div>)}</div><p className="view-notice">Disabling a plugin unregisters its view factory and tools; existing tabs remain recoverable placeholders. Extensions cannot be disabled.</p></div>;
}
export default function FeatureView(props:FeatureViewProps){return <PluginsView features={props.availableFeatures} enabled={props.isFeatureEnabled} enable={props.enableFeature} disable={props.disableFeature}/>;}
