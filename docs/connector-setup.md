# Connect your own existing accounts

Open **Settings → Connectors** in the Mac app. Configuration, authorization and a
successful read are separate states. A connector becomes checked only after an
explicit successful read. A synthetic test does not connect a real account.

Never paste a password, access token or credential JSON into a conversation.
Google credentials are handled by native code and the macOS Keychain. The three
credential-file integrations use a native chooser and an encrypted private local
store. The web page does not receive their secrets. Disconnect removes local
authorization; use the provider's account settings to revoke its grant too.

If macOS cannot open its file chooser, AxonCROS stops that separate chooser and
offers **Choose by path**, **Retry macOS chooser**, or **Cancel**. Choose by path
accepts one existing local file/folder in a native field, such as a path starting
with `~/Downloads/`. Paste the path, never the file's secret contents. Save-path
recovery requires a new filename and preserves existing files.

| Service | Implemented operation | What you must already have |
| --- | --- | --- |
| Gmail | Read subject/header metadata; no body, attachment, draft or send | Existing permitted Google desktop OAuth client JSON and explicit account consent |
| Google Calendar | Read upcoming primary-calendar events | Same existing Google client; Calendar read consent |
| Google Drive | Read file metadata; no contents/download/write | Same existing Google client; Drive metadata consent |
| Google Sheets | Read a chosen spreadsheet/range, maximum 100 cells | Same existing Google client; Sheets read consent and an accessible spreadsheet |
| Spotify | Read profile and saved-track metadata | Eligible existing developer app/client ID, allowed account and provider consent; development eligibility can require Premium |
| Withings | Read recent measurement values | Existing `user.metrics` access token from your own integration; import a replacement when it expires |
| Finances/Plaid | Read synthetic sandbox-item metadata only | Existing sandbox `clientId`, `clientSecret`, `accessToken` beginning `access-sandbox-`, and `environment` set to `sandbox` |
| WhatsApp Business | Read business-phone configuration only | Existing `accessToken` and `phoneNumberId` with suitable read access |

For Google, choose your existing **Desktop app** OAuth JSON in the native dialog,
review the requested scopes in the provider's consent page, then explicitly
check read access. Sheets also needs the selected spreadsheet ID and bounded
range. Tokens stay out of WebKit. Google Contacts has its own existing setup
under **Contacts** and does not inherit Workspace permissions.

For Spotify, enter only the public client ID. Its registered redirect must allow
`http://127.0.0.1/callback` with the dynamic loopback port used during authorization.
The app uses PKCE and checks the owner/session and returned state. Client secrets
are not required by this flow. Eligibility and development-user limits still
apply; no app configuration can waive them.

For Withings, Plaid and WhatsApp, select a local JSON file containing only the
named fields above (under 32 KB). Choose **Check read access**, then optionally
**Read limited preview**. Previews are temporary and are not automatically sent
to assistants. Setup does not create accounts, buy services, send messages,
publish content, retrieve real banking data or enable agent tool execution.

The owner must approve any new scopes or account permissions. If the provider
requires a new developer account, verification, payment or additional access,
stop at that dependency. The source license does not grant provider access.

Provider documentation: [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
[Google scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification),
[Spotify redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
[Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes),
[Withings authorization](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/get-access/oauth-web-flow/),
[Plaid environments](https://plaid.com/docs/api/#api-host),
[WhatsApp platform pricing](https://business.whatsapp.com/products/platform-pricing).
