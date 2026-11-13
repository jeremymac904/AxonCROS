# Direct WhatsApp in AxonCROS

AxonCROS can link your existing WhatsApp account directly using a QR code, with the same Baileys/WhatsApp Web approach used by Hermes. It does not use Zapier or require a WhatsApp Business API account. This is an unofficial integration: WhatsApp protocol changes can require re-pairing, and third-party clients can face account restrictions. Existing phone/account/data-plan conditions still apply.

## Connect your own device

1. Open **Settings → Connectors → WhatsApp on this Mac → Set up direct WhatsApp**.
2. Read the linked-device acknowledgment, then choose **Start QR pairing**.
3. On your phone, open **WhatsApp → Settings → Linked Devices → Link a Device**. Check that it is the account you intend to use, then scan the private QR shown in AxonCROS.
4. Wait for **Connected linked device**. Do not share the QR or copy credentials into chat.

The AxonCROS device has its own encrypted credentials and Signal keys in its owner-scoped local store. It neither reads nor changes Hermes sessions. Nothing connects automatically on startup; use **Resume saved connection** after reopening the app. Pairing alone sends no messages.

## Receive only selected new text

Enter explicit international numbers, including `+country code`, in the receiving allowlist. An empty list accepts nothing. AxonCROS keeps at most 200 new direct text messages received while connected; it does not import message history, download media, retrieve link previews, or accept groups/statuses. Sender identifiers that cannot be resolved safely are ignored.

The inbox is local reference data. No model call or automatic reply happens when a message arrives.

## Permit a conversation

Open a chat’s **Direct WhatsApp** permissions, choose its allowed international numbers, and explicitly consent to model context. Only new locally retained text matching both that chat’s allowed numbers and the current receiving allowlist can be included in subsequent model turns. With a remote model, allowed text and recipients leave the Mac for that configured model.

Choose **Review each exact recipient and message**, or explicitly delegate sends requested in that chat. The assistant cannot send to a number outside the chat’s allowed list. Delegated requests for recipients absent from the current user message still require exact review. Incoming messages never become permission to send or instructions overriding the user.

## Receipts and stopping

A successful send receipt means WhatsApp accepted the request, not that the phone received or read it. Dispatched requests without a confirmed result remain uncertain and are never automatically repeated. Check WhatsApp on your phone before deliberately requesting another attempt.

**Pause WhatsApp** stops that chat’s queued actions. **Stop this connection** closes the AxonCROS link while preserving its encrypted session for explicit resume. Removing the saved session affects only AxonCROS; to remove the device from the account’s linked-device list, use the phone’s **Linked Devices** settings. Previously saved local inbox text remains local, but disabled chat permissions prevent its automatic model inclusion.

No actual pairing, account access, message delivery or deployed assistant is established by the synthetic tests. The owner must complete and verify the phone pairing step.
