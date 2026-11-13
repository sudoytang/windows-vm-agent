#!/usr/bin/env node
const fs=require('fs'),path=require('path'),core=require('./core.cjs');
function args(v){let pos=[],flags={};for(let i=0;i<v.length;i++){if(v[i].startsWith('--')){const k=v[i].slice(2);if(['json','include-offscreen'].includes(k))flags[k]=true;else{if(i+1>=v.length)throw Error('Missing value for --'+k);flags[k]=v[++i]}}else pos.push(v[i])}return{pos,flags}}
const help=`vm: Windows VM command and desktop interface

vm health                              Check desktop session and SSH tunnel
vm exec 'Get-Process'                   Execute PowerShell over SSH
vm exec --script-file script.ps1        Run a local script inside the VM
vm windows                             List visible desktop windows
vm tree [--hwnd N] [--depth 5]           Read controls as compact text
        [--max-nodes 300] [--json]       JSON is optional; no screenshot
vm action ID invoke                    Invoke an accessible button
vm action ID setValue --value TEXT      Fill an accessible input
vm action ID focus|click|toggle|select|expand|collapse|scrollIntoView
vm focus HWND                          Activate a guest window
vm launch notepad.exe [arguments...]    Launch in the interactive desktop
vm type TEXT [--text-file file.txt]     Send Unicode text to focused control
vm key CTRL+L                          Send a keyboard chord
vm click X Y [--button right] [--count 2]
vm scroll -3                           Scroll down three notches
vm screenshot --output guest.png        Save a native lossless PNG
              [--x N --y N --width N --height N]
vm put local.txt C:/Users/vmuser/file.txt
vm tunnel                              Start/reuse localhost SSH forwarding

Element IDs expire after two minutes or the next tree request. Read a fresh
tree after major UI changes. GUI calls affect only the VM's logged-in desktop.
Use SSH for files, processes, installation and output; capture images only
for interfaces that do not expose useful accessibility controls.
`;
async function main(){const[cmd,...rest]=process.argv.slice(2);if(!cmd||cmd==='help'||cmd==='--help'){process.stdout.write(help);return}const{pos,flags}=args(rest);let result;
switch(cmd){
case'health':result=await core.api('/health');break;
case'exec':{const script=flags['script-file']?fs.readFileSync(flags['script-file'],'utf8'):pos.join(' ');if(!script)throw Error('PowerShell script is required');result=await core.exec(script,+(flags.timeout||60000));break}
case'windows':result=await core.api('/windows');break;
case'tree':{result=await core.api('/ui/tree',undefined,{hwnd:flags.hwnd,depth:flags.depth,maxNodes:flags['max-nodes'],includeOffscreen:flags['include-offscreen']});if(!flags.json){process.stdout.write(core.compactTree(result)+'\n');return}break}
case'action':if(!pos[0]||!pos[1])throw Error('ID and action are required');result=await core.api('/ui/action',{id:pos[0],action:pos[1],value:flags.value});break;
case'focus':result=await core.api('/window/focus',{hwnd:+pos[0]});break;
case'launch':if(!pos[0])throw Error('Executable is required');result=await core.api('/app/launch',{file:pos[0],args:pos.slice(1),cwd:flags.cwd});break;
case'type':result=await core.api('/input/text',{text:flags['text-file']?fs.readFileSync(flags['text-file'],'utf8'):pos.join(' ')});break;
case'key':result=await core.api('/input/key',{keys:pos.join('')});break;
case'click':if(pos.length<2)throw Error('X and Y are required');result=await core.api('/input/click',{x:+pos[0],y:+pos[1],button:flags.button||'left',count:+(flags.count||1)});break;
case'scroll':result=await core.api('/input/scroll',{steps:+pos[0]});break;
case'screenshot':{const target=path.resolve(flags.output||'guest.png');const data=await core.api('/screenshot',undefined,{x:flags.x,y:flags.y,width:flags.width,height:flags.height});fs.writeFileSync(target,data);result={path:target,bytes:data.length,format:'png',nativeResolution:true};break}
case'put':if(pos.length!==2)throw Error('Local and remote file paths are required');result=await core.put(pos[0],pos[1]);break;
case'tunnel':await core.tunnel();result={ok:true,localAddress:'127.0.0.1',port:core.config().localPort};break;
default:throw Error('Unknown command: '+cmd+'; use vm help')}
process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result?.exitCode)process.exitCode=result.exitCode;
}
main().catch(e=>{process.stderr.write(JSON.stringify({error:e.message})+'\n');process.exitCode=1});
