import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const pkg=JSON.parse(read('package.json'));
const dev=pkg.devDependencies, deps=pkg.dependencies;

test('real architecture libraries, not emulated substitutes',()=>{
 assert.match(deps.react,/^\^19\./);
 for(const name of ['react-dom','cordis','dockview-react','dockview','@rsbuild/core','@rsbuild/plugin-react','tailwindcss','zod','zustand','wouter','@monaco-editor/react','monaco-editor','@xterm/xterm','@xterm/addon-fit']){
  assert.ok(deps[name],`Missing ${name}`);
 }
 assert.ok(dev.typescript,'Missing typescript');
 assert.ok(!deps['react16'],'Outdated runtime');
});
test('Dockview is actual layout owner',()=>{
 const source=read('apps/web/src/App.tsx');
 assert.match(source,/import\s*\{\s*DockviewReact/);
 assert.match(source,/from\s*'dockview-react'/);
 assert.match(source,/api\.fromJSON/);
 assert.match(source,/api\.toJSON/);
 assert.match(source,/closeEmptyGroups=\{false\}/);
 assert.match(source,/getTabContextMenuItems/);
 assert.match(source,/layoutHistory=\{\{enabled:true\}\}/);
 assert.doesNotMatch(source,/class\s+(CustomDock|FakeDock|TabTree)/);
});
test('Cordis owns plugin lifecycle and feature registry',()=>{
 const source=read('packages/sdk/src/index.ts');
 assert.match(source,/import\s*\{\s*Context,\s*Service\s*\}\s*from\s*'cordis'/);
 assert.match(source,/root\.plugin\(p\.activate\)/);
 assert.match(source,/ctx\.effect\(/);
 assert.match(source,/fiber\.dispose\(/);
 const features=path.join(root,'features');
 const entries=readdirSync(features,{withFileTypes:true}).filter(f=>f.isDirectory());
 assert.equal(entries.length,31);
 for(const dir of entries){
  const prefix=`features/${dir.name}/`;
  const manifest=JSON.parse(read(prefix+'package.json'));
  const plugin=read(prefix+'src/index.ts');
  assert.ok(manifest.name.startsWith('@wrkbench/feature-'));
  assert.match(plugin,/defineFeature\(/);
  assert.ok(existsSync(path.join(root,prefix+'src/index.ts')));
  assert.match(plugin,/render:/);
  assert.ok(existsSync(path.join(root,prefix+'src/View.tsx')));
 }
});
test('local files are revision guarded by IndexedDB transaction; OPFS is nonauthoritative',()=>{
 const source=read('packages/storage/src/index.ts');
 assert.match(source,/indexedDB\.open/);
 assert.match(source,/transaction\('files','readwrite'\)/);
 assert.match(source,/expectedRevision/);
 assert.match(source,/FileConflictError/);
 assert.match(source,/navigator\.storage\?\.getDirectory/);
});
test('single-file step demands a genuine Rsbuild bundle',()=>{
 const source=read('scripts/inline-html.mjs');
 assert.match(source,/Rsbuild did not emit index\.html/);
 assert.match(source,/Standalone HTML contains external/);
 assert.match(read('rsbuild.config.ts'),/inlineScripts:\s*inline/);
 assert.match(read('rsbuild.config.ts'),/inlineStyles:\s*inline/);
});

test('shell consumes feature-owned renderers via Cordis and preserves disabled tab identity',()=>{
 const shell=read('apps/web/src/App.tsx'),sdk=read('packages/sdk/src/index.ts');
 assert.doesNotMatch(shell,/switch\(kind\)/);
 assert.match(shell,/contribution\.render\(/);
 assert.match(shell,/TabTransferQueue/);
 assert.match(sdk,/class ViewActionService extends Service/);
 assert.match(sdk,/ctx\.viewActions\.open/);
});
test('client shared modules are outside shell and all relative imports resolve',()=>{
 for(const part of ['state.ts','services.ts','icons.tsx','views/Editors.tsx','views/Features.tsx'])assert.ok(existsSync(path.join(root,'packages/client/src',part)));
 assert.ok(!existsSync(path.join(root,'apps/web/src/state.ts')));
 let resolved=0;
 for(const dir of ['apps','features','packages']){
  const queue=[path.join(root,dir)];
  while(queue.length){
   const current=queue.pop();
   for(const item of readdirSync(current,{withFileTypes:true})){
    const name=path.join(current,item.name);
    if(item.isDirectory()){queue.push(name);continue}
    if(!/\.tsx?$/.test(name))continue;
    for(const match of readFileSync(name,'utf8').matchAll(/(?:from|import)\s*(?:\(\s*)?['"](\.[^'"\s]+)['"]/g)){resolved++;assert.ok(existsSync(path.resolve(current,match[1])),name+': unresolved '+match[1]);}
   }
  }
 }
 assert.ok(resolved>100);
});
