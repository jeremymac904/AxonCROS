# Source code and artwork release scopes

Project-authored code and documentation are MIT licensed under the root
`LICENSE`. Upstream Bot HQ’s original MIT notice remains in `bot-hq/LICENSE`.
Dependency licenses remain applicable independently; retain their notices when
redistributing a runtime.

Jeremy McDonald explicitly confirmed redistribution rights on2026-11-13 and
licensed the supplied AxonCROS logos and Captain, Pixel, Bolt, Nova and Scout
artwork under CC BY4.0. [ARTWORK_LICENSE.md](ARTWORK_LICENSE.md) identifies all38
covered files and required attribution; the source manifest records their exact
hashes. Original branding and animations remain unchanged in the source release.

The working checkout also contains artwork **not cleared here for public
redistribution**: restored xAI/Cursor design exports, third-party app logos and
screenshots. The MIT code license does not grant rights to that unrelated art.

`script/prepare-source-release.py` prepares a separate source archive. It never
changes or deletes working artwork. The archive excludes Git history, local
configuration/builds, historical private handoffs and uncleared artwork. It
retains only the exact owner-licensed logos/Bot Team files and generates original
neutral geometry for excluded legacy shape/icon data. Local-mode icons continue
to use the separately licensed Lucide dependency. The manifest records every
exclusion, replacement and packaged file hash.

The sanitized archive is a release candidate, not an automatic publication
approval. It does not claim all connectors are connected, model weights are
licensed by this project, or a Mac binary is notarized. Public source publication
must use the reviewed archive rather than changing visibility of the private
history. Future additional artwork needs its own recorded origin, rights and
attribution before inclusion. Publisher material, contacts and model output are
not relicensed by the source-code license.
