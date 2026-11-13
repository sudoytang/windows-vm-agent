#!/usr/bin/env node
const readline=require('readline'),core=require('./core.cjs');
const str={type:'string'},num={type:'number'},integer={type:'integer'};
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const tools=[
 {name:'vm_exec',description:'Run PowerShell over SSH inside the Windows VM; prefer this for files, processes and system management. Returns text, not an image.',inputSchema:schema({script:str,timeoutMs:integer},['script'])},
 {name:'vm_health',description:'Check the interactive desktop bridge, screen size, session and privilege level.',inputSchema:schema(),annotations:{readOnlyHint:true}},
 {name:'vm_windows',description:'List visible guest windows with HWND, title and process ID.',inputSchema:schema(),annotations:{readOnlyHint:true}},
 {name:'vm_tree',description:'Read a compact accessibility tree of a guest window. IDs last until the next tree request or two minutes. Try this before a screenshot.',inputSchema:schema({hwnd:integer,depth:integer,maxNodes:integer,includeOffscreen:{type:'boolean'}}),annotations:{readOnlyHint:true}},
 {name:'vm_action',description:'Operate a control ID from the most recent tree. setValue fills a field; invoke presses an accessible button. Re-read stale trees.',inputSchema:schema({id:str,action:{type:'string',enum:['invoke','setValue','focus','click','select','toggle','expand','collapse','scrollIntoView']},value:str},['id','action'])},
 {name:'vm_focus',description:'Activate a guest window by HWND before keyboard input.',inputSchema:schema({hwnd:integer},['hwnd'])},
 {name:'vm_launch',description:'Start an application in the logged-in desktop session. SSH-launched GUI applications may be invisible in Session 0.',inputSchema:schema({file:str,args:{type:'array',items:str},cwd:str},['file'])},
 {name:'vm_input',description:'Fallback guest input: Unicode text, keyboard chord such as CTRL+L, coordinates, or wheel steps. Prefer control actions when available.',inputSchema:schema({operation:{type:'string',enum:['text','key','click','scroll']},text:str,keys:str,x:num,y:num,button:{type:'string',enum:['left','right']},count:integer,steps:integer},['operation'])},
 {name:'vm_screenshot',description:'Capture a native, lossless guest PNG only when the accessibility tree is insufficient. Optional x/y/width/height crop reduces image cost.',inputSchema:schema({x:integer,y:integer,width:integer,height:integer}),annotations:{readOnlyHint:true}}
];
function text(value){return{content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]}}
async function call(name,a={}){switch(name){
case'vm_exec':if(typeof a.script!=='string')throw Error('script is required');return text(await core.exec(a.script,a.timeoutMs||60000));
case'vm_health':return text(await core.api('/health'));
case'vm_windows':return text(await core.api('/windows'));
case'vm_tree':return text(core.compactTree(await core.api('/ui/tree',undefined,a)));
case'vm_action':return text(await core.api('/ui/action',a));
case'vm_focus':return text(await core.api('/window/focus',a));
case'vm_launch':return text(await core.api('/app/launch',a));
case'vm_input':{const routes={text:'/input/text',key:'/input/key',click:'/input/click',scroll:'/input/scroll'};if(!routes[a.operation])throw Error('Invalid input operation');return text(await core.api(routes[a.operation],a));}
case'vm_screenshot':return{content:[{type:'image',mimeType:'image/png',data:(await core.api('/screenshot',undefined,a)).toString('base64')}]};
default:throw Error('Unknown tool: '+name)}}
function send(id,result,error){const m={jsonrpc:'2.0',id};if(error)m.error=error;else m.result=result;process.stdout.write(JSON.stringify(m)+'\n')}
let initialized=false,queue=Promise.resolve();
async function handle(line){let m;try{m=JSON.parse(line)}catch{send(null,null,{code:-32700,message:'Parse error'});return}if(!m.method)return;if(m.id===undefined)return;
try{switch(m.method){
case'initialize':initialized=true;send(m.id,{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'windows-vm-agent',version:'1.0.0'},instructions:'Use vm_exec for command work, then vm_windows/vm_tree and vm_action for desktop work. Request vm_screenshot only when needed. Keep UI calls sequential; another tree request invalidates control IDs.'});break;
case'ping':send(m.id,{});break;
case'tools/list':if(!initialized)throw Error('Initialize first');send(m.id,{tools});break;
case'tools/call':if(!initialized)throw Error('Initialize first');try{send(m.id,await call(m.params?.name,m.params?.arguments||{}))}catch(e){send(m.id,{...text(e.message),isError:true})}break;
default:send(m.id,null,{code:-32601,message:'Method not found'})}
}catch(e){send(m.id,null,{code:-32602,message:e.message})}}
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{queue=queue.then(()=>handle(line)).catch(e=>process.stderr.write(e.message+'\n'))});
