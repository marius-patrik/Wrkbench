import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({...id:'markets',title:'Markets',category:'Research',icon:'chart',description:'Market watchlist with demo-only data',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
