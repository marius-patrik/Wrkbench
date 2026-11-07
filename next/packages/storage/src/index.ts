/** Atomic IndexedDB document authority, with OPFS as a best-effort content cache. */
export type WorkspaceFile={path:string;content:string;revision:number;updatedAt:number};
export class FileConflictError extends Error{constructor(public path:string){super(`Save conflict: ${path} changed in another tab`);}}
export class BrowserFiles{
  private readonly dbName='wrkbench-client-v3';
  private pending:Promise<IDBDatabase>|null=null;
  private connect():Promise<IDBDatabase>{
    if(this.pending)return this.pending;
    this.pending=new Promise((resolve,reject)=>{const req=indexedDB.open(this.dbName,3);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('files'))db.createObjectStore('files',{keyPath:'path'});};
      req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();this.pending=null};resolve(db)};req.onerror=()=>{this.pending=null;reject(req.error)};req.onblocked=()=>{this.pending=null;reject(new Error('Storage blocked by older tab'))};
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
      tx.oncomplete=()=>{if(!result){reject(new Error('Document save was not committed'));return;}void this.mirrorOPFS(result);resolve(result)};
      tx.onerror=()=>reject(tx.error??new Error('IndexedDB write failed'));
      tx.onabort=()=>reject(failed?new FileConflictError(path):tx.error??new Error('Transaction aborted'));
    });
  }
  async remove(path:string){const db=await this.connect();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(path);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  async rename(oldPath:string,newPath:string){
    if(oldPath===newPath)return;
    const db=await this.connect();
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('files','readwrite'),store=tx.objectStore('files');let error:Error|undefined;
      const source=store.get(oldPath);
      source.onsuccess=()=>{const current=source.result as WorkspaceFile|undefined;
        if(!current){error=new Error('Source file not found');tx.abort();return;}
        const destination=store.get(newPath);
        destination.onsuccess=()=>{if(destination.result){error=new Error('Destination exists');tx.abort();return;}
          store.put({...current,path:newPath,revision:current.revision+1,updatedAt:Date.now()});store.delete(oldPath);
        };
      };
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(error??tx.error??new Error('Rename aborted'));
      tx.onerror=()=>reject(error??tx.error??new Error('Rename failed'));
    });
  }
  async seed(files:Record<string,string>){const existing=await this.list();for(const [path,content]of Object.entries(files)){if(await this.get(path))continue;try{await this.save(path,content,0)}catch(e){if(!(e instanceof FileConflictError))throw e}}}
  private async mirrorOPFS(file:WorkspaceFile){try{const root=await navigator.storage?.getDirectory?.();if(!root)return;
    const dir=await root.getDirectoryHandle('wrkbench-cache',{create:true});const handle=await dir.getFileHandle(encodeURIComponent(file.path),{create:true});
    const writable=await handle.createWritable();await writable.write(file.content);await writable.close();
  }catch{/* IndexedDB is authoritative; OPFS is optional and fallible. */}}
}
