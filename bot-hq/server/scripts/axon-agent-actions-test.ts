/** Isolated HTTP + model-protocol regression. No credentials, external providers or inference. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'axon-agent-tests-')),dbPath=path.join(tmp,'workspace.db');
let planned:any[]=[];let calls=0;let lastInputs:string[]=[];
const model=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'synthetic-local'}]}));return;}
 let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);calls++;assert.equal(b.tools,undefined);assert.equal(b.model,req.url==='/v1/responses'?'gpt-6.1-sol':'synthetic-local');
 const input=b.messages?.[1]?.content??b.input;lastInputs.push(input);
 let output=planned.shift()??{type:'final',text:'Synthetic provider receipt reviewed.'};
 if(output?.delayMs){const wait=output.delayMs;output={...output};delete output.delayMs;await new Promise(r=>setTimeout(r,wait));}
 if(output?.httpError){res.statusCode=output.httpError;res.end(JSON.stringify({error:'SYNTHETIC_PRIVATE_CAPACITY_DETAIL'}));return;}
 if(output?.invalidEnvelope){res.end(JSON.stringify({status:'failed',error:{message:'SYNTHETIC_PRIVATE_CAPACITY_DETAIL'}}));return;}
 if(output?.guardEnvelope){res.end(JSON.stringify({status:'failed',error:{message:output.guardEnvelope}}));return;}
 const text=typeof output==='string'?output:JSON.stringify(output);
 res.end(JSON.stringify(req.url==='/v1/responses'?{status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}]}:{choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}]}));
});model.listen(0,'127.0.0.1');await once(model,'listening');const modelURL=`http://127.0.0.1:${(model.address()as any).port}`;
const allocator=http.createServer();allocator.listen(0,'127.0.0.1');await once(allocator,'listening');const port=(allocator.address()as any).port;await new Promise<void>(r=>allocator.close(()=>r()));const base=`http://127.0.0.1:${port}`;
let child:ReturnType<typeof spawn>|undefined,cookie='',otherCookie='',logs='',database:Database.Database;
async function api(route:string,method='GET',body?:any,session=cookie){const r=await fetch(base+route,{method,headers:{Cookie:session,...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()as any};}
async function start(provider='openai-local',scaled=false){
 const token=crypto.randomBytes(32).toString('hex'),home=path.join(tmp,'isolated-gateway');fs.mkdirSync(home,{recursive:true});
 const preload=path.join(tmp,'scaled-timeouts.mjs');if(scaled)fs.writeFileSync(preload,"const original=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=(ms)=>original(ms===300000?500:ms===1200000?5000:ms);");
 child=spawn(process.execPath,[...(scaled?['--import',preload]:[]),'--import','tsx','server/src/index.ts'],{cwd:process.cwd(),stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:os.homedir(),BOT_HQ_MODE:'local-text',AXON_MODEL_PROVIDER:provider,AXON_LOCAL_MODEL_URL:modelURL,AXON_LOCAL_MODEL:'synthetic-local',HERMES_HOME_PRIMARY:home,HERMES_URL:modelURL,HERMES_KEY:'synthetic-key',PORT:String(port),APP_URL:base,SERVER_URL:base,SESSION_SECRET:'synthetic-session-secret-'.repeat(4),ALLOWED_EMAILS:'synthetic@example.invalid',DB_PATH:dbPath,BOT_HQ_LAUNCH_TOKEN:token}});
 child.stdout!.on('data',b=>logs+=b);child.stderr!.on('data',b=>logs+=b);
 for(let i=0;i<100;i++){assert.equal(child.exitCode,null,logs);try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100));}
 const response=await fetch(base+'/api/auth/local',{method:'POST',redirect:'manual',headers:{'X-BotHQ-Launch-Token':token}});assert.equal(response.status,303);cookie=response.headers.get('set-cookie')!.split(';')[0];
}
async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done}}
async function chat(policy='review-writes'){const c=(await api('/api/local/chats','POST',{profileId:'general'})).data.chat;assert.equal(c.agentMode,false);const r=await api(`/api/local/chats/${c.id}/agent-mode`,'PATCH',{enabled:true,contextConsent:true,executionPolicy:policy});assert.equal(r.status,200);return r.data.chat;}
async function waitAction(chatId:string){for(let n=0;n<100;n++){const a=(await api('/api/local/agent-actions/pending')).data.actions.find((a:any)=>a.chatId===chatId);if(a)return a;await new Promise(r=>setTimeout(r,30))}assert.fail('No queued action arrived')}
async function finish(a:any,status='succeeded',result:any={id:'synthetic-provider-id'}){assert.equal((await api(`/api/local/agent-actions/${a.id}/execution`)).status,409);assert.equal((await api(`/api/local/agent-actions/${a.id}/claim`,'POST',{})).status,200);assert.equal((await api(`/api/local/agent-actions/${a.id}/claim`,'POST',{})).status,409);const grant=await api(`/api/local/agent-actions/${a.id}/execution`);assert.equal(grant.status,200);assert.equal(grant.data.action.id,a.id);assert.deepEqual(grant.data.action.args,a.args);assert.equal((await api(`/api/local/agent-actions/${a.id}/execution`,'GET',undefined,otherCookie)).status,404);const body={status,...(status==='succeeded'?{result}:{error:'SYNTHETIC_PRIVATE_PROVIDER_ERROR'})};assert.equal((await api(`/api/local/agent-actions/${a.id}/complete`,'POST',body)).status,200);assert.equal((await api(`/api/local/agent-actions/${a.id}/complete`,'POST',body)).status,200);assert.equal((await api(`/api/local/agent-actions/${a.id}/execution`)).status,409);}
const send=(c:any,text='Synthetic task',requestId=crypto.randomUUID())=>api(`/api/local/chats/${c.id}/messages`,'POST',{text,requestId});
try{
 await start();database=new Database(dbPath);database.pragma('foreign_keys=ON');
 assert.equal((await api('/api/local/agent-actions/pending','GET',undefined,'')).status,401);
 const me=(await api('/api/auth/me')).data.user;
 database.prepare('INSERT INTO users(id,email,name,created_at)VALUES(?,?,?,?)').run('other-owner','other@example.invalid','Synthetic other',Date.now());const t=crypto.randomUUID();database.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(t,'other-owner',Date.now(),Date.now()+60_000);otherCookie='grokbot_session='+t;
 const originalColumns=(database.prepare('PRAGMA table_info(local_chats)').all()as any[]).map(c=>c.name);assert.ok(!originalColumns.includes('agent_mode'));
 const draft=(await api('/api/local/chats','POST',{profileId:'general'})).data.chat;planned=['Unchanged plain draft'];assert.equal((await send(draft)).data.messages[1].text,'Unchanged plain draft');
 const c=await chat(),chatBefore=database.prepare('SELECT * FROM local_chats WHERE id=?').get(c.id);
 assert.equal((await api(`/api/local/chats/${c.id}/agent-mode`,'PATCH',{enabled:true,contextConsent:false})).status,400);
 assert.equal((await api(`/api/local/chats/${c.id}/agent-mode`,'PATCH',{enabled:true,contextConsent:true},otherCookie)).status,404);
 assert.deepEqual(database.prepare('SELECT * FROM local_chats WHERE id=?').get(c.id),chatBefore);
 const requestId=crypto.randomUUID();planned=[{type:'action',operation:'gmail.search',args:{query:'synthetic',limit:1}},{type:'final',text:'Found the synthetic message.'}];const pending=send(c,'Find the synthetic message',requestId),a=await waitAction(c.id);assert.equal(a.state,'queued');assert.equal(a.ownerId,me.id);
 assert.equal((await api(`/api/local/agent-actions/${a.id}/claim`,'POST',{},otherCookie)).status,404);assert.equal((await api(`/api/local/chats/${c.id}/agent-actions`,'GET',undefined,otherCookie)).status,404);
 assert.equal((await fetch(base+`/api/local/agent-actions/${a.id}/claim`,{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
 await finish(a);const reply=await pending;assert.equal(reply.status,200);assert.match(reply.data.messages[1].text,/succeeded/);const count=calls;assert.equal((await send(c,'Find the synthetic message',requestId)).status,200);assert.equal(calls,count);
 console.log('PASS draft compatibility; separate permissions preserve original columns/rows; authenticated owner/CSRF isolation; real HTTP model loop and request/claim/receipt idempotency');
 for(const policy of ['review-writes','delegated']){
  const ch=await chat(policy);planned=[{type:'action',operation:'sheets.create',args:{title:'Synthetic worksheet'}},{type:'final',text:'Worksheet created.'}];const turn=send(ch),act=await waitAction(ch.id);assert.equal(act.state,policy==='delegated'?'queued':'review');
  if(policy==='review-writes'){assert.equal((await api(`/api/local/agent-actions/${act.id}/claim`,'POST',{})).status,409);assert.equal((await api(`/api/local/agent-actions/${act.id}/decision`,'POST',{approved:true})).status,200)}
  await finish(act);assert.equal((await turn).status,200);
 }
 for(const authorized of [false,true]){
  const ch=await chat('delegated');planned=[{type:'action',operation:'gmail.send',args:{to:['synthetic@example.invalid'],subject:'Synthetic',body:'No actual message'}},{type:'final',text:'Synthetic receipt saved.'}];const turn=send(ch,authorized?'Send synthetic message to synthetic@example.invalid':'Summarize an email'),act=await waitAction(ch.id);assert.equal(act.state,authorized?'queued':'review');if(!authorized)await api(`/api/local/agent-actions/${act.id}/decision`,'POST',{approved:false});else await finish(act);assert.equal((await turn).status,200);
 }
 console.log('PASS exact write review; delegated supported writes; recipient not authorized by user forced to review; deny dispatches nothing');
 const unknown=await chat('delegated');planned=[{type:'action',operation:'sheets.create',args:{title:'Unknown synthetic'}}];const ut=send(unknown),ua=await waitAction(unknown.id);await finish(ua,'uncertain');assert.equal((await ut).status,200);const uhistory=(await api(`/api/local/chats/${unknown.id}/agent-actions`)).data.actions;assert.equal(uhistory.length,1);assert.equal(uhistory[0].state,'uncertain');assert.ok(!JSON.stringify(uhistory).includes('SYNTHETIC_PRIVATE_PROVIDER_ERROR'));
 const pause=await chat('delegated');planned=[{type:'action',operation:'drive.create',args:{name:'Synthetic',content:'synthetic'}}];const pt=send(pause),pa=await waitAction(pause.id);await api(`/api/local/chats/${pause.id}/agent-mode`,'PATCH',{enabled:false,contextConsent:false,executionPolicy:'delegated'});assert.equal((await pt).status,409);assert.equal((await api(`/api/local/agent-actions/${pa.id}/claim`,'POST',{})).status,409);
 const late=await chat('delegated');planned=[{type:'action',operation:'drive.create',args:{name:'Late receipt'}}];const lt=send(late),la=await waitAction(late.id);assert.equal((await api(`/api/local/agent-actions/${la.id}/claim`,'POST',{})).status,200);await api(`/api/local/chats/${late.id}/cancel`,'POST',{});assert.equal((await lt).status,409);assert.equal((await api(`/api/local/agent-actions/${la.id}/execution`)).status,409);assert.equal((await api(`/api/local/agent-actions/${la.id}/complete`,'POST',{status:'succeeded',result:{id:'late-synthetic-id'}})).status,200);assert.equal((await api(`/api/local/agent-actions/${la.id}/claim`,'POST',{})).status,409);
 console.log('PASS unknown outcome stops loop with durable receipt; sanitized failures; Pause/Stop prevent dispatch; late receipt recorded without re-execution');
 for(const output of [{type:'action',operation:'gmail.send',args:{to:Array(21).fill('synthetic@example.invalid'),subject:'Synthetic',body:'No send'}},{type:'action',operation:'drive.read',args:{id:'a'.repeat(201)}},{type:'action',operation:'shell.exec',args:{command:'no'}},{type:'action',operation:'drive.read',args:{id:'x',url:'https://evil.invalid'}},{type:'action',operation:'sheets.write',args:{spreadsheetId:'x',range:'A1',values:[Array(501).fill('x')]}},'not valid JSON']){const ch=await chat('delegated');planned=[output];assert.ok([400,409].includes((await send(ch)).status));assert.equal((await api(`/api/local/chats/${ch.id}/agent-actions`)).data.actions.length,0)}
 const repeat=await chat('delegated'),same={type:'action',operation:'sheets.create',args:{title:'No duplicate'}};planned=[same,same,{type:'final',text:'One result.'}];const rt=send(repeat),ra=await waitAction(repeat.id);await finish(ra);assert.equal((await rt).status,200);assert.equal((await api(`/api/local/chats/${repeat.id}/agent-actions`)).data.actions.length,1);
 console.log('PASS unsupported operations/unknown arguments/oversized cells/malformed protocol rejected; repeated model action reused receipt, no duplicate execution');
 const restart=await chat('delegated');planned=[{type:'action',operation:'drive.create',args:{name:'Restart synthetic'}}];const restarting=send(restart).catch(()=>null),restartAction=await waitAction(restart.id);await api(`/api/local/agent-actions/${restartAction.id}/claim`,'POST',{});await stop();await restarting;await start();const saved=(await api(`/api/local/chats/${restart.id}/agent-actions`)).data.actions;assert.equal(saved[0].state,'uncertain');assert.equal((await api(`/api/local/chats/${restart.id}`)).data.chat.agentMode,true);assert.equal((await api(`/api/local/agent-actions/${restartAction.id}/claim`,'POST',{})).status,409);assert.equal((await api(`/api/local/chats/${c.id}`)).data.messages.length,2);
 console.log('PASS restart retains permissions/history/receipts; interrupted running action uncertain, never requeued');
 // Every fixed operation can enter the queue; the native adapter owns provider-specific validation.
 const fixtures:Record<string,any>={
 'gmail.search':{limit:1},'gmail.read':{id:'synthetic'},'gmail.draft':{to:['synthetic@example.invalid'],subject:'Synthetic',body:'Example'},'gmail.send':{to:['synthetic@example.invalid'],subject:'Synthetic',body:'Example'},'gmail.modify':{id:'synthetic',addLabelIds:['STARRED']},
 'calendar.list':{limit:1},'calendar.create':{summary:'Synthetic',start:'2026-11-14T10:00:00Z',end:'2026-11-14T11:00:00Z'},'calendar.update':{id:'synthetic',summary:'Revised synthetic'},
 'drive.list':{limit:1},'drive.read':{id:'synthetic'},'drive.create':{name:'Synthetic',content:'Example'},'drive.update':{id:'synthetic',content:'Updated example'},'drive.trash':{id:'synthetic'},
 'sheets.read':{spreadsheetId:'synthetic',range:'A1'},'sheets.create':{title:'Synthetic'},'sheets.write':{spreadsheetId:'synthetic',range:'A1',values:[['Example']]},'sheets.append':{spreadsheetId:'synthetic',range:'A1',values:[['Example']]},
 'contacts.search':{query:'Synthetic',limit:1},'contacts.create':{givenName:'Synthetic'},'contacts.update':{resourceName:'people/synthetic',givenName:'Synthetic updated'},
 };
 for(const [operation,args]of Object.entries(fixtures)){const ch=await chat('delegated');planned=[{type:'action',operation,args},{type:'final',text:'Synthetic bounded operation receipt.'}];const task=send(ch,'Synthetic operation for synthetic@example.invalid'),act=await waitAction(ch.id);assert.equal(act.state,'queued',operation);await finish(act);assert.equal((await task).status,200,operation)}
 const profiles=(await api('/api/local/profiles')).data.profiles;
 for(const profile of profiles.filter((p:any)=>p.id!=='general')){const ch=(await api('/api/local/chats','POST',{profileId:profile.id})).data.chat;await api(`/api/local/chats/${ch.id}/agent-mode`,'PATCH',{enabled:true,contextConsent:true,executionPolicy:'review-writes'});planned=[{type:'final',text:'Synthetic research draft [R1].'}];assert.equal((await send(ch,'According to saved LendingPad document-merge training, what risk affects the original entries? Synthetic example only.')).status,200,profile.id)}
 for(const failure of [{httpError:429},{httpError:503},{invalidEnvelope:true}]){
  const ch=await chat('delegated');planned=[failure];const before=calls,r=await send(ch);assert.equal(r.status,'httpError'in failure?failure.httpError:502);assert.equal(r.data.code,'failed');assert.ok(!r.data.error.includes('valid agent protocol'));assert.match(r.data.error,/saved (?:Google )?action receipts/);assert.ok(!JSON.stringify(r.data).includes('SYNTHETIC_PRIVATE_CAPACITY_DETAIL'));assert.equal(calls,before+1);assert.equal(r.data.actions.length,0);
 }
 console.log('PASS upstream429/503/incomplete envelope distinguished from invalid model JSON; saved receipt warning; no retry or private diagnostic exposure');
 const follow=await chat('delegated');planned=[{type:'action',operation:'sheets.create',args:{title:'Followup'}},{type:'final',text:'Synthetic sheet.'}];const ft=send(follow),fa=await waitAction(follow.id);await finish(fa,'succeeded',{spreadsheetId:'saved-synthetic-id'});await ft;planned=[{type:'final',text:'Using prior evidence.'}];assert.equal((await send(follow,'What was the sheet ID?')).status,200);assert.ok(lastInputs.at(-1)?.includes('saved-synthetic-id'));
 const broken=await chat('delegated');planned=[{type:'action',operation:'drive.create',args:{name:'Before model failure'}},'invalid final protocol'];const bt=send(broken),ba=await waitAction(broken.id);await finish(ba);const br=await bt;assert.equal(br.status,409);assert.equal(br.data.actions[0].state,'succeeded');
 assert.equal((await api('/api/local/export')).data.agentActions.actions.some((r:any)=>r.id===ba.id),true);
 console.log('PASS all20 fixed operations; five mortgage profiles retain bounded research; same-chat followup receipts; action evidence survives model failure and exports without credentials');


 for(const revoke of [false,true]){
  const ch=await chat('delegated');planned=[{type:'action',operation:'drive.create',args:{name:'Logout synthetic'}}];const task=send(ch),act=await waitAction(ch.id);
  if(revoke)await api(`/api/local/agent-actions/${act.id}/claim`,'POST',{});
  if(revoke){const device=(await api('/api/local/devices')).data.devices.find((d:any)=>d.current);assert.equal((await api(`/api/local/devices/${device.id}`,'DELETE',{})).status,200)}else assert.equal((await api('/api/auth/logout','POST',{})).status,200);
  assert.equal((await task).status,409);assert.equal((await api('/api/local/agent-actions/pending')).status,401);
  const login=crypto.randomUUID();database.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(login,me.id,Date.now(),Date.now()+60_000);cookie='grokbot_session='+login;
  const saved=(await api(`/api/local/chats/${ch.id}/agent-actions`)).data.actions;assert.equal(saved[0].state,revoke?'uncertain':'cancelled');assert.equal((await api(`/api/local/agent-actions/${act.id}/execution`)).status,409);assert.equal((await api(`/api/local/agent-actions/${act.id}/claim`,'POST',{})).status,409);
 }
 console.log('PASS logout cancels queued automation; session revocation interrupts running action; same-owner relogin cannot resume either request');
 // Both configured model transports share exactly the same strict protocol.
 await stop();await start('hermes');const hc=await chat();planned=[{type:'action',operation:'gmail.search',args:{limit:1}},{type:'final',text:'Synthetic Hermes route receipt.'}];const ht=send(hc),ha=await waitAction(hc.id);await finish(ha);assert.equal((await ht).status,200);assert.ok(lastInputs.at(-1)?.includes('Action receipts for this request'));
 for(const status of [429,503]){const ch=await chat('delegated');planned=[{httpError:status}];const before=calls,r=await send(ch);assert.equal(r.status,status);assert.match(r.data.error,/saved (?:Google )?action receipts/);assert.ok(!r.data.error.includes('valid agent protocol'));assert.equal(calls,before+1);assert.equal(r.data.actions.length,0)}
 console.log('PASS dedicated Hermes plain Responses transport and local chat completions transport use same loop; synthetic upstreams only');
 const guard='Bot HQ subscription guard: usage reached the conservative 80% stop point or is unknown; wait for reset.';
 for(const failure of [guard,guard.replace('80%','95%'),'turn/start failed: codex app-server error -32001: '+guard,'Codex app-server turn failed: '+guard,{guardEnvelope:'Bot HQ subscription guard: subscription allowance could not be verified.'},'Bot HQ subscription guard: included subscription allowance is unavailable; this request is blocked.','Bot HQ subscription guard: missing subscription usage windows.']){
  const ch=await chat('delegated');planned=[failure];const before=calls,r=await send(ch);assert.equal(r.status,429);assert.equal(r.data.actions.length,0);assert.match(r.data.error,/included subscription allowance/);assert.match(r.data.error,/saved action receipts/);assert.ok(!r.data.error.includes('valid agent protocol'));assert.equal(calls,before+1);
 }
 const partial=await chat('delegated');planned=[{type:'action',operation:'sheets.create',args:{title:'Before allowance block'}},guard];const partialTurn=send(partial),partialAction=await waitAction(partial.id);await finish(partialAction);const partialReply=await partialTurn;assert.equal(partialReply.status,429);assert.equal(partialReply.data.actions[0].state,'succeeded');assert.match(partialReply.data.error,/earlier actions may already have completed/);
 const quote=(await api('/api/local/chats','POST',{profileId:'general'})).data.chat;planned=['A documented example says: "'+guard+'". This is a quotation, not a current allowance claim.'];assert.equal((await send(quote)).status,200);
 console.log('PASS flattened and structured subscription-guard failures return sanitized429; no retry; prior successful receipts retained; legitimate quoted diagnostics preserved');
 await stop();await start('hermes',true);const slow=await chat('delegated');planned=[{delayMs:300,type:'action',operation:'drive.create',args:{name:'Synthetic bounded slow turn'}},{delayMs:300,type:'final',text:'Synthetic slow sequence completed.'}];const slowStarted=Date.now(),slowTask=send(slow),slowAction=await waitAction(slow.id);await finish(slowAction);assert.equal((await slowTask).status,200);assert.ok(Date.now()-slowStarted>500);assert.equal((await api(`/api/local/chats/${slow.id}/agent-actions`)).data.actions.length,1);
 console.log('PASS accelerated timing: two successful model turns exceed one model deadline but stay inside bounded agent budget; one action, no retry');

}finally{await stop();database!?.close();await new Promise<void>(r=>model.close(()=>r()));fs.rmSync(tmp,{recursive:true,force:true});}
