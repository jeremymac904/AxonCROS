// Keep local text mode independent of vendor SDKs, schedulers and managed agents.
import { env } from './env.js';
if (env.localTextMode) await import('./local-text-server.js');
else await import('./full-server.js');
