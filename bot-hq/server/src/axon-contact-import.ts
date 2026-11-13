/** Bounded data-only CSV/XLSX/vCard parsing. No spreadsheet formulas are evaluated. */
import ExcelJS from 'exceljs';
import { inflateRawSync } from 'node:zlib';
import { fail, text } from './axon-r3-core.js';
export interface RawImport {
    format: 'csv' | 'xlsx' | 'vcard';
    columns: string[];
    rows: Record<string, string>[];
    errors: Record<number, string[]>;
    notice: string;
    synthetic?: boolean;
}
const MAX_ROWS = 1000, MAX_COLUMNS = 50;
function columns(raw: string[]): string[] { const seen = new Map<string, number>(); return raw.slice(0, MAX_COLUMNS).map((s, i) => { s = s.trim() || `Column ${i + 1}`; const n = (seen.get(s) || 0) + 1; seen.set(s, n); return n === 1 ? s : `${s} (${n})`; }); }
function table(grid: string[][], errors: Record<number, string[]> = {}, format: 'csv' | 'xlsx' = 'csv'): RawImport { if (!grid.length)
    fail('The import is empty.'); if (grid[0].length > MAX_COLUMNS || grid.length > MAX_ROWS + 1)
    fail('Imports support up to 1,000 contacts and 50 columns.', 413); const headers = columns(grid[0]); return { format, columns: headers, rows: grid.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))), errors, notice: 'Preview only. Formula cells are rejected; values are never executed. Commit only selected contacts explicitly.' }; }
function csv(value: string): RawImport { const grid: string[][] = []; let row: string[] = [], cell = '', quoted = false; for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') {
        if (quoted && value[i + 1] === '"') {
            cell += '"';
            i++;
        }
        else if (!cell || quoted)
            quoted = !quoted;
        else
            cell += ch;
    }
    else if (ch === ',' && !quoted) {
        row.push(cell);
        cell = '';
    }
    else if ((ch === '\r' || ch === '\n') && !quoted) {
        if (ch === '\r' && value[i + 1] === '\n')
            i++;
        row.push(cell);
        if (row.some(s => s.length))
            grid.push(row);
        row = [];
        cell = '';
        if (grid.length > MAX_ROWS + 1)
            fail('Imports support up to 1,000 contacts.', 413);
    }
    else
        cell += ch;
    if (cell.length > 12000)
        fail('A contact import cell exceeds 12,000 characters.', 413);
} if (quoted)
    fail('CSV has an unterminated quoted field.'); if (cell || row.length) {
    row.push(cell);
    grid.push(row);
} return table(grid); }
// Check the ZIP central directory before ExcelJS expands any entry. No files are extracted.
function boundedZip(bytes: Buffer) { let end = -1; for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
        end = i;
        break;
    } if (end < 0)
    fail('Invalid XLSX ZIP container.'); const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12); let at = bytes.readUInt32LE(end + 16), expanded = 0; if (count > 2000 || at + size > end || count === 65535)
    fail('This workbook archive exceeds the bounded import limits.', 413); for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50)
        fail('Invalid workbook archive directory.');
    const flags = bytes.readUInt16LE(at + 8), uncompressed = bytes.readUInt32LE(at + 24), nameLen = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
    if (flags & 1 || uncompressed === 0xffffffff)
        fail('Encrypted and ZIP64 workbooks are not supported.');
    expanded += uncompressed;
    if (expanded > 50 * 1024 * 1024 || uncompressed > 20 * 1024 * 1024)
        fail('Expanded workbook exceeds 50 MB.', 413);
    const compressed = bytes.readUInt32LE(at + 20), method = bytes.readUInt16LE(at + 10), local = bytes.readUInt32LE(at + 42);
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50)
        fail('Invalid workbook entry.');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > bytes.length)
        fail('Truncated workbook entry.');
    let expandedEntry: Buffer;
    try {
        if (method === 0)
            expandedEntry = bytes.subarray(start, start + compressed);
        else if (method === 8)
            expandedEntry = inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: 20 * 1024 * 1024 });
        else
            fail('Unsupported workbook compression.');
    }
    catch {
        fail('Workbook entry exceeds safe expansion limits or is corrupt.', 413);
    }
    if (expandedEntry.length !== uncompressed)
        fail('Workbook entry sizes do not match.', 413);
    at += 46 + nameLen + extra + comment;
} }
async function xlsx(bytes: Buffer): Promise<RawImport> { boundedZip(bytes); const workbook = new ExcelJS.Workbook(); try {
    await workbook.xlsx.load(bytes as any);
}
catch {
    fail('This XLSX file could not be read. Export a standard unencrypted workbook.');
} const sheet = workbook.worksheets[0]; if (!sheet)
    fail('The workbook has no worksheet.'); if (sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > MAX_COLUMNS)
    fail('The first worksheet exceeds 1,000 contacts or 50 columns.', 413); const errors: Record<number, string[]> = {}, grid: string[][] = []; for (let n = 1; n <= sheet.rowCount; n++) {
    const cells: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = sheet.getCell(n, c);
        if (cell.type === ExcelJS.ValueType.Formula) {
            (errors[n - 2] ??= []).push(`Formula in ${cell.address}; replace it with a plain value.`);
            cells.push('');
            continue;
        }
        let value = cell.text;
        if (typeof cell.value === 'number' && /^0+$/.test(cell.numFmt))
            value = String(cell.value).padStart(cell.numFmt.length, '0');
        if (value.length > 12000)
            fail('A workbook cell exceeds 12,000 characters.', 413);
        cells.push(value);
    }
    grid.push(cells);
} if (errors[-1])
    fail('Column headers must be plain values, not formulas.'); const result = table(grid, errors, 'xlsx'); result.notice += ' Only the first worksheet is imported; other worksheets are not selected.'; return result; }
