import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TabTransferQueue} from '../packages/core/src/transfers.ts';
const fixture={id:'tab-1',title:'File',params:{kind:'code',path:'src/index.tsx'},source:'development',target:'research',createdAt:123};
function memory(){const raw=new Map();return {raw,getItem:k=>raw.get(k)??null,setItem:(k,v)=>raw.set(k,v)};}
test('Durable stage, recover and destination acknowledgment',()=>{const s=memory(),q=new TabTransferQueue(s);q.stage(fixture);assert.equal(new TabTransferQueue(s).arrivals('research').length,1);assert.throws(()=>q.acknowledge('tab-1','development'));q.acknowledge('tab-1','research');assert.equal(q.pending().length,0);});
test('Move cannot overwrite a conflicting pending destination',()=>{const q=new TabTransferQueue(memory());q.stage(fixture);assert.throws(()=>q.stage({...fixture,target:'audio'}));assert.equal(q.arrivals('research').length,1);});
test('Storage errors retain source until journal commit',()=>{const q=new TabTransferQueue({getItem:()=>null,setItem:()=>{throw Error('Quota exceeded')}});assert.throws(()=>q.stage(fixture));});
test('Corruption is surfaced and never overwritten',()=>{const s=memory(),q=new TabTransferQueue(s);q.stage(fixture);const key=[...s.raw.keys()][0];s.raw.set(key,'bad json');assert.throws(()=>q.pending());assert.equal(s.raw.get(key),'bad json');});
test('Same source and destination and missing params rejected',()=>{const q=new TabTransferQueue(memory());assert.throws(()=>q.stage({...fixture,target:'development'}));assert.throws(()=>q.stage({...fixture,params:null}));});
