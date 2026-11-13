/** Canonical contacts and weekly work; local storage only, never sends messages. */
import type { Hono } from 'hono';
import type { AuthVars } from './lib/auth.js';
import { db, now, uuid, digest, fail, text, strings, zone, timestamp, dateKey, today, ownerZone, router, checkVersion, once, recordHistory, history } from './axon-r3-core.js';
import { parseContactImport, type RawImport } from './axon-contact-import.js';
export interface Destination {
    label: string;
    value: string;
}
export interface Contact {
    id: string;
    name: string;
    organization: string;
    market: string;
    roles: string[];
    tags: string[];
    phones: Destination[];
    emails: Destination[];
    preferredChannel: 'email' | 'sms' | 'call' | null;
    preferredDestination: string | null;
    source: string;
    synthetic: boolean;
    archived: boolean;
    version: number;
    createdAt: number;
    updatedAt: number;
    lastInteractionAt: number | null;
}
const ROLES = ['customer', 'realtor', 'lead', 'referral-partner', 'vip'];
export const ROUTINES = [{ day: 'monday', label: 'Realtor outreach', target: 40, queues: [{ id: 'realtors', label: 'Realtor outreach' }] }, { day: 'tuesday', label: 'Active loan updates', target: null, queues: [{ id: 'active-loans', label: 'Active loan updates' }] }, { day: 'wednesday', label: 'Pre-approval and lead follow-up', target: null, queues: [{ id: 'pre-approvals', label: 'Pre-approval follow-up' }, { id: 'leads', label: 'Lead follow-up' }] }, { day: 'thursday', label: 'VIP outreach', target: null, queues: [{ id: 'vips', label: 'VIP outreach' }] }, { day: 'friday', label: 'Active loan updates and referral partner updates', target: null, queues: [{ id: 'active-loans', label: 'Active loan updates' }, { id: 'referral-partners', label: 'Referral partner updates' }] }] as const;
db.exec(`
CREATE TABLE IF NOT EXISTS axon_contacts(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),data_json TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS axon_contact_notes(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,contact_id TEXT NOT NULL REFERENCES axon_contacts(id),tracker_item_id TEXT,text TEXT NOT NULL,version INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS axon_contact_interactions(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,contact_id TEXT NOT NULL REFERENCES axon_contacts(id),tracker_item_id TEXT,data_json TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS axon_contact_imports(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,raw_json TEXT NOT NULL,mapping_json TEXT NOT NULL,provider_json TEXT,state TEXT NOT NULL,result_json TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS axon_contact_import_rows(owner_id TEXT NOT NULL,row_hash TEXT NOT NULL,contact_id TEXT NOT NULL REFERENCES axon_contacts(id),PRIMARY KEY(owner_id,row_hash));
CREATE TABLE IF NOT EXISTS axon_contact_identities(owner_id TEXT NOT NULL,provider TEXT NOT NULL,account_id TEXT NOT NULL,external_id TEXT NOT NULL,contact_id TEXT NOT NULL REFERENCES axon_contacts(id),version TEXT,active INTEGER NOT NULL,data_json TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner_id,provider,account_id,external_id));
CREATE TABLE IF NOT EXISTS axon_contact_merges(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,contact_id TEXT NOT NULL,before_json TEXT NOT NULL,after_version INTEGER NOT NULL,undone INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS axon_tracker_templates(owner_id TEXT NOT NULL,day TEXT NOT NULL,label TEXT NOT NULL,target INTEGER,queues_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(owner_id,day));
CREATE TABLE IF NOT EXISTS axon_tracker_weeks(owner_id TEXT NOT NULL,week TEXT NOT NULL,timezone TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner_id,week));
CREATE TABLE IF NOT EXISTS axon_tracker_days(owner_id TEXT NOT NULL,week TEXT NOT NULL,day TEXT NOT NULL,label TEXT NOT NULL,target INTEGER,note TEXT NOT NULL DEFAULT '',queues_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(owner_id,week,day));
CREATE TABLE IF NOT EXISTS axon_tracker_items(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,week TEXT NOT NULL,day TEXT NOT NULL,queue TEXT NOT NULL,contact_id TEXT,pipeline_id TEXT,unit_key TEXT NOT NULL,title TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,completed_at INTEGER,completed_by TEXT,removed INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,source_json TEXT,created_at INTEGER NOT NULL,UNIQUE(owner_id,week,day,queue,unit_key));
CREATE TABLE IF NOT EXISTS axon_tracker_notes(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,item_id TEXT NOT NULL,text TEXT NOT NULL,version INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
`);
const emailKey = (s: string) => s.trim().toLowerCase();
const phoneKey = (s: string) => { const n = s.replace(/[^0-9]/g, ''); return n.length === 11 && n.startsWith('1') ? n.slice(1) : n; };
function destinations(value: unknown, kind: 'phones' | 'emails'): Destination[] { if (value === undefined)
    return []; if (!Array.isArray(value) || value.length > 20)
    fail('Use at most 20 phone or email destinations.'); const seen = new Set<string>(); return value.map(v => ({ label: text(v?.label ?? 'other', 60, true), value: text(v?.value, 320, true) })).filter(v => { if (/[\r\n]/.test(v.value))
    fail('Destinations cannot contain line breaks.'); if (kind === 'emails' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.value))
    fail('Enter valid email destinations.'); if (kind === 'phones' && (phoneKey(v.value).length < 3 || phoneKey(v.value).length > 20))
    fail('Enter a valid phone destination.'); const k = kind === 'emails' ? emailKey(v.value) : phoneKey(v.value); if (seen.has(k))
    return false; seen.add(k); return true; }); }
