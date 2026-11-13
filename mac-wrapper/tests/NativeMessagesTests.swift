import AppKit
final class MessagesMemory: ContactCredentialStorage {
    var entries: [String: [String: Any]] = [:]
    func read(_ scope: String, _ name: String) -> [String: Any]? { entries[scope+":"+name] }
    func write(_ scope: String, _ name: String, _ value: [String: Any]) { entries[scope+":"+name] = value }
    func remove(_ scope: String, _ name: String) { entries.removeValue(forKey: scope+":"+name) }
}
@main struct NativeMessagesTests {
    @MainActor static func main() async throws {
        var checks: [String] = [], prompts = 0, sends = 0, permission: OSStatus = -1744
        let store = MessagesMemory()
        var delay: UInt64 = 0, failure = false, validOwner = true
        let client = NativeMessages(service: "unused", storage: store, permission: { ask in if ask { prompts += 1; permission = 0 }; return permission }, available: { true }, sender: { _, _ in sends += 1; if delay > 0 { try await Task.sleep(nanoseconds: delay) }; if failure { throw NSError(domain: "synthetic", code: 1) } })
        func check(_ ok: @autoclosure () -> Bool, _ name: String) { guard ok() else { fatalError(name) }; checks.append(name) }
        func call(_ action: String, _ body: [String: Any] = [:]) async -> ([String: Any]?, String?) {
            await withCheckedContinuation { continuation in client.handle(action, body: body, authorize: { if !validOwner { throw NSError(domain: "owner", code: 401) } }) { result, error in continuation.resume(returning: (result as? [String: Any], error)) } }
        }
        func action(_ id: String = UUID().uuidString, text: String = "Synthetic test") -> [String: Any] { ["scope":"owner", "expectedOwner":"owner", "operation":"messages.send", "requestId":id,"args":["recipient":"synthetic@example.invalid","text":text]] }
        var result = await call("messagesStatus")
        check(result.0?["permission"] as? String == "not-determined" && prompts == 0 && sends == 0, "Status never prompts or sends")
        result = await call("executeMessagesAction", action())
        check(result.0?["status"] as? String == "failed" && sends == 0 && prompts == 0, "Unapproved Automation fails without prompt or send")
        result = await call("reviewMessagesPermission")
        check(result.0?["permission"] as? String == "authorized" && prompts == 1 && sends == 0, "Only explicit review requests Automation permission")
        let id = UUID().uuidString
        result = await call("executeMessagesAction", action(id))
        let receipt = result.0?["result"] as? [String: Any]
        check(result.0?["status"] as? String == "completed" && receipt?["acceptedByMessages"] as? Bool == true && receipt?["deliveryStatus"] as? String == "unverified" && sends == 1, "Synthetic acceptance never claims delivery")
        result = await call("executeMessagesAction", action(id))
        check(result.0?["replayed"] as? Bool == true && sends == 1, "Same UUID returns receipt without another message")
        result = await call("executeMessagesAction", action(id,text:"Changed"))
        check(result.0?["status"] as? String == "failed" && sends == 1, "Changed payload cannot reuse send UUID")
        failure = true; let uncertainID = UUID().uuidString
        result = await call("executeMessagesAction", action(uncertainID))
        check(result.0?["status"] as? String == "unknown" && sends == 2, "Transport failure after dispatch is unknown")
        result = await call("executeMessagesAction", action(uncertainID))
        check(result.0?["replayed"] as? Bool == true && sends == 2, "Unknown message never automatically repeats")
        failure = false; delay = 100_000_000
        let pending = Task { @MainActor in await call("executeMessagesAction", action()) }
        try await Task.sleep(nanoseconds: 20_000_000)
        result = await call("executeMessagesAction", action())
        check(result.1 != nil && sends == 3, "Concurrent sends serialize")
        _ = await call("cancelMessagesActions")
        let cancelled = await pending.value
        check(cancelled.0?["status"] as? String == "unknown", "Cancel after dispatch cannot claim a message was recalled")
        validOwner = false; result = await call("executeMessagesAction", action())
        check(result.1 != nil && sends == 3, "Retired owner cannot dispatch")
        validOwner = true
        for args: [String: Any] in [["recipient":"bad\r\nvalue","text":"x"], ["recipient":"+15555550100","text":String(repeating:"x",count:4001)], ["recipient":"synthetic@example.invalid","text":"x","script":"do shell script"]] {
            check((try? NativeMessages.validate(args)) == nil, "Invalid recipient text or arbitrary script rejected")
        }
        let injection = "\"\nend tell\ndo shell script \"unsafe\"\\tail"
        let literal = NativeMessages.literal(injection)
        check(!literal.contains("\n") && literal.contains("\\\"") && literal.contains("\\\\tail"), "AppleScript input is one escaped literal without source line injection")
        let fixed = NativeMessages.script(recipient:"synthetic@example.invalid",text:injection)
        check(fixed.contains("first service whose service type is iMessage") && fixed.contains("with timeout of 20 seconds") && !fixed.contains("chat.db"), "Fixed script uses only iMessage and bounded AppleEvent timeout")
        print(String(data: try JSONSerialization.data(withJSONObject:["passed":true,"checks":checks,"checkCount":checks.count,"realAppleEvents":0,"realMessages":0,"realPermissions":0],options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
    }
}
