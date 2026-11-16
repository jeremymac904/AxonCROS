# Model routes

AxonCROS can take its model turns through one of four routes. You choose the
route; the app never switches routes on its own, and no route is ever used as
a silent fallback. If the route you chose cannot serve a turn, the turn stops
and says why.

The route is selected with `AXON_MODEL_PROVIDER` in this Mac's private
configuration file:

```
/Users/<you>/Library/Application Support/Bot HQ/.env
```

Change it, then reopen the Mac app. The app reads that file when it starts.

| `AXON_MODEL_PROVIDER` | Route | Costs money? |
| --- | --- | --- |
| `hermes` | Your dedicated ChatGPT subscription gateway | Included allowance only |
| `ollama-local` | A local model on this Mac | No |
| `openai-local` | Any OpenAI-compatible server on this Mac | Depends on that server |
| `codex-cli` | The Codex CLI installed on this Mac | Included allowance only |
| `openrouter` | OpenRouter, using your own key | **Yes — metered** |

## Your ChatGPT subscription gateway (`hermes`)

The default. Every turn checks the included weekly allowance first and stops
at a conservative stop point you approved, keeping a reserve. Nothing is
dispatched and nothing is retried when the stop point is reached. This route
never spends credits and never buys anything.

## A local model on this Mac (`ollama-local`)

No model account, no allowance and no network. Needs Ollama running with the
model downloaded:

```bash
ollama pull qwen3:4b-instruct
```

Keep Ollama running while you use the app. A local model is free but much
weaker than a frontier model — review its drafts.

## The Codex CLI on this Mac (`codex-cli`)

Uses the Codex CLI that is already installed and signed in with your own
ChatGPT account. **This app never reads, copies or stores your Codex token.**
The CLI authenticates itself from its own profile; the app only points at it.

```bash
AXON_MODEL_PROVIDER=codex-cli
AXON_CODEX_CLI_MODEL=gpt-6.1-sol
```

Limits that are deliberate:

- The CLI's own tools and your personal MCP servers are switched off for this
  route. It produces text and nothing else.
- The model is fixed. There is no provider model fallback.
- It never asks for a paid tier, so it can never fall through to metered
  credits.
- It does **not** hold the subscription reserve the dedicated gateway holds. It
  uses the provider's included window to its natural end and stops when that
  window is exhausted.
- The turn runs in a scratch directory under this app's private storage, in a
  read-only sandbox that cannot read your documents, desktop, downloads or
  credential stores.

## OpenRouter (`openrouter`)

**Metered.** Every token is billed to your own OpenRouter account. It is only
used when you select it and supply your own key, and it is never a fallback.

Put your key in a private file, readable only by you:

```bash
mkdir -p "$HOME/Library/Application Support/Bot HQ"
printf '%s' 'YOUR_OPENROUTER_KEY' > "$HOME/Library/Application Support/Bot HQ/openrouter-key"
chmod 600 "$HOME/Library/Application Support/Bot HQ/openrouter-key"
```

```bash
AXON_MODEL_PROVIDER=openrouter
AXON_OPENROUTER_MODEL=openai/gpt-4o-mini
```

The key is never printed, never sent to a model, never returned to the app
window and never written to a log.

## Checking a route

Settings → Wallet shows the active route, its model and whether it is
available. A status check does not run inference and does not verify answer
quality.

The route test script exercises a real route against a real provider. It is
opt-in and local only:

```bash
cd bot-hq
AXON_TEST_PROVIDER=codex-cli \
AXON_TEST_MODEL=gpt-6.1-sol \
AXON_CODEX_CLI_BIN=/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex \
AXON_CODEX_CLI_HOME=~/.codex \
node --import tsx server/scripts/axon-codex-cli-test.ts
```
