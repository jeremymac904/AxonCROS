# Local text-only mode

`BOT_HQ_MODE=local-text` opens Bot HQ as a local conversation app using the already configured ChatGPT subscription gateway. Orgo, Composio and xAI keys are unnecessary in this mode. `full` remains the default and retains its existing requirements.

## Native setup

Keep the private configuration at `~/Library/Application Support/Bot HQ/.env`. Set `BOT_HQ_MODE=local-text` and preserve the existing `SESSION_SECRET`, `ALLOWED_EMAILS`, `HERMES_URL` and isolated `HERMES_HOME_PRIMARY`. The app and gateway URLs must use `127.0.0.1` and explicit ports. The main `~/.hermes` home is refused, including symlink aliases. Never paste keys into chat or put them in Git.

The Mac wrapper uses `data/local-text.db` separately from the full-mode database. It generates a fresh one-time launch credential, starts its own server, verifies the server instance, and signs in the configured local owner through an HttpOnly session. No Google login, developer email-only login, model login or manual key entry is needed. Opening the URL in a different browser remains locked.

Build, install with backup, and open the Mac app from the repository root:

```bash
./script/build_and_run.sh --verify
```

This updates only Bot HQ. Prior runtime, app bundle and config are retained under `~/Library/Application Support/Bot HQ/backups/`. Existing databases and the separate gateway stay in place. The wrapper is ad-hoc signed, not notarized. It does not start, stop, reconfigure or update main Hermes.

## What works in this mode

- Select Mortgage Team Lead, Loan Officer Assistant, Loan Processing Assistant, Mortgage Marketing Assistant or Mortgage Email Assistant. Each uses the original profile instructions with a stricter local draft-only boundary.
- Create and switch conversations within each assistant; successful messages and replies persist on this Mac. Existing conversations remain under General chat. Switching assistants never moves a conversation or shares its transcript.
- Review the selected assistant’s role and Draft label before sending synthetic text.
- All five mortgage assistants can use relevant excerpts from the packaged local research. Inspect their citations and the Local research library; see [research and citation behavior](local-research.md).
- Send text through the fixed `gpt-6.1-sol` subscription route, with bounded conversation history serialized for the installed Hermes transport.
- See gateway connection status, busy state and a preserved draft when a request fails. Connection status is not proof that subscription allowance remains available.
- Retry an uncertain request with the same ID without repeating completed inference. Known failed/interrupted requests require an explicit new attempt.
- Delete a local conversation after confirmation. A conversation with an active reply cannot be deleted.

Only one reply runs at a time. A reply may take several minutes; the app waits up to five minutes for the gateway. On timeout the upstream request may still finish, so the app never retries automatically and requires a deliberate new attempt. Input is capped at 12,000 characters and local context at 60,000 characters; start another conversation when it reaches the limit. The dedicated gateway separately enforces its subscription guard. Errors are sanitized, and API keys never enter the web interface.

The local server mounts no cloud-computer, voice, Composio, bot-provisioning, MCP, configuration or scheduler routes. Unsupported endpoints return 404. The renderer blocks remote resources and has no file-upload or tool controls. Text is sent to ChatGPT for inference; local history storage does not mean offline inference.

The gateway must already be running. On this Mac its private service controls are documented in `~/Library/Application Support/Bot HQ/gateway/README.md`. An expired existing Codex login must be renewed through Codex normally, followed by restarting only that dedicated gateway. Do not substitute a paid API route.

The [local subscription adapter](../gateway/README.md) handles login-token callbacks during startup, allows a bounded startup acknowledgement wait, and retires timed-out sessions without automatic resubmission. The app rejects known transport diagnostics even when the installed Hermes API labels them completed; a failed request does not become a saved assistant answer or receive citation cards. Existing historical messages are preserved.

## Validation

From `bot-hq`:

```bash
node server/scripts/build-profile-catalog.mjs --check
node server/scripts/build-research-catalog.mjs --check
npm run typecheck
npm run build
node --import tsx server/scripts/local-research-test.ts
node --import tsx server/scripts/local-text-test.ts
```

The integration test uses temporary data and a synthetic local gateway. It verifies no-key startup, authentication, Host/Origin checks, unsupported routes, ownership, migration of existing general chats, all five profile instructions, separate history selection, context serialization, idempotency, failure handling, concurrency, deletion and shutdown. It does not claim live model access. Also test the installed app with two synthetic messages, recall of earlier context, reopening persisted history, and native shutdown. Keep screenshots and private evidence outside Git.

The packaged role catalog preserves the instruction blocks from `mortgage-bot-team/04-bot-profiles.md` verbatim. After an intentional profile edit, regenerate from `bot-hq` with `node server/scripts/build-profile-catalog.mjs`, review the resulting catalog, and rerun the checks above. The installed app loads only the packaged catalog; it does not need access to the source checkout.

## Scope

Use synthetic material while the broader access-control design is under review. The five original mortgage profiles are loaded as selectable draft text assistants. They share one model and serial gateway capacity; they are not five deployed or autonomous bots. Histories are logically separated by assistant and conversation in one local-owner database, not separate accounts or security tenants. The local research is packaged with the app and relevant excerpts are selected for mortgage-assistant replies. This is a saved reference snapshot, not live web research or verification of current rules. Full-mode capacity, shared-filesystem and approval limitations remain unresolved. This mode does not connect borrower records or enable real external actions.
