import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({id:'models',title:'Models',category:'Operations',icon:'cpu',description:'Model endpoint and capabilities',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
