import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({...id:'git',title:'Git',category:'Development',icon:'git-branch',description:'Inspect local version-control status',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