function contactData(input: any, previous?: Contact) { const x = { ...previous, ...input }; const roles = strings(x.roles); if (roles.some(r => !ROLES.includes(r)))
    fail('Use customer, realtor, lead, referral-partner or vip roles.'); const phones = destinations(x.phones, 'phones'), emails = destinations(x.emails, 'emails'), preferredChannel = x.preferredChannel ?? null, preferredDestination = x.preferredDestination ?? null; if (preferredChannel !== null && !['email', 'sms', 'call'].includes(preferredChannel))
    fail('Choose email, SMS or call.'); if (preferredDestination !== null && !([...phones, ...emails].some(d => d.value === preferredDestination)))
    fail('Preferred destination must be one of this contact’s saved values.'); return { name: text(x.name, 240, true), organization: text(x.organization, 240), market: text(x.market, 240), roles, tags: strings(x.tags), phones, emails, preferredChannel, preferredDestination, source: previous?.source ?? text(input.source ?? 'manual', 100), synthetic: x.synthetic === true }; }
export function getContact(owner: string, id: string): Contact { const r = db.prepare('SELECT * FROM axon_contacts WHERE id=? AND owner_id=?').get(id, owner) as any; if (!r)
    fail('Contact not found.', 404); const last = db.prepare('SELECT max(created_at) AS stamp FROM axon_contact_interactions WHERE owner_id=? AND contact_id=?').get(owner, id) as any; return { ...JSON.parse(r.data_json), id: r.id, archived: !!r.archived, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, lastInteractionAt: last.stamp ?? null }; }
export function listContacts(owner: string): Contact[] { return (db.prepare('SELECT id FROM axon_contacts WHERE owner_id=? ORDER BY updated_at DESC,id').all(owner) as any[]).map(r => getContact(owner, r.id)); }
export function createContact(owner: string, input: any): Contact { const data = contactData(input), id = uuid(), stamp = now(); db.prepare('INSERT INTO axon_contacts VALUES(?,?,?,0,1,?,?)').run(id, owner, JSON.stringify(data), stamp, stamp); recordHistory(owner, 'contact', id, 'created', data); return getContact(owner, id); }
function updateContact(owner: string, id: string, input: any): Contact { const old = getContact(owner, id); checkVersion(old, input.version); const data = contactData(input, old); db.prepare('UPDATE axon_contacts SET data_json=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?').run(JSON.stringify(data), now(), id, owner); recordHistory(owner, 'contact', id, 'updated', data); return getContact(owner, id); }
function notes(owner: string, id: string) { return db.prepare('SELECT id,text,tracker_item_id AS trackerItemId,version,created_at AS createdAt,updated_at AS updatedAt FROM axon_contact_notes WHERE owner_id=? AND contact_id=? ORDER BY created_at DESC').all(owner, id); }
function interactions(owner: string, id: string) { return (db.prepare('SELECT * FROM axon_contact_interactions WHERE owner_id=? AND contact_id=? ORDER BY created_at DESC').all(owner, id) as any[]).map(r => ({ id: r.id, contactId: id, trackerItemId: r.tracker_item_id, ...JSON.parse(r.data_json), createdAt: r.created_at })); }
function addNote(owner: string, contactId: string, input: any) { getContact(owner, contactId); if (input.trackerItemId) {
    const item = getItem(owner, input.trackerItemId);
    if (item.contactId !== contactId)
        fail('This tracker item belongs to another contact.', 404);
} return once(owner, 'contact-note', input.requestId, { contactId, ...input }, () => { const id = uuid(), stamp = now(), value = text(input.text, 12000, true); db.prepare('INSERT INTO axon_contact_notes VALUES(?,?,?,?,?,1,?,?)').run(id, owner, contactId, input.trackerItemId ?? null, value, stamp, stamp); return { id, contactId, trackerItemId: input.trackerItemId ?? null, text: value, version: 1, createdAt: stamp, updatedAt: stamp }; }); }
const mappedFields = ['name', 'organization', 'market', 'roles', 'tags', 'phones', 'emails'];
function defaultMapping(raw: RawImport) { const out: Record<string, string | string[]> = {}; for (const field of mappedFields) {
    const names = raw.columns.filter(c => { const key = c.toLowerCase().replace(/[^a-z]/g, ''); return field === 'name' ? ['name', 'fullname', 'displayname'].includes(key) : field === 'organization' ? (['organization', 'company', 'companyname'].includes(key) || /^organization.*name$/.test(key)) : field === 'phones' ? /^(phone|mobile|telephone|cell)/.test(key) && !/(type|label)$/.test(key) : field === 'emails' ? /^email/.test(key) && !/(type|label)$/.test(key) : key === field; });
    if (names.length)
        out[field] = ['phones', 'emails', 'roles', 'tags'].includes(field) ? names : names[0];
} if (!out.name) {
    const first = raw.columns.find(c => /^(firstname|givenname)$/i.test(c.replace(/[^a-z]/gi, ''))), last = raw.columns.find(c => /^(lastname|familyname|surname)$/i.test(c.replace(/[^a-z]/gi, '')));
    if (first || last)
        out.name = [first, last].filter(Boolean) as string[];
} return out; }
function validateMapping(raw: RawImport, value: any) { if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('Choose a field mapping.'); const result: Record<string, string | string[]> = {}; for (const [key, v] of Object.entries(value)) {
    if (!mappedFields.includes(key))
        fail('Unsupported mapping field.');
    const values = Array.isArray(v) ? v : [v];
    if (values.some(x => typeof x !== 'string' || !raw.columns.includes(x)))
        fail('Choose an existing import column.');
    result[key] = Array.isArray(v) ? values as string[] : values[0] as string;
} return result; }
function rawToContact(raw: Record<string, string>, mapping: Record<string, string | string[]>, synthetic = false) { const vals = (key: string) => { const m = mapping[key]; return (Array.isArray(m) ? m : m ? [m] : []).map(k => raw[k] ?? '').filter(Boolean); }; return { name: vals('name').join(' '), organization: vals('organization').join(' · '), market: vals('market').join(' · '), roles: vals('roles').flatMap(x => x.split(/[;,|]/)).map(s => s.trim().toLowerCase()).filter(Boolean), tags: vals('tags').flatMap(x => x.split(/[;,|]/)).map(s => s.trim()).filter(Boolean), phones: vals('phones').flatMap(v => v.split(/\s*\|\s*/)).map(value => ({ label: 'imported', value })), emails: vals('emails').flatMap(v => v.split(/\s*[;|]\s*/)).map(value => ({ label: 'imported', value })), source: 'import', synthetic }; }
function importRow(owner: string, id: string) { const r = db.prepare('SELECT * FROM axon_contact_imports WHERE id=? AND owner_id=?').get(id, owner) as any; if (!r)
    fail('Import preview not found.', 404); return r; }
