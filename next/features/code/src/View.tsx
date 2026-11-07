import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {CodeView} from '../../../packages/client/src/views/Editors.tsx';
export default function FeatureView(props:FeatureViewProps){return <CodeView path={props.path}/>;}
