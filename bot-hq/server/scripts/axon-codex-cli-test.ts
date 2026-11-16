/** End-to-end check for a directly configured model route.
 *
 * Boots the real local server with the selected provider and drives it the way
 * a person would: read the status, ask a question, and (when the route is
 * usable) run one agent turn.
 *
 * The Codex CLI route signs in with the owner's own ChatGPT account; this
 * script never reads a token. The OpenRouter route is metered and must fail
 * honestly when no key is configured.
 *
 * Usage:
 *   AXON_TEST_PROVIDER=codex-cli \
 *   AXON_TEST_MODEL=gpt-6.1-sol \
 *   AXON_CODEX_CLI_BIN=/path/to/codex \
 *   AXON_CODEX_CLI_HOME=~/.codex \
 *   node --import tsx server/scripts/axon-codex-cli-test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

if (!process.env.AXON_TEST_PROVIDER) {
  console.log(JSON.stringify({
    passed: true, skipped: true,
    reason: 'Set AXON_TEST_PROVIDER and the settings of the route to exercise it. This test needs a real provider, so it skips in continuous integration.',
  }, null, 2));
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-route-test-'));
const dbPath = path.join(tmp, 'workspace.db');
const supportDir = path.join(tmp, 'support');
fs.mkdirSync(path.join(supportDir, 'data'), { recursive: true, mode: 0o700 });

const provider = process.env.AXON_TEST_PROVIDER ?? 'codex-cli';
const model = process.env.AXON_TEST_MODEL ?? '';
const token = crypto.randomBytes(32).toString('hex');
const port = 40000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const home = path.join(tmp, 'home');
fs.mkdirSync(home, { recursive: true });

const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    PATH: process.env.PATH, HOME: home,
    BOT_HQ_MODE: 'local-text',
    AXON_MODEL_PROVIDER: provider,
    AXON_CODEX_CLI_BIN: provider === 'codex-cli' ? (process.env.AXON_CODEX_CLI_BIN ?? '') : '',
    AXON_CODEX_CLI_HOME: provider === 'codex-cli' ? (process.env.AXON_CODEX_CLI_HOME ?? '') : '',
    AXON_CODEX_CLI_MODEL: provider === 'codex-cli' ? model : '',
    AXON_OPENROUTER_MODEL: provider === 'openrouter' ? model : '',
    AXON_OPENROUTER_KEY_FILE: provider === 'openrouter' ? (process.env.AXON_OPENROUTER_KEY_FILE ?? '') : '',
    DB_PATH: dbPath, PORT: String(port), APP_URL: base, SERVER_URL: base,
    SESSION_SECRET: 'synthetic-route-test-session-secret-value',
    ALLOWED_EMAILS: 'synthetic@example.invalid',
    BOT_HQ_LAUNCH_TOKEN: token,
  },
});
let logs = '';
child.stdout!.on('data', b => { logs += b; });
child.stderr!.on('data', b => { logs += b; });

let cookie = '';
try {
  for (let i = 0; i < 150; i++) {
    assert.equal(child.exitCode, null, logs);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  const health = await (await fetch(`${base}/api/health`)).json() as any;
  assert.equal(health.engine, provider, 'The health endpoint must report the selected provider.');
  assert.equal(health.mode, 'local-text');

  const auth = await fetch(`${base}/api/auth/local`, { method: 'POST', redirect: 'manual', headers: { 'X-BotHQ-Launch-Token': token } });
  assert.equal(auth.status, 303);
  cookie = auth.headers.get('set-cookie')!.split(';')[0];

  const status = await (await fetch(`${base}/api/local/status`, { headers: { Cookie: cookie } })).json() as any;
  assert.ok(status.status === 'ready' || status.status === 'unavailable', 'The status endpoint must report a provider state.');
  console.log(JSON.stringify({ provider, model: status.model, status: status.status, metered: status.metered ?? false, message: status.message }, null, 2));

  const chat = await (await fetch(`${base}/api/local/chats`, {
    method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: 'general' }),
  })).json() as any;
  assert.ok(chat.chat?.id, 'A chat was not created.');

  const reply = await (await fetch(`${base}/api/local/chats/${chat.chat.id}/messages`, {
    method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Reply with exactly the word: route-ok', requestId: crypto.randomUUID() }),
  })).json() as any;
  const text = reply?.messages?.[1]?.text ?? '';
  console.log('  reply:', text.slice(0, 200), '| error:', reply?.error ?? null);

  if (reply?.error) {
    // A route that cannot serve a turn must say why and save no reply.
    assert.equal(text, '', 'A reply was saved even though the provider refused the turn.');
    assert.ok(String(reply.error).length > 20, 'The provider failure was not explained.');
    console.log(`PASS ${provider} route failed honestly: ${String(reply.error).slice(0, 120)}`);
  } else if (status.status !== 'ready') {
    assert.ok(/key|OpenRouter key/i.test(String(reply?.error ?? '')), `The missing key was not explained: ${reply?.error}`);
    assert.equal(text, '', 'A reply was saved even though the route was unavailable.');
    console.log(`PASS ${provider} route reported unavailable with an honest reason and saved no reply`);
  } else {
    assert.ok(text.length > 0, 'The provider returned no reply.');
    assert.ok(/route-ok/i.test(text), `The reply did not contain the expected word: ${text.slice(0, 200)}`);
    console.log(`PASS ${provider} route answered a real message`);

    // The agent turn must produce the app's strict action protocol. The action
    // then waits for a native executor that a headless test server does not
    // have, so the check is that a valid action was planned and queued.
    const agentMode = await (await fetch(`${base}/api/local/chats/${chat.chat.id}/agent-mode`, {
      method: 'PATCH', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, contextConsent: true, executionPolicy: 'review-writes' }),
    })).json() as any;
    assert.equal(agentMode.chat?.agentMode, true, 'Agent mode was not enabled.');

    const agentTurn = fetch(`${base}/api/local/chats/${chat.chat.id}/messages`, {
      method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'List my Gmail messages. Do not send anything.', requestId: crypto.randomUUID() }),
    });
    let planned: any = null;
    for (let i = 0; i < 160 && !planned; i++) {
      const history = await (await fetch(`${base}/api/local/chats/${chat.chat.id}/agent-actions`, { headers: { Cookie: cookie } })).json() as any;
      planned = (history?.actions ?? [])[0] ?? null;
      if (!planned) await new Promise(r => setTimeout(r, 250));
    }
    assert.ok(planned, 'The agent turn planned no action.');
    assert.ok(typeof planned.operation === 'string' && planned.operation.length > 0, 'The planned action has no operation.');
    console.log('  planned action:', planned.operation, '| state:', planned.state, '| policy:', planned.executionPolicy);
    assert.ok(/^gmail\.|^drive\.|^calendar\.|^contacts\.|^sheets\./.test(planned.operation), `Unexpected operation: ${planned.operation}`);
    await fetch(`${base}/api/local/chats/${chat.chat.id}/cancel`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
    await agentTurn.catch(() => undefined);
    console.log(`PASS ${provider} route answered a real agent turn with a valid planned action`);
  }
} catch (error) {
  console.error('FAIL', String(error), '\n--- server log ---\n', logs.slice(-2000));
  process.exitCode = 1;
} finally {
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  await new Promise(r => setTimeout(r, 300));
  fs.rmSync(tmp, { recursive: true, force: true });
}
