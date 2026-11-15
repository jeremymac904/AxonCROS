# Connect your own existing accounts

Open **Settings → Connectors** in the Mac app. Configuration, account consent and
checked read access are separate states. A synthetic test does not connect a real
account. These steps use existing accounts and access; **stop before creating an
account, buying a subscription, enabling billing or requesting additional access**.
The owner must personally review any permission grant.

Never paste passwords, tokens or credential JSON into chat. Google credentials
stay in native code and macOS Keychain. Withings, Plaid and WhatsApp credential
files go through a native chooser into encrypted private local storage; their
secrets never enter the web page. Disconnect removes this app's local credentials;
revoke the provider grant separately in that account's settings if desired.

If the native chooser fails, select **Choose by path**, **Retry macOS chooser** or
**Cancel**. The native path field accepts an existing local file/folder, including
`~/Downloads/…`. Paste only the path, never its secret contents. Save-path recovery
requires a new filename and preserves existing files.

## Google: four Workspace connectors

1. Use an existing Google Cloud project and **Desktop app** OAuth client intended
   for AxonCROS. Download its original JSON from **Google Auth Platform → Clients**.
   AxonCROS requires the `installed` JSON format; **Web application** (`web`) JSON
   is unsupported. Do not rename its fields to bypass this check, or borrow another
   app's or Hermes' OAuth client, tokens or configuration. If the correct client is
   missing, stop and have the owner arrange it separately. See [Google Desktop
   OAuth setup](https://developers.google.com/identity/protocols/oauth2/native-app).
2. In that project's API Library, confirm **Gmail API**, **Google Calendar API**,
   **Google Drive API** and **Google Sheets API** are enabled. **People API** is the
   fifth relevant API, needed only for the separate Contacts flow below. Existing
   test-user/organization restrictions must permit the chosen account. Stop at
   billing, verification or administrator-access requirements. See [Google API
   enablement](https://developers.google.com/workspace/guides/enable-apis).
3. Open a Google connector's **View setup → Choose existing OAuth JSON**. Then
   select **Review read-only Google consent** and confirm the intended account in
   Google's browser page. This Workspace grant requests all four scopes together,
   plus `openid` and `email` for account identity:

   | Connector | Scope suffix after `https://www.googleapis.com/auth/` | Implemented read |
   | --- | --- | --- |
   | Gmail | `gmail.metadata` | Subject/header metadata; no body, attachment, draft or send |
   | Calendar | `calendar.events.readonly` | Upcoming primary-calendar events |
   | Drive | `drive.metadata.readonly` | File metadata; no contents, download or write |
   | Sheets | `spreadsheets.readonly` | Explicit spreadsheet ID and range, at most 100 cells |

4. Select **Check read access** for each service; optionally **Read limited
   preview**. Sheets also needs an accessible spreadsheet ID and bounded A1 range.
   Authorization alone does not prove each API works. Previews are temporary and
   are not automatically sent to assistants. A failed check needs its stated
   prerequisite resolved; repeatedly granting permission does not enable an API.

Workspace and Contacts have separate stored grants. Signing into Google, importing
OAuth JSON, or connecting one account does not authorize another account or imply
Contacts access. Restricted scopes may require Google's verification; this app
cannot bypass that review.

## Contacts: reviewed import, separate consent

Open **Contacts → Sync & sources**.

- **Google Contacts:** confirm [People API setup](https://developers.google.com/people/v1/getting-started)
  in the intended project. Choose **Import only**, select **Choose existing OAuth
  configuration** with the proper Desktop JSON, then **Review Google permission**.
  This separate grant uses `contacts.readonly`, plus identity scopes. Select
  **Review contact sync**, choose records, inspect the import/merge preview, and
  explicitly commit. Do not select reviewed provider-update access for import-only
  use; it requests broader permission.
- **Apple Contacts:** select **Review Mac permission**, review macOS access, then
  **Choose contacts to import**. Select records, preview and explicitly commit.
  Permission does not automatically import records or enable continuous sync.
  Available iPhone contacts depend on the owner's existing iCloud/Mac setup.
- CSV, XLSX and vCard import remain available without an account connection.

## Spotify

Development mode requires an **existing Premium app owner** and permits at most
**five allowlisted users**. Add the intended account to the existing developer
app's user allowlist; authorization can succeed while reads fail for an unlisted
user. If Premium or eligible developer access is missing, stop—do not upgrade for
this setup. See [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

Register the following loopback redirect in that existing app, **without a port**;
Spotify permits the dynamic port AxonCROS adds during authorization:

```text
http://127.0.0.1/callback
```

Enter only the public client ID, choose **Prepare Spotify consent**, then **Open
Spotify consent in browser**. The PKCE flow needs no client secret. After consent,
refresh status and explicitly check/read profile or saved-track metadata. See
[Spotify redirect rules](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

## Withings, Plaid and WhatsApp: existing credential files

Choose **View setup → Choose existing credential JSON**, select a local JSON file
under 32 KB containing the fields below, then **Check read access** and optionally
**Read limited preview**. Keep these files private; never commit or share them.

| Service | Required JSON fields | Implemented operation / stopping point |
| --- | --- | --- |
| Withings | `accessToken` with existing `user.metrics` authorization | Read recent measurements. Token import only: AxonCROS does not run Withings OAuth or automatically refresh this token; securely import a replacement after expiry. |
| Finances/Plaid | `clientId`, `clientSecret`, existing item `accessToken` beginning `access-sandbox-`, `environment: "sandbox"` | Synthetic sandbox-item metadata only. Dashboard keys alone are insufficient; an existing sandbox item token is required. No live bank connection, production token or new item provisioning. |
| WhatsApp Business | `accessToken`, numeric `phoneNumberId` with suitable existing access | Business-phone configuration metadata only. A personal WhatsApp login is insufficient. No messages, templates, sending or new business registration. |

**Withings eligibility:** under the Start for Free API plan, Withings accounts
created **after October 12, 2026** need an active **Withings+** membership to share
health data. Accounts created before that date are exempt from this requirement.
The plan allows ten active users before Withings review is needed to exceed the
cap. If required membership or access is missing, stop without purchasing it.
See [Withings plans and dated eligibility](https://static.withings.com/content/api/plans/plans.html)
and [Withings authorization](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/get-access/oauth-web-flow/).

[Plaid Sandbox](https://plaid.com/docs/sandbox/) is distinct from production and
trial access. [WhatsApp phone-number documentation](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers)
and [platform pricing](https://business.whatsapp.com/products/platform-pricing)
remain provider prerequisites, not permission to enable paid messaging.

No connector setup deploys assistants, enables their tool execution, sends
messages, publishes content or imports borrower loan files. Missing accounts,
scopes, eligible subscriptions, approvals or tokens remain explicit setup blockers;
the source license grants no provider access.
