import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({...id:'timeline',title:'Timeline',category:'Creative',icon:'list',description:'Non-destructive clip arrangement',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
