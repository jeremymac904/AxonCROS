/** Outbound fixed Zapier and Buffer MCP only. No stdio, arbitrary endpoints, account provisioning or automatic retries. */
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {jsonSchemaValidator,JsonSchemaType} from '@modelcontextprotocol/sdk/validation/types.js';
import {Ajv} from 'ajv';
import {Hono} from 'hono';
import {db,now} from './db.js';
import {requireUser,type AuthVars} from './lib/auth.js';
import {mcpVault} from './axon-connectors.js';

type ConnectionId='zapier'|'buffer';
const endpoints={zapier:'https://mcp.zapier.com/api/v1/connect',buffer:'https://mcp.buffer.com/mcp'};
const idOf=(v:unknown):ConnectionId=>{if(v!=='zapier'&&v!=='buffer')throw new MCPError('Unknown fixed MCP connection.',404);return v};
const NOTICE='Discovery does not verify app access. Each successful Zapier app action, including reads, uses two shared plan tasks. Confirm existing included allowance and disabled overage billing before enabling calls. No automatic retries.';
export class MCPError extends Error {constructor(message:string,public status:400|404|409|413|424|502=400){super(message)}}
const fail=(m:string,s:400|404|409|413|424|502=400):never=>{throw new MCPError(m,s)};
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const stable=(v:any):string=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=(v:any)=>crypto.createHash('sha256').update(stable(v)).digest('hex');
const ajv=new Ajv({strict:false,validateFormats:false,allErrors:false,ownProperties:true});
const blocked=new Set(['enable_zapier_action','disable_zapier_action','auto_provision_mcp','manage_zapier_connections','get_configuration_url','write_code_action','create_zapier_skill','update_zapier_skill','delete_zapier_skill','send_feedback']);
const generic=new Set(['execute_zapier_read_action','execute_zapier_write_action']);
const sensitive=/^(?:authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|connection[_-]?token|cookie|password|api[_-]?key)$/i;
function scrub(value:any,token:string,depth=0):any {
 if(depth>24)return '[omitted]';
 if(typeof value==='string')return value.split(token).join('[redacted]').replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/https:\/\/mcp\.zapier\.com\/[^\s"']*\?[^\s"']+/gi,'[redacted MCP URL]');
 if(Array.isArray(value))return value.map(v=>scrub(v,token,depth+1));
 if(object(value))return Object.fromEntries(Object.entries(value).filter(([k])=>!sensitive.test(k)&&!['__proto__','constructor','prototype'].includes(k)).map(([k,v])=>[k,scrub(v,token,depth+1)]));
 return value;
}
function safeSchema(schema:any){
 if(!object(schema)||schema.type!=='object'||Buffer.byteLength(JSON.stringify(schema))>24000)fail('Unsupported or oversized MCP input schema.',502);
 let nodes=0;function visit(v:any,d:number){if(++nodes>2000||d>16)fail('MCP schema exceeds the bounded validation limit.',502);if(object(v))for(const[k,x]of Object.entries(v)){if(['$ref','$dynamicRef','pattern','patternProperties','__proto__','constructor','prototype'].includes(k))fail('MCP schema requires unsupported reference or pattern validation.',502);visit(x,d+1)}else if(Array.isArray(v))v.forEach(x=>visit(x,d+1))}visit(schema,0);
 try{ajv.compile(schema)}catch{fail('MCP returned an invalid input schema.',502)}
}
const outputValidator:jsonSchemaValidator={getValidator<T>(schema:JsonSchemaType){try{safeSchema(schema)}catch{return()=>({valid:false,data:undefined,errorMessage:'Unsupported MCP output schema.'})}const validate=ajv.compile(schema);return (input:unknown)=>validate(input)?{valid:true,data:input as T,errorMessage:undefined}:{valid:false,data:undefined,errorMessage:'MCP structured output did not match its bounded schema.'}}};
const bufferReads=new Set(['get_account','list_channels','get_channel','list_posts','get_post','list_ideas','get_idea','list_tags']);
function forceReview(name:string,id:ConnectionId){return id==='buffer'?!bufferReads.has(name):generic.has(name)||/(?:send|message|email|post|publish|invite)/i.test(name)}
function descriptor(raw:any,token:string,id:ConnectionId){if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(raw.name))fail('Invalid MCP tool name.',502);const d=scrub(raw,token);let blockReason=restriction(d.name,id);try{safeSchema(d.inputSchema);if(d.outputSchema!==undefined)safeSchema(d.outputSchema)}catch{blockReason='Input schema is unsupported; this tool cannot execute.'}return {name:d.name,title:String(d.title??d.name).slice(0,200),description:String(d.description??'').slice(0,4000),inputSchema:d.inputSchema,...(d.outputSchema!==undefined?{outputSchema:d.outputSchema}:{}),blocked:!!blockReason,blockReason,forceReview:forceReview(d.name,id)}}
function restriction(name:string,id:ConnectionId){if(id==='buffer')return !bufferReads.has(name)&&name!=='create_post'?'Only verified Buffer reads and draft creation are enabled; editing, generic GraphQL, publishing and deletion are blocked.':null;return blocked.has(name)||/(?:deploy|workflow|zap_create|zap_update|zap_delete|code_action|publish_zap)/i.test(name)?'Account, tool provisioning, code and workflow administration are not enabled.':null}
db.exec(`CREATE TABLE IF NOT EXISTS axon_mcp_connections(owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,connection_id TEXT NOT NULL,revision TEXT NOT NULL,status TEXT NOT NULL,discovered_at INTEGER,quota_confirmed INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,PRIMARY KEY(owner_id,connection_id));
 CREATE TABLE IF NOT EXISTS axon_mcp_tools(owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,connection_id TEXT NOT NULL,name TEXT NOT NULL,descriptor_json TEXT NOT NULL,schema_hash TEXT NOT NULL,policy TEXT NOT NULL DEFAULT 'disabled',PRIMARY KEY(owner_id,connection_id,name));
 CREATE TABLE IF NOT EXISTS axon_mcp_chat_permissions(chat_id TEXT PRIMARY KEY REFERENCES local_chats(id) ON DELETE CASCADE,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,enabled INTEGER NOT NULL DEFAULT 0,context_consent INTEGER NOT NULL DEFAULT 0,connection_ids_json TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL);`);
