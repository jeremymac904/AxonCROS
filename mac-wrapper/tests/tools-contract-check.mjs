/** Cross-check the native tool-detection contract against the web that reads it.
 * The Swift side builds the dictionary; the TypeScript side reads it. A key
 * renamed on one side would silently show an empty field in the app.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.AXON_REPO_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const discovery = read('mac-wrapper/Sources/BotHQ/NativeToolDiscovery.swift');
const bridge = read('mac-wrapper/Sources/BotHQ/NativeBridge.swift');
const ts = read('bot-hq/web/src/components/AxonDetectedTools.tsx');

const block = discovery.slice(discovery.indexOf('var dictionary: [String: Any] {'), discovery.indexOf('return out', discovery.indexOf('var dictionary: [String: Any] {')));
const produced = new Set([
  ...[...block.matchAll(/"(\w+)":/g)].map(m => m[1]),       // "key": value
  ...[...block.matchAll(/out\["(\w+)"\]/g)].map(m => m[1]), // out["key"] = value
]);
const consumed = new Set([...ts.matchAll(/tool\.(\w+)/g)].map(m => m[1]));
const missing = [...consumed].filter(k => !produced.has(k));

const checks = [
  { ok: produced.has('id'), what: 'the native side produces an id' },
  { ok: produced.has('name'), what: 'the native side produces a name' },
  { ok: produced.has('path'), what: 'the native side produces a path' },
  { ok: produced.has('version'), what: 'the native side produces a version' },
  { ok: produced.has('role'), what: 'the native side produces a role' },
  { ok: produced.has('route'), what: 'the native side produces a route' },
  { ok: missing.length === 0, what: `the web reads no key the native side does not produce${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}` },
  { ok: /case "detectTools"/.test(bridge), what: 'the bridge exposes detectTools' },
  { ok: /NativeToolDiscovery\.detect\(\)\.map/.test(bridge), what: 'detectTools returns the detected tools' },
  { ok: /replyHandler\(\["tools"/.test(bridge), what: 'detectTools replies with a tools array' },
  { ok: /case "selectModelRoute"/.test(bridge), what: 'the bridge exposes selectModelRoute' },
  { ok: /NativeToolDiscovery\.writeModelRoute/.test(bridge), what: 'selectModelRoute writes through the tested writer' },
  { ok: /nativeRequest\('detectTools'\)/.test(ts), what: 'the web asks the bridge for detectTools' },
  { ok: /nativeRequest\('selectModelRoute', \{ toolId: tool\.id \}\)/.test(ts), what: 'the web selects a route by tool id' },
];
let failed = 0;
for (const c of checks) { if (!c.ok) failed++; console.log(`${c.ok ? 'PASS' : 'FAIL'}: ${c.what}`); }
console.log(`\nnative keys produced: ${[...produced].sort().join(', ')}`);
console.log(`web keys consumed:   ${[...consumed].sort().join(', ')}`);
process.exit(failed ? 1 : 0);
