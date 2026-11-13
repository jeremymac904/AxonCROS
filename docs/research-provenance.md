# Packaged mortgage research provenance

The source package contains exactly12 allowlisted project-authored Markdown
documents under `mortgage-bot-team/`: research summaries, a source registry,
five draft assistant profiles, operating boundaries and synthetic test plans.
`server/scripts/build-research-catalog.mjs --check` verifies that the compiled
catalog is an exact representation of those files, not additional source data.
The release manifest records their paths and individual SHA-256 hashes.

A scoped pre-release review on2026-11-13 found no raw third-party transcript,
full article, downloaded training recording, borrower document or customer
record in those12 files. Identifier-pattern checks found no email addresses,
phone numbers, SSN patterns or borrower/customer identity assignments. The
worked handoff uses an explicit synthetic case identifier. This is a scoped
review of these files, not a guarantee about private history or future edits.

The platform guides include concise project-authored observations from public
written guidance and caption transcripts, with publisher/video URLs, dates,
time ranges and limitations. They distinguish public text, course outlines,
gated/unseen videos and unverified account-specific behavior. The raw transcripts
and media are not bundled. Public speaker/vendor names used in source attribution
are not represented as borrower/customer records.

Source links do not grant rights to the linked material. Publisher text, videos,
trademarks and model output are not relicensed by the project's MIT license.
Original summaries/profiles are project documentation; retain source attribution
when using them. No publisher endorsement, current legal verification, platform
authorization or production lending readiness is implied.

This is a historical reference snapshot, principally November11,2026. Changes in
rules, vendor interfaces, account configuration and permissions require fresh
authorized verification. It must not be used as a substitute for the original
documents, professional review or an approved borrower-data system. Future
research additions need another privacy/provenance review before joining the
release allowlist; the packager does not copy arbitrary research-folder files.
