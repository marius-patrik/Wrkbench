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
 assert.match(source,/function travelLayout\(/);
 assert.match(source,/function recordLayout\(/);
 assert.doesNotMatch(source,/layoutHistory=\{\{enabled:true\}\}/);
 assert.doesNotMatch(source,/class\s+(CustomDock|FakeDock|TabTree)/);
});
test('Cordis owns plugin lifecycle and feature registry',()=>{
 const source=read('packages/sdk/src/index.ts');
 assert.match(source,/import\s*\{\s*Context,\s*Service\s*\}\s*from\s*'cordis'/);
 assert.match(source,/root\.plugin\(plugin\.activate\)/);
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
  assert.match(plugin,/render:/);
  assert.ok(existsSync(path.join(root,prefix+'src/View.tsx')));
  assert.ok(existsSync(path.join(root,prefix+'src/index.ts')));
  assert.match(read(prefix+'src/View.tsx'),/export default function FeatureView/);
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

test('Cordis features contribute renderers and tools, not metadata-only placeholders',()=>{
 const app=read('apps/web/src/App.tsx');
 const sdk=read('packages/sdk/src/index.ts');
 assert.doesNotMatch(app,/switch\(kind\)/);
 assert.match(app,/contribution\.render\(/);
 assert.match(sdk,/class ViewActionService extends Service/);
 assert.match(sdk,/ctx\.viewActions\.open/);
 for(const pathPart of ['services.ts','state.ts','icons.tsx','views/Editors.tsx','views/Primitives.tsx','views/Capabilities.tsx']) {
  assert.ok(existsSync(path.join(root,'packages/client/src',pathPart)));
 }
});
test('every source-relative import resolves inside this monorepo',()=>{
 let n=0;
 for(const folder of ['apps','features','packages']){
  const queue=[path.join(root,folder)];
  while(queue.length){
   const dir=queue.pop();
   for(const ent of readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,ent.name);
    if(ent.isDirectory()){queue.push(file);continue;}
    if(!/\.tsx?$/.test(ent.name))continue;
    for(const match of readFileSync(file,'utf8').matchAll(/(?:import|from)\s*(?:\(\s*)?['"](\.[^'"\s]+)['"]/g)){
     n++; assert.ok(existsSync(path.resolve(dir,match[1])),path.relative(root,file)+' missing '+match[1]);
    }
   }
  }
 }
 assert.ok(n>200,'too few imports verified');
});

test('first-party view modules live in feature packages, not the shell or a mega presenter',()=>{
 assert.ok(!existsSync(path.join(root,'apps/web/src/views/Features.tsx')));
 assert.ok(!existsSync(path.join(root,'packages/client/src/views/Features.tsx')));
 const agent=read('features/agent/src/View.tsx');
 const timeline=read('features/timeline/src/View.tsx');
 const plugins=read('features/plugins/src/View.tsx');
 assert.match(agent,/export function AgentView/);
 assert.match(timeline,/export function TimelineView/);
 assert.match(plugins,/export function PluginsView/);
 assert.match(agent,/scrollIntoView/);
 assert.match(agent,/useEffect\(\(\)=>\{/);
});
