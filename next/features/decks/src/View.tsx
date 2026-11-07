import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {DeckView} from '../../../packages/client/src/views/Features.tsx';
export default function FeatureView(props:FeatureViewProps){return <DeckView id={props.viewId}/>;}
