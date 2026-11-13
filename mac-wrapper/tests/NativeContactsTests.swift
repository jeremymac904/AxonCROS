import AppKit
import Contacts
import Foundation

final class MemoryCredentials: ContactCredentialStorage {
    var values: [String: [String: Any]] = [:]
    func read(_ scope: String, _ name: String) -> [String: Any]? { values[scope + ":" + name] }
    func write(_ scope: String, _ name: String, _ value: [String: Any]) { values[scope + ":" + name] = value }
    func remove(_ scope: String, _ name: String) { values.removeValue(forKey: scope + ":" + name) }
}
final class GoogleFixtureProtocol: URLProtocol {
    static var response: (URLRequest) -> (Int, [String: Any]) = { _ in (500, [:]) }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (code, data) = Self.response(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: data))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
@main struct NativeContactsTests {
    @MainActor static func main() async throws {
        var checks = 0
        func check(_ result: @autoclosure () -> Bool, _ message: String) {
            guard result() else { fatalError(message) }; checks += 1
        }
        let apple = CNMutableContact()
        apple.givenName = "Synthetic"; apple.familyName = "Contact"
        apple.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: "+1 202-555-0101")), CNLabeledValue(label: CNLabelWork, value: CNPhoneNumber(stringValue: "020 0000 0000"))]
        apple.emailAddresses = [CNLabeledValue(label: CNLabelWork, value: "synthetic@example.invalid" as NSString)]
        let appleRecord = NativeContacts.record(apple)
        check((appleRecord["phones"] as? [[String: String]])?.count == 2, "Apple preserves multiple phones")
        check(appleRecord["note"] == nil, "Apple notes are not requested/exported")
        let version = appleRecord["version"] as? String
        apple.familyName = "Changed"
        check(NativeContacts.record(apple)["version"] as? String != version, "Apple edits change optimistic version")
        let storage = MemoryCredentials()
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [GoogleFixtureProtocol.self]
        let client = NativeGoogleContacts(service: "test-unused", storage: storage, transport: URLSession(configuration: config))
        func call(_ action: String, _ fields: [String: Any] = [:], scope: String = "synthetic-owner") async -> (Any?, String?) {
            await withCheckedContinuation { continuation in
                client.handle(action, body: fields.merging(["scope": scope]) { _, new in new }, window: nil) { value, error in continuation.resume(returning: (value, error)) }
            }
        }
        let initial = await call("googleContactsStatus")
        check((initial.0 as? [String: Any])?["connected"] as? Bool == false, "Unconfigured is not connected")
        let noClient = await call("connectGoogleContacts")
        check(noClient.1?.contains("existing Google Desktop OAuth") == true, "Missing client is explicit")
        let auth: [String: Any] = ["accountId": "synthetic-account", "accountName": "synthetic@example.invalid", "direction": "two-way-reviewed", "access_token": "synthetic-test-only", "expiresAt": Date().timeIntervalSince1970 + 3600]
        storage.write("synthetic-owner", "authorization", auth)
        let person: [String: Any] = ["resourceName": "people/synthetic", "etag": "v1", "metadata": ["sources": [["type": "CONTACT", "id": "synthetic", "etag": "source-v1"]]], "names": [["givenName": "Synthetic", "familyName": "Contact", "displayName": "Synthetic Contact"]], "emailAddresses": [["value": "one@example.invalid", "type": "work"], ["value": "two@example.invalid", "type": "home"]], "phoneNumbers": [["value": "+1 202-555-0101", "type": "mobile"]]]
        var requests: [URLRequest] = []
        GoogleFixtureProtocol.response = { req in
            requests.append(req)
            let q = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!.queryItems!
            if q.contains(where: { $0.name == "pageToken" }) { return (200, ["connections": [], "nextSyncToken": "synthetic-checkpoint"]) }
            return (200, ["connections": [person], "nextPageToken": "synthetic-page-two"])
        }
        let pulled = await call("readGoogleContacts"); let batch = pulled.0 as! [String: Any]
        check(pulled.1 == nil && requests.count == 2, "Full sync paginates")
        check(storage.read("synthetic-owner", "authorization")?["syncToken"] == nil, "Preview does not advance checkpoint")
        let contacts = batch["contacts"] as! [[String: Any]]
        check((contacts[0]["emails"] as? [[String: String]])?.count == 2, "Google preserves multiple email destinations")
        check(!String(describing: batch).contains("access_token"), "Tokens never enter renderer response")
        let foreign = await call("ackGoogleContactsSync", ["batchId": batch["batchId"]!, "committed": true], scope: "other-owner")
        check(foreign.1 != nil, "Sync acknowledgement is owner scoped")
        let ack = await call("ackGoogleContactsSync", ["batchId": batch["batchId"]!, "committed": true])
        check(ack.1 == nil && storage.read("synthetic-owner", "authorization")?["syncToken"] as? String == "synthetic-checkpoint", "Checkpoint advances after explicit local commit")
        let replay = await call("ackGoogleContactsSync", ["batchId": batch["batchId"]!, "committed": true])
        check(replay.1 != nil, "Acknowledgement is one use")
        var resetRequests = 0
        GoogleFixtureProtocol.response = { req in
            resetRequests += 1
            if req.url!.absoluteString.contains("syncToken=") { return (410, ["error": ["status": "EXPIRED_SYNC_TOKEN"]]) }
            return (200, ["connections": [person, ["resourceName": "people/removed", "metadata": ["deleted": true]]], "nextSyncToken": "synthetic-reset"])
        }
        let reset = await call("readGoogleContacts"); let resetBatch = reset.0 as! [String: Any]
        check(resetRequests == 2 && resetBatch["fullSnapshot"] as? Bool == true, "Expired incremental token recovers with full sync")
        check(resetBatch["deletedExternalIds"] as? [String] == ["people/removed"], "Tombstones remain explicit, not local deletes")
        check(storage.read("synthetic-owner", "authorization")?["syncToken"] as? String == "synthetic-checkpoint", "Uncommitted replacement snapshot retains old checkpoint")
        let newest = await call("readGoogleContacts")
        let staleAck = await call("ackGoogleContactsSync", ["batchId": resetBatch["batchId"]!, "committed": true])
        check(newest.1 == nil && staleAck.1 != nil, "A newer preview invalidates older sync acknowledgements")
        check(storage.read("synthetic-owner", "authorization")?["syncToken"] as? String == "synthetic-checkpoint", "A stale preview cannot rewind the checkpoint")
        var patchCalls = 0
        GoogleFixtureProtocol.response = { req in
            if req.httpMethod == "PATCH" { patchCalls += 1 }
            return (200, person)
        }
        let preview = await call("previewGoogleContactUpdate", ["externalId": "people/synthetic", "version": "v1", "patch": ["addEmail": "three@example.invalid"]])
        let proposal = preview.0 as! [String: Any]
        check(patchCalls == 0, "Preview performs no Google mutation")
        check(((proposal["proposed"] as? [String: Any])?["emails"] as? [[String: String]])?.count == 3, "Review preserves both old emails")
        var changed = person; changed["etag"] = "v2"
        GoogleFixtureProtocol.response = { req in if req.httpMethod == "PATCH" { patchCalls += 1 }; return (200, changed) }
        let conflict = await call("applyGoogleContactUpdate", ["proposalId": proposal["proposalId"]!, "confirmed": true])
        check(conflict.1?.contains("changed after review") == true && patchCalls == 0, "Concurrent provider edit prevents write")
        GoogleFixtureProtocol.response = { _ in (200, person) }
        let secondPreview = await call("previewGoogleContactUpdate", ["externalId": "people/synthetic", "version": "v1", "patch": ["addEmail": "three@example.invalid"]])
        let second = secondPreview.0 as! [String: Any]
        GoogleFixtureProtocol.response = { req in
            if req.httpMethod == "PATCH" { patchCalls += 1; return (200, changed) }
            return (200, person)
        }
        let applied = await call("applyGoogleContactUpdate", ["proposalId": second["proposalId"]!, "confirmed": true])
        check(applied.1 == nil && patchCalls == 1, "One explicitly reviewed Google write")
        let duplicate = await call("applyGoogleContactUpdate", ["proposalId": second["proposalId"]!, "confirmed": true])
        check(duplicate.1 != nil && patchCalls == 1, "Repeated confirmation cannot repeat provider mutation")
        GoogleFixtureProtocol.response = { _ in (200, person) }
        let guarded = await call("previewGoogleContactUpdate", ["externalId": "people/synthetic", "version": "v1", "patch": ["givenName": "Synthetic Updated"]])
        let guardedProposal = guarded.0 as! [String: Any]
        var authChecks = 0
        let expiredSession: (Any?, String?) = await withCheckedContinuation { continuation in
            client.handle("applyGoogleContactUpdate", body: ["scope": "synthetic-owner", "proposalId": guardedProposal["proposalId"]!, "confirmed": true], window: nil,
                          authorize: { authChecks += 1; if authChecks == 2 { throw NSError(domain: "synthetic.session", code: 401) } }) { value, error in continuation.resume(returning: (value, error)) }
        }
        check(expiredSession.1 != nil && authChecks == 2 && patchCalls == 1, "Ended session is rechecked immediately before provider mutation")
        GoogleFixtureProtocol.response = { _ in (429, ["error": [:]]) }
        let limited = await call("readGoogleContacts")
        check(limited.1?.contains("rate limited") == true, "Quota error remains recoverable")
        let disconnected = await call("disconnectGoogleContacts")
        check(disconnected.1 == nil && storage.read("synthetic-owner", "authorization") == nil, "Disconnect clears only app credential")
        let oauth = try ContactOAuthReceiver()
        var callbackCount = 0
        let returnCode: String = try await withCheckedThrowingContinuation { continuation in
            do {
                try oauth.start(onReady: { result in
                    if case .success(let address) = result {
                        Task {
                            do {
                                let invalid = URL(string: address.absoluteString + "?state=wrong&code=synthetic")!
                                let (_, response) = try await URLSession.shared.data(from: invalid)
                                check((response as? HTTPURLResponse)?.statusCode == 400, "OAuth rejects wrong state")
                                let valid = URL(string: address.absoluteString + "?state=" + oauth.state + "&code=synthetic-return")!
                                _ = try? await URLSession.shared.data(from: valid)
                            } catch { oauth.cancel() }
                        }
                    }
                }, completion: { result in callbackCount += 1; continuation.resume(with: result) })
            } catch { continuation.resume(throwing: error) }
        }
        oauth.cancel()
        check(returnCode == "synthetic-return" && callbackCount == 1, "Loopback OAuth settles once and supports native return")
        print("Native contact adapter checks passed: \(checks). Synthetic provider responses and loopback return only; no account, address-book permission, Keychain credential or real contact accessed.")
    }
}
