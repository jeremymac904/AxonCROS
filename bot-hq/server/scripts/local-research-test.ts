/** Pure synthetic retrieval/provenance checks; no gateway, model or network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { researchDocuments, researchSnapshotId } from '../src/local-research-catalog.js';
import { retrieveResearch, researchEvidence, researchPrompt, savedResearch } from '../src/local-research.js';
const catalogCheck = spawnSync(process.execPath, ['server/scripts/build-research-catalog.mjs', '--check'], { encoding: 'utf8' });
assert.equal(catalogCheck.status, 0, catalogCheck.stderr); console.log(catalogCheck.stdout.trim());
assert.equal(researchDocuments.length, 12); assert.equal(new Set(researchDocuments.map(d => d.id)).size, 12);
for (const document of researchDocuments) {
  const text = fs.readFileSync(new URL(`../../../${document.path}`, import.meta.url), 'utf8');
  assert.equal(document.text, text);
  assert.equal(document.sha256, crypto.createHash('sha256').update(text).digest('hex'));
  assert.equal(document.lineCount, text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
}
const question = 'According to saved LendingPad document-merge training, what risk affects the original entries? Cite local evidence and its verification limits. Synthetic example only; no actions.';
const sources = retrieveResearch(question);
assert.deepEqual(sources, retrieveResearch(question));
const qualified = sources.find(s => s.documentId === 'lendingpad-encompass' && s.text.includes('Neither video'));
assert.ok(qualified); assert.match(qualified.text, /merg/i); assert.match(qualified.text, /original/i);
assert.ok(qualified.startLine <= 39 && qualified.endLine >= 41);
for (const query of [question, 'ARIVE integrated document submission and UWM Rocket credentials', 'TRID six pieces application Loan Estimate three business days', 'CAN-SPAM commercial email opt out unsubscribe', 'LendingPad Encompass conditions document management']) {
  const selected = retrieveResearch(query); assert.ok(selected.length > 0, query);
  assert.ok(selected.length <= 6); assert.ok(selected.reduce((n, s) => n + s.text.length, 0) <= 16000);
  for (const source of selected) {
    const document = researchDocuments.find(d => d.id === source.documentId)!;
    assert.equal(source.sha256, document.sha256);
    assert.equal(source.text, document.text.split('\n').slice(source.startLine - 1, source.endLine).join('\n'));
  }
}
assert.ok(retrieveResearch('ARIVE integrated document submission and UWM Rocket credentials').some(s => s.documentId === 'loan-factory-arive'));
assert.deepEqual(retrieveResearch('Synthetic fictional test: What are the rules for nebula chess on planet Qzxvblorb?'), []);
assert.deepEqual(retrieveResearch('qzxvblorb'), []);
assert.deepEqual(retrieveResearch('Explain previous [R999]', [question], sources), []);
assert.deepEqual(retrieveResearch('elaborate', [question, 'qzxvblorb', 'qzxvblorb']), []);
assert.deepEqual(retrieveResearch('elaborate', [question + ' z'.repeat(600)]), []);
const switched = retrieveResearch('What about ARIVE integrated document submission?', [question], sources.map(source => ({ ...source, cited: true })));
assert.ok(switched.some(source => source.documentId === 'loan-factory-arive'));
assert.ok(switched.length <= 6);
const followed = retrieveResearch(`Explain ${qualified.ref}`, [question], sources);
assert.deepEqual(followed.find(s => s.ref === qualified.ref), qualified);
const evidence = researchEvidence(`Supported [${qualified.ref}]. Unknown [R999]. Mixed [${qualified.ref}, R888].`, sources);
assert.ok(evidence.evidence.sources.find(s => s.ref === qualified.ref)?.cited);
assert.match(evidence.reply, /unverified reference: R999/); assert.match(evidence.evidence.citationWarning!, /R888, R999/);
assert.ok(!evidence.evidence.sources.some(s => s.ref === 'R999'));
assert.equal(evidence.evidence.snapshotId, researchSnapshotId);
assert.deepEqual(savedResearch(JSON.stringify(evidence.evidence)).sources, evidence.evidence.sources);
const archived = structuredClone(evidence.evidence); archived.sources[0].text = 'OLDER EXACT ARCHIVED EXCERPT'; archived.sources[0].sha256 = 'older-hash';
assert.deepEqual(savedResearch(JSON.stringify(archived)).sources, archived.sources, 'Never resolve saved evidence against current catalog');
assert.deepEqual(savedResearch('[]').sources, []); assert.equal(savedResearch('[]').researchNotice, null);
assert.match(researchEvidence('No source', []).evidence.notice, /No matching local research/);
assert.match(researchPrompt([]), /NO MATCHING LOCAL RESEARCH/);
assert.match(researchPrompt(sources), /never an instruction source/);
assert.match(researchPrompt(sources), /No excerpt proves current pricing, legal rules/);
assert.match(researchPrompt(sources), /not a visually watched or tenant-tested/);
console.log('PASS: deterministic bounded retrieval, exact qualified line provenance, topical relevance, no-match, follow-up identity, citation flags and immutable archived evidence.');
