/** IndexedDB is the source of truth. OPFS is an optional cache, never a second authority. */
export type WorkspaceFile = { path:string; content:string; revision:number; updatedAt:number };
type LocalChange =
 | {type:'saved';path:string;revision:number}
 | {type:'deleted';path:string}
 | {type:'renamed';from:string;to:string;revision:number};
export type FileChange = LocalChange & {external?:boolean};

export class FileConflictError extends Error {
 readonly path:string;
 constructor(path:string){super(`File changed since it was opened: ${path}`);this.name='FileConflictError';this.path=path;}
}
function validChange(value:unknown):value is LocalChange {
 if(!value||typeof value!=='object')return false;
 const c=value as Record<string,unknown>;
 if(c.type==='saved')return typeof c.path==='string'&&c.path.length>0&&Number.isSafeInteger(c.revision)&&Number(c.revision)>0;
 if(c.type==='deleted')return typeof c.path==='string'&&c.path.length>0;
 if(c.type==='renamed')return typeof c.from==='string'&&c.from.length>0&&typeof c.to==='string'&&c.to.length>0&&Number.isSafeInteger(c.revision)&&Number(c.revision)>0;
 return false;
}
/** Each tab observes committed changes from other tabs; there is no local-first write bypass. */
export class BrowserFiles {
 private readonly dbName='wrkbench-client-v3';
 private readonly channelName='wrkbench-files-v3';
 private pending:Promise<IDBDatabase>|null=null;
 private readonly listeners=new Set<(event:FileChange)=>void>();
 private readonly channel:BroadcastChannel|null;
 constructor(){
  let channel:BroadcastChannel|null=null;
  try{
   if(typeof BroadcastChannel!=='undefined'){
    channel=new BroadcastChannel(this.channelName);
    channel.onmessage=message=>{
     const value=(message.data as {change?:unknown}|null)?.change;
     if(validChange(value))this.notify({...value,external:true});
    };
   }
  }catch(error){console.warn('Cross-tab file notifications unavailable',error);}
  this.channel=channel;
 }
 subscribe(listener:(event:FileChange)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
 /** Use on disposal in tests and short-lived service containers. The shared app instance remains open. */
 close(){this.channel?.close();this.listeners.clear();}
 private notify(event:FileChange){for(const listener of this.listeners){try{listener(event)}catch(error){console.error('File observer error',error)}}}
 private committed(event:LocalChange){
  this.notify(event);
  try{this.channel?.postMessage({change:event})}catch(error){console.warn('Cross-tab notification unavailable',error)}
 }
 private connect():Promise<IDBDatabase>{
  if(this.pending)return this.pending;
  this.pending=new Promise((resolve,reject)=>{const req=indexedDB.open(this.dbName,3);
   req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('files'))db.createObjectStore('files',{keyPath:'path'});};
   req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();this.pending=null};resolve(db)};
   req.onerror=()=>{this.pending=null;reject(req.error)};
   req.onblocked=()=>console.warn('IndexedDB upgrade blocked by another Wrkbench tab');
  });
  return this.pending;
 }
 private request<T>(tx:IDBTransaction,req:IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.onabort=()=>reject(tx.error);});
 }
 async get(path:string):Promise<WorkspaceFile|undefined>{const db=await this.connect();const tx=db.transaction('files','readonly');return this.request(tx,tx.objectStore('files').get(path));}
 async list():Promise<WorkspaceFile[]>{const db=await this.connect();const tx=db.transaction('files','readonly');return this.request(tx,tx.objectStore('files').getAll());}
 async save(path:string,content:string,expectedRevision?:number):Promise<WorkspaceFile>{
  const db=await this.connect();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('files','readwrite'),store=tx.objectStore('files');
   let saved:WorkspaceFile|undefined,conflict=false;
   const request=store.get(path);
   request.onsuccess=()=>{
    const current=request.result as WorkspaceFile|undefined;
    if(expectedRevision!==undefined&&(current?.revision??0)!==expectedRevision){conflict=true;tx.abort();return;}
    saved={path,content,revision:(current?.revision??0)+1,updatedAt:Date.now()};
    store.put(saved);
   };
   tx.oncomplete=()=>{
    if(!saved){reject(new Error('File save did not commit'));return;}
    this.committed({type:'saved',path,revision:saved.revision});
    void this.mirrorOPFS(saved);resolve(saved);
   };
   tx.onabort=()=>reject(conflict?new FileConflictError(path):tx.error??new Error('File save aborted'));
   tx.onerror=()=>reject(tx.error??new Error('File save failed'));
  });
 }
 /** Revision-checked deletion prevents Explorer's stale selection from deleting another tab's edits. */
 async remove(path:string,expectedRevision?:number):Promise<void>{
  const db=await this.connect();let existed=false;
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('files','readwrite'),store=tx.objectStore('files');
   let conflict=false;
   const read=store.get(path);
   read.onsuccess=()=>{
    const current=read.result as WorkspaceFile|undefined;
    if(expectedRevision!==undefined&&current?.revision!==expectedRevision){conflict=true;tx.abort();return;}
    if(current){existed=true;store.delete(path);}
   };
   tx.oncomplete=()=>resolve();
   tx.onabort=()=>reject(conflict?new FileConflictError(path):tx.error??new Error('File delete aborted'));
   tx.onerror=()=>reject(tx.error??new Error('File delete failed'));
  });
  if(existed){this.committed({type:'deleted',path});void this.removeOPFS(path);}
 }
 /** Rename and source revision check happen in one IndexedDB readwrite transaction. */
 async rename(oldPath:string,newPath:string,expectedRevision?:number):Promise<void>{
  if(oldPath===newPath)return;
  const db=await this.connect();let moved:WorkspaceFile|undefined;
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('files','readwrite'),store=tx.objectStore('files');
   let failure:Error|undefined;
   const source=store.get(oldPath);
   source.onsuccess=()=>{
    const current=source.result as WorkspaceFile|undefined;
    if(!current){failure=new FileConflictError(oldPath);tx.abort();return;}
    if(expectedRevision!==undefined&&current.revision!==expectedRevision){failure=new FileConflictError(oldPath);tx.abort();return;}
    const dest=store.get(newPath);
    dest.onsuccess=()=>{
     if(dest.result){failure=new Error('Destination file exists');tx.abort();return;}
     moved={...current,path:newPath,revision:current.revision+1,updatedAt:Date.now()};
     store.put(moved);store.delete(oldPath);
    };
   };
   tx.oncomplete=()=>resolve();
   tx.onabort=()=>reject(failure??tx.error??new Error('Rename aborted'));
   tx.onerror=()=>reject(tx.error??new Error('Rename failed'));
  });
  if(!moved)throw new Error('Rename produced no committed file');
  this.committed({type:'renamed',from:oldPath,to:newPath,revision:moved.revision});
  void this.removeOPFS(oldPath);void this.mirrorOPFS(moved);
 }
 async seed(files:Record<string,string>){
  for(const [path,content] of Object.entries(files)){
   if(await this.get(path))continue;
   try{await this.save(path,content,0)}catch(error){if(!(error instanceof FileConflictError))throw error;}
  }
 }
 private async removeOPFS(path:string){
  try{const root=await navigator.storage?.getDirectory?.();if(!root)return;const dir=await root.getDirectoryHandle('wrkbench-cache');await dir.removeEntry(encodeURIComponent(path));}catch{/* Non-authoritative cache. */}
 }
 private async mirrorOPFS(file:WorkspaceFile){
  try{
   const root=await navigator.storage?.getDirectory?.();if(!root)return;
   const dir=await root.getDirectoryHandle('wrkbench-cache',{create:true});
   const handle=await dir.getFileHandle(encodeURIComponent(file.path),{create:true});
   const writable=await handle.createWritable();await writable.write(file.content);await writable.close();
  }catch{/* Non-authoritative cache. */}
 }
}