function importedRowHash(input: any, provider: any, index: number) { const identity = provider?.contacts?.[index]; return digest(identity ? { provider: provider.provider, accountId: provider.accountId, externalId: identity.externalId, input } : input); }
function bindIdentity(owner: string, identity: any, contactId: string) { if (!identity)
    return; db.prepare('INSERT INTO axon_contact_identities VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(owner_id,provider,account_id,external_id) DO UPDATE SET version=excluded.version,active=1,data_json=excluded.data_json,updated_at=excluded.updated_at').run(owner, identity.provider, identity.accountId, identity.externalId, contactId, identity.version, JSON.stringify(identity), now()); }
function preview(owner: string, id: string) {
    const r = importRow(owner, id), raw = JSON.parse(r.raw_json) as RawImport, mapping = JSON.parse(r.mapping_json), provider = r.provider_json ? JSON.parse(r.provider_json) : null, contacts = listContacts(owner);
    const rows = raw.rows.map((row, index) => {
        const input = rawToContact(row, mapping, raw.synthetic === true), errors = [...(raw.errors[index] ?? [])];
        let contact: any = input;
        try {
            contact = contactData(input);
        }
        catch (e) {
            errors.push(e instanceof Error ? e.message : 'Invalid contact.');
        }
        const hash = importedRowHash(input, provider, index), previous = db.prepare('SELECT contact_id FROM axon_contact_import_rows WHERE owner_id=? AND row_hash=?').get(owner, hash) as any;
        const identity = provider?.contacts?.[index];
        const identityRow = identity ? db.prepare('SELECT contact_id,version FROM axon_contact_identities WHERE owner_id=? AND provider=? AND account_id=? AND external_id=?').get(owner, provider.provider, provider.accountId, identity.externalId) as any : null;
        const matches = contacts.filter(c => c.id === identityRow?.contact_id || !c.archived && (c.emails.some(e => input.emails.some(p => emailKey(p.value) === emailKey(e.value))) || c.phones.some(e => input.phones.some(p => phoneKey(p.value) === phoneKey(e.value))))).map(c => ({ id: c.id, name: c.name, version: c.version, reason: c.id === identityRow?.contact_id ? 'provider-id' : 'phone-or-email', existing: c }));
        return { rowId: String(index + 1), contact, errors, matches, decision: errors.length || previous ? 'skip' : matches.length ? 'review' : 'new', alreadyImportedContactId: previous?.contact_id ?? null, externalIdentity: identity ? { provider: provider.provider, accountId: provider.accountId, ...identity } : null };
    });
    return { importId: id, state: r.state, format: raw.format, columns: raw.columns, mapping, rows, notice: raw.notice + ' Explicit update merges additional destinations/roles/tags and keeps existing nonempty profile fields unless prefer-import is selected.', provider: provider ? { provider: provider.provider, accountId: provider.accountId, direction: provider.direction, deletedExternalIds: provider.deletedExternalIds ?? [] } : null };
}
function mergeContact(owner: string, id: string, incoming: any, version: unknown, fieldPolicy: unknown) { const old = getContact(owner, id); checkVersion(old, version); if (fieldPolicy !== undefined && !['keep-existing', 'prefer-import'].includes(String(fieldPolicy)))
    fail('Choose a valid merge field policy.'); const prefer = fieldPolicy === 'prefer-import'; const combined = { ...incoming, version: old.version, name: prefer ? incoming.name : old.name, organization: prefer && incoming.organization ? incoming.organization : old.organization || incoming.organization, market: prefer && incoming.market ? incoming.market : old.market || incoming.market, phones: [...old.phones, ...incoming.phones], emails: [...old.emails, ...incoming.emails], roles: [...new Set([...old.roles, ...incoming.roles])], tags: [...new Set([...old.tags, ...incoming.tags])], preferredChannel: old.preferredChannel, preferredDestination: old.preferredDestination }; const updated = updateContact(owner, id, combined); db.prepare('INSERT INTO axon_contact_merges VALUES(?,?,?,?,?,0,?)').run(uuid(), owner, id, JSON.stringify(old), updated.version, now()); return updated; }
function weekKey(value: string, z: string) { const date = value === 'current' ? today(z) : dateKey(value); const d = new Date(date + 'T12:00:00Z'), weekday = d.getUTCDay(), offset = (weekday + 6) % 7; d.setUTCDate(d.getUTCDate() - offset); const monday = d.toISOString().slice(0, 10); if (value !== 'current' && date !== monday)
    fail('Choose the Monday week key.'); return monday; }
function templates(owner: string) { for (const r of ROUTINES)
    db.prepare('INSERT OR IGNORE INTO axon_tracker_templates VALUES(?,?,?,?,?,1)').run(owner, r.day, r.label, r.target, JSON.stringify(r.queues)); return ROUTINES.map(r => db.prepare('SELECT * FROM axon_tracker_templates WHERE owner_id=? AND day=?').get(owner, r.day) as any); }
