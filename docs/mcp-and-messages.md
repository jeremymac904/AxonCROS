# MCP and Mac Messages

These are optional local connections. Installing the source does not connect an account, authorize a message, or purchase service usage. Existing Google grants and conversation permissions are separate.

## Zapier and Buffer

Open Settings → Connectors, then **Manage Buffer MCP** or **Manage Zapier MCP**.

1. Use your existing provider account. For Zapier, use a separate managed server with only the actions you intend to enable. Buffer supports a personal API key for a locally run copy.
2. Save the credential to a private local JSON file with one `connectionToken` property. Select it with **Choose existing credential JSON** in the Mac app. Never put credentials in chat or source control.
3. Choose **Discover tools**. This initializes MCP and lists tools; it does not execute an app action. The app accepts only `https://mcp.zapier.com/api/v1/connect` and `https://mcp.buffer.com/mcp`. Custom URLs, redirects and command-based servers are not supported.
4. Check your existing plan allowance before saving the allowance confirmation. Each successful Zapier app action, including reads, consumes two Zapier tasks. Keep pay-per-task overages disabled when using an included allowance. Buffer's free plan includes API/MCP access within its account limits. The app cannot verify your billing settings or remaining quota.
5. Enable specific discovered tools. All begin disabled. Review requires the exact arguments to be approved; eligible delegated tools run only in a conversation where you explicitly enable that connection and model-context consent.

Provider tokens stay in the owner's encrypted local vault. They are not returned to the renderer or model. Token rotation, schema changes, disconnecting or revoking permission invalidates pending work. A provider timeout may mean an action completed; uncertain results are never automatically retried. Check provider history before attempting it again.

Buffer draft creation requires `saveToDraft: true` and exact review. Post editing, direct publishing, deletion and arbitrary GraphQL are blocked until a verified adapter can safely support them. Zapier administration, account provisioning and code execution are not exposed. External messaging tools require exact review.

WhatsApp is built directly into AxonCROS through its own QR-linked session, separate from Hermes and Zapier; no WhatsApp Business API account is required for that connection. Follow the [direct WhatsApp setup guide](direct-whatsapp.md). Any optional Zapier business integration is a separate path and works only if its specific provider account and action are supported; discovery alone does not establish access.

Enable MCP separately in a chat, select its allowed connections and acknowledge that retrieved results can enter the configured model. Only then request a specific synthetic test. Verify the saved provider receipt; a successful discovery is not a successful action.

## Using a local model for connected actions

Agent mode works with a locally hosted model as well as the hosted subscription.
The model chooses the MCP tool; the app still validates the proposed arguments
against the full discovered schema and the saved per-tool policy, and only the
fixed provider endpoint is called. A local model therefore needs no hosted
allowance and makes no paid inference call.

One provider tool can ship a very large schema. When a single tool schema is
larger than 2 KB, the model is shown a simplified planning summary of that
tool's fields instead of its full schema, so one oversized schema cannot
consume a bounded local-model input budget. The action itself is still
validated against the complete discovered schema before dispatch, and a
simplified summary never widens what a tool permits.

Official references: [Zapier connection methods](https://docs.zapier.com/mcp/overview/how-connections-work), [Zapier usage](https://docs.zapier.com/mcp/overview/usage), [Buffer MCP](https://developers.buffer.com/guides/integrations/mcp), [Buffer limits](https://developers.buffer.com/guides/api-limits.html).

## iMessage on a Mac

The signed-in Messages application must already be available. AxonCROS uses a fixed, validated iMessage operation; it does not run model-supplied scripts or read Messages history.

Choose **Review Mac permission** to request the macOS Automation grant. Then enable Messages in a specific chat with context consent and either exact-write review or delegated actions. Each send requires a single explicit email address or international phone number and plain text. The durable receipt records acceptance by Messages, not delivery to the recipient. Check Messages for actual delivery. Unknown outcomes are not retried.

The Mac app must remain open. Incoming synchronization, group messaging, SMS fallback and Full Disk Access are not part of this connector. No Messages permission is requested by installation or background status checks.

## Private email signatures

An optional signature package can live outside the checkout at `~/Library/Application Support/Bot HQ/email-signature`. The native sender validates its owner-only manifest, account match, file hashes and 12 inline CID image assets before building the MIME message. Model arguments remain plain text. A configured package that fails validation blocks sending before any network call. Personal signature assets and sender identity are never included in the public source.

## Synthetic verification

Run `node --import tsx server/scripts/axon-mcp-test.ts` from `bot-hq` and the native scripts `test_native_email_signature.sh` and `test_native_messages.sh` from the repository root under `mac-wrapper/script`. These use fake transports and temporary storage; they do not send email, iMessages, posts or paid MCP calls. Actual provider authorization and live receipts remain separate acceptance steps.

`node --import tsx server/scripts/axon-model-mcp-test.ts` is an **opt-in,
local-only** model-driven acceptance check. Without `AXON_MCP_TEST_PROFILE` it
skips cleanly, so it is safe in continuous integration and never needs a
credential. When it is pointed at an isolated owner profile and a local model
endpoint, it lets the model choose a delegated read tool, lets the app validate
and dispatch it, and asserts that no write tool was attempted or executed. It
runs against a separate database and its own copy of the connector key, and
reports only tool names, states and error codes — never a credential, token or
provider payload.

