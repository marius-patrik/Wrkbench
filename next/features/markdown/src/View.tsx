import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
import {MarkdownView} from '../../../packages/client/src/views/Editors.tsx';
export default function FeatureView(props:FeatureViewProps){return <MarkdownView path={props.path}/>;}