const connection=(owner:string,id:ConnectionId='zapier')=>db.prepare('SELECT * FROM axon_mcp_connections WHERE owner_id=? AND connection_id=?').get(owner,id) as any;
const toolRow=(owner:string,name:string,id:ConnectionId='zapier')=>db.prepare('SELECT * FROM axon_mcp_tools WHERE owner_id=? AND connection_id=? AND name=?').get(owner,id,name) as any;
export function mcpPermissions(chatId:string,owner:string):any{const r=db.prepare('SELECT enabled,context_consent,connection_ids_json FROM axon_mcp_chat_permissions WHERE chat_id=? AND owner_id=?').get(chatId,owner) as any;return {mcp_mode:r?.enabled??0,mcp_context_consent:r?.context_consent??0,mcp_connection_ids:r?JSON.parse(r.connection_ids_json):[]}}
export function mcpChatView(chat:any){const p=mcpPermissions(chat.id,chat.user_id);return {mcpMode:!!p.mcp_mode,mcpContextConsent:!!p.mcp_context_consent,mcpConnectionIds:p.mcp_connection_ids}}
export function mcpConnectionView(owner:string,id:ConnectionId='zapier'){const r=connection(owner,id),configured=mcpVault.exists(owner,id);return {id,name:id==='zapier'?'Zapier MCP':'Buffer MCP',origin:new URL(endpoints[id]).origin,status:configured?(r?.status??'configured'):'not-configured',configured,discoveredAt:r?.discovered_at??null,revision:r?.revision??null,quotaConfirmed:!!r?.quota_confirmed,notice:id==='zapier'?NOTICE:'Direct Buffer MCP uses your existing API key and plan, without Zapier tasks. Confirm existing included access; read checks and publishing are never automatic. Draft creation requires exact review. Editing and publishing are blocked.',tools:(db.prepare('SELECT * FROM axon_mcp_tools WHERE owner_id=? AND connection_id=? ORDER BY name').all(owner,id)as any[]).map(t=>{const d=JSON.parse(t.descriptor_json);return {...d,schemaHash:t.schema_hash,policy:t.policy}})}}
function invalidate(owner:string,id?:ConnectionId,chatId?:string){if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='axon_agent_actions'").get())db.prepare("UPDATE axon_agent_actions SET state=CASE WHEN state='running' THEN 'uncertain' ELSE 'cancelled' END,error='MCP permissions or connection changed. No retry; review any in-flight provider action.',updated_at=? WHERE owner_id=? AND operation='mcp.call' AND state IN ('review','queued','running')"+(id?" AND json_extract(args_json,'$.connectionId')=?":'')+(chatId?' AND chat_id=?':'')).run(now(),owner,...(id?[id]:[]),...(chatId?[chatId]:[]))}
const active=new Map<string,{controller:AbortController,id:ConnectionId}>();
function stopOwner(owner:string,id:ConnectionId){invalidate(owner,id);if(active.get(owner)?.id===id)active.get(owner)?.controller.abort()}

/** Injectable fetch is test-only composition, never an environment variable or URL setting. */
export function createMCPService(fetcher:typeof fetch=fetch){
 async function session<T>(owner:string,id:ConnectionId,signal:AbortSignal,work:(client:Client,token:string)=>Promise<T>):Promise<T>{
  const token=mcpVault.read(owner,id),ENDPOINT=endpoints[id];const client=new Client({name:'AxonCROS',version:'3.2.1'},{capabilities:{},jsonSchemaValidator:outputValidator});
  const guardedFetch:typeof fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   if(url!==ENDPOINT)fail('Only the fixed selected MCP endpoint is allowed.',424);
   // No background SSE stream, auth redirects, resumption or implicit call replay.
   if(init?.method==='GET')return new Response(null,{status:405});
   const response=await fetcher(ENDPOINT,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),headers:{...Object.fromEntries(new Headers(init?.headers)),Authorization:`Bearer ${token}`}});
   if(Number(response.headers.get('content-length')??0)>2_000_000)throw new Error('Oversized MCP response');
   if(!response.body)return response;
   let size=0;const reader=response.body.getReader();const stream=new ReadableStream<Uint8Array>({async pull(controller){try{const part=await reader.read();if(part.done){controller.close();return}size+=part.value.length;if(size>2_000_000){await reader.cancel();controller.error(new Error('Bounded MCP response exceeded'));return}controller.enqueue(part.value)}catch{controller.error(new Error('MCP response interrupted'))}},cancel:()=>reader.cancel()});
   return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
  const transport=new StreamableHTTPClientTransport(new URL(ENDPOINT),{fetch:guardedFetch,requestInit:{redirect:'error'},reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}});
  try{await client.connect(transport,{timeout:45000,signal});return await work(client,token)}finally{await client.close().catch(()=>{})}
 }
 async function discover(owner:string,id:ConnectionId='zapier'){
  const before=connection(owner,id);if(!before||!mcpVault.exists(owner,id))fail('Import an existing connection token securely first.',424);
  const revision=before.revision,controller=new AbortController();if(active.has(owner))fail('Another MCP operation is in progress.',409);active.set(owner,{controller,id});
  try{
   const descriptors=await session(owner,id,AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]),async(client,token)=>{
    const rows:any[]=[],cursors=new Set<string>();let cursor:string|undefined;
    for(let page=0;page<10;page++){
     const result=await client.listTools(cursor?{cursor}:undefined,{timeout:45000,signal:controller.signal});
     for(const raw of result.tools){if(rows.length>=100)fail('Tool catalog exceeds100 tools. Use a smaller managed Zapier server.',502);if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(raw.name)||rows.some(t=>t.name===raw.name))fail('Invalid or duplicate MCP tool name.',502);rows.push(descriptor(raw,token,id))}
     cursor=result.nextCursor;if(!cursor)return rows;if(cursors.has(cursor)||cursor.length>2000)fail('Invalid MCP pagination.',502);cursors.add(cursor);
    }fail('Tool catalog pagination exceeds the bounded limit.',502);
   });
   if(connection(owner,id)?.revision!==revision)fail('The connection changed during discovery.',409);
   db.transaction(()=>{const prior=new Map((db.prepare('SELECT name,schema_hash,policy FROM axon_mcp_tools WHERE owner_id=? AND connection_id=?').all(owner,id)as any[]).map(t=>[t.name,t]));db.prepare('DELETE FROM axon_mcp_tools WHERE owner_id=? AND connection_id=?').run(owner,id);for(const d of descriptors!){const h=hash(d),old=prior.get(d.name),policy=!d.blocked&&old?.schema_hash===h?old.policy:'disabled';db.prepare('INSERT INTO axon_mcp_tools VALUES(?,?,?,?,?,?)').run(owner,id,d.name,JSON.stringify(d),h,policy)}db.prepare("UPDATE axon_mcp_connections SET status='discovered',discovered_at=?,updated_at=? WHERE owner_id=? AND connection_id=?").run(now(),now(),owner,id);invalidate(owner,id)})();return mcpConnectionView(owner,id);
  }catch(e){if(connection(owner,id)?.revision===revision)db.prepare("UPDATE axon_mcp_connections SET status='needs-attention',updated_at=? WHERE owner_id=? AND connection_id=?").run(now(),owner,id);if(e instanceof MCPError)throw e;fail('MCP discovery failed. Check the existing server credential and connection. No app action was called.',502)}finally{active.delete(owner)}
 }
 async function execute(owner:string,args:any,signal:AbortSignal,liveGrant:()=>boolean){
  const id=idOf(args.connectionId),controller=new AbortController();if(active.has(owner))return {status:'failed',result:null,error:'Another MCP operation is running. Nothing was dispatched.'};active.set(owner,{controller,id});let dispatched=false;
  try{
   const result=await session(owner,id,AbortSignal.any([signal,controller.signal,AbortSignal.timeout(90000)]),async(client,token)=>{
    // Discovery itself is unmetered. Recheck the remote schema before dispatch so a
    // changed server tool cannot silently reuse yesterday's approval.
    let cursor:string|undefined,found=false;const cursors=new Set<string>();
    for(let page=0;page<10;page++){
     const listing=await client.listTools(cursor?{cursor}:undefined,{signal:AbortSignal.any([signal,controller.signal]),timeout:45000});
     const matching=listing.tools.filter(t=>t.name===args.toolName);
     if(matching.length===1){if(hash(descriptor(matching[0],token,id))!==args.schemaHash)fail('Remote MCP schema changed before execution.',409);found=true;break}
     if(matching.length>1)fail('Remote MCP tool name is ambiguous.',409);
     cursor=listing.nextCursor;if(!cursor)break;if(cursors.has(cursor)||cursor.length>2000)fail('Remote MCP pagination changed.',409);cursors.add(cursor);
    }
    if(!found)fail('Remote MCP tool is no longer available.',409);
    validateMCPAction(owner,args);if(!liveGrant())fail('MCP execution grant is no longer active.',409);
    dispatched=true;
    const receipt=await client.callTool({name:args.toolName,arguments:args.arguments},undefined,{signal:AbortSignal.any([signal,controller.signal]),timeout:60000});
    if(!Array.isArray(receipt.content)||(!receipt.content.length&&!object(receipt.structuredContent)&&!receipt.isError)||receipt.isError!==undefined&&typeof receipt.isError!=='boolean'||receipt.structuredContent!==undefined&&!object(receipt.structuredContent))throw new Error('Malformed MCP receipt');
    const clean=receipt.isError?{isError:true,content:[{type:'text',text:'The provider reported a tool error. Inspect its own history for details; no automatic retry.'}]}:scrub(receipt,token);if(Buffer.byteLength(JSON.stringify(clean))>22000)throw new Error('Receipt too large');return clean;
   });
   return {status:result.isError?'failed':'succeeded',result,error:result.isError?'MCP provider reported a tool error. Review the saved result; nothing was retried.':null};
  }catch(e){if(!dispatched&&e instanceof MCPError&&/Remote MCP/.test(e.message))db.prepare("UPDATE axon_mcp_connections SET status='needs-attention',updated_at=? WHERE owner_id=? AND connection_id=?").run(now(),owner,id);return {status:dispatched?'uncertain':'failed',result:null,error:dispatched?'MCP provider outcome is unknown. The call may have used tasks or completed. Review the provider history before another attempt; nothing was retried.':e instanceof MCPError?e.message+' No tool call was sent.':'MCP setup or permissions blocked dispatch. No tool call was sent.'}}finally{active.delete(owner)}
 }
 return {discover,execute};
}
export const mcpService=createMCPService();
export function validateMCPAction(owner:string,args:any){
 if(!object(args)||Object.keys(args).some(k=>!['connectionId','toolName','arguments','revision','schemaHash'].includes(k))||!Object.hasOwn(endpoints,args.connectionId)||typeof args.toolName!=='string'||!object(args.arguments)||Buffer.byteLength(JSON.stringify(args))>48000)fail('Invalid bounded MCP call.');
 const id=idOf(args.connectionId),c=connection(owner,id),t=toolRow(owner,args.toolName,id);if(!c||c.status!=='discovered'||!c.quota_confirmed||!mcpVault.exists(owner,id))fail('Discover the MCP connection and confirm existing included allowance with overage disabled before calls.',424);
 if(c.revision!==args.revision||!t||t.schema_hash!==args.schemaHash)fail('MCP connection or tool schema changed. Review it before planning again.',409);
 const d=JSON.parse(t.descriptor_json);if(d.blocked||t.policy==='disabled')fail('This MCP tool is disabled.',409);
 safeSchema(d.inputSchema);if(!ajv.compile(d.inputSchema)(args.arguments))fail('MCP arguments do not match the discovered tool schema.');
 if(id==='buffer'&&args.toolName==='create_post'&&(args.arguments.saveToDraft!==true||!['addToQueue',undefined].includes(args.arguments.mode)))fail('Buffer creation requires saveToDraft:true; immediate, next and scheduled publishing are disabled.');
 if(id==='zapier'&&generic.has(args.toolName)&&!Object.entries(args.arguments).some(([k,v])=>/^(?:action_id|actionId|zapier_action_id|zapierActionId)$/.test(k)&&typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v)))fail('Generic Zapier execution requires a concrete nested action ID and exact review.');
 return {operation:'mcp.call' as const,args:JSON.parse(JSON.stringify(args)),policy:t.policy as string,forceReview:!!d.forceReview};
}
export function mcpModelCatalog(owner:string,ids:string[]){return JSON.stringify(ids.filter(id=>Object.hasOwn(endpoints,id)).flatMap(id=>{const c=mcpConnectionView(owner,id as ConnectionId);if(c.status!=='discovered'||!c.quotaConfirmed)return [];return c.tools.filter(t=>!t.blocked&&t.policy!=='disabled').map(t=>({operation:'mcp.call',connectionId:id,toolName:t.name,revision:c.revision,schemaHash:t.schemaHash,inputSchema:t.inputSchema,policy:t.forceReview?'review':t.policy,description:t.description,...(id==='buffer'?{boundary:'create_post requires saveToDraft:true. No publishing mode. Editing is blocked.'}:{})}))}));}
export function mountMCP(app:Hono<AuthVars>,chatView:(r:any)=>any,isBusy:(id:string)=>boolean,stop:(id:string)=>void,service=mcpService){
 const api=new Hono<AuthVars>();api.use('*',requireUser);api.onError((e,c)=>e instanceof MCPError?c.json({error:e.message},e.status):c.json({error:'The MCP operation failed safely. No credentials were returned.'},502));
 api.get('/mcp/connections',c=>c.json({connections:[mcpConnectionView(c.get('user').id,'zapier'),mcpConnectionView(c.get('user').id,'buffer')]}));
 api.post('/mcp/connections/:connectionId/credentials',async c=>{const owner=c.get('user').id,id=idOf(c.req.param('connectionId')),b=await c.req.json();if(b.expectedOwner!==owner)fail('Owner changed during secure setup.',409);if(typeof b.connectionToken!=='string'||b.connectionToken.length<8||b.connectionToken.length>8192||(/[\s\x00]/.test(b.connectionToken)||b.connectionToken.includes('://')))fail('Choose a valid existing MCP connection token in native setup.');stopOwner(owner,id);db.transaction(()=>{mcpVault.save(owner,id,b.connectionToken);db.prepare("INSERT INTO axon_mcp_connections VALUES(?,?,?, 'configured',NULL,0,?) ON CONFLICT(owner_id,connection_id) DO UPDATE SET revision=excluded.revision,status='configured',discovered_at=NULL,quota_confirmed=0,updated_at=excluded.updated_at").run(owner,id,crypto.randomUUID(),now());db.prepare('DELETE FROM axon_mcp_tools WHERE owner_id=? AND connection_id=?').run(owner,id)})();return c.json({connection:mcpConnectionView(owner,id)})});
 api.post('/mcp/connections/:connectionId/discover',async c=>c.json({connection:await service.discover(c.get('user').id,idOf(c.req.param('connectionId')))}));
 api.patch('/mcp/connections/:connectionId/quota',async c=>{const owner=c.get('user').id,id=idOf(c.req.param('connectionId')),b=await c.req.json();if(typeof b.includedAllowanceConfirmed!=='boolean'||typeof b.noOverageConfirmed!=='boolean')fail('Confirm included allowance and disabled overage explicitly.');if(!connection(owner,id))fail('Configure the connection first.',424);stopOwner(owner,id);db.prepare('UPDATE axon_mcp_connections SET quota_confirmed=?,updated_at=? WHERE owner_id=? AND connection_id=?').run(+(b.includedAllowanceConfirmed&&b.noOverageConfirmed),now(),owner,id);return c.json({connection:mcpConnectionView(owner,id)})});
 api.patch('/mcp/connections/:connectionId/tools/:name',async c=>{const owner=c.get('user').id,id=idOf(c.req.param('connectionId')),t=toolRow(owner,c.req.param('name'),id),b=await c.req.json();if(!t)fail('Tool not found.',404);if(t.schema_hash!==b.schemaHash)fail('Tool changed; review the current schema.',409);if(!['disabled','review','delegated'].includes(b.policy))fail('Choose a tool policy.');const d=JSON.parse(t.descriptor_json);if(d.blocked&&b.policy!=='disabled'||d.forceReview&&b.policy==='delegated')fail('This tool cannot use that policy.');stopOwner(owner,id);db.prepare('UPDATE axon_mcp_tools SET policy=? WHERE owner_id=? AND connection_id=? AND name=?').run(b.policy,owner,id,t.name);return c.json({connection:mcpConnectionView(owner,id)})});
 api.delete('/mcp/connections/:connectionId',c=>{const owner=c.get('user').id,id=idOf(c.req.param('connectionId'));stopOwner(owner,id);db.transaction(()=>{mcpVault.remove(owner,id);db.prepare('DELETE FROM axon_mcp_tools WHERE owner_id=? AND connection_id=?').run(owner,id);db.prepare('DELETE FROM axon_mcp_connections WHERE owner_id=? AND connection_id=?').run(owner,id);db.prepare('UPDATE axon_mcp_chat_permissions SET enabled=0,context_consent=0,updated_at=? WHERE owner_id=? AND EXISTS(SELECT 1 FROM json_each(connection_ids_json) WHERE value=?)').run(now(),owner,id)})();return c.json({connection:mcpConnectionView(owner,id)})});
 api.patch('/chats/:id/mcp-mode',async c=>{const owner=c.get('user').id,chat=db.prepare('SELECT * FROM local_chats WHERE id=? AND user_id=?').get(c.req.param('id'),owner) as any;if(!chat)fail('Chat not found.',404);const b=await c.req.json();if(typeof b.enabled!=='boolean'||typeof b.contextConsent!=='boolean'||b.enabled&&!b.contextConsent||!Array.isArray(b.connectionIds)||b.connectionIds.length>2||b.connectionIds.some((id:any)=>!Object.hasOwn(endpoints,id))||new Set(b.connectionIds).size!==b.connectionIds.length||b.enabled&&!b.connectionIds.length)fail('Explicit MCP model-context consent is required.');if(b.enabled&&isBusy(chat.id))fail('Finish or stop the current reply before changing MCP permissions.',409);db.prepare('INSERT INTO axon_mcp_chat_permissions VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET enabled=excluded.enabled,context_consent=excluded.context_consent,connection_ids_json=excluded.connection_ids_json,updated_at=excluded.updated_at').run(chat.id,owner,+b.enabled,+b.contextConsent,JSON.stringify(b.connectionIds),now());if(!b.enabled){invalidate(owner,undefined,chat.id);stop(chat.id)}return c.json({chat:chatView(chat)})});
 app.route('/api/local',api);
}
