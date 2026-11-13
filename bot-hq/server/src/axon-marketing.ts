/** Local content planning, manual publication evidence and in-app reminder events. */
import type { Hono } from 'hono';
import type { AuthVars } from './lib/auth.js';
import { Cron } from 'croner';
import { db, now, uuid, fail, text, strings, zone, timestamp, dateKey, today, ownerZone, router, checkVersion, once, recordHistory, history, httpUrl } from './axon-r3-core.js';
import { getContact } from './axon-relationships.js';
const CHANNELS = ['social', 'newsletter', 'youtube', 'blog', 'google-business-profile', 'facebook', 'instagram', 'linkedin'];
const STATUSES = ['planned', 'draft', 'ready', 'scheduled', 'cancelled'];
db.exec(`
CREATE TABLE IF NOT EXISTS axon_marketing_items(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),data_json TEXT NOT NULL,status TEXT NOT NULL,assistant_chat_id TEXT REFERENCES local_chats(id),source_key TEXT,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(owner_id,source_key));
CREATE TABLE IF NOT EXISTS axon_marketing_publications(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,item_id TEXT NOT NULL REFERENCES axon_marketing_items(id),channel TEXT NOT NULL,data_json TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS axon_marketing_reminders(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,item_id TEXT REFERENCES axon_marketing_items(id),title TEXT NOT NULL,cron TEXT NOT NULL,timezone TEXT NOT NULL,enabled INTEGER NOT NULL,next_run INTEGER,snoozed_until INTEGER,version INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS axon_marketing_reminder_events(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,reminder_id TEXT NOT NULL,item_id TEXT,scheduled_at INTEGER NOT NULL,delivered_at INTEGER NOT NULL,state TEXT NOT NULL,UNIQUE(owner_id,reminder_id,scheduled_at));
CREATE TABLE IF NOT EXISTS axon_marketing_cadence(owner_id TEXT PRIMARY KEY,data_json TEXT NOT NULL,version INTEGER NOT NULL,updated_at INTEGER NOT NULL);
`);
function channels(value: unknown) { const list = strings(value); if (list.some(c => !CHANNELS.includes(c)))
    fail('Choose supported content channels.'); return list; }
function assetIds(owner: string, value: unknown) { const ids = strings(value, 30); for (const id of ids)
    if (!db.prepare('SELECT id FROM axon_files WHERE id=? AND owner_id=?').get(id, owner))
        fail('Asset not found.', 404); return ids; }
function contactIds(owner: string, value: unknown) { const ids = strings(value, 30); for (const id of ids)
    getContact(owner, id); return ids; }
function links(value: unknown) { if (value === undefined)
    return []; if (!Array.isArray(value) || value.length > 30)
    fail('Use up to 30 source links.'); return value.map(l => ({ title: text(l?.title ?? 'Source', 240, true), url: httpUrl(l?.url) })); }
function sourceRef(owner: string, value: any) { if (!value)
    return null; const kind = text(value.kind, 40, true), id = text(value.id, 200, true); if (!['idea', 'feed', 'news', 'cadence', 'manual'].includes(kind))
    fail('Unsupported source reference.'); if (kind === 'idea' || kind === 'feed') {
    const local = db.prepare('SELECT id FROM axon_records WHERE id=? AND owner_id=? AND kind=?').get(id, owner, kind === 'idea' ? 'ideas' : 'feed');
    const table = kind === 'idea' ? 'axon_proactive_ideas' : 'axon_news_articles';
    let external = false;
    try {
        external = !!db.prepare(`SELECT id FROM ${table} WHERE id=? AND owner_id=?`).get(id, owner);
    }
    catch { }
    if (!local && !external)
        fail('Source record not found.', 404);
} if (kind === 'news' && !db.prepare('SELECT id FROM axon_news_cache WHERE id=?').get(id))
    fail('News source record not found.', 404); return { kind, id }; }
