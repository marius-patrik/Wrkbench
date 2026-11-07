import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {LocalNotes} from '../../../packages/client/src/views/Features.tsx';
export default function FeatureView(props:FeatureViewProps){return <LocalNotes id={props.viewId}/>;}
