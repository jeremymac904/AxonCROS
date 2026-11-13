# AxonCROS native bridge

The existing AppKit/WKWebView host remains the app. Bundle ID `local.bot-hq.desktop`, executable `BotHQ`, default WebKit data store, support/config/database directories and gateway identity are preserved. Display/app destination becomes `AxonCROS.app`. Build does not install; `script/build_and_run.sh` backs up prior installed runtimes and both naming variants during authorized installation.

Only the main frame at `http://127.0.0.1:8787` can call:

```js
const result = await window.webkit.messageHandlers.axoncros.postMessage({action: 'capabilities', language: 'en-US'});
window.addEventListener('axoncros:native', event => {
  const {type, sessionId, state, text, message} = event.detail;
  // Apply only to the owning conversation/session; never auto-send dictation.
});
```

Absent bridge means browser/native capability unavailable, not an empty success. Promise rejects with a bounded user-facing error. IDs use 1–96 ASCII letters/digits/underscore/hyphen; UUIDs are suitable. Audio events are scoped to the supplied session ID; ignore stale IDs.

| Action | Parameters | Result / behavior |
| --- | --- | --- |
| capabilities | optional language | native/filePicker/downloads/secureStore/folderGrants/speechPlayback booleans; dictation on-device availability; microphonePermission and speechPermission (`granted`, `denied`, `notDetermined`); captureState; installed voices `{id,name,language}` |
| startDictation | sessionId, optional language | Requests OS permissions only on this explicit action, starts on-device recognition, returns recording. Emits `dictation` recording/transcribing/complete/cancelled/error. Partial text is preview only; complete text may be inserted at captured cursor, never submitted. Max capture 60s; stop finalization max 8s. |
| stopDictation | sessionId | Stops microphone, ends recognition, emits transcribing then complete/error. If permission is still pending, cancels. |
| cancelDictation | sessionId | Immediately stops/cancels, emits cancelled without text. Stale ID cannot cancel another recording. |
| speak | sessionId, text (1–20,000 chars), optional voice/language/rate | Actual system speech playback; rate is AVSpeech rate clamped 0.1–0.6. Rejects while capture active. Emits speech speaking/complete/cancelled. |
| stopSpeaking | optional sessionId | Stops playback immediately; supplied stale ID cannot stop another session. |
| listSecrets | scope | `{entries:[{name,updatedAt,masked:true}]}`; seconds since epoch. Keychain attributes only. |
| setSecret | scope, name, value | `{ok:true}` after actual Keychain add/update; scope/name 1–96 letters/digits/dot/underscore/hyphen, value ≤16KB. Values never returned/logged. |
| deleteSecret | scope, name | Removes only this app's exact scoped Keychain entry. No provider disconnect implied. |
| listFolderGrants | none | `{grants:[{id,name,path,access:'read-only'}]}` from private native bookmark metadata. |
| chooseFolder | none | Real native directory panel; `{grant}` or `{cancelled:true}`. User explicitly picks one read-only project folder. |
| revokeFolder | grantId | Removes app bookmark grant; future operations fail. Existing imported bytes remain separate saved items. |
| listFolder | grantId, optional relativePath | `{entries:[{name,directory,size}],truncated}` up to 1,000 entries, no hidden entries. |
| readGrantedFile | grantId, relativePath | `{name,base64,size}` for a regular file ≤10MB within the actual selected root; frontend may explicitly import via normal private upload queue. No agent filesystem tool is enabled. |

Secret service is `local.bot-hq.desktop.AxonCROS`, account `${scope}:${name}`. There is deliberately no value-read bridge: saving a secret alone does not configure a connector or make it available to a model. Provider-specific secure consumption needs an authorized integration. Keychain operations do not touch Hermes/Codex credentials.

Folder bookmarks live in the existing support directory as `native-folder-grants.json` mode 0600. Stale bookmarks require deliberate revoke/reselect. Reads resolve symlinks, check root containment and reject credential/system trees and `.env`/`auth.json`. The unsandboxed legacy host's wider OS privileges are not represented as agent permissions; grants govern only these explicit native folder APIs. No background scan/import occurs.

File selection uses an ordinary `<input type=file>` routed through WKUIDelegate/NSOpenPanel. WebKit supplies real File objects; drop handling uses DataTransfer into the same frontend queue. File URLs are not admitted as navigation. Loopback/owned blob downloads use WKDownload and an NSSavePanel. Audio/video library playback uses standard authenticated same-origin media elements. WebKit microphone capture is prompted only for the trusted main frame and microphone-only requests; camera is denied. The frontend owns one audio workflow and must end it before changing agent/conversation.

Capture and speech stop on full-page navigation, WebKit process termination and app quit. No tokens, secrets, source transcripts or raw microphone buffers are logged by the bridge. Native permission/device/audio/file/download/grant acceptance must run in the packaged app; compile success is not those receipts.
