# Google actions in local chats

The Google agent mode adds real read and write operations to the local Mac app.
It uses the configured model to choose from fixed native Google operations.
Connecting an account and enabling agent mode are separate steps. Existing chats,
history and credentials keep their storage identifiers.

## Access

Use a Desktop OAuth client intended for this app in your existing Google project.
Enable Gmail, Calendar, Drive, Sheets and People APIs. Google Workspace may require
an administrator to allow this exact client under **Specific Google data**. Do not
trust every internal app or change another application's client to accomplish this.

The new Workspace grant requests these scopes, plus `openid` and `email`:

| Service | Scope suffix after `https://www.googleapis.com/auth/` | Supported purpose |
| --- | --- | --- |
| Gmail | `gmail.modify` | Search/read mail, create drafts, send mail, labels and trash |
| Calendar | `calendar.events` | Read, create and update events |
| Drive | `drive` | List/read supported files, create, update, move and trash |
| Sheets | `spreadsheets` | Read cells, create spreadsheets, write and append cells |
| Contacts | `contacts` | Search, create and update contacts |

Google's Drive and Contacts scopes include deletion powers. The native agent
operation catalog does not expose permanent deletion or access-sharing operations.
Gmail's `gmail.modify` scope excludes immediate permanent deletion. Scopes are
broader than any individual task; review Google's consent text for the full grant.

OAuth tokens stay in this app's macOS Keychain namespace. They are not returned
to the web page, local model, chat or logs. The older reviewed Contacts import/sync
connection remains separate. Removing this app's local grant does not revoke
other apps' grants in a shared Google project.

## Delegation

Enable agent mode in the intended conversation and authorize sending retrieved
Google results to the configured model. The existing ChatGPT gateway uses the
existing subscription; a locally hosted model uses its configured local endpoint.
Neither mode enables a new paid fallback.

- **Review each write:** read operations run; proposed writes show their exact
  arguments for approval.
- **Delegate actions in this chat:** supported writes can run automatically for
  the user's request. Unapproved outbound recipients still require review.

External content is reference data, not authority to change the task. Do not
enable delegation on a conversation that should remain a draft. Borrower-data
authorization and hosted multi-user isolation remain separate unresolved gates;
use synthetic mortgage records during testing.

## Receipts and recovery

The app records the owner, conversation, operation, arguments and result for each
action. These records are private local data. The native executor uses fixed
Google endpoints and bounded inputs/results; it does not execute arbitrary URLs,
scripts or shell commands from the model.

Current operation limits: Gmail reads plain-text parts, without automatically
fetching attachments. Drive reads text, Markdown, CSV, JSON, Google Docs exports
and the first 20 PDF pages, with bounded returned text and a 2 MB response cap.
Drive edits require a returned HTTP ETag and fail if the provider cannot supply
one. Sheets writes use RAW values and at most 500 cells, so text beginning with
`=` is not automatically interpreted as a formula.

Keep the Mac app open while actions run. Stop ends further dispatch; an already
sent provider request may still complete. An unknown outcome must be inspected
in the provider before another attempt. The app does not automatically repeat
an ambiguous send or write after timeout, cancellation or restart.

Provider consent, API checks, synthetic operation tests and real provider writes
are distinct verification stages. A successful mocked test is not proof that an
account is connected or that a particular live action succeeded.

See Google's [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[Calendar scopes](https://developers.google.com/workspace/calendar/api/auth),
[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes), and
[People updates](https://developers.google.com/people/api/rest/v1/people/updateContact).