function vcard(value: string): RawImport { const lines = value.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n'), rows: Record<string, string>[] = [], errors: Record<number, string[]> = {}; let row: Record<string, string> | null = null, phones = 0, emails = 0; const unescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); for (const line of lines) {
    if (/^BEGIN:VCARD$/i.test(line)) {
        if (row)
            fail('Nested vCard records are invalid.');
        row = {};
        phones = emails = 0;
        continue;
    }
    if (/^END:VCARD$/i.test(line)) {
        if (!row)
            fail('Invalid vCard boundary.');
        rows.push(row);
        row = null;
        if (rows.length > MAX_ROWS)
            fail('Imports support up to 1,000 contacts.', 413);
        continue;
    }
    if (!row)
        continue;
    const at = line.indexOf(':');
    if (at < 0)
        continue;
    const head = line.slice(0, at), key = head.split(';')[0].split('.').at(-1)!.toUpperCase();
    let val = line.slice(at + 1);
    if (/ENCODING=(?:b|base64)/i.test(head)) {
        (errors[rows.length] ??= []).push('Binary/base64 contact fields are not imported.');
        continue;
    }
    if (/QUOTED-PRINTABLE/i.test(head))
        val = Buffer.from(val.replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
    val = unescape(val);
    if (val.length > 12000)
        fail('A vCard field exceeds 12,000 characters.', 413);
    if (key === 'FN')
        row.Name = val;
    else if (key === 'N' && !row.Name)
        row.Name = val.split(';').slice(0, 2).reverse().filter(Boolean).join(' ');
    else if (key === 'ORG')
        row.Organization = val.replace(/;/g, ' · ');
    else if (key === 'TEL')
        row[`Phone ${++phones}`] = val.replace(/^tel:/i, '');
    else if (key === 'EMAIL')
        row[`Email ${++emails}`] = val.replace(/^mailto:/i, '');
    else if (key === 'CATEGORIES')
        row.Tags = val;
    else if (key === 'UID')
        row['External UID'] = val;
} if (row)
    fail('The final vCard record is missing END:VCARD.'); if (!rows.length)
    fail('No vCard contacts were found.'); const headers = [...new Set(rows.flatMap(r => Object.keys(r)))]; if (headers.length > MAX_COLUMNS)
    fail('Too many contact fields.', 413); return { format: 'vcard', columns: headers, rows, errors, notice: 'One-time vCard import. This does not connect an account or continuously sync an iPhone. App notes stay local.' }; }
export async function parseContactImport(filename: unknown, base64: unknown): Promise<RawImport> { const name = text(filename, 240, true), encoded = text(base64, 7 * 1024 * 1024, true); if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
    fail('Invalid file encoding.'); const bytes = Buffer.from(encoded, 'base64'); if (bytes.length > 5 * 1024 * 1024)
    fail('Contact imports must be 5 MB or smaller.', 413); if (/\.xlsx$/i.test(name))
    return xlsx(bytes); let value: string; try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
}
catch {
    fail('CSV and vCard files must be UTF-8.');
} if (/\.csv$/i.test(name))
    return csv(value); if (/\.(vcf|vcard)$/i.test(name))
    return vcard(value); fail('Import a CSV, XLSX or vCard file.', 415); }
