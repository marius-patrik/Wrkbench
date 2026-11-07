import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {PluginsView} from '../../../packages/client/src/views/Features.tsx';
export default function FeatureView(props:FeatureViewProps){return <PluginsView features={props.availableFeatures} enabled={props.isFeatureEnabled} enable={props.enableFeature} disable={props.disableFeature}/>;}
