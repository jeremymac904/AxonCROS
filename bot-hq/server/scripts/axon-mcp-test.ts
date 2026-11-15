/** Synthetic loopback MCP server; no real Zapier/account/model calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {Hono} from 'hono';
const bufferSchemas=JSON.parse(fs.readFileSync(new URL('./fixtures/buffer-mcp-schemas.json',import.meta.url),'utf8')).schemas;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'axon-mcp-tests-'));
Object.assign(process.env,{BOT_HQ_MODE:'local-text',SESSION_SECRET:'synthetic-session-secret',DB_PATH:path.join(tmp,'test.db')});
const TOKEN='synthetic-connection-token-never-return';let methodCalls:string[]=[],callCount=0,mode='success',changed=false,pages=0;
const fake=http.createServer(async(req,res)=>{
 assert.equal(req.headers.authorization,`Bearer ${TOKEN}`);
 let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);methodCalls.push(b.method);
 if(b.method==='notifications/initialized'){res.writeHead(202);res.end();return}
 res.setHeader('Content-Type','application/json');
 const result=(value:any)=>res.end(JSON.stringify({jsonrpc:'2.0',id:b.id,result:value}));
 if(b.method==='initialize'){result({protocolVersion:'2024-11-05',serverInfo:{name:'Synthetic MCP',version:'1'},capabilities:{tools:{}}});return}
 if(b.method==='tools/list'){
  pages++;if(mode==='malformed'){result({wrong:'schema'});return}
  if(req.url==='/buffer'){result({tools:[
   {name:'get_account',inputSchema:{type:'object',properties:{},additionalProperties:false}},
   ...Object.entries(bufferSchemas).map(([name,inputSchema])=>({name,inputSchema})),
   ...['execute_query','execute_mutation','delete_post','update_post'].map(name=>({name,inputSchema:{type:'object',properties:{}}})),
  ]});return}
  const tools=b.params?.cursor?[
   {name:'execute_zapier_write_action',description:'Generic synthetic action',inputSchema:{type:'object',properties:{action_id:{type:'string'},value:{type:'string'}},required:['action_id','value'],additionalProperties:false}},
   {name:'whatsapp_send_message',inputSchema:{type:'object',properties:{recipient:{type:'string'},text:{type:'string'}},required:['recipient','text'],additionalProperties:false}},
   {name:'auto_provision_mcp',inputSchema:{type:'object',properties:{}}},
   {name:'unsafe_pattern',inputSchema:{type:'object',properties:{value:{type:'string',pattern:'(a+)+$'}}}},
  ]:[{name:'synthetic_managed',description:`Synthetic descriptor ${TOKEN}`,inputSchema:{type:'object',properties:{value:{type:'string',maxLength:changed?10:100}},required:['value'],additionalProperties:false}}];
  result({tools,...(!b.params?.cursor?{nextCursor:'page2'}:{})});return;
 }
 if(b.method==='tools/call'){callCount++;if(mode==='drop'){req.socket.destroy();return}if(mode==='malformed-call'){result({wrong:'receipt'});return}if(mode==='oversized'){result({content:[{type:'text',text:'x'.repeat(2100000)}]});return}if(mode==='sse'){res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({jsonrpc:'2.0',id:b.id,result:{content:[{type:'text',text:'Synthetic streaming accepted'}]}})+'\n\n');return}if(mode==='wait')await new Promise(r=>setTimeout(r,150));result({content:[{type:'text',text:mode==='error'?'Synthetic provider rejection':`Synthetic accepted ${TOKEN}`}],structuredContent:{accessToken:TOKEN,accepted:true},isError:mode==='error'});return}
 result({});
});fake.listen(0,'127.0.0.1');await once(fake,'listening');const address=`http://127.0.0.1:${(fake.address()as any).port}`;
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=String(input);assert.ok(['https://mcp.zapier.com/api/v1/connect','https://mcp.buffer.com/mcp'].includes(url),'No arbitrary provider request');return realFetch(address+(url.includes('buffer.com')?'/buffer':''),init)};
const {db}=await import('../src/db.js');
db.exec(`CREATE TABLE local_chats(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),profile_id TEXT,title TEXT);CREATE TABLE local_requests(request_id TEXT PRIMARY KEY,user_id TEXT,chat_id TEXT,state TEXT);`);
const {requireUser}=await import('../src/lib/auth.js');const mcp=await import('../src/axon-mcp-client.js');const actions=await import('../src/axon-agent-actions.js');actions.initializeAgentActions();
for(const owner of ['ownerA','ownerB']){db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run(owner,owner+'@example.invalid',owner,Date.now());db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(owner+'-session',owner,Date.now(),Date.now()+3600000)}
const app=new Hono<any>();app.use('*',requireUser);let stopped='';const chatView=(r:any)=>({...r,...actions.agentChatView(r)});actions.mountAgentActions(app,chatView,()=>false,id=>stopped=id);mcp.mountMCP(app,chatView,()=>false,id=>stopped=id);
async function api(route:string,method='GET',body?:any,owner='ownerA'){const response=await app.request('http://localhost/api/local'+route,{method,headers:{Cookie:owner?`grokbot_session=${owner}-session`:'','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json()as any;assert.ok(!JSON.stringify(data).includes(TOKEN),'Token absent from all public responses');return {status:response.status,data}}
const base='/mcp/connections/zapier';
async function importToken(owner='ownerA'){return api(base+'/credentials','POST',{expectedOwner:owner,connectionToken:TOKEN},owner)}
async function config(){assert.equal((await importToken()).status,200);assert.equal((await api(base+'/discover','POST',{})).status,200);await api(base+'/quota','PATCH',{includedAllowanceConfirmed:true,noOverageConfirmed:true});}
async function policy(name='synthetic_managed',policy='review'){const c=(await api('/mcp/connections')).data.connections[0],tool=c.tools.find((t:any)=>t.name===name);return api(base+'/tools/'+name,'PATCH',{policy,schemaHash:tool.schemaHash})}
function chat(){const id=crypto.randomUUID(),requestId=crypto.randomUUID();db.prepare('INSERT INTO local_chats VALUES(?,?,?,?)').run(id,'ownerA','general','Synthetic');db.prepare('INSERT INTO local_requests VALUES(?,?,?,?)').run(requestId,'ownerA',id,'pending');return {id,user_id:'ownerA',profile_id:'general',requestId}}
async function enabled(){const c=chat();assert.equal((await api(`/chats/${c.id}/mcp-mode`,'PATCH',{enabled:true,contextConsent:true,connectionIds:['zapier']})).status,200);return c}
function args(name='synthetic_managed',parameters:any={value:'synthetic'}){const c=mcp.mcpConnectionView('ownerA'),t=c.tools.find((t:any)=>t.name===name);return {connectionId:'zapier',toolName:name,arguments:parameters,revision:c.revision,schemaHash:t.schemaHash}}
const queue=(c:any,a=args())=>actions.createAgentAction('ownerA',c,c.requestId,0,'mcp.call',a);
try{
 assert.equal((await api('/mcp/connections','GET',undefined,'')).status,401);
 assert.equal((await api(base+'/credentials','POST',{expectedOwner:'ownerB',connectionToken:TOKEN})).status,409);
 for(const masked of ['••••••••••••••••','masked\u0001token','synthetic-token\n','synthetic-token\r\n','https://mcp.example.invalid/?token=secret'])assert.equal((await api(base+'/credentials','POST',{expectedOwner:'ownerA',connectionToken:masked})).status,400);
 await config();assert.equal(callCount,0);assert.equal(pages,2);assert.ok(methodCalls.includes('initialize'));assert.equal((await api('/mcp/connections','GET',undefined,'ownerB')).data.connections[0].configured,false);
 const c=await enabled();assert.throws(()=>queue(c),/disabled/);assert.equal(actions.agentPermissions(c.id,'ownerA').agent_mode,0);assert.equal((await api(`/chats/${c.id}/mcp-mode`,'PATCH',{enabled:true,contextConsent:false,connectionIds:['zapier']})).status,400);assert.equal((await api(`/chats/${c.id}/mcp-mode`,'PATCH',{enabled:true,contextConsent:true,connectionIds:['zapier']},'ownerB')).status,404);
 const cipher=db.prepare("SELECT encrypted FROM axon_connector_credentials WHERE owner_id='ownerA'").get()as any;assert.ok(!cipher.encrypted.includes(TOKEN));assert.equal(fs.statSync(path.join(tmp,'connector-secrets')).mode&0o777,0o700);assert.equal(fs.statSync(path.join(tmp,'connector-secrets/key')).mode&0o777,0o600);
 console.log('PASS actual SDK initialize/paginated HTTP tools/list; no calls on setup; auth/owner isolation; private encrypted vault; no token in metadata');
 await policy();const a=queue(c);assert.equal(a.state,'review');assert.equal(a.executor,'server-mcp');await actions.executeQueuedMCP('ownerA',a.id,new AbortController().signal);assert.equal(callCount,0);assert.equal((await api(`/agent-actions/${a.id}/claim`,'POST',{})).status,409);assert.equal((await api(`/agent-actions/${a.id}/complete`,'POST',{status:'succeeded',result:{fake:true}})).status,409);assert.equal((await api(`/agent-actions/${a.id}/decision`,'POST',{approved:true},'ownerB')).status,404);await api(`/agent-actions/${a.id}/decision`,'POST',{approved:true});await actions.executeQueuedMCP('ownerA',a.id,new AbortController().signal);assert.equal(callCount,1);let saved=actions.actionHistory('ownerA',c.id)[0];assert.equal(saved.state,'succeeded');assert.ok(!JSON.stringify(saved).includes(TOKEN));assert.equal(saved.result.structuredContent.accessToken,undefined);await actions.executeQueuedMCP('ownerA',a.id,new AbortController().signal);assert.equal(callCount,1);assert.equal(queue(c).id,a.id);
 console.log('PASS exact review before even reads; server-only claim/receipt; one real synthetic HTTP call; redaction; repeated execution uses durable receipt');
 await policy('synthetic_managed','delegated');const delegated=await enabled(),d=queue(delegated);assert.equal(d.state,'queued');await actions.executeQueuedMCP('ownerA',d.id,new AbortController().signal);assert.equal(actions.actionHistory('ownerA',delegated.id)[0].state,'succeeded');assert.equal((await policy('auto_provision_mcp','review')).status,400);assert.equal((await policy('unsafe_pattern','review')).status,400);assert.equal((await policy('execute_zapier_write_action','delegated')).status,400);assert.equal((await policy('whatsapp_send_message','delegated')).status,400);await policy('whatsapp_send_message','review');const managed=await enabled(),managedAction=queue(managed,args('whatsapp_send_message',{recipient:'+15555550123',text:'Synthetic only'}));assert.equal(managedAction.state,'review');assert.equal(callCount,2);await policy('execute_zapier_write_action','review');const generic=await enabled();assert.throws(()=>queue(generic,args('execute_zapier_write_action',{value:'x'})),/schema/);const g=queue(generic,args('execute_zapier_write_action',{action_id:'synthetic-action-id',value:'exact'}));assert.equal(g.state,'review');
 await api(base+'/quota','PATCH',{includedAllowanceConfirmed:true,noOverageConfirmed:false});assert.throws(()=>queue(awaitless()),/allowance/);
 function awaitless(){return chat()}
 await api(base+'/quota','PATCH',{includedAllowanceConfirmed:true,noOverageConfirmed:true});
 console.log('PASS explicit delegation only; generic nested action exact review; unsafe administration/schema disabled; quota gate fails closed');
 await policy('synthetic_managed','review');const oldArgs=args(),schemaChat=await enabled(),old=queue(schemaChat);changed=true;await api(base+'/discover','POST',{});assert.equal(actions.actionHistory('ownerA',schemaChat.id)[0].state,'cancelled');assert.throws(()=>actions.createAgentAction('ownerA',chat(),crypto.randomUUID(),0,'mcp.call',oldArgs),/schema changed/);assert.equal(mcp.mcpConnectionView('ownerA').tools.find(t=>t.name==='synthetic_managed').policy,'disabled');
 await policy('synthetic_managed','delegated');const rotate=await enabled(),r=queue(rotate);const beforeRevision=args().revision;await importToken();assert.notEqual(mcp.mcpConnectionView('ownerA').revision,beforeRevision);assert.equal(mcp.mcpConnectionView('ownerA').quotaConfirmed,false);assert.equal(actions.actionHistory('ownerA',rotate.id)[0].state,'cancelled');
 console.log('PASS discovery schema changes invalidate permissions and pending calls; credential rotation resets quota/tools and cancels stale actions');
 await config();await policy('synthetic_managed','delegated');for(const failure of ['error','drop','malformed-call','oversized']){mode=failure;const ch=await enabled(),action=queue(ch),before=callCount;await actions.executeQueuedMCP('ownerA',action.id,new AbortController().signal);const evidence=actions.actionHistory('ownerA',ch.id)[0];assert.equal(evidence.state,failure==='error'?'failed':'uncertain',failure+' '+JSON.stringify(evidence.result));await actions.executeQueuedMCP('ownerA',action.id,new AbortController().signal);assert.equal(callCount,before+1)}mode='success';
 mode='sse';const stream=await enabled(),streamAction=queue(stream);await actions.executeQueuedMCP('ownerA',streamAction.id,new AbortController().signal);assert.equal(actions.actionHistory('ownerA',stream.id)[0].state,'succeeded');mode='success';
 const paused=await enabled(),pa=queue(paused),before=callCount;await api(`/chats/${paused.id}/mcp-mode`,'PATCH',{enabled:false,contextConsent:false,connectionIds:['zapier']});await actions.executeQueuedMCP('ownerA',pa.id,new AbortController().signal);assert.equal(callCount,before);assert.equal(stopped,paused.id);
 mode='malformed';assert.equal((await api(base+'/discover','POST',{})).status,502);assert.equal(mcp.mcpConnectionView('ownerA').status,'needs-attention');mode='success';
 console.log('PASS provider isError failure; committed/lost-response unknown never replayed; Pause blocks dispatch; malformed discovery never ready');
 await config();await policy('synthetic_managed','delegated');const loop=await enabled();let turns=0;const reply=await actions.runGoogleAgent({owner:'ownerA',chat:{...loop,...actions.agentPermissions(loop.id,'ownerA')},requestId:loop.requestId,input:'Synthetic MCP user request',signal:new AbortController().signal,model:async input=>{turns++;return turns===1?JSON.stringify({type:'action',operation:'mcp.call',args:args()}):JSON.stringify({type:'final',text:'Synthetic receipt reviewed.'})}});assert.match(reply,/succeeded/);assert.equal(turns,2);assert.equal(actions.actionHistory('ownerA',loop.id).length,1);
 const msgs=chat();await api(`/chats/${msgs.id}/messages-mode`,'PATCH',{enabled:true,contextConsent:true,executionPolicy:'delegated'});let ma=actions.createAgentAction('ownerA',msgs,msgs.requestId,0,'messages.send',{recipient:'+15555550123',text:'Synthetic text'},[]);assert.equal(ma.state,'review');assert.equal(ma.executor,'native-messages');assert.equal(actions.agentPermissions(msgs.id,'ownerA').agent_mode,0);await api(`/agent-actions/${ma.id}/decision`,'POST',{approved:true});assert.equal((await api(`/agent-actions/${ma.id}/claim`,'POST',{})).status,200);assert.equal((await api(`/agent-actions/${ma.id}/execution`)).status,200);await api(`/agent-actions/${ma.id}/complete`,'POST',{status:'succeeded',result:{acceptedByMessages:true,deliveryStatus:'unverified'}});assert.equal(actions.actionHistory('ownerA',msgs.id)[0].result.deliveryStatus,'unverified');assert.throws(()=>actions.createAgentAction('ownerA',chat(),crypto.randomUUID(),0,'messages.send',{recipient:'recipient',text:'x'}),/explicit/);
 console.log('PASS bounded MCP model-action-receipt-final loop; independent Messages consent, unknown recipient exact review and acceptance-not-delivery receipt');
 const bufferBase='/mcp/connections/buffer';await api(bufferBase+'/credentials','POST',{expectedOwner:'ownerA',connectionToken:TOKEN});assert.equal((await api(bufferBase+'/discover','POST',{})).status,200);await api(bufferBase+'/quota','PATCH',{includedAllowanceConfirmed:true,noOverageConfirmed:true});let bc=mcp.mcpConnectionView('ownerA','buffer'),bt=bc.tools.find(t=>t.name==='create_post');await api(bufferBase+'/tools/create_post','PATCH',{policy:'review',schemaHash:bt.schemaHash});
 const ba={connectionId:'buffer',revision:bc.revision,schemaHash:bt.schemaHash,toolName:'create_post',arguments:{channelId:'a'.repeat(24),schedulingType:'automatic',text:'Synthetic draft',saveToDraft:true}};
 const bufferChat=await enabled();assert.throws(()=>queue(bufferChat,ba as any),/paused/);await api(`/chats/${bufferChat.id}/mcp-mode`,'PATCH',{enabled:true,contextConsent:true,connectionIds:['buffer']});assert.throws(()=>queue(bufferChat,{...ba,arguments:{...ba.arguments,saveToDraft:false}}as any),/saveToDraft/);assert.throws(()=>queue(bufferChat,{...ba,arguments:{...ba.arguments,mode:'shareNow'}}as any),/publishing/);const bufferAction=queue(bufferChat,ba as any);assert.equal(bufferAction.state,'review');await api(`/agent-actions/${bufferAction.id}/decision`,'POST',{approved:true});await actions.executeQueuedMCP('ownerA',bufferAction.id,new AbortController().signal);assert.equal(actions.actionHistory('ownerA',bufferChat.id)[0].state,'succeeded');assert.ok(bc.tools.filter(t=>['create_post','list_channels','list_posts','get_post'].includes(t.name)).every(t=>!t.blocked));assert.throws(()=>queue(chat(),{...ba,arguments:{...ba.arguments,channelId:'not-a-provider-id'}}as any),/schema/);assert.throws(()=>queue(chat(),{...ba,arguments:{...ba.arguments,dueAt:'not-a-timestamp'}}as any),/schema/);assert.ok(bc.tools.filter(t=>['execute_query','execute_mutation','delete_post','update_post'].includes(t.name)).every(t=>t.blocked));assert.ok(!mcp.mcpModelCatalog('ownerA',['zapier']).includes('"connectionId":"buffer"'));
 const bufferRead=bc.tools.find(t=>t.name==='get_account');await api(bufferBase+'/tools/get_account','PATCH',{policy:'delegated',schemaHash:bufferRead.schemaHash});const br=chat();await api(`/chats/${br.id}/mcp-mode`,'PATCH',{enabled:true,contextConsent:true,connectionIds:['buffer']});const bra=queue(br,{...ba,toolName:'get_account',schemaHash:bufferRead.schemaHash,arguments:{}}as any);assert.equal(bra.state,'queued');await actions.executeQueuedMCP('ownerA',bra.id,new AbortController().signal);assert.equal(actions.actionHistory('ownerA',br.id)[0].state,'succeeded');
 assert.equal((await api('/mcp/connections/evil/credentials','POST',{expectedOwner:'ownerA',connectionToken:TOKEN})).status,404);
 // A tool whose saved policy requires exact review must reach the review queue
 // when the MODEL proposes it, dispatch nothing until the exact action is
 // approved, and then dispatch exactly once. A denial dispatches nothing.
 {
  const live=mcp.mcpConnectionView('ownerA','buffer'),reviewTool=live.tools.find(t=>t.name==='create_post')!;
  const reviewArgs={connectionId:'buffer',revision:live.revision,schemaHash:reviewTool.schemaHash,toolName:'create_post',arguments:{channelId:'a'.repeat(24),schedulingType:'automatic',text:'Synthetic draft',saveToDraft:true}};
  for(const approved of [true,false]){
   const ch=await enabled();await api(`/chats/${ch.id}/mcp-mode`,'PATCH',{enabled:true,contextConsent:true,connectionIds:['buffer']});
   const before=callCount;let turns=0;
   const run=actions.runGoogleAgent({owner:'ownerA',chat:{...ch,...actions.agentPermissions(ch.id,'ownerA')},requestId:ch.requestId,input:'Synthetic MCP review request',signal:new AbortController().signal,model:async()=>{turns++;return turns===1?JSON.stringify({type:'action',operation:'mcp.call',args:reviewArgs}):JSON.stringify({type:'final',text:'Synthetic review finished.'})}});
   let pending:any=null;for(let i=0;i<120&&!pending;i++){pending=(await api('/agent-actions/pending')).data.actions.find((a:any)=>a.chatId===ch.id);if(!pending)await new Promise(r=>setTimeout(r,25))}
   assert.ok(pending,'The model-proposed action never reached the review queue.');
   assert.equal(pending.state,'review');
   assert.equal(callCount,before,'A review-gated tool was dispatched before the exact action was approved.');
   await api(`/agent-actions/${pending.id}/decision`,'POST',{approved});
   const reply=await run;
   const history=actions.actionHistory('ownerA',ch.id);
   assert.equal(history.length,1);
   assert.equal(history[0].state,approved?'succeeded':'cancelled');
   assert.equal(callCount,before+(approved?1:0),'The provider call count did not match the review decision.');
   if(approved)assert.match(reply,/succeeded/);else assert.match(reply,/did not complete successfully \(cancelled\)/);
  }
 }
 console.log('PASS fixed direct Buffer SDK transport; explicit per-chat connection selection; real synthetic draft call; publishing/edit/GraphQL/delete blocked; reviewed writes and delegated reads');
 console.log('PASS model-proposed review-gated tool waits for the exact-action approval, dispatches nothing before it, dispatches exactly once after it, and a denial dispatches nothing');
 // The provider can change after local discovery. Revalidate before tools/call.
 const drift=await enabled(),driftAction=queue(drift),driftBefore=callCount;changed=!changed;await actions.executeQueuedMCP('ownerA',driftAction.id,new AbortController().signal);assert.equal(callCount,driftBefore);assert.equal(actions.actionHistory('ownerA',drift.id)[0].state,'failed');changed=!changed;await api(base+'/discover','POST',{});
 const waiting=await enabled(),wa=queue(waiting);mode='wait';const work=actions.executeQueuedMCP('ownerA',wa.id,new AbortController().signal);for(let i=0;i<100&&callCount===driftBefore;i++)await new Promise(r=>setTimeout(r,5));await importToken();await work;assert.equal(actions.actionHistory('ownerA',waiting.id)[0].state,'uncertain');mode='success';await config();await policy('synthetic_managed','delegated');
 console.log('PASS live remote schema drift prevents dispatch; token rotation aborts an in-flight call as uncertain without replay');
 const replay=await enabled(),ra=queue(replay);db.prepare("UPDATE axon_agent_actions SET state='running' WHERE id=?").run(ra.id);actions.initializeAgentActions();assert.equal(actions.actionHistory('ownerA',replay.id)[0].state,'uncertain');const previous=callCount;await actions.executeQueuedMCP('ownerA',ra.id,new AbortController().signal);assert.equal(callCount,previous);await api(base,'DELETE');assert.equal(mcp.mcpConnectionView('ownerA').configured,false);assert.equal(actions.agentPermissions(replay.id,'ownerA').mcp_mode,0);
 console.log('PASS restart retains unknown outcome without replay; disconnect disables owner chat permissions and removes local secret');
}finally{globalThis.fetch=realFetch;db.close();fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()));fs.rmSync(tmp,{recursive:true,force:true})}
