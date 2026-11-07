import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({...id:'tailscale',title:'Tailscale',category:'Operations',icon:'network',description:'Connectivity and device view',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
