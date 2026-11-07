import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({...id:'canvas',title:'Canvas',category:'Creative',icon:'workflow',description:'Freeform draggable canvas',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
