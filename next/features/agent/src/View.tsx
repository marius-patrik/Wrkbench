import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {AgentView} from '../../../packages/client/src/views/Features.tsx';
export default function FeatureView(props:FeatureViewProps){return <AgentView id={props.viewId}/>;}