function ensureWeek(owner: string, value: string) { const tz = ownerZone(owner), week = weekKey(value, tz); db.transaction(() => { const result = db.prepare('INSERT OR IGNORE INTO axon_tracker_weeks VALUES(?,?,?,?)').run(owner, week, tz, now()); if (result.changes)
    for (const r of templates(owner))
        db.prepare('INSERT INTO axon_tracker_days VALUES(?,?,?,?,?,\'\',?,1)').run(owner, week, r.day, r.label, r.target, r.queues_json); })(); return db.prepare('SELECT week,timezone FROM axon_tracker_weeks WHERE owner_id=? AND week=?').get(owner, week) as {
    week: string;
    timezone: string;
}; }
function dayRow(owner: string, week: string, day: string) { const r = db.prepare('SELECT * FROM axon_tracker_days WHERE owner_id=? AND week=? AND day=?').get(owner, week, day) as any; if (!r)
    fail('Weekday not found.', 404); return r; }
function dayView(owner: string, r: any) { const items = db.prepare('SELECT queue,completed FROM axon_tracker_items WHERE owner_id=? AND week=? AND day=? AND removed=0').all(owner, r.week, r.day) as any[]; const date = new Date(r.week + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + ROUTINES.findIndex(d => d.day === r.day)); return { day: r.day, date: date.toISOString().slice(0, 10), label: r.label, target: r.target, note: r.note, version: r.version, queues: JSON.parse(r.queues_json).map((q: any) => ({ ...q, selected: items.filter(i => i.queue === q.id).length, completed: items.filter(i => i.queue === q.id && i.completed).length })), selected: items.length, completed: items.filter(i => i.completed).length }; }
function weekView(owner: string, value: string) { const w = ensureWeek(owner, value); return { ...w, days: ROUTINES.map(r => dayView(owner, dayRow(owner, w.week, r.day))) }; }
function pipeline(owner: string, id: string) { const row = db.prepare("SELECT * FROM axon_records WHERE id=? AND owner_id=? AND kind='pipeline' AND status!='archived'").get(id, owner) as any; if (!row)
    fail('Pipeline record not found.', 404); return { ...row, data: JSON.parse(row.data_json) }; }
function itemView(owner: string, row: any) { let contact = null; if (row.contact_id)
    contact = getContact(owner, row.contact_id); const notesList = row.contact_id ? notes(owner, row.contact_id).filter((n: any) => n.trackerItemId === row.id) : db.prepare('SELECT id,text,version,created_at AS createdAt,updated_at AS updatedAt FROM axon_tracker_notes WHERE owner_id=? AND item_id=? ORDER BY created_at').all(owner, row.id); return { id: row.id, week: row.week, day: row.day, queue: row.queue, contactId: row.contact_id, pipelineId: row.pipeline_id, contact, title: row.pipeline_id ? row.title : (contact?.name ?? row.title), completed: !!row.completed, completedAt: row.completed_at, completionProvenance: row.completed ? 'manual' : null, completedBy: row.completed_by, removed: !!row.removed, version: row.version, notes: notesList }; }
export function getItem(owner: string, id: string) { const r = db.prepare('SELECT * FROM axon_tracker_items WHERE id=? AND owner_id=?').get(id, owner) as any; if (!r)
    fail('Tracker item not found.', 404); return itemView(owner, r); }
function candidates(owner: string, week: string, day: string) { const r = dayRow(owner, week, day), queues = JSON.parse(r.queues_json) as {
    id: string;
}[], contacts = listContacts(owner).filter(c => !c.archived); return queues.flatMap(q => { const role = q.id === 'realtors' ? 'realtor' : q.id === 'vips' ? 'vip' : q.id === 'referral-partners' ? 'referral-partner' : null; if (role)
    return contacts.filter(c => c.roles.includes(role)).map(c => ({ queue: q.id, contactId: c.id, pipelineId: null, title: c.name, contact: c })); const stages = q.id === 'active-loans' ? ['processing', 'underwriting', 'closing', 'active'] : q.id === 'pre-approvals' ? ['pre-approval', 'preapproval'] : ['lead']; return (db.prepare("SELECT * FROM axon_records WHERE owner_id=? AND kind='pipeline' AND status!='archived'").all(owner) as any[]).filter(p => stages.includes(JSON.parse(p.data_json).stage)).map(p => { const data = JSON.parse(p.data_json), contact = contacts.find(c => c.id === data.contactId) ?? null; return { queue: q.id, pipelineId: p.id, contactId: contact?.id ?? null, title: p.title, contact }; }); }); }
