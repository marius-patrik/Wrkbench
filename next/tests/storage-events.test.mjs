import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BrowserFiles} from '../packages/storage/src/index.ts';

test('BroadcastChannel sends validated file changes only to other tabs',async()=>{
 const files=new BrowserFiles();
 const sender=new BroadcastChannel('wrkbench-files-v3');
 const seen=[];
 const unsub=files.subscribe(event=>seen.push(event));
 try{
  sender.postMessage({change:{type:'saved',path:'src/main.ts',revision:2}});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.deepEqual(seen,[{type:'saved',path:'src/main.ts',revision:2,external:true}]);
  sender.postMessage({change:{type:'saved',path:'',revision:-1}});
  sender.postMessage({change:{type:'bogus',path:'src/main.ts'}});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(seen.length,1);
 }finally{unsub();sender.close();files.close();}
});
