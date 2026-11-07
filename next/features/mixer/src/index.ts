import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({...id:'mixer',title:'Mixer',category:'Creative',icon:'sliders',description:'Track volume and mute controls',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
