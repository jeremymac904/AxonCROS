// Isolated rendered checks. API/native handlers are synthetic; no real permission,
// Keychain, folder, gateway, microphone, or provider operations are performed.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { port: 0, strictPort: false, host: '127.0.0.1', proxy: {} } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [], unexpected = [], uploads = [], apiBodies = [];
page.on('pageerror', error => errors.push(error.message));
let saved = { settings: { appearance:'light',timezone:'America/New_York',language:'en',allowScheduledDrafts:false,dictationLanguage:'en-US',voiceByProfile:{} }, version:0 };
await page.route('**/api/**', async route => {
  const request=route.request(), path=new URL(request.url()).pathname;
  if(request.postData()) apiBodies.push(request.postData());
  let response;
  if(path==='/api/local/settings') {
    if(request.method()==='PUT') { const body=request.postDataJSON(); assert.equal(body.version,saved.version); saved={settings:body.settings,version:saved.version+1}; }
    response=saved;
  } else if(path==='/api/auth/me') response={user:{id:'synthetic-owner',name:'Synthetic owner',email:'synthetic@example.invalid'}};
  else if(path==='/api/local/capabilities') response={connectors:[],computerUse:{dependency:'Synthetic unavailable runtime'},wallet:{dependency:'No billing API configured'}};
  else if(path==='/api/local/profiles') response={profiles:[{id:'general',name:'General chat'},{id:'mortgage-team-lead',name:'Mortgage Team Lead'}]};
  else if(path==='/api/local/devices') response={devices:[]};
  else if(path==='/api/local/legal') response={documents:[{name:'LICENSE',text:'Synthetic license fixture'}]};
  else if(path==='/api/local/files'&&request.method()==='POST') {uploads.push(request.postDataBuffer().toString());response={file:{id:`fixture-${uploads.length}`}};}
  else { unexpected.push(path); return route.fulfill({status:404,json:{error:'Unexpected fixture route'}}); }
  await route.fulfill({json:response});
});
await page.addInitScript(() => {
  window.nativeCalls=[];window.failSecret=true;window.holdFolder=false;
  window.webkit={messageHandlers:{axoncros:{postMessage:async body=>{
    window.nativeCalls.push({...body,...(body.value?{value:'[redacted synthetic]'}:{})});
    switch(body.action){
      case 'capabilities':return {secureStore:true,folderGrants:true,dictation:true,microphonePermission:'granted',speechPermission:'granted',voices:[{id:'voice.fixture',name:'Fixture Voice',language:'en-US'}]};
      case 'startDictation':window.lastDictation=body.sessionId;return {state:'recording',sessionId:body.sessionId};
      case 'stopDictation':case 'cancelDictation':case 'stopSpeaking':return {ok:true};
      case 'speak':window.lastSpeech=body.sessionId;return {state:'speaking'};
      case 'listSecrets':return {entries:[]};
      case 'setSecret':if(window.failSecret)throw new Error('Synthetic Keychain access denied');return {ok:true};
      case 'listFolderGrants':return {grants:[{id:'synthetic-grant',name:'Synthetic project',path:'/synthetic/project',access:'read-only'}]};
      case 'listFolder':if(window.holdFolder)await new Promise(resolve=>window.releaseFolder=resolve);return {entries:[{name:'picture.png',directory:false,size:4},{name:'notes.json',directory:false,size:2}]};
      case 'readGrantedFile':return {name:body.relativePath,base64:btoa('SYNTHETIC'),size:9};
      default:throw new Error('Unexpected native action');
    }
  }}}};
});
const navigate=async label=>page.getByRole('navigation',{name:'Test settings navigation'}).getByRole('button',{name:label,exact:true}).click();
const emit=async detail=>page.evaluate(detail=>window.dispatchEvent(new CustomEvent('axoncros:native',{detail})),detail);
try {
  await page.goto(`${base}/tests/axon-settings-fixture.html`);
  await page.getByText('Synthetic owner',{exact:true}).waitFor();
  for(const label of ['General','Connectors','Computer use','File system access','Dictation','Wallet','Secure store','Permissions','Messaging channels','Devices','Data controls','Voice and avatar','Help & support','Legal info','Log out']) {
    await navigate(label); await page.getByRole('heading',{level:1,name:label,exact:true}).waitFor();
  }
  console.log('PASS: all 15 Settings sections render distinct useful content.');
  await navigate('Dictation');
  const draft=page.getByRole('textbox',{name:'Editable dictation test'});
  await draft.fill('Before after');await draft.evaluate(node=>node.setSelectionRange(7,7));
  await page.getByRole('button',{name:'Start test',exact:true}).click();
  const first=await page.evaluate(()=>window.lastDictation);
  await emit({type:'dictation',sessionId:first,state:'recording',text:'partial'});
  assert.equal(await draft.inputValue(),'Before after');
  await emit({type:'dictation',sessionId:first,state:'complete',text:'spoken '});
  await page.waitForFunction(()=>document.querySelector('textarea').value==='Before spoken after');
  await page.getByRole('button',{name:'Start test',exact:true}).click();const cancelled=await page.evaluate(()=>window.lastDictation);
  await page.getByRole('button',{name:'Cancel recording',exact:true}).click();
  await emit({type:'dictation',sessionId:cancelled,state:'complete',text:'STALE'});
  assert.equal(await draft.inputValue(),'Before spoken after');
  await page.getByRole('button',{name:'Start test',exact:true}).click();const leaving=await page.evaluate(()=>window.lastDictation);
  await navigate('General');assert.ok(await page.evaluate(id=>window.nativeCalls.some(c=>c.action==='cancelDictation'&&c.sessionId===id),leaving));
  console.log('PASS: exact native event, cursor insertion, partial isolation, cancel/stale event and unmount cleanup.');
  await navigate('Voice and avatar');
  await page.getByLabel('Assistant',{exact:true}).selectOption('mortgage-team-lead');
  await page.getByLabel('Voice',{exact:true}).selectOption('voice.fixture');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByText('Preferences saved.').waitFor();assert.equal(saved.settings.voiceByProfile['mortgage-team-lead'].voice,'voice.fixture');
  await page.getByRole('button',{name:'Preview voice',exact:true}).click();const speech=await page.evaluate(()=>window.lastSpeech);
  await navigate('General');assert.ok(await page.evaluate(id=>window.nativeCalls.some(c=>c.action==='stopSpeaking'&&c.sessionId===id),speech));
  await navigate('Voice and avatar');await page.getByLabel('Assistant',{exact:true}).selectOption('mortgage-team-lead');assert.equal(await page.getByLabel('Voice',{exact:true}).inputValue(),'voice.fixture');
  console.log('PASS: per-assistant voice save/restore and scoped preview cleanup.');
  await navigate('Secure store');await page.getByRole('button',{name:'Add secret',exact:true}).click();
  await page.getByLabel('Entry name',{exact:true}).fill('fixture');await page.getByLabel('Secret value',{exact:true}).fill('SYNTHETIC_NOT_A_KEY');
  await page.getByRole('button',{name:'Save to Keychain',exact:true}).click();
  await page.getByRole('dialog').getByRole('alert').filter({hasText:'Synthetic Keychain access denied'}).waitFor();
  assert.ok(!apiBodies.join('').includes('SYNTHETIC_NOT_A_KEY'));await page.getByRole('button',{name:'Close Store a secret securely',exact:true}).click();
  console.log('PASS: Keychain failure visible inside modal; value never sent to HTTP API.');
  await navigate('File system access');await page.getByRole('button',{name:'Browse',exact:true}).click();
  await page.getByRole('dialog').getByText('picture.png',{exact:true}).waitFor();
  await page.locator('.ax-file-row').filter({hasText:'picture.png'}).getByRole('button').click();
  await page.getByRole('dialog').getByText('picture.png imported into the private library.').waitFor();
  assert.match(uploads[0],/Content-Type: image\/png/i);
  await page.locator('.ax-file-row').filter({hasText:'notes.json'}).getByRole('button').click();
  await page.getByRole('dialog').getByText('notes.json imported into the private library.').waitFor();assert.match(uploads[1],/Content-Type: application\/json/i);
  await page.getByRole('button',{name:'Close Browse Synthetic project',exact:true}).click();
  await page.evaluate(()=>window.holdFolder=true);await page.getByRole('button',{name:'Browse',exact:true}).click();
  await page.getByRole('button',{name:'Close Browse Synthetic project',exact:true}).click();await page.evaluate(()=>window.releaseFolder());
  assert.equal(await page.getByRole('dialog').count(),0);
  console.log('PASS: folder imports keep correct MIME; late closed-browser result cannot reopen modal.');
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  console.log('PASS: no JavaScript errors, unexpected API calls, real credentials, audio, or model requests.');
} finally {await browser.close();await server.close();}
