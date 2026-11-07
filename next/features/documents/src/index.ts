import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({id:'documents',title:'Documents',category:'Creative',icon:'file-text',description:'Rich document editing',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
