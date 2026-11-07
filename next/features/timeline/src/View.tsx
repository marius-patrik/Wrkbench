import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {TimelineView} from '../../../packages/client/src/views/Features.tsx';
export default function FeatureView(props:FeatureViewProps){return <TimelineView id={props.viewId}/>;}
