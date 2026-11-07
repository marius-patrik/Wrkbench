import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({id:'preview',title:'Preview',category:'Creative',icon:'play',description:'Preview media and documents',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
