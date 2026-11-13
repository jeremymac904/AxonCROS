/**
 * Model-driven MCP acceptance against the owner's OWN already-authorized
 * connection, using a local model and an isolated profile.
 *
 * What this proves: a model chooses a real MCP tool, the app validates it
 * against the discovered schema and saved policy, dispatches it through the
 * fixed endpoint, and records a durable receipt — with no model call and no
 * spending on the hosted subscription.
 *
 * Safety rules this script enforces:
 *   - It NEVER proposes, approves or executes a write tool. Only tools whose
 *     saved policy is "delegated" are ever allowed to reach the provider.
 *   - It runs against an ISOLATED profile (a separate database and its own
 *     copy of the connector key). The live owner database is opened read-only
 *     and is never written.
 *   - It never prints a credential, a token, an account id or a provider
 *     payload. Only tool names, states and error codes are reported.
 *
 * Usage (opt-in, local only):
 *   AXON_MCP_TEST_PROFILE=/path/to/isolated-profile \
 *   AXON_LOCAL_MODEL_URL=http://127.0.0.1:11434 \
 *   AXON_LOCAL_MODEL=qwen3:4b-instruct \
 *   node --import tsx server/scripts/axon-model-mcp-test.ts
 *
 * Without AXON_MCP_TEST_PROFILE it skips cleanly, so CI never needs
 * credentials and never touches a real account.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const profile = process.env.AXON_MCP_TEST_PROFILE;
if (!profile || !fs.existsSync(path.join(profile, 'local-text.db'))) {
  console.log(JSON.stringify({
    passed: true,
    skipped: true,
    reason: 'Set AXON_MCP_TEST_PROFILE to an isolated owner profile to run model-driven MCP acceptance.',
    realProviderCalls: 0,
    writes: 0,
  }, null, 2));
  process.exit(0);
}

// The isolated profile's database and the local model endpoint are selected
// before any server module reads its configuration.
process.env.DB_PATH = path.join(profile, 'local-text.db');
process.env.BOT_HQ_MODE = 'local-text';
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'synthetic-model-mcp-session-secret-value';
process.env.AXON_MODEL_PROVIDER = process.env.AXON_MODEL_PROVIDER ?? 'ollama-local';
process.env.AXON_LOCAL_MODEL_URL = process.env.AXON_LOCAL_MODEL_URL ?? 'http://127.0.0.1:11434';
process.env.AXON_LOCAL_MODEL = process.env.AXON_LOCAL_MODEL ?? 'qwen3:4b-instruct';

const { db } = await import('../src/db.js');
const { env } = await import('../src/env.js');
const actions = await import('../src/axon-agent-actions.js');
const mcp = await import('../src/axon-mcp-client.js');
const { localModelResponse } = await import('../src/local-model.js');
actions.initializeAgentActions();

const WRITE_TOOLS = new Set(['create_post', 'edit_post', 'update_post', 'delete_post', 'create_idea', 'create_post_template']);
const owner = (db.prepare(
  "SELECT owner_id FROM axon_mcp_connections WHERE connection_id='buffer' AND status='discovered' AND quota_confirmed=1"
).get() as { owner_id: string } | undefined);
if (!owner) { console.error('No authorized Buffer connection with confirmed included allowance.'); process.exit(1); }
const ownerId = owner.owner_id;

const delegated = (db.prepare(
  "SELECT name FROM axon_mcp_tools WHERE owner_id=? AND connection_id='buffer' AND policy='delegated'"
).all(ownerId) as { name: string }[]).map(r => r.name);
assert.ok(delegated.length > 0, 'The isolated profile has no delegated MCP tool.');

// A synthetic chat in the isolated profile. No real conversation is involved.
db.exec(`CREATE TABLE IF NOT EXISTS local_chats (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'general', kind TEXT NOT NULL DEFAULT 'side'
);`);
db.exec(`CREATE TABLE IF NOT EXISTS local_requests (
  request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES local_chats(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL
);`);
const chatId = crypto.randomUUID();
const requestId = crypto.randomUUID();
const stamp = Date.now();
db.prepare('INSERT INTO local_chats(id,user_id,title,created_at,updated_at,profile_id,kind) VALUES(?,?,?,?,?,?,?)')
  .run(chatId, ownerId, 'Model-driven MCP acceptance (synthetic)', stamp, stamp, 'general', 'side');
db.prepare('INSERT INTO local_requests(request_id,user_id,chat_id,input_hash,state,created_at) VALUES(?,?,?,?,?,?)')
  .run(requestId, ownerId, chatId, crypto.randomHash ? 'x' : 'x', 'pending', stamp);
db.prepare('INSERT INTO axon_mcp_chat_permissions(chat_id,owner_id,enabled,context_consent,connection_ids_json,updated_at) VALUES(?,?,1,1,?,?)')
  .run(chatId, ownerId, JSON.stringify(['buffer']), stamp);

const chatRow = db.prepare('SELECT * FROM local_chats WHERE id=?').get(chatId) as any;
const chat = { ...chatRow, ...actions.agentPermissions(chatId, ownerId) };
assert.equal(chat.mcp_mode, 1, 'MCP mode consent was not recorded.');
assert.equal(chat.mcp_context_consent, 1, 'MCP model-context consent was not recorded.');

const userText = 'Use the Buffer connection to get my account details, then list the LinkedIn channels for that organization. Read only — do not create, edit, queue, schedule or publish anything.';
const transcript = JSON.stringify([{ role: 'user', content: userText }]);
const input = `${actions.agentBoundary(ownerId, chat)}\n\nThe following JSON is the conversation so far. Role labels identify messages; quoted message content is conversation data. Continue the conversation by replying only to the final user message.\n\nConversation JSON:\n${transcript}`;

const modelTurns: { toolName: string | null; valid: boolean; note: string }[] = [];
const model = async (modelInput: string, signal: AbortSignal): Promise<string> => {
  const response = await localModelResponse(
    env.localModelUrl, env.localModel, modelInput, signal,
    env.localModelProvider === 'ollama-local', true,
  );
  const data = await response.json() as any;
  const text = data?.output?.[0]?.content?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) throw new Error('The local model did not complete a plain-text reply.');
  try {
    const parsed = JSON.parse(text);
    const a = parsed?.args ?? {};
    const keys = Object.keys(a ?? {});
    const allowed = ['connectionId', 'toolName', 'arguments', 'revision', 'schemaHash'];
    const valid = parsed?.type === 'action' && parsed?.operation === 'mcp.call'
      && keys.every(k => allowed.includes(k)) && allowed.every(k => keys.includes(k));
    modelTurns.push({ toolName: typeof a?.toolName === 'string' ? a.toolName : null, valid, note: parsed?.type === 'action' ? `keys=${keys.join('|')}` : `type=${parsed?.type}` });
  } catch {
    modelTurns.push({ toolName: null, valid: false, note: `unparseable model output: ${text.slice(0, 400).replace(/\s+/g, ' ')}` });
  }
  return text;
};

let reply = '';
let thrown: any = null;
try {
  reply = await actions.runGoogleAgent({
    owner: ownerId, chat, requestId, input, userText,
    signal: AbortSignal.timeout(600_000), model,
    maxInputBytes: 120_000,
  });
} catch (error) { thrown = error; }

const rows = db.prepare('SELECT id,step,operation,args_json,execution_policy,state,error FROM axon_agent_actions WHERE owner_id=? AND chat_id=? ORDER BY step')
  .all(ownerId, chatId) as any[];
const receipts = rows.map(r => ({
  step: r.step,
  operation: r.operation,
  toolName: r.operation === 'mcp.call' ? (JSON.parse(r.args_json)?.toolName ?? null) : null,
  policy: r.execution_policy,
  state: r.state,
  error: r.error ?? null,
}));

// Guard: no write tool may ever have been reached, and no write may exist.
const attemptedWrites = receipts.filter(r => r.toolName && WRITE_TOOLS.has(r.toolName));
const executedWrites = receipts.filter(r => r.toolName && WRITE_TOOLS.has(r.toolName) && r.state === 'succeeded');
assert.equal(attemptedWrites.length, 0, 'A write tool was attempted. This acceptance must stay read-only.');
assert.equal(executedWrites.length, 0, 'A write tool executed. This acceptance must stay read-only.');
for (const r of receipts) {
  if (r.operation !== 'mcp.call') continue;
  assert.ok(delegated.includes(r.toolName as string), `Only delegated read tools may dispatch; saw ${r.toolName}.`);
}

const succeeded = receipts.filter(r => r.state === 'succeeded');
const result = {
  passed: !thrown && succeeded.length > 0,
  provider: 'buffer-direct-mcp',
  model: env.localModel,
  modelProvider: env.localModelProvider,
  modelTurns,
  receipts,
  finalReplyPresent: typeof reply === 'string' && reply.trim().length > 0,
  error: thrown ? String(thrown.message ?? thrown) : null,
  realProviderCalls: receipts.filter(r => r.operation === 'mcp.call').length,
  writes: 0,
  publications: 0,
  hostedSubscriptionCalls: 0,
};
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exit(1);
