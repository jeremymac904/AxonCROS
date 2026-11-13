/** Shared owner-scoped helpers for additive Revision 3 records. */
import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db, now } from './db.js';
import { requireUser, type AuthVars } from './lib/auth.js';
export { db, now };
export const uuid = () => crypto.randomUUID();
export const digest = (value: unknown) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export class R3Error extends Error {
    constructor(message: string, readonly status: 400 | 404 | 409 | 413 | 415 | 424 = 400) { super(message); }
}
export function fail(message: string, status: 400 | 404 | 409 | 413 | 415 | 424 = 400): never { throw new R3Error(message, status); }
export function text(value: unknown, max = 1000, required = false): string { if (value === undefined && !required)
    return ''; if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000]/.test(value))
    fail(`Enter ${required ? 'nonempty ' : ''}text up to ${max} characters.`); return value.trim(); }
export function strings(value: unknown, max = 30): string[] { if (value === undefined)
    return []; if (!Array.isArray(value) || value.length > max)
    fail('Choose a bounded list of values.'); return [...new Set(value.map(v => text(v, 200, true)))]; }
export function zone(value: unknown): string { const z = text(value ?? 'America/New_York', 100, true); try {
    new Intl.DateTimeFormat('en', { timeZone: z });
}
catch {
    fail('Unknown timezone.');
} return z; }
export function timestamp(value: unknown, nullable = true): number | null { if (value === null || value === undefined) {
    if (nullable)
        return null;
    fail('A timestamp is required.');
} if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 4102444800000)
    fail('Use a valid timestamp in milliseconds.'); return Math.round(value); }
export function dateKey(value: unknown): string { const s = text(value, 10, true); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) !== s)
    fail('Use a valid YYYY-MM-DD date.'); return s; }
export function today(z: string, stamp = now()): string { return new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' }).format(stamp); }
export function ownerZone(owner: string): string { const r = db.prepare('SELECT data_json FROM axon_settings WHERE owner_id=?').get(owner) as any; return zone(r ? JSON.parse(r.data_json).timezone : undefined); }
export function router() { const api = new Hono<AuthVars>(); api.use('*', requireUser); api.onError((error, c) => error instanceof R3Error ? c.json({ error: error.message }, error.status) : c.json({ error: 'This local change was not completed. Reload and retry deliberately.' }, 500)); return api; }
export function checkVersion(row: any, value: unknown) { if (typeof value !== 'number' || value !== row.version)
    fail('This record changed. Reload before saving.', 409); }
db.exec(`CREATE TABLE IF NOT EXISTS axon_r3_receipts(owner_id TEXT NOT NULL REFERENCES users(id),scope TEXT NOT NULL,request_id TEXT NOT NULL,input_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner_id,scope,request_id));
CREATE TABLE IF NOT EXISTS axon_r3_history(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,kind TEXT NOT NULL,record_id TEXT NOT NULL,event TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at INTEGER NOT NULL);`);
export function recordHistory(owner: string, kind: string, id: string, event: string, snapshot: any) { db.prepare('INSERT INTO axon_r3_history VALUES(?,?,?,?,?,?,?)').run(uuid(), owner, kind, id, event, JSON.stringify(snapshot), now()); }
export function history(owner: string, kind: string, id: string) { return (db.prepare('SELECT id,event,snapshot_json,created_at AS createdAt FROM axon_r3_history WHERE owner_id=? AND kind=? AND record_id=? ORDER BY created_at,rowid').all(owner, kind, id) as any[]).map(({ snapshot_json, ...r }) => ({ ...r, snapshot: JSON.parse(snapshot_json) })); }
export function once<T>(owner: string, scope: string, key: unknown, input: any, work: () => T): T { const requestId = text(key, 100, true); if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))
    fail('Use a stable request ID for this action.'); const hash = digest(input); return db.transaction(() => { const previous = db.prepare('SELECT input_hash,result_json FROM axon_r3_receipts WHERE owner_id=? AND scope=? AND request_id=?').get(owner, scope, requestId) as any; if (previous) {
    if (previous.input_hash !== hash)
        fail('This request ID was already used for a different action.', 409);
    return JSON.parse(previous.result_json) as T;
} const result = work(); db.prepare('INSERT INTO axon_r3_receipts VALUES(?,?,?,?,?,?)').run(owner, scope, requestId, hash, JSON.stringify(result), now()); return result; })(); }
export function httpUrl(value: unknown): string { const s = text(value, 2048, true); let u: URL; try {
    u = new URL(s);
}
catch {
    fail('Use an absolute http or https source link.');
} if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
    fail('Use a public http or https link without credentials.'); return u.href; }
