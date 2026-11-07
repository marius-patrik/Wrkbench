import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({...id:'news',title:'News',category:'Research',icon:'rss',description:'Research feed with locally seeded stories',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