function dataFor(owner: string, input: any, old?: any) { const x = { ...old, ...input }, status = x.status ?? 'planned'; if (!STATUSES.includes(status))
    fail('Publication states come from separate publication records. Choose planned, draft, ready, scheduled or cancelled.'); const dueAt = timestamp(x.dueAt); if (status === 'scheduled' && !dueAt)
    fail('Save a due date before marking a local calendar item scheduled.'); const contact = contactIds(owner, x.contactIds), assets = assetIds(owner, x.assetIds); return { title: text(x.title, 240, true), topic: text(x.topic, 2000), audience: text(x.audience, 2000), campaign: text(x.campaign, 240), brandVoice: text(x.brandVoice, 4000), channels: channels(x.channels ?? []), format: text(x.format, 100), dueAt, timezone: zone(x.timezone ?? ownerZone(owner)), draft: text(x.draft, 100000), assetIds: assets, contactIds: contact, sourceLinks: links(x.sourceLinks), sourceRef: sourceRef(owner, x.sourceRef), synthetic: x.synthetic === true, status }; }
function publicationRows(owner: string, id: string) { return (db.prepare('SELECT * FROM axon_marketing_publications WHERE owner_id=? AND item_id=? ORDER BY created_at DESC,id').all(owner, id) as any[]).map(r => ({ id: r.id, itemId: id, channel: r.channel, ...JSON.parse(r.data_json), createdAt: r.created_at })); }
export function getMarketingItem(owner: string, id: string) { const r = db.prepare('SELECT * FROM axon_marketing_items WHERE id=? AND owner_id=?').get(id, owner) as any; if (!r)
    fail('Marketing item not found.', 404); const data = JSON.parse(r.data_json), publications = publicationRows(owner, id), completed = new Set(publications.filter(p => ['published', 'sent'].includes(p.outcome)).map(p => p.channel)); const displayStatus = r.status === 'cancelled' ? 'cancelled' : data.channels.length && data.channels.every((channel: string) => completed.has(channel)) ? (data.channels.every((channel: string) => channel === 'newsletter') ? 'sent' : 'published') : publications.some(p => p.outcome === 'failed' && !completed.has(p.channel)) ? 'failed' : data.dueAt && data.dueAt < now() && !completed.size ? 'missed' : r.status; return { ...data, id: r.id, status: r.status, displayStatus, assistantChatId: r.assistant_chat_id, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, publicationCounts: { manual: publications.filter(p => p.provenance === 'manual' && ['published', 'sent'].includes(p.outcome)).length, verified: 0 } }; }
export function createMarketingItem(owner: string, input: any) { const data = dataFor(owner, input), sourceKey = data.sourceRef ? `${data.sourceRef.kind}:${data.sourceRef.id}` : null; return db.transaction(() => { if (sourceKey) {
    const previous = db.prepare('SELECT id FROM axon_marketing_items WHERE owner_id=? AND source_key=?').get(owner, sourceKey) as any;
    if (previous)
        return getMarketingItem(owner, previous.id);
} const id = uuid(), stamp = now(); db.prepare('INSERT INTO axon_marketing_items VALUES(?,?,?,?,?,?,1,?,?)').run(id, owner, JSON.stringify(data), data.status, null, sourceKey, stamp, stamp); recordHistory(owner, 'marketing', id, 'created', data); return getMarketingItem(owner, id); })(); }
function updateItem(owner: string, id: string, input: any) { const old = getMarketingItem(owner, id); checkVersion(old, input.version); const data = dataFor(owner, input, old); if (JSON.stringify(data.sourceRef) !== JSON.stringify(old.sourceRef))
    fail('The original source reference is immutable; intentionally duplicate the item for another source.'); db.prepare('UPDATE axon_marketing_items SET data_json=?,status=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?').run(JSON.stringify(data), data.status, now(), id, owner); recordHistory(owner, 'marketing', id, 'updated', data); return getMarketingItem(owner, id); }
