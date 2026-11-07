import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {SheetView} from '../../../packages/client/src/views/Features.tsx';
export default function FeatureView(props:FeatureViewProps){return <SheetView id={props.viewId}/>;}
