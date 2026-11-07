import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {TerminalView} from '../../../packages/client/src/views/Editors.tsx';
export default function FeatureView(props:FeatureViewProps){return <TerminalView id={props.viewId}/>;}
