#!/usr/bin/env node
// First-run only. Never imports a prior owner's account, gateway, or secrets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function setupLocal(support = path.join(os.homedir(), 'Library/Application Support/Bot HQ')) {
  support = path.resolve(support);
  const config = path.join(support, '.env');
  // An existing installation owns its settings; even a malformed file is preserved.
  if (fs.existsSync(config)) return {created:false, support};
  let ancestor = support;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor,support));
  const mainPath = path.join(os.homedir(), '.hermes');
  const main = fs.existsSync(mainPath) ? fs.realpathSync(mainPath) : mainPath;
  if (resolved === main || resolved.startsWith(main + path.sep)) throw new Error('Setup cannot write in main Hermes.');
  fs.mkdirSync(support,{recursive:true,mode:0o700});
  fs.mkdirSync(path.join(support,'data'),{recursive:true,mode:0o700});
  const text = [
    '# AxonCROS local-first installation. Private; never commit or share this file.',
    'BOT_HQ_MODE=local-text', 'AXON_MODEL_PROVIDER=ollama-local',
    'AXON_LOCAL_MODEL_URL=http://127.0.0.1:11434', 'AXON_LOCAL_MODEL=qwen3:4b-instruct',
    'PORT=8787', 'APP_URL=http://127.0.0.1:8787', 'SERVER_URL=http://127.0.0.1:8787',
    `SESSION_SECRET=${crypto.randomBytes(48).toString('hex')}`, 'ALLOWED_EMAILS=local@axoncros.local',
    `DB_PATH=${JSON.stringify(path.join(support,'data/local-text.db'))}`,
    'DEV_LOGIN=0', 'GROKBOT_NO_SCHEDULER=1', '',
  ].join('\n');
  try { fs.writeFileSync(config,text,{flag:'wx',mode:0o600}); }
  catch(error) { if(error.code === 'EEXIST') return {created:false,support}; throw error; }
  return {created:true,support};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--support' || !path.isAbsolute(args[1]))) {
    console.error('Usage: node script/setup-local.mjs [--support /absolute/private/folder]'); process.exit(2);
  }
  try {
    const result = setupLocal(args[1]);
    console.log(result.created ? 'Created private local-model configuration. Start Ollama and download qwen3:4b-instruct to enable chat.' : 'Preserved existing configuration.');
  } catch { console.error('Local setup failed. Check the destination and permissions; no existing configuration was replaced.'); process.exit(1); }
}