export function createLinkedTrackerItem(owner: string, input: any) { const w = ensureWeek(owner, text(input.week ?? 'current', 10, true)), day = text(input.day, 20, true), r = dayRow(owner, w.week, day), queue = text(input.queue, 40, true); if (!JSON.parse(r.queues_json).some((q: any) => q.id === queue))
    fail('Queue does not belong to this weekday.'); const contactId = input.contactId ? text(input.contactId, 100, true) : null, pipelineId = input.pipelineId ? text(input.pipelineId, 100, true) : null; let title = ''; if (contactId) {
    const c = getContact(owner, contactId);
    if (c.archived)
        fail('Restore this contact before selecting it.');
    const role = queue === 'realtors' ? 'realtor' : queue === 'vips' ? 'vip' : queue === 'referral-partners' ? 'referral-partner' : null;
    if (role && !c.roles.includes(role))
        fail('Choose a contact with the role required by this queue.');
    title = c.name;
} if (pipelineId) {
    const p = pipeline(owner, pipelineId);
    const stages = queue === 'active-loans' ? ['processing', 'underwriting', 'closing', 'active'] : queue === 'pre-approvals' ? ['pre-approval', 'preapproval'] : queue === 'leads' ? ['lead'] : [];
    if (!stages.includes(p.data.stage))
        fail('Choose a Pipeline record in this queue’s stages.');
    title = p.title;
    const linked = p.data.contactId;
    if (linked && contactId && linked !== contactId)
        fail('This loan is linked to a different contact.');
} const loanQueue = ['active-loans', 'pre-approvals', 'leads'].includes(queue); if (loanQueue && !pipelineId || !loanQueue && !contactId)
    fail('Select the required contact or Pipeline record.'); const unitKey = loanQueue ? `loan:${pipelineId}` : `contact:${contactId}`; return db.transaction(() => { const old = db.prepare('SELECT * FROM axon_tracker_items WHERE owner_id=? AND week=? AND day=? AND queue=? AND unit_key=?').get(owner, w.week, day, queue, unitKey) as any; if (old) {
    if (old.removed) {
        db.prepare('UPDATE axon_tracker_items SET removed=0,version=version+1 WHERE id=?').run(old.id);
        recordHistory(owner, 'tracker', old.id, 'restored', {});
    }
    return getItem(owner, old.id);
} const id = uuid(); db.prepare('INSERT INTO axon_tracker_items(id,owner_id,week,day,queue,contact_id,pipeline_id,unit_key,title,source_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, owner, w.week, day, queue, contactId, pipelineId, unitKey, title, input.sourceRef ? JSON.stringify(input.sourceRef) : null, now()); recordHistory(owner, 'tracker', id, 'selected', { week: w.week, day, queue, contactId, pipelineId }); return getItem(owner, id); })(); }
export function exportRelationships(owner: string) { const tables = ['axon_contacts', 'axon_contact_notes', 'axon_contact_interactions', 'axon_contact_identities', 'axon_contact_merges', 'axon_tracker_templates', 'axon_tracker_weeks', 'axon_tracker_days', 'axon_tracker_items', 'axon_tracker_notes']; return Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t} WHERE owner_id=?`).all(owner)])); }
export function getRelationshipContext(owner: string) { return { contacts: listContacts(owner).filter(c => !c.archived).slice(0, 100).map(({ id, name, roles, tags, lastInteractionAt }) => ({ id, name, roles, tags, lastInteractionAt })), tracking: (db.prepare('SELECT id,week,day,queue,title,completed FROM axon_tracker_items WHERE owner_id=? AND removed=0 ORDER BY created_at DESC LIMIT 100').all(owner) as any[]).map(r => ({ ...r, completed: !!r.completed })) }; }
export function mountRelationships(app: Hono<AuthVars>) {
    const api = router();
    api.get('/contacts', c => { const owner = c.get('user').id, q = (c.req.query('q') ?? '').toLowerCase(), role = c.req.query('role'), tag = c.req.query('tag'), archived = c.req.query('archived') === '1'; let contacts = listContacts(owner).filter(x => x.archived === archived && (!role || x.roles.includes(role)) && (!tag || x.tags.includes(tag)) && (!q || [x.name, x.organization, ...x.emails.map(v => v.value), ...x.phones.map(v => v.value)].join(' ').toLowerCase().includes(q))); contacts.sort((a, b) => a.name.localeCompare(b.name)); return c.json({ contacts }); });
    api.post('/contacts', async (c) => c.json({ contact: createContact(c.get('user').id, await c.req.json()) }, 201));
    api.post('/contacts/imports/preview', async (c) => { const owner = c.get('user').id, body = await c.req.json(), raw = { ...await parseContactImport(body.filename, body.contentBase64), synthetic: body.synthetic === true }, mapping = body.mapping ? validateMapping(raw, body.mapping) : defaultMapping(raw), id = uuid(); db.prepare('INSERT INTO axon_contact_imports VALUES(?,?,?,?,NULL,\'preview\',NULL,?)').run(id, owner, JSON.stringify(raw), JSON.stringify(mapping), now()); return c.json(preview(owner, id)); });
    api.post('/contacts/imports/provider-preview', async (c) => {
        const owner = c.get('user').id, b = await c.req.json();
        if (!['apple', 'google'].includes(b.provider) || !Array.isArray(b.contacts) || b.contacts.length > 10000)
            fail('Use a supported bounded provider contact snapshot.');
        const raw: RawImport = { format: 'vcard', synthetic: b.synthetic === true, columns: ['Name', 'Organization', 'Phones', 'Emails'], rows: [], errors: {}, notice: 'Reviewed provider snapshot import. No provider writes, send permission or continuous iPhone sync is implied.' };
        const identities: any[] = [], seen = new Set<string>();
        for (let index = 0; index < b.contacts.length; index++) {
            const v = b.contacts[index] ?? {};
            let identity: any = { externalId: '', version: '' }, row = { Name: '', Organization: '', Phones: '', Emails: '' };
            try {
                identity = { externalId: text(v.externalId, 500, true), version: text(v.version ?? '', 500), containerId: text(v.containerId, 500), containerName: text(v.containerName, 500) };
                if (seen.has(identity.externalId))
                    fail('Repeated external ID in this provider snapshot.');
                seen.add(identity.externalId);
                const phones = destinations(v.phones, 'phones'), emails = destinations(v.emails, 'emails'), organization = text(v.organization, 240);
                const name = text(v.displayName ?? '', 240) || [text(v.givenName, 120), text(v.familyName, 120)].filter(Boolean).join(' ') || organization || emails[0]?.value || phones[0]?.value || '';
                row = { Name: text(name, 320, true), Organization: organization, Phones: phones.map(v => v.value).join('|'), Emails: emails.map(v => v.value).join('|') };
            }
            catch (error) {
                raw.errors[index] = [error instanceof Error ? error.message : 'This provider row needs correction.'];
            }
            identities.push(identity);
            raw.rows.push(row);
        }
        const provider = { provider: b.provider, accountId: text(b.accountId, 300, true), direction: b.direction === 'two-way' ? 'two-way' : 'import-only', contacts: identities, deletedExternalIds: strings(b.deletedExternalIds ?? [], 10000) };
        const id = uuid();
        db.prepare('INSERT INTO axon_contact_imports VALUES(?,?,?,?,?,\'preview\',NULL,?)').run(id, owner, JSON.stringify(raw), JSON.stringify({ name: 'Name', organization: 'Organization', phones: ['Phones'], emails: ['Emails'] }), JSON.stringify(provider), now());
        return c.json(preview(owner, id));
    });
    api.get('/contacts/imports/:id', c => c.json(preview(c.get('user').id, c.req.param('id'))));
    api.patch('/contacts/imports/:id', async (c) => { const owner = c.get('user').id, id = c.req.param('id'), r = importRow(owner, id); if (r.state !== 'preview')
        fail('This preview is no longer editable.', 409); const b = await c.req.json(), mapping = validateMapping(JSON.parse(r.raw_json), b.mapping); db.prepare('UPDATE axon_contact_imports SET mapping_json=? WHERE id=? AND owner_id=?').run(JSON.stringify(mapping), id, owner); return c.json(preview(owner, id)); });
    api.delete('/contacts/imports/:id', c => { const owner = c.get('user').id, id = c.req.param('id'), r = importRow(owner, id); if (r.state === 'committed')
        fail('A committed import cannot be cancelled.', 409); db.prepare("UPDATE axon_contact_imports SET state='cancelled' WHERE id=? AND owner_id=?").run(id, owner); return c.json({ ok: true }); });
    api.post('/contacts/imports/:id/commit', async (c) => { const owner = c.get('user').id, id = c.req.param('id'), body = await c.req.json(); const result = once(owner, 'import-commit', body.requestId, { id, decisions: body.decisions }, () => { const stored = importRow(owner, id); if (stored.state === 'committed')
        return JSON.parse(stored.result_json); if (stored.state !== 'preview')
        fail('This import was cancelled.', 409); const p = preview(owner, id); if (!Array.isArray(body.decisions) || body.decisions.length > 10000)
        fail('Review the import row decisions.'); const seen = new Set<string>(), results: any[] = []; for (const decision of body.decisions) {
        const row = p.rows.find(r => r.rowId === decision.rowId);
        if (!row || seen.has(decision.rowId))
            fail('Choose each import row once.');
        seen.add(decision.rowId);
        if (!['new', 'update', 'skip'].includes(decision.action))
            fail('Choose new, update or skip.');
        if (decision.action === 'skip') {
            results.push({ rowId: row.rowId, status: 'skipped' });
            continue;
        }
        if (row.errors.length) {
            results.push({ rowId: row.rowId, status: 'error', error: row.errors.join(' ') });
            continue;
        }
        const originalRaw = JSON.parse(stored.raw_json) as RawImport, input = rawToContact(originalRaw.rows[Number(row.rowId) - 1], p.mapping, originalRaw.synthetic === true), hash = importedRowHash(input, stored.provider_json ? JSON.parse(stored.provider_json) : null, Number(row.rowId) - 1), prior = db.prepare('SELECT contact_id FROM axon_contact_import_rows WHERE owner_id=? AND row_hash=?').get(owner, hash) as any;
        if (prior) {
            bindIdentity(owner, row.externalIdentity, prior.contact_id);
            results.push({ rowId: row.rowId, status: 'skipped', contactId: prior.contact_id });
            continue;
        }
        const providerMatch = row.matches.find(m => m.reason === 'provider-id');
        if (providerMatch && (decision.action !== 'update' || decision.contactId !== providerMatch.id)) {
            results.push({ rowId: row.rowId, status: 'error', error: 'This provider identity already belongs to a contact. Review an update to that existing contact or skip it.' });
            continue;
        }
        let contact: Contact;
        try {
            contact = decision.action === 'update' ? mergeContact(owner, text(decision.contactId, 100, true), input, decision.version, decision.fieldPolicy) : createContact(owner, input);
        }
        catch (e) {
            results.push({ rowId: row.rowId, status: 'error', error: e instanceof Error ? e.message : 'Contact was not saved.' });
            continue;
        }
        db.prepare('INSERT INTO axon_contact_import_rows VALUES(?,?,?)').run(owner, hash, contact.id);
        bindIdentity(owner, row.externalIdentity, contact.id);
        results.push({ rowId: row.rowId, status: decision.action === 'new' ? 'created' : 'updated', contactId: contact.id });
    } if (stored.provider_json) {
        const provider = JSON.parse(stored.provider_json);
        for (const externalId of provider.deletedExternalIds ?? [])
            db.prepare('UPDATE axon_contact_identities SET active=0,updated_at=? WHERE owner_id=? AND provider=? AND account_id=? AND external_id=?').run(now(), owner, provider.provider, provider.accountId, externalId);
    } const result = { results, summary: { created: results.filter(r => r.status === 'created').length, updated: results.filter(r => r.status === 'updated').length, skipped: results.filter(r => r.status === 'skipped').length, errors: results.filter(r => r.status === 'error').length } }; db.prepare("UPDATE axon_contact_imports SET state='committed',result_json=? WHERE id=? AND owner_id=?").run(JSON.stringify(result), id, owner); return result; }); return c.json(result); });
    api.get('/contacts/:id', c => { const owner = c.get('user').id, id = c.req.param('id'); return c.json({ contact: getContact(owner, id), notes: notes(owner, id), interactions: interactions(owner, id), identities: db.prepare('SELECT provider,account_id AS accountId,external_id AS externalId,version,active,data_json AS metadata,updated_at AS updatedAt FROM axon_contact_identities WHERE owner_id=? AND contact_id=?').all(owner, id), merges: db.prepare('SELECT id,after_version AS afterVersion,undone,created_at AS createdAt FROM axon_contact_merges WHERE owner_id=? AND contact_id=?').all(owner, id) }); });
    api.patch('/contacts/:id', async (c) => c.json({ contact: updateContact(c.get('user').id, c.req.param('id'), await c.req.json()) }));
    api.delete('/contacts/:id', c => { const owner = c.get('user').id, id = c.req.param('id'); getContact(owner, id); db.prepare('UPDATE axon_contacts SET archived=1,version=version+1,updated_at=? WHERE id=? AND owner_id=?').run(now(), id, owner); return c.json({ ok: true, notice: 'Contact archived; notes and historical outreach are retained.' }); });
    api.post('/contacts/:id/restore', c => { const owner = c.get('user').id, id = c.req.param('id'); getContact(owner, id); db.prepare('UPDATE axon_contacts SET archived=0,version=version+1,updated_at=? WHERE id=? AND owner_id=?').run(now(), id, owner); return c.json({ contact: getContact(owner, id) }); });
    api.post('/contacts/merges/:id/undo', c => { const owner = c.get('user').id, r = db.prepare('SELECT * FROM axon_contact_merges WHERE id=? AND owner_id=?').get(c.req.param('id'), owner) as any; if (!r)
        fail('Merge not found.', 404); if (r.undone)
        fail('Merge already undone.', 409); const contact = getContact(owner, r.contact_id); if (contact.version !== r.after_version)
        fail('Contact changed after this merge. Review changes before undo.', 409); const before = JSON.parse(r.before_json); const restored = updateContact(owner, r.contact_id, { ...before, version: contact.version }); db.prepare('UPDATE axon_contact_merges SET undone=1 WHERE id=?').run(r.id); return c.json({ contact: restored, notice: 'App-owned notes and activity remain attached.' }); });
    api.post('/contacts/:id/notes', async (c) => c.json({ note: addNote(c.get('user').id, c.req.param('id'), await c.req.json()) }, 201));
    api.patch('/contact-notes/:id', async (c) => { const owner = c.get('user').id, r = db.prepare('SELECT * FROM axon_contact_notes WHERE id=? AND owner_id=?').get(c.req.param('id'), owner) as any; if (!r)
        fail('Note not found.', 404); const b = await c.req.json(); checkVersion(r, b.version); db.prepare('UPDATE axon_contact_notes SET text=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?').run(text(b.text, 12000, true), now(), r.id, owner); return c.json({ note: notes(owner, r.contact_id).find((n: any) => n.id === r.id) }); });
    api.post('/contacts/:id/handoff', async (c) => { const contact = getContact(c.get('user').id, c.req.param('id')), b = await c.req.json(), channel = text(b.channel, 10, true), destination = text(b.destination, 320, true); if (!['email', 'sms', 'call'].includes(channel) || (channel === 'email' ? contact.emails : contact.phones).every(d => d.value !== destination))
        fail('Choose a saved destination for this channel.'); const uri = channel === 'email' ? `mailto:${encodeURIComponent(destination)}?body=${encodeURIComponent(text(b.text, 12000))}` : channel === 'sms' ? `sms:${encodeURIComponent(destination)}?body=${encodeURIComponent(text(b.text, 12000))}` : `tel:${encodeURIComponent(destination)}`; return c.json({ uri, notice: 'Opens the selected app with this destination. A phone link may start a call; review the system prompt. This does not verify delivery, a successful conversation or tracker completion.' }); });
    api.post('/contacts/:id/interactions', async (c) => { const owner = c.get('user').id, id = c.req.param('id'), contact = getContact(owner, id), b = await c.req.json(); if (!['email', 'sms', 'call', 'note'].includes(b.channel) || !['drafted', 'reached', 'voicemail', 'no-answer', 'rescheduled', 'sent'].includes(b.outcome))
        fail('Choose a supported channel and manually logged outcome.'); const destination = text(b.destination, 320, b.channel !== 'note'); if (b.channel !== 'note' && (b.channel === 'email' ? contact.emails : contact.phones).every(d => d.value !== destination))
        fail('Choose a destination saved on this contact.'); if (b.trackerItemId && getItem(owner, b.trackerItemId).contactId !== id)
        fail('Tracker item belongs to another contact.', 404); const result = once(owner, 'interaction', b.requestId, { id, ...b }, () => { const result = { id: uuid(), contactId: id, trackerItemId: b.trackerItemId ?? null, channel: b.channel, destination, outcome: b.outcome, note: text(b.note, 12000), followUpAt: timestamp(b.followUpAt), provenance: 'manual', actor: owner, createdAt: now() }; db.prepare('INSERT INTO axon_contact_interactions VALUES(?,?,?,?,?,?)').run(result.id, owner, id, result.trackerItemId, JSON.stringify(result), result.createdAt); return result; }); return c.json({ interaction: result }); });
    api.get('/tracking/routines', c => c.json({ routines: templates(c.get('user').id).map(r => ({ day: r.day, label: r.label, target: r.target, queues: JSON.parse(r.queues_json), version: r.version })) }));
    api.patch('/tracking/routines/:day', async (c) => { const owner = c.get('user').id, r = templates(owner).find(r => r.day === c.req.param('day')); if (!r)
        fail('Weekday not found.', 404); const b = await c.req.json(); checkVersion(r, b.version); if (b.target !== null && (!Number.isInteger(b.target) || b.target < 0 || b.target > 10000))
        fail('Use an optional target from 0 to 10,000.'); db.prepare('UPDATE axon_tracker_templates SET target=?,version=version+1 WHERE owner_id=? AND day=?').run(b.target, owner, r.day); return c.json({ routine: { day: r.day, label: r.label, target: b.target, queues: JSON.parse(r.queues_json), version: r.version + 1 }, notice: 'Default applies only to weeks created after this change; existing weeks are preserved.' }); });
    api.get('/tracking/weeks', c => { const owner = c.get('user').id, limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20)); return c.json({ weeks: (db.prepare('SELECT week FROM axon_tracker_weeks WHERE owner_id=? ORDER BY week DESC LIMIT ?').all(owner, limit) as any[]).map(r => weekView(owner, r.week)) }); });
    api.get('/tracking/weeks/:week', c => c.json(weekView(c.get('user').id, c.req.param('week'))));
    api.get('/tracking/weeks/:week/:day', c => { const owner = c.get('user').id, w = ensureWeek(owner, c.req.param('week')), day = c.req.param('day'), r = dayRow(owner, w.week, day); return c.json({ ...w, day: dayView(owner, r), items: (db.prepare('SELECT * FROM axon_tracker_items WHERE owner_id=? AND week=? AND day=? AND removed=0 ORDER BY created_at,id').all(owner, w.week, day) as any[]).map(r => itemView(owner, r)), candidates: candidates(owner, w.week, day) }); });
    api.patch('/tracking/weeks/:week/:day', async (c) => { const owner = c.get('user').id, w = ensureWeek(owner, c.req.param('week')), day = c.req.param('day'), r = dayRow(owner, w.week, day), b = await c.req.json(); checkVersion(r, b.version); const target = b.target === undefined ? r.target : b.target; if (target !== null && (!Number.isInteger(target) || target < 0 || target > 10000))
        fail('Use an optional target from 0 to 10,000.'); db.prepare('UPDATE axon_tracker_days SET target=?,note=?,version=version+1 WHERE owner_id=? AND week=? AND day=?').run(target, b.note === undefined ? r.note : text(b.note, 12000), owner, w.week, day); recordHistory(owner, 'tracker-day', `${w.week}:${day}`, 'updated', { target, note: b.note ?? r.note }); return c.json({ day: dayView(owner, dayRow(owner, w.week, day)) }); });
    api.post('/tracking/weeks/:week/:day/items', async (c) => { const owner = c.get('user').id, b = await c.req.json(), input = { ...b, week: c.req.param('week'), day: c.req.param('day') }; return c.json({ item: b.requestId ? once(owner, 'tracker-select', b.requestId, input, () => createLinkedTrackerItem(owner, input)) : createLinkedTrackerItem(owner, input) }); });
    api.patch('/tracking/items/:id', async (c) => { const owner = c.get('user').id, id = c.req.param('id'), b = await c.req.json(); const item = once(owner, 'tracker-completion', b.requestId, { id, ...b }, () => { const r = getItem(owner, id); checkVersion(r, b.version); if (r.removed || typeof b.completed !== 'boolean')
        fail('Restore the item and choose a completion state.'); if (r.completed === b.completed)
        return r; db.prepare('UPDATE axon_tracker_items SET completed=?,completed_at=?,completed_by=?,version=version+1 WHERE id=? AND owner_id=?').run(b.completed ? 1 : 0, b.completed ? now() : null, b.completed ? owner : null, id, owner); recordHistory(owner, 'tracker', id, b.completed ? 'completed-manually' : 'reopened', { actor: owner }); return getItem(owner, id); }); return c.json({ item }); });
    api.delete('/tracking/items/:id', c => { const owner = c.get('user').id, id = c.req.param('id'); getItem(owner, id); db.prepare('UPDATE axon_tracker_items SET removed=1,version=version+1 WHERE id=? AND owner_id=?').run(id, owner); recordHistory(owner, 'tracker', id, 'removed', {}); return c.json({ ok: true }); });
    api.post('/tracking/items/:id/notes', async (c) => { const owner = c.get('user').id, item = getItem(owner, c.req.param('id')), b = await c.req.json(); if (item.contactId)
        return c.json({ note: addNote(owner, item.contactId, { ...b, trackerItemId: item.id }) }); const note = once(owner, 'tracker-note', b.requestId, { itemId: item.id, ...b }, () => { const id = uuid(), stamp = now(), value = text(b.text, 12000, true); db.prepare('INSERT INTO axon_tracker_notes VALUES(?,?,?,?,1,?,?)').run(id, owner, item.id, value, stamp, stamp); const note = { id, text: value, version: 1, createdAt: stamp, updatedAt: stamp }; recordHistory(owner, 'tracker', item.id, 'note-added', { noteId: id, after: note }); return note; }); return c.json({ note }); });
    api.patch('/tracking/items/:id/notes/:noteId', async (c) => {
        const owner = c.get('user').id, itemId = c.req.param('id'), noteId = c.req.param('noteId'), b = await c.req.json();
        getItem(owner, itemId);
        const findNote = () => db.prepare('SELECT id,text,version,created_at AS createdAt,updated_at AS updatedAt FROM axon_tracker_notes WHERE id=? AND owner_id=? AND item_id=?').get(noteId, owner, itemId) as any;
        if (!findNote()) fail('Note not found on this worklist item.', 404);
        const note = once(owner, 'tracker-note-edit', b.requestId, { ...b, itemId, noteId }, () => {
            const before = findNote();
            checkVersion(before, b.version);
            const value = text(b.text, 12000, true), stamp = now();
            db.prepare('UPDATE axon_tracker_notes SET text=?,version=version+1,updated_at=? WHERE id=? AND owner_id=? AND item_id=?').run(value, stamp, noteId, owner, itemId);
            const after = findNote();
            recordHistory(owner, 'tracker', itemId, 'note-edited', { noteId, before, after });
            return after;
        });
        return c.json({ note });
    });
    api.get('/tracking/items/:id/history', c => { const owner = c.get('user').id, id = c.req.param('id'); getItem(owner, id); return c.json({ events: history(owner, 'tracker', id) }); });
    app.route('/api/local', api);
}
