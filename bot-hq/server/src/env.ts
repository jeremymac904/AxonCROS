import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** A secret from NAME, or from the file named by NAME_FILE (so keys need not sit in .env). */
function secret(name: string): string {
  const direct = process.env[name];
  if (direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, 'utf8').trim();
  throw new Error(`Missing env ${name} (or ${name}_FILE)`);
}

const mode = process.env.BOT_HQ_MODE ?? 'full';
if (!['full', 'local-text'].includes(mode)) throw new Error('BOT_HQ_MODE must be full or local-text');
const localTextMode = mode === 'local-text';
const localModelProvider = process.env.AXON_MODEL_PROVIDER ?? 'hermes';
if (!['hermes', 'ollama-local', 'openai-local', 'codex-cli', 'openrouter', 'minimax'].includes(localModelProvider)) throw new Error('AXON_MODEL_PROVIDER must be hermes, ollama-local, openai-local, codex-cli, openrouter or minimax');

const hermesHome = process.env.HERMES_HOME_PRIMARY ?? path.join(os.homedir(), '.hermes');
/** Owner-private application directory, beside the database. */
const supportDir = path.dirname(path.dirname(path.resolve(process.env.DB_PATH ?? path.join(os.homedir(), 'Library/Application Support/Bot HQ/data/local-text.db'))));

export const env = {
  localTextMode,
  localModelProvider,
  localModelUrl: process.env.AXON_LOCAL_MODEL_URL ?? 'http://127.0.0.1:11434',
  localModel: process.env.AXON_LOCAL_MODEL ?? 'qwen3:4b-instruct',
  /** The local Codex CLI. It authenticates itself from its own CODEX_HOME. */
  codexCliBin: process.env.AXON_CODEX_CLI_BIN ?? '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  codexCliHome: process.env.AXON_CODEX_CLI_HOME ?? path.join(os.homedir(), '.codex'),
  codexCliModel: process.env.AXON_CODEX_CLI_MODEL ?? '',
  /** This route uses the provider's included window to its natural end. */
  codexCliStopPercent: Number(process.env.AXON_CODEX_CLI_STOP_PERCENT ?? 100),
  /** MiniMax Code. The owner's own sign-in is read at call time, never stored. */
  minimaxAuthFile: process.env.AXON_MINIMAX_AUTH_FILE?.trim() || path.join(os.homedir(), '.minimax', 'local-runtime.auth.json'),
  minimaxBaseUrl: process.env.AXON_MINIMAX_BASE_URL?.trim() || 'https://agent.minimax.io/mavis/api/v1/llm/v1',
  minimaxModel: process.env.AXON_MINIMAX_MODEL?.trim() || 'MiniMax-M3',
  /** OpenRouter is metered. It is only ever used when explicitly selected. */
  openRouterBaseUrl: process.env.AXON_OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  openRouterModel: process.env.AXON_OPENROUTER_MODEL ?? '',
  openRouterKeyFile: process.env.AXON_OPENROUTER_KEY_FILE ?? path.join(supportDir, 'openrouter-key'),
  supportDir,
  port: Number(process.env.PORT ?? 8787),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  /** Public URL of this server, used for OAuth callbacks. */
  serverUrl: process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  xaiKey: localTextMode ? '' : req('XAI_API_KEY'),
  xaiModel: process.env.XAI_MODEL ?? 'grok-4.7',
  composioKey: localTextMode ? '' : req('COMPOSIO_API_KEY'),
  orgoKey: localTextMode ? '' : secret('ORGO_API_KEY'),
  sessionSecret: req('SESSION_SECRET'),
  devLogin: process.env.DEV_LOGIN === '1',
  dbPath: process.env.DB_PATH ?? fileURLToPath(new URL('../../data/grokbot.db', import.meta.url)),

  // ---- Hermes engine ----
  /** The `hermes` CLI used to start a gateway for each extra bot. */
  hermesBin: process.env.HERMES_BIN ?? 'hermes',
  /** The primary bot's Hermes home and API server (an agent that already runs; never restarted by us). */
  hermesHome,
  hermesUrl: (process.env.HERMES_URL ?? 'http://127.0.0.1:8642').replace(/\/+$/, ''),
  hermesKey: process.env.HERMES_KEY ?? '',
  /** Where each extra bot's own Hermes home lives. Must be outside ~/.hermes so it is a separate tenant. */
  enginesDir: process.env.ENGINES_DIR ?? fileURLToPath(new URL('../../data/engines', import.meta.url)),
  enginePortBase: Number(process.env.ENGINE_PORT_BASE ?? 8650),
  /** URL the Hermes gateways use to reach this server's MCP endpoint. */
  mcpBaseUrl: (process.env.MCP_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}`).replace(/\/+$/, ''),
  /** Extra MCP servers every managed bot gets, as a JSON object of Hermes `mcp_servers` entries (e.g. X's XMCP). */
  extraMcpServers: process.env.EXTRA_MCP_SERVERS ?? '',
  primaryBotName: process.env.PRIMARY_BOT_NAME ?? 'Doug',
  primaryBotLabel: process.env.PRIMARY_BOT_LABEL ?? 'Chief of Staff',

  // ---- the one shared computer ----
  /** The Orgo computer every bot works on (one screen each). Empty = legacy one-box-per-user mode is not supported. */
  orgoComputerId: process.env.ORGO_COMPUTER_ID ?? '',
  /** This server runs on that computer, so shell commands run locally instead of through Orgo's API. */
  localBox: process.env.HQ_LOCAL === '1',
  /**
   * DevTools URL of a Chrome that already runs on the default screen and belongs to the primary bot
   * (e.g. http://127.0.0.1:9333). When set, we never start or stop that screen's Chrome ourselves.
   */
  primaryCdpUrl: process.env.PRIMARY_CDP_URL ?? '',
  /** Bots that can each have a screen (Orgo allows four screens on one Linux computer). */
  maxBots: Number(process.env.MAX_BOTS ?? 4),
  /** Comma-separated emails allowed to sign in; empty = anyone who can reach the app. */
  allowedEmails: (process.env.ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
};
