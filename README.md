# AxonCROS — a local Mac workspace

AxonCROS is a free, open-source local application for chats, five draft mortgage assistants, research citations, files, contacts, tracking and marketing drafts. Each person runs their own copy on their own Mac. It is not a hosted borrower system or an automatically deployed team.

The application builds on [Nick Vasilescu’s MIT-licensed Bot HQ](https://github.com/nickvasilescu/bot-hq). Upstream attribution is preserved. Project-authored additions use the root [MIT license](LICENSE); artwork has a separate [release policy](ASSET_POLICY.md). Use the sanitized source candidate for redistribution, not the private development history or uncleared artwork.

## Install from source

Requirements: macOS13 or newer for the wrapper, a compatible Node.js22 or newer, Python3, and Xcode command-line tools/Swift. The default Ollama runtime requires macOS14 or newer. From the extracted source directory:

```bash
./script/build_and_run.sh --verify
```

First-time setup creates private local configuration only when it is absent. The installer preserves existing app/runtime/configuration backups. A local model runtime must be configured and running to generate replies; the default `ollama-local` route uses Ollama directly on127.0.0.1:11434, with an explicit context window. `openai-local` is an optional compatibility route. Installing AxonCROS does not download a model, create accounts or purchase inference. Model weights have their own licenses and hardware requirements. Existing explicitly configured subscription-gateway installations remain separate and must not be overwritten.

Read [local installation and release scope](docs/local-oss-release.md), [secure connector setup](docs/connector-setup.md) and [security boundaries](SECURITY.md) before use. The main Hermes installation is outside this app’s ownership. Never paste credentials into chat or commit them.

`bot-hq/.env.example` is an optional legacy **full-mode** template, not the primary Mac setup. Do not copy it over the automatically created local configuration. The app has no automatic hosted-model fallback. A custom user-managed `openai-local` service could itself proxy a cloud service; its behavior and possible costs are the user's responsibility. The default Ollama route accepts local models and rejects remote/cloud model manifests.

## What is local, and what needs access

- Separate conversation histories for General and five draft assistants; packaged mortgage research with saved source excerpts and citations.
- Local files, notes, tasks, tracking and marketing drafts. Local schedules require the app to be running.
- Dated public-source news with source attribution and explicit source failures. Unsupported publisher rights are shown as unavailable, not bypassed.
- Native file selection, owner-scoped Keychain metadata, reviewed folder grants and optional on-device speech. OS permissions and hardware must be available.
- External connectors require the user’s own configured provider access and explicit authorization. A catalogue entry or stored secret is not a verified connection. Provider terms, OAuth scopes and usage charges remain independent of this app’s source license.

The existing five-profile/local-data tests do not establish borrower-data authorization, remote tenant isolation, external sending or full cloud-computer capacity. Full-mode shared-filesystem and approval-bypass limitations remain unresolved. Do not connect real borrower records or claim all connectors are production-ready based on a local build.

## Build, test and prepare a source candidate

```bash
cd bot-hq
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
npm run typecheck
npm run build
node --import tsx server/scripts/local-text-test.ts
node --import tsx server/scripts/axon-r3-test.ts
node --import tsx server/scripts/axon-news-test.ts
node --import tsx server/scripts/axon-avatar-test.ts
node --import tsx server/scripts/axon-connectors-test.ts
node --import tsx server/scripts/local-model-test.ts
cd ..
python3 script/test_source_release.py
python3 script/prepare-source-release.py --output-dir /tmp/axoncros-source-candidate
```

These regression suites use isolated synthetic storage/stub gateways. The source helper requires a clean checkout by default; `--allow-dirty` explicitly labels an uncommitted development candidate. It generates no publication or provider request. The output includes checksums, an exact manifest and the original CC BY4.0 licensed branding/animated characters. Uncleared legacy artwork is omitted or replaced; working originals are preserved.

The native version is declared in `mac-wrapper/script/build.sh`; the installed-source receipt is local to each installation. Historical private acceptance notes are not a current universal release certification. A public binary additionally needs its own packaging, signing/notarization and clean-machine acceptance. See [release gates](docs/local-oss-release.md).
