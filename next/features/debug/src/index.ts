import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({...id:'debug',title:'Debug',category:'Development',icon:'bug',description:'Debug capabilities and run controls',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
