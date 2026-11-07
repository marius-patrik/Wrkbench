import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({id:'markdown',title:'Markdown',category:'Research',icon:'file-text',description:'Markdown editor with preview',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
