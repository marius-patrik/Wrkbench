import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({id:'agent',title:'Agent',category:'Development',icon:'bot',description:'Agent sessions and consent-gated tools',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
