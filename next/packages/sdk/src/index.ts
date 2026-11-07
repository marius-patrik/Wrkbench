import {Context,Service} from 'cordis';
import type {ReactNode} from 'react';
import {z} from 'zod';
import {ToolRegistry,type FeatureDefinition,type ViewKind} from '../../core/src/index.ts';
export interface FeatureViewProps {viewId:string;path?:string;params:Record<string,unknown>;features:FeatureDefinition[];availableFeatures:FeatureDefinition[];isFeatureEnabled:(id:string)=>boolean;enableFeature:(id:string)=>void;openFile:(path:string)=>void;openView:(kind:ViewKind)=>void;disableFeature:(id:string)=>void;}
export type FeatureContribution=FeatureDefinition&{render:(props:FeatureViewProps)=>ReactNode};
export class FeatureCatalog extends Service {
 private readonly entries=new Map<string,FeatureContribution>();private readonly listeners=new Set<()=>void>();
 constructor(ctx:Context){super(ctx,'featureCatalog');}
 add(feature:FeatureContribution){if(this.entries.has(feature.id))throw Error('Duplicate feature '+feature.id);this.entries.set(feature.id,feature);this.emit();return ()=>{if(this.entries.get(feature.id)===feature){this.entries.delete(feature.id);this.emit();}};}
 private emit(){this.listeners.forEach(fn=>fn());}
 subscribe(fn:()=>void){this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
 list():FeatureDefinition[]{return [...this.entries.values()].map(({render:_render,...rest})=>rest);}
 get(id:string){return this.entries.get(id);}
}
export class ToolService extends Service {readonly registry=new ToolRegistry();constructor(ctx:Context){super(ctx,'toolService');}}
export class ViewActionService extends Service {private handler:((id:ViewKind)=>void)|undefined;constructor(ctx:Context){super(ctx,'viewActions');}attach(fn:(id:ViewKind)=>void){this.handler=fn;return ()=>{if(this.handler===fn)this.handler=undefined;};}open(id:ViewKind){if(!this.handler)throw Error('Window manager not ready');this.handler(id);}}
declare module 'cordis'{interface Context{featureCatalog:FeatureCatalog;toolService:ToolService;viewActions:ViewActionService;}}
export function defineFeature(definition:FeatureContribution){
 const activate=Object.assign((ctx:Context)=>{ctx.effect(()=>{const removeView=ctx.featureCatalog.add(definition);const removeTool=ctx.toolService.registry.register({id:'feature.'+definition.id+'.open',label:'Open '+definition.title,description:definition.description,input:z.object({}),output:z.object({message:z.string()}),run:()=>{ctx.viewActions.open(definition.id);return {message:'Opened '+definition.title};}});return ()=>{removeTool();removeView();};});},{inject:['featureCatalog','toolService','viewActions']});
 return {definition,activate};
}
type PluginContribution=ReturnType<typeof defineFeature>;
export async function createClientHost(plugins:ReadonlyArray<PluginContribution>){
 const root=new Context();await root.plugin(FeatureCatalog);await root.plugin(ToolService);await root.plugin(ViewActionService);
 const all=new Map(plugins.map(p=>[p.definition.id,p]));const active=new Map<string,Awaited<ReturnType<Context['plugin']>>>();
 const enable=async(id:ViewKind)=>{if(active.has(id))return;const p=all.get(id);if(!p)throw Error('Unknown feature: '+id);active.set(id,await root.plugin(p.activate));};
 const disable=async(id:ViewKind)=>{const fiber=active.get(id);if(!fiber)return;await fiber.dispose();active.delete(id);};
 try{for(const plugin of plugins)await enable(plugin.definition.id);}catch(e){await root.fiber.dispose();throw e;}
 return {root,catalog:root.featureCatalog,toolRegistry:root.toolService.registry,viewActions:root.viewActions,enable,disable,isEnabled:(id:ViewKind)=>active.has(id),dispose:async()=>{active.clear();await root.fiber.dispose();}};
}
