import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import Database from 'better-sqlite3';
import { Cron } from 'croner';
type Request=(route:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<{response:Response,data:any}>;
export async function testWorkspace({request,base,cookie,dbPath,calls}: {request:Request,base:string,cookie:string,dbPath:string,calls:any[]}) {
 const uuid=()=>crypto.randomUUID(),check=(name:string)=>console.log('PASS WORKSPACE',name);
 const fall=new Cron('30 1 * * *',{timezone:'America/New_York',paused:true});assert.deepEqual(fall.nextRuns(2,new Date('2026-11-01T00:00:00Z')).map(date=>date.toISOString()),['2026-11-01T05:30:00.000Z','2026-11-02T06:30:00.000Z']);fall.stop();
 const spring=new Cron('30 2 * * *',{timezone:'America/New_York',paused:true});assert.deepEqual(spring.nextRuns(2,new Date('2027-03-14T00:00:00Z')).map(date=>date.toISOString()),['2027-03-14T07:00:00.000Z','2027-03-15T06:30:00.000Z']);spring.stop();
 const post=async(path:string,body:any)=>{const r=await request(path,'POST',body);assert.ok(r.response.status<300,`${path}: ${JSON.stringify(r.data)}`);return r.data;};
 const p='loan-officer-assistant';
 const agent=(await request(`/api/local/agents/${p}`)).data.agent;
 assert.equal((await request(`/api/local/agents/${p}`,'PATCH',{name:'Synthetic Local Identity',version:agent.version})).response.status,200);
 const soul=await request(`/api/local/agents/${p}/soul`,'PUT',{soul:'SYNTHETIC_OWNER_SOUL: Use a short numbered explanation.',version:agent.soulVersion});assert.equal(soul.response.status,200);
 assert.equal((await request(`/api/local/agents/${p}/soul`,'PUT',{soul:'stale',version:agent.soulVersion})).response.status,409);
 assert.ok((await request(`/api/local/agents/${p}/soul`)).data.versions.some((v:any)=>v.version===agent.soulVersion&&v.soul===agent.soul));
 const memory=await post(`/api/local/agents/${p}/memory`,{text:'SYNTHETIC_MEMORY_BLUEBIRD',source:'Synthetic test owner'});
 const duplicate=await post(`/api/local/agents/${p}/memory`,{text:'SYNTHETIC_MEMORY_BLUEBIRD',source:'Same text'});assert.equal(duplicate.memory.id,memory.memory.id);
 const preview=await post(`/api/local/agents/${p}/memory/import/preview`,{text:'SYNTHETIC_MEMORY_BLUEBIRD\n\nSYNTHETIC_REVIEWED_IMPORT'});assert.equal(preview.candidates[0].duplicate,true);
 assert.equal((await request(`/api/local/agents/${p}/memory`)).data.memories.length,1);
 await post(`/api/local/agents/${p}/memory/import`,{entries:[preview.candidates[1]]});
 const main=(await post('/api/local/chats',{profileId:p,kind:'main',title:'Synthetic named discussion'})).chat;
 assert.equal((await post('/api/local/chats',{profileId:p,kind:'main',title:'Must not replace existing main'})).chat.id,main.id);assert.equal((await request(`/api/local/chats/${main.id}`)).data.chat.title,'Synthetic named discussion');assert.equal((await request('/api/local/chats','POST',{title:'x'.repeat(121)})).response.status,400);
 await post(`/api/local/chats/${main.id}/messages`,{text:'Synthetic identity and memory check',requestId:uuid()});
 assert.equal((await request(`/api/local/chats/${main.id}`)).data.chat.title,'Synthetic named discussion');assert.match(calls.at(-1).input,/SYNTHETIC_OWNER_SOUL/);assert.match(calls.at(-1).input,/SYNTHETIC_MEMORY_BLUEBIRD/);
 const unrelated=(await post('/api/local/chats',{profileId:'mortgage-marketing-assistant'})).chat;
 await post(`/api/local/chats/${unrelated.id}/messages`,{text:'Synthetic isolated memory check',requestId:uuid()});assert.ok(!calls.at(-1).input.includes('SYNTHETIC_MEMORY_BLUEBIRD'));
 check('Identity/Soul versions, conflict protection, reviewed memory deduplication, agent-specific injection and preserved unique main thread');

 const fileBytes='SYNTHETIC_FILE_UNIQUE_PHRASE: amber lattice 871.\nThis is harmless synthetic text.';
 const form=new FormData();form.set('file',new Blob([fileBytes],{type:'text/plain'}),'synthetic-note.txt');form.set('profileId',p);form.set('chatId',main.id);
 const upload=await fetch(base+'/api/local/files',{method:'POST',headers:{Cookie:cookie,Origin:base},body:form});const uploaded=await upload.json()as any;assert.equal(upload.status,201,JSON.stringify(uploaded));const file=uploaded.file;assert.equal(file.deliverySupported,true);
 const bytes=await fetch(base+`/api/local/files/${file.id}/download`,{headers:{Cookie:cookie}});assert.equal(await bytes.text(),fileBytes);
 const ranged=await fetch(base+`/api/local/files/${file.id}/content`,{headers:{Cookie:cookie,Range:'bytes=0-8'}});assert.equal(ranged.status,206);assert.equal(await ranged.text(),fileBytes.slice(0,9));
 assert.equal((await fetch(base+`/api/local/files/${file.id}/content`)).status,401);
 const fileAttempt={text:'',attachmentIds:[file.id],requestId:uuid()};const sent=await post(`/api/local/chats/${main.id}/messages`,fileAttempt);assert.match(calls.at(-1).input,/amber lattice 871/);assert.equal(sent.messages.at(-2).attachments[0].id,file.id);
 const beforeDup=calls.length;await post(`/api/local/chats/${main.id}/messages`,fileAttempt);assert.equal(calls.length,beforeDup);
 await post(`/api/local/chats/${main.id}/messages`,{text:'Explain the earlier attached synthetic phrase.',requestId:uuid()});assert.match(calls.at(-1).input,/PREVIOUSLY ATTACHED FILE CONTENT/);assert.match(calls.at(-1).input,/amber lattice 871/);
 assert.equal((await request(`/api/local/chats/${unrelated.id}/messages`,'POST',{text:'No cross agent files',attachmentIds:[file.id],requestId:uuid()})).response.status,404);
 const space=(await post('/api/local/workspace/spaces',{title:'Synthetic space',data:{fileIds:[file.id]}})).record;
 const changedSpace=await request(`/api/local/workspace/spaces/${space.id}`,'PATCH',{version:space.version,data:{fileIds:[]}});assert.equal(changedSpace.response.status,200);assert.equal((await request(`/api/local/files/${file.id}`)).response.status,200);
 assert.ok((await request('/api/local/search?q=synthetic-note')).data.results.some((r:any)=>r.kind==='file'));
 assert.equal((await request(`/api/local/files/${file.id}`,'DELETE',{})).response.status,200);assert.ok(!(await request('/api/local/files')).data.files.some((f:any)=>f.id===file.id));assert.ok((await request('/api/local/files?archived=1')).data.files.some((f:any)=>f.id===file.id&&f.archived));assert.equal((await post(`/api/local/files/${file.id}/restore`,{})).file.archived,false);assert.ok((await request('/api/local/files')).data.files.some((f:any)=>f.id===file.id));
 const aliasedDownload=await fetch(base+`/api/local/files/${file.id}/content?download=1`,{headers:{Cookie:cookie}});assert.match(aliasedDownload.headers.get('Content-Disposition')!,/^attachment/);assert.equal(await aliasedDownload.text(),fileBytes);
 check('Private uploads return exact bytes/ranges, actual text reaches agent, message references persist, cross-agent delivery is denied and space membership is separate');

 // A real HTTP proxy commits the upload upstream and drops its response. Retrying
 // that same operation must recover its file, not create an invisible duplicate.
 const uploadId=uuid();
 const retryForm=(key=uploadId,bytes='SYNTHETIC_LOST_UPLOAD_RESPONSE',name='retry-proof.txt',mime='text/plain',profileId=p)=>{const f=new FormData();f.set('file',new Blob([bytes],{type:mime}),name);f.set('requestId',key);f.set('profileId',profileId);return f;};
 const uploadCount=(await request('/api/local/files')).data.files.length;
 let committedFileId='';
 const droppingProxy=http.createServer(async(req,res)=>{
   try {
     const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
     const upstream=await fetch(base+'/api/local/files',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':req.headers['content-type']!},body:Buffer.concat(chunks)});
     assert.equal(upstream.status,201);committedFileId=((await upstream.json())as any).file.id;
     res.destroy();
   }catch(error){res.destroy(error as Error);}
 });
 await new Promise<void>(resolve=>droppingProxy.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(fetch(`http://127.0.0.1:${(droppingProxy.address()as any).port}/files`,{method:'POST',body:retryForm()}));}
 finally{await new Promise<void>(resolve=>droppingProxy.close(()=>resolve()));}
 assert.ok(committedFileId);
 const sendUpload=(body:FormData,session=cookie)=>fetch(base+'/api/local/files',{method:'POST',headers:{Cookie:session,Origin:base},body});
 const retry=await sendUpload(retryForm());assert.equal(retry.status,200);assert.equal(((await retry.json())as any).file.id,committedFileId);
 assert.equal((await request('/api/local/files')).data.files.length,uploadCount+1);
 for(const changed of [retryForm(uploadId,'DIFFERENT_BYTES'),retryForm(uploadId,undefined,'renamed.txt'),retryForm(uploadId,undefined,undefined,'application/octet-stream'),retryForm(uploadId,undefined,undefined,undefined,'general')])assert.equal((await sendUpload(changed)).status,409);
 assert.equal((await sendUpload(retryForm('bad'))).status,400);
 const deliberate=await sendUpload(retryForm(uuid()));assert.equal(deliberate.status,201);assert.notEqual(((await deliberate.json())as any).file.id,committedFileId);
 await request(`/api/local/files/${committedFileId}`,'DELETE',{});const archivedRetry=await sendUpload(retryForm());assert.equal(archivedRetry.status,409);assert.match(((await archivedRetry.json())as any).error,/Restore/);
 await post(`/api/local/files/${committedFileId}/restore`,{});assert.equal((await sendUpload(retryForm())).status,200);
 const foreignToken=crypto.randomBytes(32).toString('hex'),foreignSession=`grokbot_session=${foreignToken}`;
 const receiptFixture=new Database(dbPath);receiptFixture.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(foreignToken,'foreign-user',Date.now(),Date.now()+60000);receiptFixture.close();
 const foreignUpload=await sendUpload(retryForm(),foreignSession);assert.equal(foreignUpload.status,201);const foreignUploaded=((await foreignUpload.json())as any).file;
 assert.notEqual(foreignUploaded.id,committedFileId);assert.equal((await request(`/api/local/files/${foreignUploaded.id}`)).response.status,404);
 const foreignReplay=await sendUpload(retryForm(),foreignSession);assert.equal(foreignReplay.status,200);assert.equal(((await foreignReplay.json())as any).file.id,foreignUploaded.id);
 check('Upload response-loss replay returns one committed file; changed bytes/name/MIME/recipient conflict, archived retry needs explicit restore, fresh IDs and other owners remain independent');

 const idea=(await post('/api/local/workspace/ideas',{title:'Synthetic idea',body:'Review a harmless fictional workflow',data:{category:'Productivity'}})).record;
 const goal=(await post(`/api/local/workspace/ideas/${idea.id}/goal`,{})).record;assert.equal((await post(`/api/local/workspace/ideas/${idea.id}/goal`,{})).record.id,goal.id);
 const done=await request(`/api/local/workspace/goals/${goal.id}`,'PATCH',{version:goal.version,status:'completed'});assert.equal(done.response.status,200);
 assert.equal((await request(`/api/local/workspace/goals/${goal.id}`,'PATCH',{version:goal.version,status:'tracking'})).response.status,409);
 assert.ok((await request(`/api/local/workspace/goals/${goal.id}/history`)).data.history.length>=2);
 const feed=await post('/api/local/workspace/feed/generate',{prompt:'According to saved LendingPad document-merge training, what risk affects the original entries? Cite local evidence and its verification limits.',sourceIds:['lendingpad-encompass']});assert.equal(feed.records.length,1);assert.ok(feed.records[0].data.sources[0].sha256);assert.match(feed.records[0].data.notice,/unverified/);assert.match(feed.records[0].body,/Neither video/);assert.match(feed.records[0].body,/original/i);assert.ok(feed.records[0].data.sources[0].startLine<=39&&feed.records[0].data.sources[0].endLine>=41);assert.equal(feed.records[0].data.sources[0].text,feed.records[0].body);
 const discussed=await post(`/api/local/workspace/feed/${feed.records[0].id}/discuss`,{profileId:p});assert.ok(discussed.chat.id);assert.ok(discussed.draft.includes('lendingpad-encompass'));
 const dueDate='2000-01-01';const imported=await post('/api/local/workspace/pipeline/import',{synthetic:true,sourceName:'Synthetic fixture tracker',records:[{sourceId:'fixture-one',title:'Fictional sample A',stage:'processing',dueDate,nextAction:'Review synthetic checklist',followUp:true,onHold:false},{sourceId:'fixture-two',title:'Fictional sample B',stage:'lead',nextAction:'',onHold:true}]});assert.equal(imported.imported,2);
 const reimported=await post('/api/local/workspace/pipeline/import',{synthetic:true,sourceName:'Synthetic fixture tracker',records:[{sourceId:'fixture-one',title:'Fictional sample A',stage:'processing',dueDate,nextAction:'Review synthetic checklist'}]});assert.equal(reimported.imported,0);
 const summary=(await request('/api/local/pipeline/summary')).data;assert.equal(summary.metrics.active.count,1);assert.equal(summary.metrics.leads.count,1);assert.equal(summary.metrics.overdue.count,1);assert.equal(summary.metrics.onHold.count,1);
 assert.equal((await request('/api/local/workspace/pipeline/import','POST',{records:[],sourceName:'Real data'})).response.status,400);
 const refresh=await post('/api/local/pipeline/refresh',{});assert.equal(refresh.source.externalConnected,false);
 check('Ideas/goal linking, optimistic edits/history, real local-source feed/discussion, synthetic tracker deduplication and reconciled metric populations');

 const manual=(await post('/api/local/workspace/tasks',{title:'Synthetic manual task',data:{instructions:'A synthetic manual task',cron:'',enabled:false,requiresApproval:true}})).record;assert.equal(manual.data.nextRun,null);
 assert.equal((await request('/api/local/workspace/tasks','POST',{title:'Invalid enabled schedule',data:{instructions:'Synthetic',cron:'',enabled:true}})).response.status,400);
 const task=(await post('/api/local/workspace/tasks',{title:'Synthetic scheduled draft',profileId:p,data:{instructions:'Create a SYNTHETIC_TASK_RESULT draft.',cron:'0 9 * * 1-5',timezone:'America/New_York',enabled:false,requiresApproval:true}})).record;
 assert.ok(task.data.nextRun>Date.now());
 const beforeApproval=calls.length;const run=await post(`/api/local/workspace/tasks/${task.id}/run`,{requestId:uuid()});assert.equal(run.run.state,'awaiting_approval');assert.equal(calls.length,beforeApproval);assert.equal(run.approval.payload.taskId,task.id);
 await post(`/api/local/approvals/${run.approval.id}/decision`,{decision:'denied'});assert.equal(calls.length,beforeApproval);
 const changed=await post(`/api/local/workspace/tasks/${task.id}/run`,{requestId:uuid()});await request(`/api/local/workspace/tasks/${task.id}`,'PATCH',{version:task.version,title:'Changed task'});await post(`/api/local/approvals/${changed.approval.id}/decision`,{decision:'allowed'});assert.equal(calls.length,beforeApproval);
 const allowed=await post(`/api/local/workspace/tasks/${task.id}/run`,{requestId:uuid()});await post(`/api/local/approvals/${allowed.approval.id}/decision`,{decision:'allowed'});
 let finished:any;for(let n=0;n<80;n++){finished=(await request('/api/local/activity')).data.runs.find((r:any)=>r.id===allowed.run.id);if(finished.state==='completed')break;await new Promise(resolve=>setTimeout(resolve,25));}
 assert.equal(finished.state,'completed');assert.ok(finished.result.chatId);assert.match(calls.at(-1).input,/SYNTHETIC_TASK_RESULT/);
 assert.equal((await request(`/api/local/approvals/${allowed.approval.id}/decision`,'POST',{decision:'allowed'})).response.status,409);
 const existingSettings=(await request('/api/local/settings')).data;assert.equal((await request('/api/local/settings','PUT',{version:existingSettings.version,settings:{appearance:'dark',timezone:'America/New_York',voiceByProfile:{[p]:{voice:'synthetic-local-voice',rate:1.1}}}})).response.status,200);assert.equal((await request('/api/local/settings')).data.settings.appearance,'dark');assert.equal((await request('/api/local/settings')).data.settings.voiceByProfile[p].voice,'synthetic-local-voice');
 const scheduledTask=(await post('/api/local/workspace/tasks',{title:'Synthetic due once',profileId:p,data:{instructions:'A synthetic scheduled draft',cron:'0 9 * * *',timezone:'America/New_York',enabled:true,requiresApproval:true}})).record;
 const fixture=new Database(dbPath);const data={...scheduledTask.data,nextRun:Date.now()-1000};fixture.prepare('UPDATE axon_records SET data_json=? WHERE id=?').run(JSON.stringify(data),scheduledTask.id);fixture.close();
 let dueRuns:any[]=[];for(let n=0;n<80;n++){dueRuns=(await request(`/api/local/activity?taskId=${scheduledTask.id}`)).data.runs;if(dueRuns.length)break;await new Promise(resolve=>setTimeout(resolve,25));}assert.equal(dueRuns.length,1);assert.equal(dueRuns[0].state,'awaiting_approval');
 const nextTask=(await request(`/api/local/workspace/tasks/${scheduledTask.id}`)).data.record;assert.ok(nextTask.data.nextRun>Date.now());
 const replayFixture=new Database(dbPath);replayFixture.prepare('UPDATE axon_records SET data_json=? WHERE id=?').run(JSON.stringify(data),scheduledTask.id);replayFixture.close();await new Promise(resolve=>setTimeout(resolve,1150));assert.equal((await request(`/api/local/activity?taskId=${scheduledTask.id}`)).data.runs.length,1,'Persisted unique slot prevents restart/catch-up duplicate');
 check('DST transitions and persisted-slot replay are deterministic; schedules persist actual next runs; required approval/denial and changed-payload checks gate execution; allowed local draft produces saved chat; due slot fires once');

 const capabilities=(await request('/api/local/capabilities')).data;assert.ok(capabilities.connectors.every((x:any)=>x.connected===false));assert.equal((await request('/api/local/invites','POST',{})).response.status,424);
 const exported=(await request('/api/local/export')).data;assert.ok(exported.chats.some((r:any)=>r.id===main.id));assert.ok(exported.records.some((r:any)=>r.id===goal.id));assert.ok(!JSON.stringify(exported).includes(cookie.split('=')[1]));
 const diagnostic=(await request('/api/local/diagnostics')).data;assert.ok(!JSON.stringify(diagnostic).includes('SYNTHETIC_MEMORY_BLUEBIRD'));assert.equal((await request('/api/local/legal')).data.documents.length,2);
 const deviceData=(await request('/api/local/devices')).data;assert.ok(deviceData.devices.some((d:any)=>d.current));assert.ok(!JSON.stringify(deviceData).includes(cookie.split('=')[1]));
 for(const route of ['/api/local/export','/api/local/devices'])assert.equal((await fetch(base+route)).status,401);
 const foreignSessionId=crypto.createHash('sha256').update(foreignToken).digest('hex');
 assert.equal((await request(`/api/local/devices/${foreignSessionId}`,'DELETE',{})).response.status,404);
 assert.equal((await fetch(base+'/api/local/devices',{headers:{Cookie:foreignSession}})).status,200);
 const sessionFixture=new Database(dbPath);const otherToken=crypto.randomBytes(32).toString('hex');sessionFixture.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(otherToken,'legacy-owner',Date.now(),Date.now()+60000);sessionFixture.close();
 const otherId=crypto.createHash('sha256').update(otherToken).digest('hex');assert.equal((await request(`/api/local/devices/${otherId}`,'DELETE',{})).response.status,200);
 assert.equal((await fetch(base+'/api/local/agents',{headers:{Cookie:`grokbot_session=${otherToken}`}})).status,401);
 assert.equal((await request('/api/local/devices')).response.status,200);
 const db2=new Database(dbPath);const foreignFile=uuid();db2.prepare('INSERT INTO axon_files SELECT ?,?,profile_id,chat_id,name,mime,size,sha256,bytes,category,text_content,1,created_at,updated_at FROM axon_files WHERE id=?').run(foreignFile,'foreign-user',file.id);const foreignId=uuid();db2.prepare('INSERT INTO axon_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(foreignId,'foreign-user','goals','general','Foreign private synthetic','PRIVATE_FOREIGN_RECORD','active','{}',1,Date.now(),Date.now());db2.close();assert.equal((await request(`/api/local/files/${foreignFile}/restore`,'POST',{})).response.status,404);assert.ok(!(await request('/api/local/files?archived=1')).data.files.some((f:any)=>f.id===foreignFile));assert.equal((await request(`/api/local/workspace/goals/${foreignId}`)).response.status,404);assert.ok(!JSON.stringify((await request('/api/local/export')).data).includes('PRIVATE_FOREIGN_RECORD'));
 check('Persisted settings, real session inventory, credential-free diagnostics/export, owner isolation and named external-provider blockers');
 console.log('PASS: AxonCROS workspace synthetic integration, zero real model calls.');
}
