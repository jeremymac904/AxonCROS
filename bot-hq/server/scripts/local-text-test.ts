/** Run from bot-hq: node --import tsx server/scripts/local-text-test.ts
 * Uses a temporary database and synthetic HTTP gateway. Never calls a model/provider.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { localTextProfiles } from '../src/local-text-profiles.js';
import { researchDocuments, researchSnapshotId } from '../src/local-research-catalog.js';
import { retrieveResearch } from '../src/local-research.js';
import './local-research-test.js';
import { testWorkspace } from './axon-workspace-test.js';

const catalogCheck = spawnSync(process.execPath, ['server/scripts/build-profile-catalog.mjs', '--check'], { cwd: process.cwd(), encoding: 'utf8' });
assert.equal(catalogCheck.status, 0, catalogCheck.stderr);
console.log(catalogCheck.stdout.trim());

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-hq-local-text-'));
const isolatedHome = path.join(temp, 'gateway');
fs.mkdirSync(isolatedHome, { mode: 0o700 });
const gatewayKey = crypto.randomBytes(24).toString('hex');
fs.writeFileSync(path.join(isolatedHome, '.env'), `API_SERVER_KEY=${gatewayKey}\n`, { mode: 0o600 });
const launchToken = crypto.randomBytes(32).toString('hex');
const startup = (extra: Record<string, string>) => spawnSync(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
  env: { PATH: process.env.PATH, HOME: os.homedir(), SESSION_SECRET: 'synthetic-secret-with-no-value', ...extra },
});
const fullMode = startup({ BOT_HQ_MODE: 'full' });
assert.notEqual(fullMode.status, 0); assert.match(fullMode.stderr, /Missing env XAI_API_KEY/);
const incompleteLocal = startup({ BOT_HQ_MODE: 'local-text' });
assert.notEqual(incompleteLocal.status, 0); assert.match(incompleteLocal.stderr, /Local text mode needs/);
if (fs.existsSync(path.join(os.homedir(), '.hermes'))) {
  const mainHome = startup({ BOT_HQ_MODE: 'local-text', ALLOWED_EMAILS: 'synthetic@example.invalid',
    BOT_HQ_LAUNCH_TOKEN: launchToken, DB_PATH: path.join(temp, 'forbidden-start.db'),
    HERMES_HOME_PRIMARY: path.join(os.homedir(), '.hermes'), HERMES_URL: 'http://127.0.0.1:18642',
    APP_URL: 'http://127.0.0.1:8787' });
  assert.notEqual(mainHome.status, 0); assert.match(mainHome.stderr, /cannot use the main Hermes/);
  assert.equal(fs.existsSync(path.join(temp, 'forbidden-start.db')), false);
}
console.log('PASS Full mode still requires vendor keys; incomplete local mode and main Hermes home rejected before opening a database');
const calls: any[] = [];
let scenario: 'good' | 'bad' | 'hold' = 'good';
let syntheticReply = 'SYNTHETIC_REPLY';
let syntheticEnvelope: any = null;
let release: (() => void) | undefined;
const gateway = http.createServer(async (req, res) => {
  if (req.url === '/health') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ platform: 'hermes-agent' })); return; }
  assert.equal(req.headers.authorization, `Bearer ${gatewayKey}`);
  if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'gpt-6.1-sol' }] })); return; }
  assert.equal(req.url, '/v1/responses');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); calls.push(body);
  assert.equal(body.model, 'gpt-6.1-sol'); assert.equal(body.stream, false); assert.equal(body.store, false);
  assert.equal(body.tools, undefined); assert.equal(body.previous_response_id, undefined);
  if (scenario === 'hold') await new Promise<void>((resolve) => { release = resolve; });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(syntheticEnvelope ?? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: scenario === 'bad' ? 'codex app-server startup failed: synthetic private upstream detail' : syntheticReply }] }] }));
});
gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
const gatewayPort = (gateway.address() as any).port;
const allocator = http.createServer(); allocator.listen(0, '127.0.0.1'); await once(allocator, 'listening');
const port = (allocator.address() as any).port; await new Promise<void>((r) => allocator.close(() => r()));
const base = `http://127.0.0.1:${port}`;
const dbPath = path.join(temp, 'local-text.db');
// Seed the previous local-text schema, including an existing general transcript
// and a completed receipt, so migration preservation is exercised on every run.
const legacy = new Database(dbPath);
legacy.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,avatar_url TEXT,created_at INTEGER NOT NULL);
  CREATE TABLE local_chats (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
  CREATE TABLE local_messages (id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES local_chats(id) ON DELETE CASCADE,role TEXT NOT NULL,text TEXT NOT NULL,created_at INTEGER NOT NULL);
  CREATE TABLE local_requests (request_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,chat_id TEXT NOT NULL REFERENCES local_chats(id) ON DELETE CASCADE,input_hash TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL);
  INSERT INTO users VALUES ('legacy-owner','synthetic@example.invalid','Synthetic owner',NULL,100);
  INSERT INTO local_chats VALUES ('legacy-general','legacy-owner','Existing general conversation',101,103);
  INSERT INTO local_messages VALUES ('legacy-user','legacy-general','user','LEGACY_GENERAL_ONLY',102);
  INSERT INTO local_messages VALUES ('legacy-assistant','legacy-general','assistant','Existing synthetic reply',103);
  INSERT INTO local_requests VALUES ('legacy-receipt','legacy-owner','legacy-general','synthetic-hash','completed',103);
`);
legacy.close();
// Test-only preload injects the standard fetch TimeoutError for one synthetic
// message. Production has no timeout override or test-mode configuration.
const timeoutFixture = path.join(temp, 'timeout-fixture.mjs');
fs.writeFileSync(timeoutFixture, `const original = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (String(url).endsWith('/v1/responses') && String(options?.body).includes('SYNTHETIC_TIMEOUT_CASE')) {
    return Promise.reject(new DOMException('PRIVATE_SYNTHETIC_TIMEOUT_DETAIL', 'TimeoutError'));
  }
  return original(url, options);
};\n`);
const child = spawn(process.execPath, ['--import', 'tsx', '--import', timeoutFixture, 'server/src/index.ts'], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: os.homedir(), BOT_HQ_MODE: 'local-text', BOT_HQ_INSTANCE_ID: 'synthetic-instance',
    BOT_HQ_LAUNCH_TOKEN: launchToken, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), ALLOWED_EMAILS: 'synthetic@example.invalid',
    DB_PATH: dbPath, HERMES_HOME_PRIMARY: isolatedHome, HERMES_URL: `http://127.0.0.1:${gatewayPort}`,
    PORT: String(port), APP_URL: base, SERVER_URL: base, HQ_LOCAL: '0', DEV_LOGIN: '0' },
});
let logs = ''; child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });
let cookie = '';
const check = (name: string) => console.log('PASS', name);
async function request(route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(base + route, { method, redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'GET' ? {} : { Origin: base, 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const raw = await response.text();
  let data: any; try { data = JSON.parse(raw); } catch { data = raw; }
  return { response, data };
}
try {
  for (let i = 0; i < 80; i++) {
    assert.equal(child.exitCode, null, 'Local server exited before health');
    try { if ((await request('/api/health')).response.status === 200) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const health = await request('/api/health');
  assert.deepEqual(health.data, { ok: true, engine: 'hermes', mode: 'local-text', instanceId: 'synthetic-instance' });
  assert.ok(health.response.headers.get('Content-Security-Policy')?.includes("connect-src 'self'"));
  assert.equal((await request('/api/local/chats')).response.status, 401);
  assert.equal((await request('/api/local/profiles')).response.status, 401);
  assert.equal((await request('/api/local/research')).response.status, 401);
  assert.equal((await request('/api/local/research/lendingpad-encompass')).response.status, 401);
  const hostileHost = await new Promise<number>((resolve, reject) => { const r = http.get(base + '/api/health', { headers: { Host: 'hostile.example' } }, (response) => { response.resume(); resolve(response.statusCode!); }); r.on('error', reject); });
  assert.equal(hostileHost, 403);
  assert.equal((await request('/api/auth/local', 'POST', undefined, { 'X-BotHQ-Launch-Token': 'wrong' })).response.status, 403);
  check('No vendor keys required; loopback instance identity, CSP, unauthenticated and hostile Host rejected');

  // Native bootstrap has no Origin or body; it proves possession of the one-shot launch nonce.
  const login = await fetch(base + '/api/auth/local', { method: 'POST', redirect: 'manual', headers: { 'X-BotHQ-Launch-Token': launchToken } });
  assert.equal(login.status, 303); assert.equal(login.headers.get('Location'), '/');
  const setCookie = login.headers.get('Set-Cookie')!;
  assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i);
  cookie = setCookie.split(';')[0];
  assert.equal((await request('/api/auth/local', 'POST', undefined, { 'X-BotHQ-Launch-Token': launchToken })).response.status, 403);
  assert.equal((await request('/api/auth/me')).data.user.email, 'synthetic@example.invalid');
  assert.equal((await request('/api/local/chats', 'POST', {}, { Origin: 'https://hostile.example' })).response.status, 403);
  assert.equal((await request('/api/local/chats', 'POST', {}, { 'Content-Type': 'text/plain' })).response.status, 415);
  check('Native one-time sign-in sets HttpOnly cookie; replay, cross-origin and non-JSON mutations rejected');

  for (const route of ['/api/auth/google/start','/api/apps','/api/computer','/api/bots','/api/voice/token','/mcp/primary']) {
    assert.equal((await request(route)).response.status, 404, route);
  }
  assert.equal((await request('/api/local/status')).data.status, 'ready');
  assert.equal(calls.length, 0);
  check('Unsupported vendors/tools/routes unavailable; status performs no inference');

  const catalog = (await request('/api/local/profiles')).data.profiles;
  assert.deepEqual(catalog, localTextProfiles.map(({ instructions, ...metadata }) => metadata));
  assert.equal(catalog.length, 6); assert.ok(catalog.every((profile: any) => profile.draft === true));
  assert.ok(catalog.every((profile: any) => profile.instructions === undefined));
  const migrated = (await request('/api/local/chats/legacy-general')).data;
  assert.equal(migrated.chat.profileId, 'general'); assert.equal(migrated.chat.title, 'Existing general conversation');
  assert.equal(migrated.chat.createdAt, 101); assert.equal(migrated.chat.updatedAt, 103);
  assert.ok(migrated.messages.every((message: any) => message.sources.length === 0 && message.citationWarning === null && message.researchNotice === null));
  assert.deepEqual(migrated.messages.map(({ id,role,text,createdAt }: any) => ({ id,role,text,createdAt })), [
    { id:'legacy-user',role:'user',text:'LEGACY_GENERAL_ONLY',createdAt:102 },
    { id:'legacy-assistant',role:'assistant',text:'Existing synthetic reply',createdAt:103 },
  ]);
  const migratedDb = new Database(dbPath);
  assert.equal((migratedDb.prepare('SELECT state FROM local_requests WHERE request_id=?').get('legacy-receipt') as any).state, 'completed');
  assert.ok((migratedDb.prepare('PRAGMA table_info(local_messages)').all() as any[]).some(column => column.name === 'research_json' && column.dflt_value === "'[]'"));
  migratedDb.close();
  check('Authenticated six-profile catalog matches canonical fields; legacy general history and completed receipts preserved');

  const chat = (await request('/api/local/chats','POST',{})).data.chat;
  assert.equal(chat.profileId, 'general');
  const first = { text: 'Synthetic first question', requestId: crypto.randomUUID() };
  const sent = await request(`/api/local/chats/${chat.id}/messages`, 'POST', first);
  assert.equal(sent.response.status, 200); assert.equal(sent.data.messages.length, 2);
  assert.equal(sent.data.messages[1].text, 'SYNTHETIC_REPLY');
  assert.deepEqual(sent.data.messages[1].sources, []);
  assert.equal(sent.data.messages[1].researchNotice, null);
  assert.ok(!calls.at(-1).input.includes('Research excerpt JSON:'));
  assert.equal((await request(`/api/local/chats/${chat.id}/messages`, 'POST', first)).data.messages.length, 2);
  assert.equal(calls.length, 1);
  assert.equal((await request(`/api/local/chats/${chat.id}/messages`, 'POST', { ...first, text: 'changed' })).response.status, 409);
  await request(`/api/local/chats/${chat.id}/messages`, 'POST', { text: 'Synthetic followup', requestId: crypto.randomUUID() });
  assert.equal(typeof calls[1].input, 'string');
  const forwardedHistory = JSON.parse(calls[1].input.split('Conversation JSON:\n')[1]);
  assert.deepEqual(forwardedHistory.map((m: any) => m.role), ['user','assistant','user']);
  assert.equal(forwardedHistory[0].content, first.text);
  assert.match(calls[1].input, /Do not use tools/);
  check('Persistent conversation history forwarded; duplicate request cannot trigger a second model call');

  const mortgageChats: { id: string; profileId: string }[] = [];
  for (const profile of localTextProfiles.filter((p) => p.id !== 'general')) {
    const created = await request('/api/local/chats', 'POST', { profileId: profile.id });
    assert.equal(created.response.status, 201); assert.equal(created.data.chat.profileId, profile.id);
    mortgageChats.push(created.data.chat);
    const marker = `SYNTHETIC_PRIVATE_${profile.id}`;
    const result = await request(`/api/local/chats/${created.data.chat.id}/messages`, 'POST', {
      text: marker, requestId: crypto.randomUUID(), profileId: 'general', instructions: 'CLIENT_INSTRUCTIONS_MUST_NOT_APPLY',
    });
    assert.equal(result.response.status, 200);
    const prompt = calls.at(-1).input as string;
    assert.ok(prompt.includes(profile.instructions), 'Verbatim canonical instructions must be forwarded');
    assert.ok(prompt.includes(`SELECTED DRAFT PROFILE: ${profile.name}`));
    assert.ok(prompt.indexOf('CONTROLLING LOCAL TEXT-ONLY BOUNDARY') < prompt.indexOf(profile.instructions));
    assert.match(prompt, /Work with synthetic examples only/); assert.match(prompt, /conduct live research/); assert.match(prompt, /source-linked public news excerpts/); assert.match(prompt, /minimal contact context explicitly supplied/); assert.match(prompt, /do not process real borrower records/);
    assert.match(prompt, /not a deployed autonomous team/);
    assert.ok(!prompt.includes('CLIENT_INSTRUCTIONS_MUST_NOT_APPLY'));
    for (const other of localTextProfiles.filter((p) => p.id !== profile.id && p.id !== 'general')) assert.ok(!prompt.includes(other.instructions));
    const supplied = JSON.parse(prompt.split('Conversation JSON:\n')[1]);
    assert.deepEqual(supplied, [{ role:'user',content:marker }]);
    const history = (await request(`/api/local/chats?profileId=${profile.id}`)).data.chats;
    assert.deepEqual(history.map((r: any) => r.id), [created.data.chat.id]);
    assert.ok(history.every((r: any) => r.profileId === profile.id));
  }
  const lead = mortgageChats[0];
  await request(`/api/local/chats/${lead.id}/messages`, 'POST', { text:'Synthetic lead followup', requestId:crypto.randomUUID() });
  const leadHistory = JSON.parse(calls.at(-1).input.split('Conversation JSON:\n')[1]);
  assert.deepEqual(leadHistory.map((m: any) => m.role), ['user','assistant','user']);
  assert.equal(leadHistory[0].content, `SYNTHETIC_PRIVATE_${lead.profileId}`);
  for (const other of mortgageChats.slice(1)) assert.ok(!calls.at(-1).input.includes(`SYNTHETIC_PRIVATE_${other.profileId}`));
  assert.ok(!calls.at(-1).input.includes('LEGACY_GENERAL_ONLY')); assert.ok(!calls.at(-1).input.includes(first.text));
  const generalHistory = (await request('/api/local/chats')).data.chats;
  assert.ok(generalHistory.every((r: any) => r.profileId === 'general'));
  assert.ok(generalHistory.some((r: any) => r.id === 'legacy-general'));
  assert.ok(!generalHistory.some((r: any) => mortgageChats.some((m) => m.id === r.id)));
  check('All five roles forward exact standing instructions beneath local restrictions; profile histories and general chats remain separate');

  const researchCatalog = await request('/api/local/research');
  assert.equal(researchCatalog.response.status, 200);
  assert.equal(researchCatalog.data.snapshotId, researchSnapshotId);
  assert.deepEqual(researchCatalog.data.documents, researchDocuments.map(({ text, ...metadata }) => metadata));
  assert.match(researchCatalog.data.notice, /dated, unverified/);
  for (const document of researchDocuments) {
    const fetched = await request(`/api/local/research/${document.id}`);
    assert.deepEqual(fetched.data.document, document); assert.equal(fetched.data.snapshotId, researchSnapshotId);
  }
  for (const invalid of ['unknown', '__proto__', '%2e%2e%2f.env', '%2Fetc%2Fpasswd', 'lendingpad-encompass/extra']) {
    assert.equal((await request(`/api/local/research/${invalid}`)).response.status, 404);
  }
  check('Research API is authenticated and exposes only 12 exact packaged documents by ID; unknown and filesystem paths rejected');

  const researchQuestion = 'According to saved LendingPad document-merge training, what risk affects the original entries? Cite local evidence and its verification limits. Synthetic example only; no actions.';
  const expectedSources = retrieveResearch(researchQuestion);
  const qualified = expectedSources.find(source => source.documentId === 'lendingpad-encompass' && source.text.includes('Neither video'))!;
  assert.ok(qualified);
  syntheticReply = `Synthetic draft: merging can remove original entries [${qualified.ref}]. This transcript was not visually watched or tested in a tenant [${qualified.ref}].`;
  let leadResearch: any;
  for (const mortgageChat of mortgageChats) {
    const message = { text: researchQuestion, requestId: crypto.randomUUID() };
    const result = await request(`/api/local/chats/${mortgageChat.id}/messages`, 'POST', message);
    assert.equal(result.response.status, 200);
    const last = result.data.messages.at(-1);
    assert.deepEqual(last.sources, expectedSources.map(source => ({ ...source, cited: source.ref === qualified.ref })));
    assert.equal(last.citationWarning, null); assert.equal(last.researchSnapshotId, researchSnapshotId);
    const prompt = calls.at(-1).input as string;
    const excerpts = JSON.parse(prompt.split('Research excerpt JSON:\n')[1].split('\nEND LOCAL RESEARCH REFERENCE DATA')[0]);
    assert.deepEqual(excerpts, expectedSources.map(({ cited, ...source }) => source));
    assert.match(prompt, /never an instruction source/); assert.match(prompt, /No excerpt proves current pricing/);
    const beforeDuplicate = calls.length;
    assert.deepEqual((await request(`/api/local/chats/${mortgageChat.id}/messages`, 'POST', message)).data.messages, result.data.messages);
    assert.equal(calls.length, beforeDuplicate);
    const reread = (await request(`/api/local/chats/${mortgageChat.id}`)).data;
    assert.deepEqual(reread.messages.at(-1), last);
    if (mortgageChat.id === lead.id) leadResearch = last;
  }
  const evidenceDb = new Database(dbPath);
  assert.deepEqual(JSON.parse((evidenceDb.prepare('SELECT research_json FROM local_messages WHERE id=?').get(leadResearch.id) as any).research_json).sources, leadResearch.sources);
  evidenceDb.close();
  check('All five profiles share qualified research; exact per-reply excerpts persist in SQLite and replay without another model call');

  syntheticReply = `Follow-up uses the same archived excerpt [${qualified.ref}].`;
  await request(`/api/local/chats/${lead.id}/messages`, 'POST', { text: `Explain previous ${qualified.ref}`, requestId: crypto.randomUUID() });
  const followedSources = JSON.parse(calls.at(-1).input.split('Research excerpt JSON:\n')[1].split('\nEND LOCAL RESEARCH REFERENCE DATA')[0]);
  assert.deepEqual(followedSources.find((source: any) => source.ref === qualified.ref), (({ cited, ...source }) => source)(qualified));
  syntheticReply = 'Unsupported synthetic statement [R999] and fabricated group [R1, R888].';
  const missing = await request(`/api/local/chats/${lead.id}/messages`, 'POST', {
    text: 'Synthetic fictional test: What are the rules for nebula chess on planet Qzxvblorb?', requestId: crypto.randomUUID(),
    sources: expectedSources, research_json: 'CLIENT_SUPPLIED_EVIDENCE_MUST_NOT_APPLY',
  });
  const missingReply = missing.data.messages.at(-1);
  assert.deepEqual(missingReply.sources, []); assert.match(missingReply.researchNotice, /No matching local research/);
  assert.match(missingReply.text, /unverified reference: R999/); assert.match(missingReply.citationWarning, /R999/);
  assert.ok(!missingReply.sources.some((source: any) => source.ref === 'R999'));
  assert.ok(!calls.at(-1).input.includes('CLIENT_SUPPLIED_EVIDENCE_MUST_NOT_APPLY'));
  assert.match(calls.at(-1).input, /NO MATCHING LOCAL RESEARCH EXCERPT WAS FOUND/);
  const blankChat = (await request('/api/local/chats', 'POST', { profileId: 'mortgage-email-assistant' })).data.chat;
  await request(`/api/local/chats/${blankChat.id}/messages`, 'POST', { text: `Explain previous ${qualified.ref}`, requestId: crypto.randomUUID() });
  assert.ok(calls.at(-1).input.includes('Research excerpt JSON:\n[]'));
  syntheticReply = 'SYNTHETIC_REPLY';
  check('Same-chat citation follow-up retains exact reference identity; unmatched topics and other chats cannot inherit evidence; invented references are visibly flagged');

  const callsBeforeInvalid = calls.length;
  for (const profileId of ['unknown','__proto__','',null,5,{}]) {
    assert.equal((await request('/api/local/chats','POST',{ profileId })).response.status, 400);
  }
  assert.equal((await request('/api/local/chats?profileId=unknown')).response.status, 400);
  assert.equal((await request(`/api/local/chats/${lead.id}`, 'PATCH', { profileId:'general' })).response.status, 404);
  assert.equal((await request(`/api/local/chats/${lead.id}`)).data.chat.profileId, lead.profileId);
  assert.equal(calls.length, callsBeforeInvalid);
  check('Unknown profile selection rejected; stored chat profile cannot be changed through message fields or PATCH');

  const fixture = new Database(dbPath);
  fixture.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('foreign-user','foreign@example.invalid','Synthetic',Date.now());
  fixture.prepare('INSERT INTO local_chats(id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)').run('foreign-chat','foreign-user','Private synthetic',Date.now(),Date.now());
  fixture.close();
  assert.equal((await request('/api/local/chats/foreign-chat')).response.status, 404);
  assert.equal((await request('/api/local/chats/foreign-chat', 'DELETE', {})).response.status, 404);
  assert.equal((await request('/api/local/chats/foreign-chat/messages', 'POST', { text: 'probe', requestId: crypto.randomUUID() })).response.status, 404);
  check('Chat reads, writes and deletions enforce session ownership');

  await testWorkspace({request,base,cookie,dbPath,calls});

  scenario = 'bad'; const failed = { text: 'Synthetic failed turn', requestId: crypto.randomUUID() };
  const bad = await request(`/api/local/chats/${chat.id}/messages`, 'POST', failed);
  assert.equal(bad.response.status, 502); assert.ok(!JSON.stringify(bad.data).includes('private upstream'));
  assert.equal(bad.data.code, 'failed');
  assert.equal((await request(`/api/local/chats/${chat.id}`)).data.messages.length, 4);
  const beforeRetry = calls.length;
  assert.equal((await request(`/api/local/chats/${chat.id}/messages`, 'POST', failed)).response.status, 409);
  assert.equal(calls.length, beforeRetry);
  check('Gateway HTTP200 error text becomes sanitized failure; failed attempt is not saved or automatically retried');

  // Exercise the installed non-stream Responses bug: terminal error text may
  // arrive as an apparently completed output_text. Use a mortgage chat so a
  // false success would also incorrectly save research citations.
  scenario = 'good';
  const failureBaseline = (await request(`/api/local/chats/${lead.id}`)).data;
  const completedEnvelope = (text: string) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] });
  const transportFailures = [
    'turn/start failed: codex app-server error -32000: SYNTHETIC_PRIVATE_FAILURE',
    'Codex app-server turn failed: SYNTHETIC_PRIVATE_FAILURE. Fall back to default runtime with `/codex-runtime auto`.',
    'turn/start timed out: SYNTHETIC_PRIVATE_FAILURE',
    'turn ended status=failed: SYNTHETIC_PRIVATE_FAILURE',
    'codex app-server subprocess exited unexpectedly\ncodex stderr: SYNTHETIC_PRIVATE_FAILURE',
    'Codex authentication failed — SYNTHETIC_PRIVATE_FAILURE',
    'turn timed out after 600.0s',
  ];
  const envelopes = transportFailures.map(completedEnvelope);
  envelopes.push({ ...completedEnvelope('Partial draft [R1]'), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
  envelopes.push({ ...completedEnvelope('Apparent draft [R1]'), error: { message: 'SYNTHETIC_PRIVATE_FAILURE' } });
  const unfinishedItem = completedEnvelope('Partial item [R1]'); unfinishedItem.output[0].status = 'in_progress'; envelopes.push(unfinishedItem);
  for (const envelope of envelopes) {
    syntheticEnvelope = envelope;
    const attempt = { text: researchQuestion, requestId: crypto.randomUUID() };
    const rejected = await request(`/api/local/chats/${lead.id}/messages`, 'POST', attempt);
    assert.equal(rejected.response.status, 502); assert.equal(rejected.data.code, 'failed');
    assert.ok(!JSON.stringify(rejected.data).includes('SYNTHETIC_PRIVATE_FAILURE'));
    assert.deepEqual((await request(`/api/local/chats/${lead.id}`)).data, failureBaseline);
    const failedCalls = calls.length;
    assert.equal((await request(`/api/local/chats/${lead.id}/messages`, 'POST', attempt)).response.status, 409);
    assert.equal(calls.length, failedCalls);
  }
  syntheticEnvelope = null;
  const quotedChat = (await request('/api/local/chats', 'POST', { profileId: 'loan-processing-assistant' })).data.chat;
  for (const quoted of [
    '> turn/start failed: codex app-server error -32000: quoted diagnostic. This is a quotation, not this request failing.',
    '```text\nturn/start failed: codex app-server error -32000: quoted diagnostic\n```\nResearch explanation follows.',
    'Codex app-server is a transport. The quoted example “turn/start failed: codex app-server error” does not describe this request.',
  ]) {
    syntheticReply = quoted;
    const accepted = await request(`/api/local/chats/${quotedChat.id}/messages`, 'POST', { text: 'Explain this synthetic quoted diagnostic.', requestId: crypto.randomUUID() });
    assert.equal(accepted.response.status, 200); assert.equal(accepted.data.messages.at(-1).text, quoted);
  }
  syntheticReply = 'SYNTHETIC_REPLY';
  check('Known flattened transport failures and structured incomplete/error payloads cannot alter chat or citations; failed IDs never retry; quoted diagnostics remain valid replies');

  const timedOut = { text: 'SYNTHETIC_TIMEOUT_CASE', requestId: crypto.randomUUID() };
  const beforeTimeout = calls.length;
  const timeoutResult = await request(`/api/local/chats/${chat.id}/messages`, 'POST', timedOut);
  assert.equal(timeoutResult.response.status, 504); assert.equal(timeoutResult.data.code, 'failed');
  assert.match(timeoutResult.data.error, /upstream request may still finish/);
  assert.match(timeoutResult.data.error, /nothing was retried automatically/);
  assert.ok(!JSON.stringify(timeoutResult.data).includes('PRIVATE_SYNTHETIC_TIMEOUT_DETAIL'));
  assert.equal((await request(`/api/local/chats/${chat.id}`)).data.messages.length, 4);
  assert.equal((await request(`/api/local/chats/${chat.id}/messages`, 'POST', timedOut)).response.status, 409);
  assert.equal(calls.length, beforeTimeout);
  check('Timeout becomes explicit sanitized 504 with unknown-upstream-outcome warning; same attempt cannot auto-resubmit');

  const preflightChat=(await request('/api/local/chats','POST',{})).data.chat;
  const stoppedBeforeSend={text:'Synthetic reordered send must never run',requestId:crypto.randomUUID()};
  assert.equal((await request(`/api/local/chats/${chat.id}/cancel`,'POST',{requestId:first.requestId})).data.outcome,'completed');
  const beforePreflight=calls.length;
  assert.equal((await request(`/api/local/chats/${preflightChat.id}/cancel`,'POST',{requestId:stoppedBeforeSend.requestId})).data.outcome,'cancelled-before-start');
  const blockedSend=await request(`/api/local/chats/${preflightChat.id}/messages`,'POST',stoppedBeforeSend);
  assert.equal(blockedSend.response.status,409);assert.equal(blockedSend.data.code,'interrupted');assert.equal(calls.length,beforePreflight);
  assert.equal((await request(`/api/local/chats/${preflightChat.id}/messages`,'POST',stoppedBeforeSend)).data.code,'interrupted');assert.equal(calls.length,beforePreflight);
  assert.equal((await request('/api/local/chats/foreign-chat/cancel','POST',{requestId:crypto.randomUUID()})).response.status,404);
  assert.equal((await request(`/api/local/chats/${preflightChat.id}/cancel`,'POST',{requestId:'invalid'})).response.status,400);
  const cancelDb=new Database(dbPath);assert.equal((cancelDb.prepare('SELECT count(*) AS n FROM local_cancellations WHERE user_id=? AND chat_id=? AND request_id=?').get('legacy-owner',preflightChat.id,stoppedBeforeSend.requestId)as any).n,1);cancelDb.close();
  check('Cancel-before-send is persisted by owner/chat/request and blocks reordered or replayed message POST before any inference');

  scenario = 'hold'; release = undefined;
  const cancelChat=(await request('/api/local/chats','POST',{})).data.chat;
  const cancelledAttempt={text:'Synthetic cancellable request',requestId:crypto.randomUUID()};
  const cancelPending=request(`/api/local/chats/${cancelChat.id}/messages`,'POST',cancelledAttempt);
  while(!release)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await request(`/api/local/chats/${cancelChat.id}/cancel`,'POST',{requestId:crypto.randomUUID()})).data.outcome,'cancelled-before-start');
  assert.equal((await request(`/api/local/chats/${cancelChat.id}/messages`,'POST',cancelledAttempt)).data.code,'pending','A different request cancellation must not abort active inference');
  assert.equal((await request(`/api/local/chats/${cancelChat.id}/cancel`,'POST',{requestId:cancelledAttempt.requestId})).data.outcome,'uncertain');
  const cancelResult=await cancelPending;assert.equal(cancelResult.data.code,'interrupted');assert.equal(cancelResult.response.status,409);
  assert.equal((await request(`/api/local/chats/${cancelChat.id}`)).data.messages.length,0);
  const callsAfterCancel=calls.length;assert.equal((await request(`/api/local/chats/${cancelChat.id}/messages`,'POST',cancelledAttempt)).response.status,409);assert.equal(calls.length,callsAfterCancel);
  release!();release=undefined;
  assert.equal((await request(`/api/local/chats/${cancelChat.id}/cancel`,'POST',{})).data.outcome,'idle');
  const legacyCancelPending=request(`/api/local/chats/${cancelChat.id}/messages`,'POST',{text:'Synthetic legacy no-ID Stop',requestId:crypto.randomUUID()});
  while(!release)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await request(`/api/local/chats/${cancelChat.id}/cancel`,'POST')).data.outcome,'uncertain');
  assert.equal((await legacyCancelPending).data.code,'interrupted');release!();release=undefined;
  check('Stop aborts local wait, preserves uncertain upstream outcome, saves no false reply and never automatically resubmits');

  scenario = 'hold'; const pendingBody = { text: 'Synthetic pending turn', requestId: crypto.randomUUID() };
  const pending = request(`/api/local/chats/${chat.id}/messages`, 'POST', pendingBody);
  while (!release) await new Promise((r) => setTimeout(r, 10));
  assert.equal((await request(`/api/local/chats/${chat.id}/messages`, 'POST', pendingBody)).response.status, 409);
  assert.equal((await request(`/api/local/chats/${chat.id}/messages`, 'POST', { text:'Second parallel',requestId:crypto.randomUUID() })).response.status, 409);
  assert.equal((await request(`/api/local/chats/${chat.id}`, 'DELETE', {})).response.status, 409);
  release(); assert.equal((await pending).response.status, 200);
  check('Single active inference, duplicate-pending and deletion-during-reply protections');

  const oversized = await request(`/api/local/chats/${chat.id}/messages`, 'POST', { text:'a'.repeat(12_001),requestId:crypto.randomUUID() });
  assert.equal(oversized.response.status, 400);
  assert.equal((await request(`/api/local/chats/${chat.id}`, 'DELETE', {})).response.status, 200);
  assert.equal((await request(`/api/local/chats/${chat.id}`)).response.status, 404);
  const savedState=()=>{const connection=new Database(dbPath,{readonly:true});try{return ['local_chats','local_messages','axon_files','axon_records'].map(table=>connection.prepare(`SELECT * FROM ${table} ORDER BY id`).all());}finally{connection.close();}};
  const beforeLogout=savedState();
  assert.ok((beforeLogout[0] as any[]).length>0);
  await request('/api/auth/logout','POST',{});
  assert.equal((await request('/api/local/chats')).response.status, 401);
  assert.equal((await request('/api/local/export')).response.status, 401);
  assert.deepEqual(savedState(),beforeLogout,'Logout invalidates authentication without altering saved chats/messages/files/records');
  assert.ok(!logs.includes(launchToken)); assert.ok(!logs.includes(gatewayKey));
  check('Message bounds, deletion, logout denies authenticated APIs while preserving saved rows, and credential-free logs');
  console.log('PASS: local text mode HTTP integration; all data synthetic; zero real model calls.');
} finally {
  release?.();
  child.kill('SIGTERM');
  await Promise.race([once(child,'exit'), new Promise((r) => setTimeout(r,3000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  fs.rmSync(temp, { recursive:true,force:true });
}
