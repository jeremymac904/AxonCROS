# Local Mac source release

The supported target is one user's own Mac and local data. Free source code does
not make external services, model weights, provider accounts or usage free. No
installer grants provider access, connects borrower systems or publishes work.

## Fresh installation

Install Node.js22+ and Xcode command-line tools/Swift first. Extract the sanitized
source candidate, then run `./script/build_and_run.sh --verify`. First setup must
generate fresh random secrets and private storage rather than reuse a developer's
configuration. The setup helper is `node script/setup-local.mjs`; the installer
calls it only when no existing configuration is present. Existing installations
retain their configuration and have app/runtime backups before replacement.

The initial `ollama-local` model route uses Ollama’s direct API on loopback
port11434 with an explicit context window. `openai-local` is an optional
OpenAI-compatible local route. Install/run the runtime and choose a model separately. A model
download can be large and its license/hardware needs must be checked. No model
weights are included or downloaded by this source archive. An unavailable model
must show a setup error rather than fall back to a paid API. Existing explicitly
configured Hermes/subscription routes are preserved; new local installs do not
need private Hermes files or a ChatGPT account.

`bot-hq/.env.example` is the optional legacy full-mode template and retains
external service fields. It is not required for the primary Mac install and
must not replace an existing configuration. The `ollama-local` default rejects
remote/cloud model manifests. The app's adapter has no automatic hosted-model
fallback; however a custom user-managed `openai-local` compatibility service may
internally proxy a cloud provider. Its owner must verify its behavior and costs.
Loopback transport alone is not proof that a separate runtime performs offline
inference. Source licensing and provider/model usage terms remain separate.

Local storage uses the historical `~/Library/Application Support/Bot HQ` location
for compatibility. The app is `~/Applications/AxonCROS.app`. Keep backups private;
they can contain configuration and user data. Do not upload them for debugging.

## Source archive

```bash
python3 script/test_source_release.py
python3 script/prepare-source-release.py --output-dir /tmp/axoncros-source-candidate
```

The helper copies an explicit source allowlist, not a repository directory. It
omits `.git`, private handoffs, local staging, configuration, databases, exports,
dependencies, build products, uncleared legacy artwork and screenshots. Symlinks and
credential-shaped text are rejected; only a placeholder `.env.example` is allowed.
Untracked files are considered only when their paths/types are within the source
allowlist, and a dirty worktree requires `--allow-dirty` in the recorded manifest.

`RELEASE_MANIFEST.json` records source commit, dirty status, file hashes,
transformations and exclusions. `ARTWORK_LICENSE.md` records the owner’s
CC BY4.0 grant for the exact38 AxonCROS/Bot Team files, retained unchanged with
attribution. `SOURCE_EDITION.md` explains the neutral legacy geometry. The archive
does not include private Git history, so publishing the private repository itself
is a different, unaudited action.

Extraction/build checks must run in a temporary directory, with an explicit temporary
`--support` directory or isolated NativeVerificationProfile for setup tests, and
isolated synthetic databases for server tests. Do not repurpose HOME. Never
point verification at the installed owner's storage or main Hermes. The source
helper refuses output inside the checkout and never overwrites an existing
candidate. SHA-256 checksums detect changed archive bytes; they are not a publisher
signature or notarization ticket.

## Release gates

Before any public publication, record the exact commit/archive checksum and:

1. Pass source-archive exclusion/hash tests, clean extraction, lockfile install,
   typecheck/build and synthetic API/native component regressions.
2. Verify a fresh local setup and actual app launch/relaunch with no pre-existing
   developer config. Verify existing installs preserve data/configuration.
3. Review licenses/notices and packaged dependency inventory. Include upstream
   MIT, root MIT, CC BY4.0 artwork attribution/legalcode, third-party notices and any bundled Node LICENSE.
4. Review the current dependency audit. The scoped ExcelJS override uses patched
   uuid11.1.1; verify XLSX import and v4 compatibility rather than downgrading
   ExcelJS to satisfy an automated suggestion.
5. Review privacy and provenance. Automated source scanning is not a guarantee
   against personal data, and does not review material deliberately excluded.
6. Label each connector by actual supported read/write operations, authorization
   and tested status. OAuth consent/revocation and provider-side limits remain
   real prerequisites; synthetic fixtures are not live-provider acceptance.

An optional ad-hoc-signed Mac package is a test candidate, not a notarized release.
Build it on an Apple Silicon Mac with
`bash script/package_macos.sh <extracted-sanitized-source> <output-directory>`.
It includes official Node24.20.0, verified against a pinned checksum and the
official HTTPS checksum list, plus its license and production npm dependencies.
The download's PGP signature is not verified by this helper. It builds native
dependencies using the bundled Node ABI and verifies SQLite before packaging.
This binary targets Apple Silicon and macOS13.5 or newer, matching
[Node24's supported platform floor](https://github.com/nodejs/node/blob/v24.20.0/BUILDING.md#platform-list).
It does not bundle a model or model runtime, and never installs or launches itself.
The default [Ollama runtime requires macOS14 or newer](https://docs.ollama.com/macos).
Trusted public binary distribution requires an appropriate Developer ID identity,
hardened-runtime/entitlement review, notarization and clean-Mac Gatekeeper testing.
Do not disable Gatekeeper or remove quarantine as a substitute for that release
process. Source builds remain available without purchasing a signing service.

## Limits

This is not a hosted multi-user product. Mortgage assistants remain local drafts
with shared local model capacity, not independently deployed bots. Real borrower
connections, remote collaboration/invitations and automatic external sends are
outside the verified scope. Native speech, Finder drop and personal-app handoffs
retain their separately documented hardware/permission verification requirements.
No public release, new provider account, spending or outreach occurs merely by
preparing or testing a candidate.
