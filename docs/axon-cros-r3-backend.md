# Revision 3 local backend verification

Implemented against preserved source baseline `43801d96fa3f285ddcdcd98d73783911150a1d23`. These results cover the new local backend modules, not live account synchronization, publication or deployment. Root owns final route registration, installed build/version and end-to-end acceptance.

## Implemented

- Canonical owner-scoped Contacts, multiple destinations/roles, local notes and manually recorded interactions. CSV, XLSX and vCard parsing supports field mapping, row errors, explicit commit/cancel, duplicate review, merge provenance/undo and repeat-import suppression. Provider snapshots retain stable external identities, source versions and deletion tombstones without deleting people or app notes. Explicitly selected real directory records can be stored locally; all verification data was synthetic.
- Exactly five Greatness Tracker routines, Monday default 40 and optional persisted future-week defaults. Each week snapshots timezone/targets/queues. Contact/loan counting units are unique; manual completion, undo, notes and history remain scoped to the selected week/day. Friday retains separate loan and referral-partner queues. External handoff URIs never imply a send, call success or completion.
- Marketing content/calendar records, weekend-aware cadence planning, per-channel manual publication records, in-app reminders and due-item consistency counts. Each item owns a stable existing Marketing Assistant conversation; explicit reply-save checks item version, message role, conversation and owner. No generation, reminder or calendar state publishes content.

The new tables are additive. Existing workspace/Pipeline/chat/file schemas are reused. `mountRelationships(app)` and `mountMarketing(app)` expose authenticated `/api/local` routes. Export helpers include the new canonical records; root integrates them into the existing export.

## Verified with isolated synthetic data

Commands from `bot-hq`:

```sh
./node_modules/.bin/tsc -p server/tsconfig.json --noEmit
node --import tsx server/scripts/axon-r3-test.ts
git diff --check
```

All passed. The suite creates and removes a temporary database, starts no external providers, sends no outreach and makes no model requests. It covers:

- CSV quoted values/duplicate headers/leading zeros; actual XLSX workbook import, zero-padding and formula rejection; multiple vCard phone/email values; invalid row errors and mapping; advertised ZIP-size tampering rejected after bounded actual inflation.
- Preview cancellation creates no contacts; commit replay and exact re-import do not multiply records. Ambiguous shared phone matches require review. Merge retains identity/destinations/notes and can be undone without deleting notes.
- Organization-only/email-only provider records remain usable; malformed provider rows do not discard valid rows. Delete-only snapshots deactivate source identity while retaining contact/notes. Reappearance retains identity; archived or changed provider identities cannot silently create another person. Distinct external IDs are not automatically merged merely for identical source fields.
- Foreign-owner access and stale versions fail. Tracker rejects wrong-role/wrong-stage selections. Duplicate selection/completion, undo, totals above target, Friday’s separate queues and existing-week versus future-default edits remain consistent. Contact and Tracker notes share the same stored note.
- Manual publication replay creates one record; caller-provided verified/provider status is rejected. Assistant reply-save cannot use another item’s thread. Selected contact context omits phones/emails and the whole address book.
- Weekend cadence replay preserves IDs. Reconciled reminder slots do not repeat, including a repeated fall-DST hour; reminders never create publication records. A separate Node process reopens the same database and confirms contact/item/thread/reminder persistence. An existing chat message survives all additive migrations.

Independent review found and prompted fixes for wrong Tracker role/stage admission, archived provider-identity duplication and organization/email-only provider records. Those cases are now regression-tested.

## Boundaries

- Google and native Apple adapters are separate integration lanes. Provider-preview/commit support alone is not a live sync, account connection, permission grant or verified iPhone propagation. No agent imported the user’s actual address book during these tests.
- Messaging, calling, publishing and provider-confirmed receipts remain unavailable without a separately supported, authorized integration. Manual outcomes are explicitly manual. No model, publication or sending occurs merely by opening an assistant handoff.
- Reminders are available in-app while the local service runs. Missed intervals coalesce once; this is not an always-on delivery or OS notification service.
- File imports: 5 MB, first XLSX worksheet only, at most 1,000 rows / 50 columns, bounded 50 MB expanded archive. Formula cells require plain-value replacement. Provider previews allow up to 10,000 rows; actual source authorization remains the adapter’s responsibility.
- Added exact dependencies: `exceljs@4.4.0`, `fast-xml-parser@5.12.0`; updated test loader `tsx@4.23.15` for Node 24 transitive-module compatibility. The remaining npm audit report is ExcelJS’s transitive UUID caller-buffer-bounds advisory (two package entries, moderate). This import code does not invoke UUID v3/v5/v6 or caller-provided UUID buffers; no unreviewed downgrade/audit-fix was applied.
