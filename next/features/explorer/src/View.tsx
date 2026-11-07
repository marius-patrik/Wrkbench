import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {ExplorerView} from '../../../packages/client/src/views/Editors.tsx';
export default function FeatureView(props:FeatureViewProps){return <ExplorerView onOpen={props.openFile}/>;}
