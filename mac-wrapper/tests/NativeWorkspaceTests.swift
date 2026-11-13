import AppKit
import Foundation
final class WorkspaceMemorySecrets: ContactCredentialStorage {
    var records: [String: [String: Any]] = [:]
    func read(_ scope: String, _ name: String) -> [String: Any]? { records[scope + ":" + name] }
    func write(_ scope: String, _ name: String, _ value: [String: Any]) { records[scope + ":" + name] = value }
    func remove(_ scope: String, _ name: String) { records.removeValue(forKey: scope + ":" + name) }
}
final class WorkspaceFixtureProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var response: (URLRequest) -> (Int, [String: Any]) = { _ in (500, [:]) }
    static var delay: TimeInterval = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request); let (code, body) = Self.response(request)
        let respond = { [self] in
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: body)); client?.urlProtocolDidFinishLoading(self)
        }
        if Self.delay > 0 { DispatchQueue.global().asyncAfter(deadline: .now() + Self.delay, execute: respond) } else { respond() }
    }
    override func stopLoading() {}
}
@main struct NativeWorkspaceTests {
    @MainActor static func main() async throws {
        var checks: [String] = []
        func check(_ value: @autoclosure () -> Bool, _ text: String) { guard value() else { fatalError(text) }; checks.append(text) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [WorkspaceFixtureProtocol.self]
        let session = URLSession(configuration: config), storage = WorkspaceMemorySecrets()
        let adapter = NativeGoogleWorkspace(service: "synthetic-never-keychain", storage: storage, transport: session)
        let owner = "synthetic-owner", scopes = NativeGoogleWorkspace.scopes.values.sorted().joined(separator: " ")
        func seed(_ expires: Double = Date().timeIntervalSince1970 + 3600) {
            storage.records[owner + ":client"] = ["client_id": "synthetic.apps.googleusercontent.com"]
            storage.records[owner + ":authorization"] = ["access_token": "FAKE_NATIVE_TEST_TOKEN", "refresh_token": "FAKE_NATIVE_REFRESH", "scope": scopes, "expiresAt": expires, "accountName": "synthetic@example.invalid", "accountId": "synthetic-account"]
        }
        func call(_ action: String, _ extra: [String: Any] = [:]) async -> ([String: Any]?, String?) {
            await withCheckedContinuation { continuation in adapter.handle(action, body: ["scope": owner].merging(extra) { _, new in new }, window: nil) { result, error in continuation.resume(returning: (result as? [String: Any], error)) } }
        }
        var result = await call("googleWorkspaceStatus")
        check(result.0?["configured"] as? Bool == false, "Fresh setup is unconfigured without network")
        check(WorkspaceFixtureProtocol.requests.isEmpty, "Status never fetches providers")
        seed(); result = await call("googleWorkspaceStatus")
        let initial = result.0?["connectors"] as? [[String: Any]] ?? []
        check(initial.count == 5 && initial.allSatisfy { $0["authorized"] as? Bool == true && $0["connected"] as? Bool == false }, "Granted scopes are authorized but not claimed checked")
        let serialized = String(data: try JSONSerialization.data(withJSONObject: result.0!), encoding: .utf8)!
        check(!serialized.contains("FAKE_NATIVE"), "Native status excludes token values")
        WorkspaceFixtureProtocol.response = { request in
            let path = request.url!.path
            if path.hasSuffix("/connections") { return (200, ["totalPeople": 1, "connections": [["resourceName": "people/one", "names": [["displayName": "Synthetic contact"]]]]]) }
            if path.hasSuffix("/messages") { return (200, ["resultSizeEstimate": 1, "messages": [["id": "abc123"]]]) }
            if path.contains("/messages/") { return (200, ["id": "abc123", "payload": ["headers": [["name": "Subject", "value": "Synthetic subject"]]]]) }
            if path.contains("/events") { return (200, ["kind": "calendar#events", "items": [["id": "event1", "summary": "Synthetic meeting", "start": ["date": "2026-11-13"]]]]) }
            if path.contains("/files") { return (200, ["kind": "drive#fileList", "files": (1...20).map { ["id": "file\($0)", "name": "Synthetic file \($0)", "mimeType": "text/plain"] }]) }
            if path.contains("/values/") { return (200, ["range": "Sheet1!A1:D5", "values": [["Synthetic", "42"]]]) }
            return (200, ["spreadsheetId": "syntheticSheet123"])
        }
        for provider in ["gmail", "google-calendar", "google-drive", "google-sheets", "google-contacts"] {
            result = await call("readGoogleWorkspace", ["provider": provider, "limit": 3, "spreadsheetId": "syntheticSheet123", "range": "A1:D5"])
            check(result.1 == nil && result.0?["readOnly"] as? Bool == true, "\(provider) read succeeds through synthetic transport")
            if provider == "google-drive" { check((result.0?["items"] as? [[String: Any]])?.count == 3, "Preview record bound enforced even for oversized provider collection") }
        }
        check(WorkspaceFixtureProtocol.requests.allSatisfy { $0.httpMethod == "GET" }, "All service operations are GET; no send/write calls")
        check(WorkspaceFixtureProtocol.requests.filter { $0.url!.path.contains("/messages/") }.allSatisfy { $0.url!.query!.contains("format=metadata") }, "Gmail requests metadata only")
        result = await call("googleWorkspaceStatus")
        check(result.0?["connected"] as? Bool == true, "Five successful checks yield connected metadata")
        let requestsBeforeRange = WorkspaceFixtureProtocol.requests.count
        result = await call("readGoogleWorkspace", ["provider": "google-sheets", "spreadsheetId": "syntheticSheet123", "range": "A1:Z99999"])
        check(result.1 != nil && WorkspaceFixtureProtocol.requests.count == requestsBeforeRange, "Oversized range denied before provider call")
        check(NativeGoogleWorkspace.boundedRange("'Test Sheet'!B2:F21") && !NativeGoogleWorkspace.boundedRange("A2:A1") && !NativeGoogleWorkspace.boundedRange("A:A"), "Bounded ranges enforce cells, order and explicit dimensions")
        for provider in ["gmail", "google-calendar", "google-drive", "google-sheets", "google-contacts"] {
            WorkspaceFixtureProtocol.response = { _ in (200, [:]) }
            result = await call("checkGoogleWorkspace", ["provider": provider, "spreadsheetId": "syntheticSheet123"])
            check(result.1 != nil, "\(provider) malformed200 cannot verify access")
        }
        WorkspaceFixtureProtocol.response = { _ in (200, ["resultSizeEstimate": 0, "padding": String(repeating: "x", count: 2 * 1024 * 1024 + 1)]) }
        result = await call("checkGoogleWorkspace", ["provider": "gmail"])
        check(result.1?.contains("2 MB") == true, "Streaming provider response is cancelled beyond 2 MB")
        WorkspaceFixtureProtocol.response = { _ in (403, ["error": "FAKE_NATIVE_TEST_TOKEN"]) }
        result = await call("checkGoogleWorkspace", ["provider": "gmail"])
        check(result.1?.contains("403") == true && result.1?.contains("FAKE_NATIVE") == false, "Provider refusal is sanitized")
        result = await call("googleWorkspaceStatus")
        let failed = (result.0?["connectors"] as? [[String: Any]])?.first { $0["id"] as? String == "gmail" }
        check(failed?["status"] as? String == "needs-attention" && failed?["connected"] as? Bool == false && failed?["authorized"] as? Bool == true, "Failed check clears verified status while preserving retryable grant")
        WorkspaceFixtureProtocol.response = { _ in (200, ["resultSizeEstimate": 0]) }
        result = await call("checkGoogleWorkspace", ["provider": "gmail"])
        check(result.1 == nil, "Valid empty mailbox confirms access and clears error")
        seed(0)
        WorkspaceFixtureProtocol.response = { request in request.url!.host == "oauth2.googleapis.com" ? (200, ["access_token": "REFRESHED_FAKE", "expires_in": 3600]) : (200, ["resultSizeEstimate": 0]) }
        result = await call("checkGoogleWorkspace", ["provider": "gmail"])
        check(result.1 == nil && WorkspaceFixtureProtocol.requests.last?.value(forHTTPHeaderField: "Authorization") == "Bearer REFRESHED_FAKE", "Expired grant refresh stays native")
        seed(); storage.records[owner + ":authorization"]?["scope"] = "https://www.googleapis.com/auth/contacts.readonly"
        let requestsBeforeScope = WorkspaceFixtureProtocol.requests.count
        result = await call("readGoogleWorkspace", ["provider": "gmail"])
        check(result.1 != nil && WorkspaceFixtureProtocol.requests.count == requestsBeforeScope, "Contacts scope cannot power Workspace reads")
        seed(); result = await call("disconnectGoogleWorkspace")
        check(result.0?["disconnected"] as? Bool == true && storage.records[owner + ":authorization"] == nil && storage.records[owner + ":client"] != nil, "Disconnect removes only this adapter authorization")
        for code in [200, 400] {
            seed(0); let before = try JSONSerialization.data(withJSONObject: storage.records, options: .sortedKeys)
            var ownerValid = true
            WorkspaceFixtureProtocol.delay = 0.15
            WorkspaceFixtureProtocol.response = { _ in (code, ["access_token": "MUST_NOT_SAVE", "expires_in": 3600]) }
            let pendingRead = Task { @MainActor in
                await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
                    adapter.handle("checkGoogleWorkspace", body: ["scope": owner, "provider": "gmail"], window: nil, authorize: { if !ownerValid { throw NSError(domain: "synthetic-owner-retired", code: 401) } }) { _, error in continuation.resume(returning: error) }
                }
            }
            try await Task.sleep(nanoseconds: 30_000_000); ownerValid = false
            let failure = await pendingRead.value
            let after = try JSONSerialization.data(withJSONObject: storage.records, options: .sortedKeys)
            check(failure != nil && before == after, "Retired owner cannot save refresh or failure metadata after delayed HTTP\(code)")
        }
        WorkspaceFixtureProtocol.delay = 0
        let cancelledStorage = WorkspaceMemorySecrets(), cancelled = NativeGoogleWorkspace(service: "unused", storage: cancelledStorage, transport: session)
        WorkspaceFixtureProtocol.response = { _ in (200, ["sub": "synthetic", "email": "synthetic@example.invalid"]) }; WorkspaceFixtureProtocol.delay = 0.15
        let pending = Task { @MainActor in try await cancelled.finalizeAuthorization(owner, token: ["access_token": "CANCELLED_FAKE", "scope": scopes], generation: 0, authorize: {}) }
        try await Task.sleep(nanoseconds: 30_000_000)
        cancelled.handle("cancelGoogleWorkspaceAuth", body: ["scope": owner], window: nil) { _, _ in }
        do { _ = try await pending.value; check(false, "Cancelled finalization must throw") } catch { check(cancelledStorage.records[owner + ":authorization"] == nil, "Cancel after OAuth callback prevents delayed identity response from saving authorization") }
        WorkspaceFixtureProtocol.delay = 0
        check((try? NativeConnectorCredentials.validated(["clientId": "id", "clientSecret": "secret", "accessToken": "token", "environment": "production"], provider: "plaid")) == nil, "Native credential picker rejects Plaid production")
        let sanitized = try NativeConnectorCredentials.validated(["accessToken": "synthetic", "unrelatedSecret": "must-not-copy"], provider: "withings")
        check(sanitized.count == 1 && sanitized["unrelatedSecret"] == nil, "Native picker allowlists only necessary credential fields")
        check((try? NativeConnectorCredentials.validated(["accessToken": "synthetic", "phoneNumberId": "https://attacker.invalid"], provider: "whatsapp")) == nil, "WhatsApp phone identity rejects URL injection")
        // Public bridge action semantics, all through synthetic URLProtocol.
        WorkspaceFixtureProtocol.delay = 0
        storage.records.removeValue(forKey: owner + ":authorization")
        let actionId = UUID().uuidString
        let actionBody: [String: Any] = ["operation": "gmail.send", "args": ["to": ["synthetic@example.invalid"], "subject": "Synthetic", "body": "Synthetic"], "requestId": actionId, "expectedOwner": owner]
        let noGrantCount = WorkspaceFixtureProtocol.requests.count
        result = await call("executeGoogleAction", actionBody)
        check(result.1 == nil && result.0?["status"] as? String == "failed" && result.0?["requestId"] as? String == actionId && WorkspaceFixtureProtocol.requests.count == noGrantCount, "Unconfigured action returns matched failed receipt without provider call")
        check((result.0?["error"] as? String)?.contains("Reconnect Workspace to verify its Google account identity.") == true, "Unconfigured failed receipt preserves actionable sanitized dependency message")
        seed()
        result = await call("executeGoogleAction", actionBody.merging(["expectedOwner": "other"]) { _, v in v })
        check(result.1 != nil && WorkspaceFixtureProtocol.requests.count == noGrantCount, "Action expectedOwner mismatch blocks dispatch")
        result = await call("googleActionCatalog")
        check((result.0?["operations"] as? [[String: Any]])?.count == 20, "Native action catalog exposes 20 fixed operations")
        WorkspaceFixtureProtocol.delay = 0.1
        WorkspaceFixtureProtocol.response = { _ in (200, ["resourceName": "people/person1", "etag": "v1", "metadata": ["sources": [["type": "CONTACT", "etag": "s1"]]], "names": [["givenName": "Synthetic"]]]) }
        let contactAction: [String: Any] = ["operation": "contacts.update", "args": ["resourceName": "people/person1", "givenName": "Changed"], "requestId": UUID().uuidString, "expectedOwner": owner]
        let cancelBefore = WorkspaceFixtureProtocol.requests.count
        let pendingAction = Task { @MainActor in await call("executeGoogleAction", contactAction) }
        try await Task.sleep(nanoseconds: 20_000_000)
        _ = await call("cancelGoogleActions")
        let cancelledAction = await pendingAction.value
        check(cancelledAction.0?["status"] as? String == "failed" && WorkspaceFixtureProtocol.requests.count == cancelBefore + 1 && WorkspaceFixtureProtocol.requests.last?.httpMethod == "GET", "Cancellation generation prevents mutation after deferred preflight")
        seed()
        let changedBefore = WorkspaceFixtureProtocol.requests.count
        let changedAction = Task { @MainActor in await call("executeGoogleAction", contactAction.merging(["requestId": UUID().uuidString]) { _, v in v }) }
        try await Task.sleep(nanoseconds: 20_000_000)
        storage.records[owner + ":authorization"]?["accountId"] = "different-account"
        let accountChanged = await changedAction.value
        check(accountChanged.0?["status"] as? String == "failed" && WorkspaceFixtureProtocol.requests.count == changedBefore + 1 && WorkspaceFixtureProtocol.requests.last?.httpMethod == "GET", "Changing Google account during preflight prevents mutation")
        WorkspaceFixtureProtocol.delay = 0
        print(String(data: try JSONSerialization.data(withJSONObject: ["passed": true, "checks": checks, "providerCalls": 0, "realCredentials": false, "contactsWrites": 0], options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    }
}
