import { useEffect,useRef,useState,type ReactNode } from 'react';
import { type ViewKind,type FeatureDefinition,uniqueId } from '../../../packages/core/src/index.ts';
import {useUI,RUNTIMES,resolvedContext} from '../../../packages/client/src/state.ts';
import {Icon} from '../../../packages/client/src/icons.tsx';
import {notify,tools,invocationContext} from '../../../packages/client/src/services.ts';
import {ToolbarButton,ViewToolbar} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
export function MarketsView(){const watch=useUI(s=>s.watchlist),toggle=useUI(s=>s.toggleWatch),[symbol,setSymbol]=useState('');const demo:Record<string,number>={AAPL:274.56,NVDA:207.12,MSFT:512.88,TSLA:381.16,AMD:255.34};
 return <div className="view vertical"><ViewToolbar label="Watchlist"><span className="chip warning-chip">ILLUSTRATIVE · NOT LIVE</span></ViewToolbar><form className="add-line" onSubmit={e=>{e.preventDefault();if(symbol.trim()){toggle(symbol.trim().toUpperCase());setSymbol('')}}}><input placeholder="Symbol" title="Watchlist symbol" value={symbol} onChange={e=>setSymbol(e.target.value)}/><button title="Add symbol"><Icon name="plus"/></button></form><div className="market-table"><div className="market-row muted"><span>Symbol</span><span>Reference sample</span><span></span></div>{watch.map((s,i)=><div key={s} className="market-row"><strong>{s}</strong><span>{demo[s]!==undefined?`$${demo[s].toFixed(2)}`:'—'}</span><ToolbarButton title={`Remove ${s}`} icon="x" onClick={()=>toggle(s)}/></div>)}</div><p className="view-notice">Sample values are static demonstration fixtures, not market prices or investment data.</p></div>;
}
export default function FeatureView(props:FeatureViewProps){return <MarketsView />;}
