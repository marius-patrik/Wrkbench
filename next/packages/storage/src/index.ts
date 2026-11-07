/** Atomic IndexedDB document authority, with OPFS as a best-effort content cache. */
export type WorkspaceFile={path:string;content:string;revision:number;updatedAt:number};
export type FileChange={type:'saved';path:string;revision:number}|{type:'deleted';path:string}|{type:'renamed';from:string;to:string;revision:number};
export class FileConflictError extends Error{constructor(public path:string){super(`Save conflict: ${path} changed in another tab`);}}
export class BrowserFiles{
  private readonly dbName='wrkbench-client-v3';
  private pending:Promise<IDBDatabase>|null=null;
  private readonly listeners=new Set<(event:FileChange)=>void>();
  subscribe(listener:(event:FileChange)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
  private emit(event:FileChange){for(const listener of this.listeners){try{listener(event)}catch(error){console.error('File observer error',error)}}}
  private connect():Promise<IDBDatabase>{
    if(this.pending)return this.pending;
    this.pending=new Promise((resolve,reject)=>{const req=indexedDB.open(this.dbName,3);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('files'))db.createObjectStore('files',{keyPath:'path'});};
      req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();this.pending=null};resolve(db)};req.onerror=()=>{this.pending=null;reject(req.error)};
    });return this.pending;
  }
  private async readReq<T>(tx:IDBTransaction, req:IDBRequest<T>):Promise<T>{
    return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.onabort=()=>reject(tx.error);});
  }
  async get(path:string):Promise<WorkspaceFile|undefined>{const db=await this.connect();const tx=db.transaction('files','readonly'); return this.readReq(tx,tx.objectStore('files').get(path));}
  async list():Promise<WorkspaceFile[]>{const db=await this.connect();const tx=db.transaction('files','readonly');return this.readReq(tx,tx.objectStore('files').getAll());}
  async save(path:string,content:string,expectedRevision?:number):Promise<WorkspaceFile>{
    const db=await this.connect();return new Promise((resolve,reject)=>{
      const tx=db.transaction('files','readwrite');const store=tx.objectStore('files');let result:WorkspaceFile|undefined;let failed=false;
      const get=store.get(path);get.onsuccess=()=>{const existing=get.result as WorkspaceFile|undefined;
        if(expectedRevision!==undefined&&(existing?.revision??0)!==expectedRevision){failed=true;tx.abort();return;}
        result={path,content,revision:(existing?.revision??0)+1,updatedAt:Date.now()};store.put(result);
      };
      tx.oncomplete=()=>{if(!result){reject(new Error('Document save was not committed'));return;}this.emit({type:'saved',path,revision:result.revision});void this.mirrorOPFS(result);resolve(result)};
      tx.onerror=()=>reject(tx.error??new Error('IndexedDB write failed'));
      tx.onabort=()=>reject(failed?new FileConflictError(path):tx.error??new Error('Transaction aborted'));
    });
  }
  async remove(path:string){const db=await this.connect();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(path);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error('Delete aborted'));tx.onerror=()=>reject(tx.error);});this.emit({type:'deleted',path});void this.removeOPFS(path)}
  async rename(oldPath:string,newPath:string){
    if(oldPath===newPath)return;
    const db=await this.connect();let moved:WorkspaceFile|undefined;
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('files','readwrite'),store=tx.objectStore('files');let failure:Error|undefined;
      const source=store.get(oldPath);
      source.onsuccess=()=>{
        const current=source.result as WorkspaceFile|undefined;
        if(!current){failure=new Error('Source file not found');tx.abort();return}
        const destination=store.get(newPath);
        destination.onsuccess=()=>{
          if(destination.result){failure=new Error('Destination file exists');tx.abort();return}
          moved={...current,path:newPath,revision:current.revision+1,updatedAt:Date.now()};
          store.put(moved);store.delete(oldPath);
        };
      };
      tx.oncomplete=()=>resolve();
      tx.onabort=()=>reject(failure??tx.error??new Error('Rename aborted'));
      tx.onerror=()=>reject(tx.error??new Error('Rename failed'));
    });
    if(!moved)throw new Error('Rename produced no committed file');
    this.emit({type:'renamed',from:oldPath,to:newPath,revision:moved.revision});
    void this.removeOPFS(oldPath);void this.mirrorOPFS(moved);
  }
  async seed(files:Record<string,string>){const existing=await this.list();for(const [path,content]of Object.entries(files)){if(await this.get(path))continue;try{await this.save(path,content,0)}catch(e){if(!(e instanceof FileConflictError))throw e}}}
  private async removeOPFS(path:string){try{const root=await navigator.storage?.getDirectory?.();if(!root)return;const dir=await root.getDirectoryHandle('wrkbench-cache');await dir.removeEntry(encodeURIComponent(path))}catch{/* Cache is never authoritative. */}}
  private async mirrorOPFS(file:WorkspaceFile){try{const root=await navigator.storage?.getDirectory?.();if(!root)return;
    const dir=await root.getDirectoryHandle('wrkbench-cache',{create:true});const handle=await dir.getFileHandle(encodeURIComponent(file.path),{create:true});
    const writable=await handle.createWritable();await writable.write(file.content);await writable.close();
  }catch{/* IndexedDB is authoritative; OPFS is optional and fallible. */}}
}
