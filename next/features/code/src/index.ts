import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({id:'code',title:'Code',category:'Development',icon:'code',description:'Edit source documents with Monaco',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