function recurrence(cron: unknown, tz: unknown, after = now()) { const z = zone(tz), expression = text(cron, 100, true); if (expression.split(/\s+/).length !== 5)
    fail('Use a five-field recurrence (minute hour day month weekday).'); let parser: Cron; try {
    parser = new Cron(expression, { timezone: z, paused: true });
    const next = parser.nextRun(new Date(after))?.getTime() ?? null;
    parser.stop();
    return { cron: expression, timezone: z, nextRun: next };
}
catch {
    fail('Invalid reminder recurrence or timezone.');
} }
function reminderView(r: any) { return { id: r.id, itemId: r.item_id, title: r.title, cron: r.cron, timezone: r.timezone, delivery: 'in-app', enabled: !!r.enabled, nextRun: r.next_run, snoozedUntil: r.snoozed_until, version: r.version, createdAt: r.created_at }; }
function getReminder(owner: string, id: string) { const r = db.prepare('SELECT * FROM axon_marketing_reminders WHERE id=? AND owner_id=?').get(id, owner) as any; if (!r)
    fail('Reminder not found.', 404); return r; }
export function reconcileMarketingReminders(owner: string, stamp = now()) { return db.transaction(() => { const rows = db.prepare('SELECT * FROM axon_marketing_reminders WHERE owner_id=? AND enabled=1 AND next_run<=?').all(owner, stamp) as any[]; const events: any[] = []; for (const row of rows) {
    if (row.snoozed_until && row.snoozed_until > stamp)
        continue;
    if (row.item_id && getMarketingItem(owner, row.item_id).status === 'cancelled')
        continue;
    const scheduled = row.snoozed_until ?? row.next_run, id = uuid();
    const inserted = db.prepare('INSERT OR IGNORE INTO axon_marketing_reminder_events VALUES(?,?,?,?,?,?,?)').run(id, owner, row.id, row.item_id, scheduled, stamp, 'available-in-app');
    const next = recurrence(row.cron, row.timezone, stamp).nextRun;
    db.prepare('UPDATE axon_marketing_reminders SET next_run=?,snoozed_until=NULL WHERE id=? AND owner_id=?').run(next, row.id, owner);
    if (inserted.changes)
        events.push({ id, reminderId: row.id, itemId: row.item_id, scheduledAt: scheduled, deliveredAt: stamp, state: 'available-in-app' });
} return { events, notice: 'Due reminders were reconciled once in the app. Missed intervals coalesce; no publication or message was sent.' }; })(); }
const defaultCadence = () => ({ version: 0, entries: ['social', 'newsletter', 'youtube', 'blog', 'google-business-profile'].map(category => ({ category, days: [] as number[], time: '09:00', enabled: false })), notice: 'Choose actual days and enable your cadence. No content or public posts are seeded.' });
function cadence(owner: string) { const r = db.prepare('SELECT * FROM axon_marketing_cadence WHERE owner_id=?').get(owner) as any; return r ? { entries: JSON.parse(r.data_json), version: r.version, updatedAt: r.updated_at } : defaultCadence(); }
export function getMarketingContext(owner: string) { return { items: (db.prepare('SELECT id FROM axon_marketing_items WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100').all(owner) as any[]).map(r => { const x = getMarketingItem(owner, r.id); return { id: x.id, title: x.title, status: x.displayStatus, dueAt: x.dueAt, channels: x.channels }; }), cadence: cadence(owner) }; }
export function exportMarketing(owner: string) { const tables = ['axon_marketing_items', 'axon_marketing_publications', 'axon_marketing_reminders', 'axon_marketing_reminder_events', 'axon_marketing_cadence']; return Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t} WHERE owner_id=?`).all(owner)])); }
export function mountMarketing(app: Hono<AuthVars>) {
    const api = router();
    api.get('/marketing/items', c => { const owner = c.get('user').id, from = c.req.query('from') ? dateKey(c.req.query('from')) : null, to = c.req.query('to') ? dateKey(c.req.query('to')) : null, channel = c.req.query('channel'), status = c.req.query('status'); const items = (db.prepare('SELECT id FROM axon_marketing_items WHERE owner_id=? ORDER BY updated_at DESC').all(owner) as any[]).map(r => getMarketingItem(owner, r.id)).filter(x => { const date = x.dueAt ? today(x.timezone, x.dueAt) : null; return (!from || !!date && date >= from) && (!to || !!date && date <= to) && (!channel || x.channels.includes(channel)) && (!status || x.status === status || x.displayStatus === status); }); return c.json({ items }); });
    api.post('/marketing/items', async (c) => c.json({ item: createMarketingItem(c.get('user').id, await c.req.json()) }, 201));
    api.get('/marketing/items/:id', c => { const owner = c.get('user').id, id = c.req.param('id'), item = getMarketingItem(owner, id); return c.json({ item, publications: publicationRows(owner, id), reminders: (db.prepare('SELECT * FROM axon_marketing_reminders WHERE owner_id=? AND item_id=?').all(owner, id) as any[]).map(reminderView), contacts: item.contactIds.map((contactId: string) => ({ contact: getContact(owner, contactId), notes: db.prepare('SELECT id,text,created_at AS createdAt FROM axon_contact_notes WHERE owner_id=? AND contact_id=? ORDER BY created_at DESC').all(owner, contactId) })), history: history(owner, 'marketing', id) }); });
    api.patch('/marketing/items/:id', async (c) => c.json({ item: updateItem(c.get('user').id, c.req.param('id'), await c.req.json()) }));
    api.post('/marketing/items/:id/duplicate', async (c) => { const owner = c.get('user').id, id = c.req.param('id'), body = await c.req.json(); return c.json({ item: once(owner, 'marketing-duplicate', body.requestId, { id }, () => { const old = getMarketingItem(owner, id); return createMarketingItem(owner, { ...old, title: `${old.title} (copy)`, status: 'planned', sourceRef: null }); }) }); });
    api.post('/marketing/items/:id/publications', async (c) => { const owner = c.get('user').id, id = c.req.param('id'), item = getMarketingItem(owner, id), b = await c.req.json(); if (b.provenance && b.provenance !== 'manual' || b.verified === true || b.providerId)
        fail('Provider-verified publication is unavailable. Record an explicit manual confirmation instead.', 424); const channel = text(b.channel, 60, true); if (!item.channels.includes(channel))
        fail('This channel is not selected on the content item.'); if (!['published', 'sent', 'failed'].includes(b.outcome))
        fail('Choose a publication result.'); const publishedAt = timestamp(b.publishedAt, false)!; if (publishedAt > now() + 60000)
        fail('A future planned date is not completed publication.'); const result = once(owner, 'publication', b.requestId, { id, ...b }, () => { const publication = { id: uuid(), itemId: id, channel, accountLabel: text(b.accountLabel, 240, true), outcome: b.outcome, publishedAt, url: b.url ? httpUrl(b.url) : null, note: text(b.note, 4000), provenance: 'manual', actor: owner, createdAt: now() }; db.prepare('INSERT INTO axon_marketing_publications VALUES(?,?,?,?,?,?)').run(publication.id, owner, id, channel, JSON.stringify(publication), publication.createdAt); recordHistory(owner, 'marketing', id, 'manual-publication', publication); return publication; }); return c.json({ publication: result, item: getMarketingItem(owner, id) }); });
    api.post('/marketing/items/:id/assistant', c => { const owner = c.get('user').id, id = c.req.param('id'); const result = db.transaction(() => { let item = getMarketingItem(owner, id), chatId = item.assistantChatId; const contactContext = item.contactIds.map((contactId: string) => { const x = getContact(owner, contactId); return { id: x.id, name: x.name, roles: x.roles, organization: x.organization }; }); const draft = `Create a draft only for Marketing item ${id}. Do not publish, send or claim completion. Use synthetic examples; do not infer borrower facts.\n${JSON.stringify({ itemId: id, title: item.title, topic: item.topic, audience: item.audience, campaign: item.campaign, channels: item.channels, format: item.format, deadline: item.dueAt, timezone: item.timezone, brandVoice: item.brandVoice, sourceLinks: item.sourceLinks, selectedContacts: contactContext })}\nReturn the draft here. Save a selected reply back to this same item explicitly.`; if (chatId) {
        const r = db.prepare("SELECT id FROM local_chats WHERE id=? AND user_id=? AND profile_id='mortgage-marketing-assistant'").get(chatId, owner);
        if (!r)
            fail('The linked assistant conversation is no longer available. Preserve the item and review the missing conversation.', 409);
    }
    else {
        chatId = uuid();
        const stamp = now();
        db.prepare("INSERT INTO local_chats(id,user_id,title,created_at,updated_at,profile_id,kind) VALUES(?,?,?,?,?,'mortgage-marketing-assistant','side')").run(chatId, owner, `Marketing: ${item.title}`.slice(0, 120), stamp, stamp);
        db.prepare('UPDATE axon_marketing_items SET assistant_chat_id=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?').run(chatId, stamp, id, owner);
        recordHistory(owner, 'marketing', id, 'assistant-linked', { chatId });
    } return { chatId, profileId: 'mortgage-marketing-assistant', draft, item: getMarketingItem(owner, id) }; })(); return c.json(result); });
    api.post('/marketing/items/:id/assistant/save', async (c) => { const owner = c.get('user').id, id = c.req.param('id'), b = await c.req.json(); const item = once(owner, 'marketing-save-reply', b.requestId, { id, ...b }, () => { const old = getMarketingItem(owner, id); checkVersion(old, b.version); const message = db.prepare("SELECT m.text FROM local_messages m JOIN local_chats c ON c.id=m.chat_id WHERE m.id=? AND m.chat_id=? AND m.role='assistant' AND c.user_id=?").get(text(b.messageId, 100, true), old.assistantChatId, owner) as any; if (!message)
        fail('Choose an assistant reply from this item’s linked conversation.', 404); return updateItem(owner, id, { version: old.version, draft: message.text, status: 'draft', assetIds: b.assetIds ?? old.assetIds }); }); return c.json({ item }); });
    api.get('/marketing/reminders', c => c.json({ reminders: (db.prepare('SELECT * FROM axon_marketing_reminders WHERE owner_id=? ORDER BY next_run,id').all(c.get('user').id) as any[]).map(reminderView) }));
    api.post('/marketing/reminders', async (c) => { const owner = c.get('user').id, b = await c.req.json(), itemId = b.itemId ? text(b.itemId, 100, true) : null; if (itemId)
        getMarketingItem(owner, itemId); const r = recurrence(b.cron, b.timezone ?? ownerZone(owner)), id = uuid(); db.prepare('INSERT INTO axon_marketing_reminders VALUES(?,?,?,?,?,?,?,?,NULL,1,?)').run(id, owner, itemId, text(b.title, 240, true), r.cron, r.timezone, b.enabled === false ? 0 : 1, r.nextRun, now()); return c.json({ reminder: reminderView(getReminder(owner, id)) }, 201); });
    api.patch('/marketing/reminders/:id', async (c) => { const owner = c.get('user').id, id = c.req.param('id'), old = getReminder(owner, id), b = await c.req.json(); checkVersion(old, b.version); const changed = b.cron !== undefined && b.cron !== old.cron || b.timezone !== undefined && b.timezone !== old.timezone; const r = recurrence(b.cron ?? old.cron, b.timezone ?? old.timezone), snooze = b.snoozedUntil === undefined ? old.snoozed_until : timestamp(b.snoozedUntil); if (snooze && snooze <= now())
        fail('Choose a future snooze time.'); db.prepare('UPDATE axon_marketing_reminders SET title=?,cron=?,timezone=?,enabled=?,next_run=?,snoozed_until=?,version=version+1 WHERE id=? AND owner_id=?').run(b.title === undefined ? old.title : text(b.title, 240, true), r.cron, r.timezone, b.enabled === undefined ? old.enabled : b.enabled ? 1 : 0, changed ? r.nextRun : old.next_run, snooze, id, owner); return c.json({ reminder: reminderView(getReminder(owner, id)) }); });
    api.post('/marketing/reminders/reconcile', c => c.json(reconcileMarketingReminders(c.get('user').id)));
    api.get('/marketing/reminder-events', c => c.json({ events: db.prepare('SELECT id,reminder_id AS reminderId,item_id AS itemId,scheduled_at AS scheduledAt,delivered_at AS deliveredAt,state FROM axon_marketing_reminder_events WHERE owner_id=? ORDER BY delivered_at DESC LIMIT 200').all(c.get('user').id) }));
    api.get('/marketing/cadence', c => c.json(cadence(c.get('user').id)));
    api.put('/marketing/cadence', async (c) => { const owner = c.get('user').id, b = await c.req.json(), old = cadence(owner); checkVersion(old, b.version); if (!Array.isArray(b.entries) || b.entries.length > 20)
        fail('Choose a bounded cadence.'); const categories = new Set<string>(); const entries = b.entries.map((e: any) => { const category = text(e.category, 100, true); if (!CHANNELS.includes(category) || categories.has(category))
        fail('Choose each supported category once.'); categories.add(category); if (!Array.isArray(e.days) || e.days.some((n: any) => !Number.isInteger(n) || n < 0 || n > 6))
        fail('Choose weekdays 0 (Sunday) through 6 (Saturday).'); const time = text(e.time, 5, true); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
        fail('Use HH:mm local time.'); if (e.enabled && !e.days.length)
        fail('Choose at least one cadence day.'); return { category, days: [...new Set(e.days)], time, enabled: e.enabled === true }; }); db.prepare('INSERT INTO axon_marketing_cadence VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET data_json=excluded.data_json,version=excluded.version,updated_at=excluded.updated_at').run(owner, JSON.stringify(entries), old.version + 1, now()); return c.json(cadence(owner)); });
    api.post('/marketing/cadence/plan', async (c) => { const owner = c.get('user').id, b = await c.req.json(), from = dateKey(b.from), to = dateKey(b.to), tz = zone(b.timezone ?? ownerZone(owner)), days = (Date.parse(to) - Date.parse(from)) / 86400000; if (days < 0 || days > 62)
        fail('Plan a range of at most 63 days.'); const items: any[] = []; for (let offset = 0; offset <= days; offset++) {
        const d = new Date(from + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + offset);
        const key = d.toISOString().slice(0, 10);
        for (const entry of cadence(owner).entries) {
            if (!entry.enabled || !entry.days.includes(d.getUTCDay()))
                continue;
            const [hour, minute] = entry.time.split(':').map(Number);
            const parser = new Cron(`${minute} ${hour} ${d.getUTCDate()} ${d.getUTCMonth() + 1} *`, { timezone: tz, paused: true });
            const after = new Date(Date.parse(key + 'T00:00:00Z') - 86400000), scheduled = parser.nextRun(after)?.getTime();
            parser.stop();
            if (!scheduled)
                continue;
            items.push(createMarketingItem(owner, { title: `${entry.category} content`, channels: [entry.category], dueAt: scheduled, timezone: tz, status: 'planned', synthetic: b.synthetic === true, sourceRef: { kind: 'cadence', id: `${key}:${entry.category}` } }));
        }
    } return c.json({ items, notice: 'Local planning occurrences only. No draft was generated and nothing was published.' }); });
    api.get('/marketing/consistency', c => { const owner = c.get('user').id, from = dateKey(c.req.query('from') ?? today(ownerZone(owner))), to = dateKey(c.req.query('to') ?? from); const rows = (db.prepare('SELECT id FROM axon_marketing_items WHERE owner_id=?').all(owner) as any[]).map(r => getMarketingItem(owner, r.id)); const metrics = CHANNELS.map(channel => { const due = rows.filter(i => i.status !== 'cancelled' && i.channels.includes(channel) && i.dueAt && i.dueAt <= now() && today(i.timezone, i.dueAt) >= from && today(i.timezone, i.dueAt) <= to); const completed = due.filter(i => publicationRows(owner, i.id).some(p => p.channel === channel && ['published', 'sent'].includes(p.outcome))); return { channel, due: due.length, manual: completed.length, verified: 0, remaining: due.length - completed.length, itemIds: due.map(i => i.id) }; }); return c.json({ from, to, channels: metrics, notice: 'Only due planned items count. Manual confirmations stay manual; reminder events and future plans are not publications.' }); });
    app.route('/api/local', api);
    const timer = setInterval(() => { const owners = db.prepare('SELECT DISTINCT owner_id FROM axon_marketing_reminders WHERE enabled=1').all() as any[]; for (const row of owners)
        try {
            reconcileMarketingReminders(row.owner_id);
        }
        catch { /* UI exposes persisted definitions; no external send can occur. */ } }, 30000);
    timer.unref();
}
