import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({id:'explorer',title:'Explorer',category:'Development',icon:'folder',description:'Browse and open local workspace files',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
