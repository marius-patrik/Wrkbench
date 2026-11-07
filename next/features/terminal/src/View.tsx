import {useEffect,useRef} from 'react';
import {Terminal as XTerm} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {files} from '../../../packages/client/src/services.ts';
import {useUI} from '../../../packages/client/src/state.ts';
import {ToolbarButton} from '../../../packages/client/src/views/Primitives.tsx';
import type {FeatureViewProps} from '../../../packages/sdk/src/index.ts';
async function executeBrowserCommand(input:string):Promise<string>{const parts=input.trim().split(/\s+/),cmd=parts[0];if(!cmd)return '';
 switch(cmd){case 'help':return 'Browser commands: help, pwd, ls, cat <file>, echo <text>, date, whoami, clear.\r\nNo OS shell or remote process is connected.';
 case 'pwd':return '/atlas-studio';case 'whoami':return 'browser-local';case 'date':return new Date().toString();case 'echo':return parts.slice(1).join(' ');case 'ls':return (await files.list()).map(f=>f.path).join('\r\n');case 'cat':return (await files.get(parts[1]??''))?.content??'File not found';case 'clear':return '\u000c';default:return `Command unavailable in browser-only mode: ${cmd}\r\nConnect an authorized runtime in Phase 2 to execute system processes.`}
}
export function TerminalView({id}:{id:string}){
 const host=useRef<HTMLDivElement>(null);const terminal=useRef<XTerm|null>(null);
 useEffect(()=>{if(!host.current)return;const term=new XTerm({fontSize:12,fontFamily:'JetBrains Mono, monospace',cursorBlink:true,theme:{background:'#161616',foreground:'#cccccc',cursor:'#e5e5e5',green:'#76bf9b',yellow:'#d6b36e',red:'#dd8585'},convertEol:true});const fit=new FitAddon();term.loadAddon(fit);term.open(host.current);const observer=new ResizeObserver(()=>{try{fit.fit()}catch{}});observer.observe(host.current);
 term.writeln('\x1b[1;32mWrkbench local terminal\x1b[0m  ·  no OS process');term.writeln('Enter help for supported browser commands.');let current='';const prompt=()=>term.write('\r\n\x1b[38;5;114m~/atlas-studio\x1b[0m ❯ ');prompt();
 const subscription=term.onData(data=>{if(data==='\r'){const command=current;current='';term.write('\r\n');useUI.getState().appendTerminal(id,command);void executeBrowserCommand(command).then(output=>{if(output==='\u000c'){term.clear()}else if(output)term.writeln(output.replaceAll('\n','\r\n'));prompt()});}else if(data==='\u007f'){if(current.length){current=current.slice(0,-1);term.write('\b \b')}}else if(data==='\u0003'){current='';term.write('^C');prompt()}else if(data.length===1&&data>=' '){current+=data;term.write(data)}});
 terminal.current=term;return()=>{subscription.dispose();observer.disconnect();term.dispose();terminal.current=null}},[id]);
 return <div className="view vertical"><div className="view-toolbar"><span className="section-label">TERMINAL</span><span className="chip subtle">BROWSER LOCAL</span><div className="spacer"/><ToolbarButton title="Clear terminal output" icon="trash" onClick={()=>terminal.current?.clear()} /></div><div ref={host} className="xterm-host"/></div>;
}

export default function FeatureView(props:FeatureViewProps){return <TerminalView id={props.viewId}/>;}
