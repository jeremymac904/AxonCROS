/** Isolated regression: no accounts, downloaded models, or installed user data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {localModelReady,localModelResponse,localModelURL,localResearchInput,LOCAL_INPUT_BYTES} from '../src/local-model.js';

const {localTextProfiles}=await import('../src/local-text-profiles.js');
const {retrieveResearch,researchPrompt}=await import('../src/local-research.js');
const researchQuestion='What should I check in a synthetic loan processing file?';
const originalSources=retrieveResearch(researchQuestion);
for(const profile of localTextProfiles.filter(p=>p.id!=='general')){const prefix='BOUNDARY'.repeat(300)+profile.instructions,suffix='FULL_UNCHANGED_HISTORY';const selected=localResearchInput(originalSources,sources=>prefix+researchPrompt(sources)+suffix);assert.ok(Buffer.byteLength(selected.input)<=LOCAL_INPUT_BYTES);assert.ok(selected.sources.length>=1&&selected.sources.length<originalSources.length);assert.deepEqual(selected.sources,originalSources.slice(0,selected.sources.length));assert.ok(selected.input.startsWith(prefix)&&selected.input.endsWith(suffix));}
const over='FULL_HISTORY'.repeat(3000);assert.equal(localResearchInput([],()=>over).input,over);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'axoncros-local-model-'));
const {setupLocal}=await import('../../../script/setup-local.mjs' as string);
assert.equal(setupLocal(root).created,true);
const config=fs.readFileSync(path.join(root,'.env'),'utf8');
assert.equal(setupLocal(root).created,false);
assert.equal(fs.readFileSync(path.join(root,'.env'),'utf8'),config);
assert.equal(fs.statSync(path.join(root,'.env')).mode & 0o777,0o600);
assert.equal(parseEnv(config).AXON_MODEL_PROVIDER,'ollama-local');
assert.equal(parseEnv(config).SESSION_SECRET.length,96);
for(const bad of ['https://example.com','http://localhost:11434','http://127.0.0.1:11434/path','http://secret@127.0.0.1:11434','http://127.0.0.1:11434?x=1']) assert.throws(()=>localModelURL(bad));

let scenario='good',calls=0;
const model='synthetic-local:1';
const runtime=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/tags') {res.end(JSON.stringify({models:scenario==='missing'?[]:[{name:model,size:2_000_000,...(scenario==='remote-model'?{remote_model:'cloud-model'}:{}),...(scenario==='remote-host'?{remote_host:'https://cloud.invalid'}:{})}]}));return;}
  if(req.url==='/v1/models') {res.end(JSON.stringify({data:[{id:model}]}));return;}
  let raw='';for await(const chunk of req) raw+=chunk;
  const body=JSON.parse(raw);calls++;
  assert.equal(req.headers.authorization,undefined);assert.equal(body.tools,undefined);assert.equal(body.stream,false);
  assert.equal(body.model,model);assert.equal(body.messages[0].role,'system');assert.ok(body.messages[0].content.includes('[R1]'));assert.equal(body.messages[1].role,'user');assert.equal(body.messages.length,2);
  if(req.url==='/api/chat') assert.equal(body.options.num_ctx,32768);
  assert.ok(['/api/chat','/v1/chat/completions'].includes(req.url!));
  if(scenario==='huge'){res.end('x'.repeat(1_000_001));return;}
  if(scenario==='error'){res.statusCode=401;res.end('{"error":"PRIVATE_SYNTHETIC_DETAIL"}');return;}
  const message={role:'assistant',content:'SYNTHETIC_LOCAL_REPLY',...(scenario==='tools'?{tool_calls:[{function:{name:'unexpected'}}]}:{})};
  res.end(JSON.stringify(req.url==='/api/chat'?{done:scenario!=='partial',done_reason:scenario==='length'?'length':'stop',message}:{choices:[{finish_reason:scenario==='length'?'length':'stop',message}]}));
});
runtime.listen(0,'127.0.0.1');await once(runtime,'listening');
const modelURL=`http://127.0.0.1:${(runtime.address() as any).port}`;
const signal=()=>AbortSignal.timeout(10_000);
assert.equal(await localModelReady(modelURL,model,signal(),true),true);
assert.equal(await localModelReady(modelURL,model,signal()),true);
assert.equal(calls,0);
for(const ollama of [true,false]) {
  assert.equal((await(await localModelResponse(modelURL,model,'synthetic input',signal(),ollama)).json()).status,'completed');
  for(const bad of ['tools','length','huge','error']){scenario=bad;await assert.rejects(localModelResponse(modelURL,model,'synthetic input',signal(),ollama));}
  scenario='good';
}
scenario='partial';await assert.rejects(localModelResponse(modelURL,model,'synthetic input',signal(),true));
scenario='missing';assert.equal(await localModelReady(modelURL,model,signal(),true),false);await assert.rejects(localModelResponse(modelURL,model,'synthetic input',signal(),true));
for(const blocked of ['remote-model','remote-host']){scenario=blocked;const before=calls;assert.equal(await localModelReady(modelURL,model,signal(),true),false);await assert.rejects(localModelResponse(modelURL,model,'synthetic input',signal(),true));assert.equal(calls,before);}
scenario='good';await assert.rejects(localModelResponse(modelURL,model,'x'.repeat(24_001),signal(),true));
console.log('PASS first-run preservation/private permissions; loopback restriction; both local protocols; no tools, truncated/error/oversized replies rejected');

const allocator=http.createServer();allocator.listen(0,'127.0.0.1');await once(allocator,'listening');
const port=(allocator.address() as any).port;await new Promise<void>(r=>allocator.close(()=>r()));
const base=`http://127.0.0.1:${port}`;
let child:ReturnType<typeof spawn>|undefined,cookie='',logs='';
async function request(route:string,method='GET',body?:any){
 const r=await fetch(base+route,{method,headers:{Cookie:cookie,...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:r.status,data:await r.json() as any};
}
async function start(){
 const token=crypto.randomBytes(32).toString('hex');
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:process.cwd(),stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:os.homedir(),...parseEnv(config),PORT:String(port),APP_URL:base,SERVER_URL:base,AXON_LOCAL_MODEL_URL:modelURL,AXON_LOCAL_MODEL:model,BOT_HQ_LAUNCH_TOKEN:token}});
 child.stdout!.on('data',b=>logs+=b);child.stderr!.on('data',b=>logs+=b);
 for(let i=0;i<100;i++){assert.equal(child.exitCode,null,logs);try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal((await request('/api/health')).data.engine,'ollama-local');
 const r=await fetch(base+'/api/auth/local',{method:'POST',redirect:'manual',headers:{'X-BotHQ-Launch-Token':token}});assert.equal(r.status,303);cookie=r.headers.get('set-cookie')!.split(';')[0];
}
async function stop(){if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
try{
 await start();assert.equal((await request('/api/local/status')).data.status,'ready');
 const chat=(await request('/api/local/chats','POST',{profileId:'general'})).data.chat;
 const receipt=crypto.randomUUID();const before=calls;
 const reply=await request(`/api/local/chats/${chat.id}/messages`,'POST',{text:'Synthetic hello.',requestId:receipt});
 assert.equal(reply.status,200);assert.equal(reply.data.messages[1].text,'SYNTHETIC_LOCAL_REPLY');
 assert.equal(calls,before+1);
 await request(`/api/local/chats/${chat.id}/messages`,'POST',{text:'Synthetic hello.',requestId:receipt});assert.equal(calls,before+1);
 scenario='length';assert.equal((await request(`/api/local/chats/${chat.id}/messages`,'POST',{text:'Synthetic failure.',requestId:crypto.randomUUID()})).status,502);
 assert.equal((await request(`/api/local/chats/${chat.id}`)).data.messages.length,2);
 scenario='good';
 for(const profile of localTextProfiles.filter(p=>p.id!=='general')){const created=await request('/api/local/chats','POST',{profileId:profile.id});const result=await request(`/api/local/chats/${created.data.chat.id}/messages`,'POST',{text:researchQuestion,requestId:crypto.randomUUID()});assert.equal(result.status,200,JSON.stringify(result.data));assert.ok(result.data.messages[1].sources.length>=1);assert.ok(result.data.messages[1].citationWarning.includes('did not cite'));assert.ok(result.data.messages[1].sources.length<originalSources.length);for(const source of result.data.messages[1].sources)assert.deepEqual(source,originalSources.find(s=>s.ref===source.ref));}
 const task=(await request('/api/local/workspace/tasks','POST',{title:'Synthetic bounded research draft',profileId:'loan-processing-assistant',data:{instructions:researchQuestion,cron:'',enabled:false,requiresApproval:true}})).data.record;const taskRun=(await request(`/api/local/workspace/tasks/${task.id}/run`,'POST',{requestId:crypto.randomUUID()})).data;assert.equal(taskRun.run.state,'awaiting_approval');await request(`/api/local/approvals/${taskRun.approval.id}/decision`,'POST',{decision:'allowed'});let finished:any;for(let i=0;i<100;i++){finished=(await request('/api/local/activity')).data.runs.find((r:any)=>r.id===taskRun.run.id);if(finished.state!=='running')break;await new Promise(r=>setTimeout(r,20));}assert.equal(finished.state,'completed');const taskChat=(await request(`/api/local/chats/${finished.result.chatId}`)).data;assert.ok(taskChat.messages[1].sources.length>=1&&taskChat.messages[1].sources.length<originalSources.length);assert.ok(taskChat.messages[1].citationWarning.includes('did not cite'));
 const historyChat=(await request('/api/local/chats','POST',{profileId:'general'})).data.chat;const long='x'.repeat(12000);assert.equal((await request(`/api/local/chats/${historyChat.id}/messages`,'POST',{text:long,requestId:crypto.randomUUID()})).status,200);const beforeOverflow=calls;const rejected=await request(`/api/local/chats/${historyChat.id}/messages`,'POST',{text:long,requestId:crypto.randomUUID()});assert.equal(rejected.status,413);assert.equal(rejected.data.code,'context_limit');assert.equal(calls,beforeOverflow);assert.equal((await request(`/api/local/chats/${historyChat.id}`)).data.messages.length,2);
 console.log('PASS local system citation instructions; remote manifests blocked; allfive default profiles and approved scheduled task accept first research question with complete bounded evidence; oversized full history rejects before inference without truncation');
 await stop();cookie='';await start();
 assert.equal((await request(`/api/local/chats/${chat.id}`)).data.messages[1].text,'SYNTHETIC_LOCAL_REPLY');
 assert.equal(logs.includes('PRIVATE_SYNTHETIC_DETAIL'),false);
 assert.equal(fs.readFileSync(path.join(root,'.env'),'utf8'),config);
 console.log('PASS actual local server starts with no Hermes configuration; saved reply/idempotency/error isolation/restart persistence');
}finally{await stop();await new Promise<void>(r=>runtime.close(()=>r()));fs.rmSync(root,{recursive:true,force:true});}
