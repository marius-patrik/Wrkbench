import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({id:'terminal',title:'Terminal',category:'Development',icon:'terminal',description:'Browser-local terminal interface and command history',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
