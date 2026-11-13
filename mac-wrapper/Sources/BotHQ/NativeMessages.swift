import AppKit
import ApplicationServices
import CryptoKit

/// Explicit macOS Automation consent, fixed iMessage-only AppleScript, and a
/// private journal. No chat.db, Full Disk Access, shell, attachments or SMS fallback.
final class NativeMessages {
    struct Failure: LocalizedError { let text: String; var errorDescription: String? { text } }
    static let supportedBundleIdentifiers = ["com.apple.MobileSMS", "com.apple.iChat"]
    /// Resolve once per native client, so availability, consent and sending target
    /// the same installed Messages application. No application is launched here.
    static func resolveBundleIdentifier(
        lookup: (String) -> URL? = { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) },
        identity: (URL) -> String? = { Bundle(url: $0)?.bundleIdentifier }
    ) -> String? {
        supportedBundleIdentifiers.first { id in
            guard let url = lookup(id) else { return false }
            return identity(url) == id
        }
    }
    let applicationBundleIdentifier: String?
    private let storage: ContactCredentialStorage
    private let permission: (Bool) -> OSStatus
    private let available: () -> Bool
    private let sender: (String, String) async throws -> Void
    private var busy = false
    private var generation = 0
    init(service: String, storage: ContactCredentialStorage? = nil,
         permission: ((Bool) -> OSStatus)? = nil, available: (() -> Bool)? = nil,
         sender: ((String, String) async throws -> Void)? = nil) {
        self.storage = storage ?? ContactSecrets(service: service)
        let bundleID = Self.resolveBundleIdentifier()
        self.applicationBundleIdentifier = bundleID
        self.permission = permission ?? { ask in
            guard let bundleID else { return OSStatus(-600) }
            return Self.checkPermission(ask, bundleIdentifier: bundleID)
        }
        self.available = available ?? { bundleID != nil }
        self.sender = sender ?? { recipient, text in
            guard let bundleID else { throw Failure(text: "The supported Messages app is unavailable.") }
            try await Self.sendFixedScript(recipient, text, bundleIdentifier: bundleID)
        }
    }
    static func checkPermission(_ ask: Bool, bundleIdentifier id: String) -> OSStatus {
        guard supportedBundleIdentifiers.contains(id) else { return OSStatus(-600) }
        var target = AEAddressDesc()
        let result = id.withCString { AECreateDesc(DescType(typeApplicationBundleID), $0, id.utf8.count, &target) }
        guard result == noErr else { return OSStatus(result) }; defer { AEDisposeDesc(&target) }
        return AEDeterminePermissionToAutomateTarget(&target, AEEventClass(typeWildCard), AEEventID(typeWildCard), ask)
    }
    static func permissionName(_ code: OSStatus) -> String { code == noErr ? "authorized" : code == -1744 ? "not-determined" : code == -1743 ? "denied" : "unavailable" }
    func status(ask: Bool = false) -> [String: Any] {
        let installed = available(), code = installed ? permission(ask) : OSStatus(-600)
        return ["available": installed, "permission": Self.permissionName(code), "configured": installed && code == noErr,
                "transport": "native-messages", "direction": "send-only", "historyAccess": false, "deliveryVerification": false,
                "notice": code == noErr ? "Uses the Mac’s signed-in iMessage service. A successful action means Messages accepted it; delivery is not verified." : "Open and sign in to Messages, then explicitly review Automation permission. No message history or Full Disk Access is requested."]
    }
    func handles(_ action: String) -> Bool { ["messagesStatus", "reviewMessagesPermission", "executeMessagesAction", "cancelMessagesActions"].contains(action) }
    func handle(_ action: String, body: [String: Any], authorize: @escaping @MainActor () async throws -> Void, reply: @escaping (Any?, String?) -> Void) {
        if action == "cancelMessagesActions" { generation += 1; reply(["cancelled": true], nil); return }
        if action == "messagesStatus" { reply(status(), nil); return }
        if action == "reviewMessagesPermission" {
            // Only a direct UI bridge action reaches this path. Execution never
            // calls ask=true or silently grants permission on the model's behalf.
            Task { @MainActor in do { try await authorize(); reply(status(ask: true), nil) } catch { reply(nil, "Unlock this local session before reviewing Messages permission.") } }; return
        }
        guard action == "executeMessagesAction", let owner = body["scope"] as? String, body["expectedOwner"] as? String == owner,
              let requestId = body["requestId"] as? String, UUID(uuidString: requestId) != nil,
              body["operation"] as? String == "messages.send", let args = body["args"] as? [String: Any] else { reply(nil, "Invalid owner-bound Messages action."); return }
        guard !busy else { reply(nil, "A Messages action is already running. Nothing new was dispatched."); return }
        busy = true; let captured = generation
        Task { @MainActor in
            defer { busy = false }
            var dispatched = false
            let key = "action-" + requestId.lowercased()
            var fingerprint = ""
            func check() async throws {
                try await authorize(); guard captured == self.generation else { throw Failure(text: "Messages action was cancelled.") }
            }
            do {
                try await check(); try Self.validate(args)
                guard available(), permission(false) == noErr else { throw Failure(text: "Messages Automation permission is unavailable. Open Messages and use Review permission in Connectors first.") }
                let encoded = try JSONSerialization.data(withJSONObject: ["operation": "messages.send", "args": args], options: .sortedKeys)
                fingerprint = SHA256.hash(data: encoded).map { String(format: "%02x", $0) }.joined()
                let prior: [String: Any]?
                do { prior = try storage.read(owner, key) } catch {
                    reply(["requestId": requestId, "operation": "messages.send", "status": "unknown", "error": "Prior native receipt is unavailable. Nothing was dispatched now; review Messages before another attempt."], nil); return
                }
                if let prior {
                    guard prior["hash"] as? String == fingerprint else { throw Failure(text: "This request ID belongs to different message arguments.") }
                    var result = prior["output"] as? [String: Any] ?? ["requestId": requestId, "operation": "messages.send", "status": "unknown", "error": "A prior attempt may have been accepted by Messages. Do not repeat it blindly."]
                    result["replayed"] = true; reply(result, nil); return
                }
                try await check()
                try storage.write(owner, key, ["hash": fingerprint, "state": "pending", "createdAt": Date().timeIntervalSince1970])
                dispatched = true
                try await sender(args["recipient"] as! String, args["text"] as! String)
                try await check()
                let output: [String: Any] = ["requestId": requestId, "operation": "messages.send", "status": "completed", "replayed": false,
                    "result": ["acceptedByMessages": true, "deliveryStatus": "unverified", "transport": "iMessage", "notice": "Messages accepted this action. This is not a delivery or read receipt."]]
                try storage.write(owner, key, ["hash": fingerprint, "state": "completed", "output": output]); reply(output, nil)
            } catch {
                let output: [String: Any] = ["requestId": requestId, "operation": "messages.send", "status": dispatched ? "unknown" : "failed", "replayed": false,
                    "error": dispatched ? "Messages may have accepted this message. Nothing was retried; check the app before a new request." : ((error as? Failure)?.text ?? "Messages could not start safely.") + " No message was dispatched."]
                // Owner/queue loss cannot save a receipt into a retired session.
                if (try? await authorize()) != nil {
                    if dispatched { try? storage.write(owner, key, ["hash": fingerprint, "state": "unknown", "output": output]) }
                    reply(output, nil)
                } else { reply(nil, "The local action session ended. Check Messages before repeating any dispatched action.") }
            }
        }
    }
    static func validate(_ args: [String: Any]) throws {
        guard Set(args.keys) == Set(["recipient", "text"]), let recipient = args["recipient"] as? String,
              recipient.utf8.count <= 254, recipient.range(of: "^\\+[1-9][0-9]{6,14}$|^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", options: .regularExpression) != nil,
              let text = args["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf8.count <= 4000,
              !text.contains("\0"), !recipient.unicodeScalars.contains(where: { $0.value == 10 || $0.value == 13 }) else { throw Failure(text: "Use one explicit iMessage email or international phone number and a message up to 4,000 bytes.") }
    }
    static func literal(_ text: String) -> String {
        "\"" + text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "\\r").replacingOccurrences(of: "\n", with: "\\n").replacingOccurrences(of: "\t", with: "\\t") + "\""
    }
    static func script(recipient: String, text: String, bundleIdentifier: String) throws -> String {
        guard supportedBundleIdentifiers.contains(bundleIdentifier) else { throw Failure(text: "Unsupported Messages application.") }
        return """
        with timeout of 20 seconds
          tell application id \(literal(bundleIdentifier))
            set targetService to first service whose service type is iMessage
            set targetBuddy to buddy \(literal(recipient)) of targetService
            send \(literal(text)) to targetBuddy
          end tell
        end timeout
        return "AXON_MESSAGES_ACCEPTED"
        """
    }
    private static func sendFixedScript(_ recipient: String, _ text: String, bundleIdentifier: String) async throws {
        let source = try script(recipient: recipient, text: text, bundleIdentifier: bundleIdentifier)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
                process.arguments = ["-l", "AppleScript", "-"]
                process.environment = ["PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"]
                process.standardInput = input; process.standardOutput = output; process.standardError = errors
                do {
                    try process.run()
                    input.fileHandleForWriting.write(Data(source.utf8)); try? input.fileHandleForWriting.close()
                    let deadline = Date().addingTimeInterval(30)
                    while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
                    if process.isRunning { process.terminate(); Thread.sleep(forTimeInterval: 0.1); if process.isRunning { kill(process.processIdentifier, SIGKILL) }; throw Failure(text: "Messages request timed out; outcome is unknown.") }
                    let bytes = output.fileHandleForReading.readDataToEndOfFile()
                    guard process.terminationStatus == 0, bytes.count <= 1024,
                        String(data: bytes, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) == "AXON_MESSAGES_ACCEPTED" else { throw Failure(text: "Messages did not confirm acceptance.") }
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
}
