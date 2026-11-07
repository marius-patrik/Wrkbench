import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const cols=['A','B','C','D','E','F'];
export function SheetView({id}:{id:string}){const raw=useUI(s=>s.notes[id]??''),setNote=useUI(s=>s.setNote);
 let cells:Record<string,string>={};try{cells=JSON.parse(raw||'{}')}catch{cells={}};
 const change=(key:string,value:string)=>setNote(id,JSON.stringify({...cells,[key]:value}));
 return <div className="view vertical"><ViewToolbar label="Spreadsheet" actions={<ToolbarButton title="Download CSV" icon="download" onClick={()=>{const csv=[cols.join(','),...Array.from({length:12},(_,r)=>cols.map((_,c)=>JSON.stringify(cells[`${r}-${c}`]??'')).join(','))].join('\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));link.download='wrkbench-sheet.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),500)}}>CSV</ToolbarButton>}/><div className="sheet-scroll"><table className="sheet"><thead><tr><th>#</th>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{Array.from({length:12},(_,r)=><tr key={r}><th>{r+1}</th>{cols.map((c,i)=><td key={c}><input aria-label={`Cell ${c}${r+1}`} value={cells[`${r}-${i}`]??(r===0&&i===0?'Metric':r===0&&i===1?'Value':'')} onChange={e=>change(`${r}-${i}`,e.target.value)}/></td>)}</tr>)}</tbody></table></div></div>;
}
export default function FeatureView(props:FeatureViewProps){return <SheetView id={props.viewId}/>;}
