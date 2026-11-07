import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({...id:'docker',title:'Docker',category:'Operations',icon:'box',description:'Container connection UI and capability reporting',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
