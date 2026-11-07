import type {ReactNode} from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {Icon} from '../icons.tsx';
export function ViewToolbar({label,actions,children}:{label:string;actions?:ReactNode;children?:ReactNode}){return <div className="view-toolbar"><span className="section-label">{label.toUpperCase()}</span>{children}<div className="spacer"/>{actions}</div>}
const EMPTY_AGENT_MESSAGES: ReadonlyArray<{id:string;role:string;text:string;time:number}> = [];
export function ToolbarButton({title,icon,onClick,disabled=false,children}:{title:string;icon?:string;onClick:()=>void;disabled?:boolean;children?:ReactNode}){
 return <Tooltip.Root><Tooltip.Trigger asChild><button aria-label={title} type="button" className="tiny-action" disabled={disabled} onClick={onClick}>{icon&&<Icon name={icon} size={14}/>} {children}</button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="wrk-tooltip" sideOffset={7}>{title}<Tooltip.Arrow className="wrk-tooltip-arrow"/></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}
