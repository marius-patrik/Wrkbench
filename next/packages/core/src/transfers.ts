/** Durable two-phase handoff: Dockview alone owns the layout graph. */
export type TabTransfer={id:string;title:string;params:Record<string,unknown>;source:string;target:string;createdAt:number};
export type TransferStorage=Pick<Storage,'getItem'|'setItem'>;
const isRecord=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
export const isTabTransfer=(x:unknown):x is TabTransfer=>isRecord(x)&&typeof x.id==='string'&&x.id.length>0&&x.id.length<256&&typeof x.title==='string'&&typeof x.source==='string'&&typeof x.target==='string'&&x.source!==x.target&&Number.isFinite(x.createdAt)&&isRecord(x.params);
export class TabTransferQueue{
 private readonly store:TransferStorage;private readonly key:string;
 constructor(store:TransferStorage,key='wrkbench-panel-transfers-v4'){this.store=store;this.key=key;}
 pending():TabTransfer[]{const raw=this.store.getItem(this.key);if(raw===null)return [];let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw Error('Transfer journal corrupt; original preserved')}
  if(!Array.isArray(parsed)||parsed.length>128||!parsed.every(isTabTransfer)||new Set(parsed.map(t=>t.id)).size!==parsed.length)throw Error('Invalid transfer journal; original preserved');
  return parsed;
 }
 stage(record:TabTransfer){if(!isTabTransfer(record))throw Error('Invalid tab transfer');const encoded=JSON.stringify(record);if(!encoded||!isTabTransfer(JSON.parse(encoded)))throw Error('Transfer not serializable');
  const prev=this.pending(),old=prev.find(t=>t.id===record.id);if(old&&(old.source!==record.source||old.target!==record.target))throw Error('Conflicting pending transfer');
  if(!old&&prev.length>=128)throw Error('Transfer queue full');this.store.setItem(this.key,JSON.stringify([...prev.filter(t=>t.id!==record.id),JSON.parse(encoded)]));if(!this.pending().some(t=>t.id===record.id))throw Error('Transfer journal not persisted');
 }
 departures(id:string){return this.pending().filter(t=>t.source===id);}
 arrivals(id:string){return this.pending().filter(t=>t.target===id);}
 acknowledge(id:string,destination:string){const pending=this.pending();if(!pending.some(t=>t.id===id&&t.target===destination))throw Error('Unknown transfer destination');this.store.setItem(this.key,JSON.stringify(pending.filter(t=>t.id!==id)));}
}
