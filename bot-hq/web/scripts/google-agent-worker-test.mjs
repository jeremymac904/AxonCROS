import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(process.argv[2]||fileURLToPath(new URL('../../../',import.meta.url)));
const require=createRequire(path.join(repo,'bot-hq/package.json'));
const ts=require('typescript');
const source=fs.readFileSync(path.join(repo,'bot-hq/web/src/lib/google-agent-worker.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {GoogleAgentWorker,boundedGoogleResult}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
let counter=0;const checks=[];
function fixture(state='queued'){
 const id=`synthetic-${++counter}`,ownerId=`owner-${counter}`;
 const action={id,ownerId,chatId:'synthetic-chat',profileId:'general',requestId:id,operation:'gmail.send',args:{to:['synthetic@example.invalid'],body:'SYNTHETIC'},state,createdAt:0,updatedAt:0};
 const calls={claim:0,execute:0,complete:0}; let owner=ownerId;
 const io={owner:async()=>owner,pending:async()=>[action],claim:async()=>{calls.claim++;action.state='running';return {...action}},execute:async a=>{calls.execute++;return {requestId:a.id,operation:a.operation,status:'completed',result:{id:'synthetic-provider-id'}}},complete:async(id,receipt)=>{calls.complete++;action.state=receipt.status;action.result=receipt.result;action.error=receipt.error}};
 return {action,calls,io,worker:()=>new GoogleAgentWorker(ownerId,io),setOwner:id=>owner=id};
}
async function test(name,fn){await fn();checks.push(name)}
await test('Queued action executes once and saves matching successful receipt',async()=>{const f=fixture(),w=f.worker();await w.tick();await w.tick();assert.equal(f.calls.execute,1);assert.equal(f.action.state,'succeeded');assert.equal(f.action.result.id,'synthetic-provider-id')});
await test('Pending review and already running actions never dispatch',async()=>{for(const state of ['review','running']){const f=fixture(state);await f.worker().tick();assert.equal(f.calls.claim,0);assert.equal(f.calls.execute,0)}});
await test('Lost completion response retries exact receipt, never repeats native action',async()=>{const f=fixture(),complete=f.io.complete;let first=true;f.io.complete=async(id,r)=>{await complete(id,r);if(first){first=false;throw Error('Synthetic response loss')}};const w=f.worker();await assert.rejects(w.tick());await w.tick();assert.equal(f.calls.execute,1);assert.equal(f.calls.complete,2);assert.equal(f.calls.claim,1)});
await test('Native unknown result remains uncertain and never auto retries',async()=>{const f=fixture();f.io.execute=async a=>{f.calls.execute++;return {requestId:a.id,operation:a.operation,status:'unknown',error:'Synthetic ambiguous write'}};const w=f.worker();await w.tick();await w.tick();assert.equal(f.action.state,'uncertain');assert.equal(f.calls.execute,1)});
await test('Bridge rejection cannot be mistaken for confirmed failure or success',async()=>{const f=fixture();f.io.execute=async()=>{f.calls.execute++;throw Error('Synthetic disconnected bridge')};await f.worker().tick();assert.equal(f.action.state,'uncertain')});
await test('Mismatched native receipt is uncertain',async()=>{const f=fixture();f.io.execute=async()=>({requestId:'other',operation:'other',status:'completed',result:{}});await f.worker().tick();assert.equal(f.action.state,'uncertain')});
await test('Owner switch after claim prevents native execution',async()=>{const f=fixture(),claim=f.io.claim;f.io.claim=async id=>{const a=await claim(id);f.setOwner('different-owner');return a};await f.worker().tick();assert.equal(f.calls.execute,0)});
await test('Cross-owner queued action never claimed',async()=>{const f=fixture();f.action.ownerId='different-owner';await f.worker().tick();assert.equal(f.calls.claim,0)});
await test('Concurrent ticks do not dispatch twice',async()=>{const f=fixture();let release;f.io.execute=async a=>{f.calls.execute++;await new Promise(r=>release=r);return {requestId:a.id,operation:a.operation,status:'completed',result:{}}};const w=f.worker(),running=w.tick();while(!release)await new Promise(r=>setTimeout(r,0));await w.tick();release();await running;assert.equal(f.calls.execute,1)});
await test('Stop during pending claim prevents dispatch',async()=>{const f=fixture();let release;const claim=f.io.claim;f.io.claim=async id=>{await new Promise(r=>release=r);return claim(id)};const w=f.worker(),running=w.tick();while(!release)await new Promise(r=>setTimeout(r,0));w.stop();release();await running;assert.equal(f.calls.execute,0)});
await test('Remount retries retained receipt without another provider call',async()=>{const f=fixture(),complete=f.io.complete;f.io.complete=async()=>{throw Error('Synthetic backend down')};const old=f.worker();await assert.rejects(old.tick());old.stop();f.io.complete=complete;await f.worker().tick();assert.equal(f.calls.execute,1);assert.equal(f.action.state,'succeeded')});
await test('Definite native rejection saves failed receipt without repeating action',async()=>{const f=fixture();f.io.execute=async a=>{f.calls.execute++;return {requestId:a.id,operation:a.operation,status:'failed',error:'Synthetic permission refused'}};const w=f.worker();await w.tick();await w.tick();assert.equal(f.action.state,'failed');assert.equal(f.calls.execute,1)});
await test('Owner change after native result withholds receipt from other owner',async()=>{const f=fixture(),execute=f.io.execute;f.io.execute=async a=>{const result=await execute(a);f.setOwner('different-owner');return result};const w=f.worker();await w.tick();assert.equal(f.calls.complete,0);f.setOwner(f.action.ownerId);await w.tick();assert.equal(f.calls.execute,1);assert.equal(f.action.state,'succeeded')});
await test('Stop during native operation preserves result for receipt-only recovery',async()=>{const f=fixture();let release;f.io.execute=async a=>{f.calls.execute++;await new Promise(r=>release=r);return {requestId:a.id,operation:a.operation,status:'completed',result:{id:'late-synthetic'}}};const old=f.worker(),running=old.tick();while(!release)await new Promise(r=>setTimeout(r,0));old.stop();release();await running;assert.equal(f.calls.complete,0);await f.worker().tick();assert.equal(f.calls.execute,1);assert.equal(f.action.result.id,'late-synthetic')});
await test('Large provider result saved with explicit bounded truncation',async()=>{const result=boundedGoogleResult({text:'\\\n😀'.repeat(20000)});assert.equal(result.truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(result))<24000);assert.equal(boundedGoogleResult({id:'small'}).id,'small')});
const nativeSource=fs.readFileSync(path.join(repo,'bot-hq/web/src/lib/axon-native.ts'),'utf8');
const nativeCompiled=ts.transpileModule(nativeSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {nativeRequest}=await import('data:text/javascript;base64,'+Buffer.from(nativeCompiled).toString('base64'));
const previousWindow=globalThis.window;
try {
 for(const status of ['failed','unknown','completed']) await test(`Native helper preserves matching ${status} action receipt`,async()=>{
  const envelope={requestId:'synthetic-request',operation:'drive.create',status,...(status==='completed'?{result:{id:'synthetic-id'}}:{error:'Synthetic '+status})};
  globalThis.window={webkit:{messageHandlers:{axoncros:{postMessage:async()=>envelope}}}};
  assert.deepEqual(await nativeRequest('executeGoogleAction',{requestId:envelope.requestId,operation:envelope.operation}),envelope);
 });
 await test('Native helper rejects mismatched failure receipt and retains other action error behavior',async()=>{
  globalThis.window={webkit:{messageHandlers:{axoncros:{postMessage:async()=>({requestId:'other',operation:'drive.create',status:'failed',error:'Synthetic rejected'})}}}};
  await assert.rejects(nativeRequest('executeGoogleAction',{requestId:'expected',operation:'drive.create'}),/Synthetic rejected/);
  await assert.rejects(nativeRequest('checkGoogleWorkspace',{}),/Synthetic rejected/);
 });
 await test('Real native helper plus worker classifies confirmed failure as failed, not uncertain',async()=>{
  const f=fixture();globalThis.window={webkit:{messageHandlers:{axoncros:{postMessage:async body=>({requestId:body.requestId,operation:body.operation,status:'failed',error:'Synthetic missing grant. No write was dispatched.'})}}}};
  f.io.execute=a=>nativeRequest('executeGoogleAction',{requestId:a.id,operation:a.operation,expectedOwner:a.ownerId,args:a.args});
  await f.worker().tick();assert.equal(f.action.state,'failed');assert.match(f.action.error,/missing grant/);
 });
}finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
const receipt={passed:true,checks,realProviderCalls:0,realModelCalls:0};
console.log(JSON.stringify(receipt,null,2));
