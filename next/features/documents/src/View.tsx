import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {DocumentView} from '../../../packages/client/src/views/Features.tsx';
export default function FeatureView(props:FeatureViewProps){return <DocumentView id={props.viewId}/>;}
