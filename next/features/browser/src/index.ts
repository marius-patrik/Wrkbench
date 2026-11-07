import {lazy,createElement} from 'react';
import {defineFeature} from '../../../packages/sdk/src/index.ts';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
const View=lazy(()=>import('./View.tsx'));
export const plugin=defineFeature({id:'browser',title:'Browser',category:'Research',icon:'globe',description:'URL and research collection',render:(props:FeatureViewProps)=>createElement(View,props)});
export default plugin;
