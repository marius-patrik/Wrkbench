import { z } from 'zod';
export const runtimeSchema = z.enum(['browser', 'remote-ssh', 'container', 'local-agent']);
export const workbenchSchema = z.enum(['development','research','audio','video','operations','agents','trading']);
export type WorkbenchId = z.infer<typeof workbenchSchema>;
export type RuntimeId = z.infer<typeof runtimeSchema>;
// Extensible plugin identifiers are not restricted to first-party feature IDs.
export type ViewKind = string;
export type ViewContext = { runtime: RuntimeId; session: string; project: string; account: string };
export interface FeatureDefinition { id: ViewKind; title: string; category: 'Development'|'Creative'|'Operations'|'Research'|'System'; description: string; icon: string; supportsMultiple?: boolean; capabilities?: string[] }
export type ToolContext = { viewId?: string; workbench: WorkbenchId; context: ViewContext; requestApproval?: (message:string)=>Promise<boolean> };
export type ToolDefinition<T = unknown, R = unknown> = { id: string; label: string; description: string; input: z.ZodType<T>; output: z.ZodType<R>; permission?: string; run: (input:T, context:ToolContext)=>Promise<R>|R };
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<any,any>>();
  register<T,R>(tool:ToolDefinition<T,R>):()=>void { if(this.tools.has(tool.id)) throw new Error(`Tool already registered: ${tool.id}`); this.tools.set(tool.id,tool); return ()=>{if(this.tools.get(tool.id)===tool)this.tools.delete(tool.id)}; }
  list() {return [...this.tools.values()].map(({id,label,description,permission})=>({id,label,description,permission}));}
  async invoke(id:string,input:unknown,ctx:ToolContext):Promise<unknown> {
    const tool=this.tools.get(id); if(!tool)throw new Error(`Unknown tool: ${id}`);
    if(tool.permission){ const yes=await ctx.requestApproval?.(`${tool.label}: ${tool.permission}`); if(!yes)throw new Error('Permission denied'); }
    return tool.output.parse(await tool.run(tool.input.parse(input),ctx));
  }
}
export const WORKBENCHES:Record<WorkbenchId,{title:string,description:string,icon:string,views:ViewKind[]}>={
 development:{title:'Development',description:'Build, inspect and ship software',icon:'code',views:['explorer','code','agent','terminal','git']},
 research:{title:'Research',description:'Browse, read and organize',icon:'globe',views:['browser','notes','markdown','agent','chart']},
 audio:{title:'Audio',description:'Arrangement and mixing',icon:'music',views:['explorer','timeline','mixer','agent']},
 video:{title:'Video',description:'Editing and preview',icon:'film',views:['explorer','timeline','preview','agent']},
 operations:{title:'Operations',description:'Runtime and infrastructure',icon:'server',views:['docker','tailscale','runtime','terminal','models']},
 agents:{title:'Agents',description:'Sessions, tools and models',icon:'bot',views:['agent','models','approvals','terminal']},
 trading:{title:'Trading',description:'Markets and analysis',icon:'chart',views:['markets','chart','news','agent']},
};
export const defaultContext:ViewContext={runtime:'browser',session:'personal',project:'atlas-studio',account:'local'};
export function uniqueId(prefix='view'){return `${prefix}-${crypto.randomUUID()}`}
