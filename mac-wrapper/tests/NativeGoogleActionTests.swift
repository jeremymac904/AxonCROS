import Foundation
import PDFKit

final class ActionMemorySecrets: ContactCredentialStorage {
    var records: [String: [String: Any]] = [:]
    var denyWrites = false
    var denyReads = false
    func read(_ scope: String, _ name: String) throws -> [String: Any]? { if denyReads { throw NSError(domain: "synthetic-journal-unavailable", code: 1) }; return records[scope + ":" + name] }
    func write(_ scope: String, _ name: String, _ value: [String: Any]) throws { if denyWrites { throw NSError(domain: "synthetic-journal-unavailable", code: 1) }; records[scope + ":" + name] = value }
    func remove(_ scope: String, _ name: String) { records.removeValue(forKey: scope + ":" + name) }
}
final class ActionFixtureProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var bodies: [Data] = []
    static var response: (URLRequest) -> (Int, Data, [String: String]) = { _ in (500, Data(), [:]) }
    static var delay: Double = 0
    static var networkFailure = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; body.append(buffer, count: count) }
        }
        Self.bodies.append(body)
        let reply = Self.response(request), fails = Self.networkFailure
        let finish = { [self] in
            if fails { client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost)); return }
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: reply.0, httpVersion: nil, headerFields: reply.2)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: reply.1); client?.urlProtocolDidFinishLoading(self)
        }
        if Self.delay > 0 { DispatchQueue.global().asyncAfter(deadline: .now() + Self.delay, execute: finish) } else { finish() }
    }
    override func stopLoading() {}
}
@main struct NativeGoogleActionTests {
    @MainActor static func main() async throws {
        var checks: [String] = []
        func check(_ condition: @autoclosure () -> Bool, _ name: String) { guard condition() else { fatalError(name) }; checks.append(name) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ActionFixtureProtocol.self]
        let session = URLSession(configuration: config), store = ActionMemorySecrets()
        let runner = NativeGoogleActions(storage: store, session: session)
        let owner = "synthetic-owner", account = "synthetic-account", fakeToken = "FAKE-NATIVE-TOKEN-DO-NOT-RETURN"
        let grants = Set(["gmail", "calendar", "drive", "sheets", "contacts"].map { NativeGoogleActions.requiredScope($0 + ".unused") })
        func json(_ object: [String: Any], status: Int = 200, etag: Bool = true) -> (Int, Data, [String: String]) { (status, try! JSONSerialization.data(withJSONObject: object), etag ? ["Content-Type": "application/json", "ETag": "\"version1\""] : ["Content-Type": "application/json"]) }
        let contact: [String: Any] = ["resourceName": "people/person1", "etag": "person-etag", "metadata": ["sources": [["type": "CONTACT", "id": "person1", "etag": "source-etag"]]], "names": [["givenName": "Synthetic", "familyName": "Contact", "middleName": "Preserve"]], "emailAddresses": [["value": "primary@example.invalid", "type": "work", "metadata": ["primary": true]], ["value": "secondary@example.invalid", "type": "home"]], "phoneNumbers": [["value": "+15555550101", "type": "work"], ["value": "+15555550102", "type": "home"]], "organizations": [["name": "Original", "title": "Role"], ["name": "Secondary"]]]
        func fixture(_ request: URLRequest) -> (Int, Data, [String: String]) {
            let path = request.url!.path, method = request.httpMethod!
            if path.hasSuffix("/messages") { return json(["resultSizeEstimate": 1, "messages": [["id": "message1", "threadId": "thread1"]]]) }
            if path.hasSuffix("/drafts") { return json(["id": "draft1", "message": ["id": "message1", "threadId": "thread1"]]) }
            if path.contains("/messages/") { return json(["id": "message1", "threadId": "thread1", "labelIds": ["INBOX"], "payload": ["mimeType": "text/plain", "body": ["data": Data("Synthetic body".utf8).base64EncodedString()], "headers": [["name": "Subject", "value": "Synthetic subject"]]]]) }
            if path.contains("/events") {
                let event: [String: Any] = ["id": "event1", "etag": "\"event-etag\"", "summary": "Synthetic", "start": ["dateTime": "2026-11-13T10:00:00Z"], "end": ["dateTime": "2026-11-13T11:00:00Z"]]
                return path.hasSuffix("/events") && method == "GET" ? json(["kind": "calendar#events", "items": [event]]) : json(event)
            }
            if path.contains("/drive/") {
                if request.url!.query?.contains("alt=media") == true || path.hasSuffix("/export") { return (200, Data("Synthetic file content".utf8), [:]) }
                let file: [String: Any] = ["id": "file1", "name": "Synthetic file", "mimeType": "text/plain", "modifiedTime": "2026-11-13T10:00:00Z", "parents": ["parent1"], "trashed": false]
                return path.hasSuffix("/files") && method == "GET" ? json(["kind": "drive#fileList", "files": [file]]) : json(file)
            }
            if path.contains("/spreadsheets") {
                if method == "GET" { return json(["range": "A1:B2", "values": [["Synthetic", 1]]]) }
                return json(["spreadsheetId": "sheet1", "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/sheet1", "updatedRange": "A1:B2", "updatedCells": 2, "properties": ["title": "Synthetic"]])
            }
            if path.hasSuffix("/connections") { return json(["totalPeople": 1, "connections": [contact]]) }
            if path.hasSuffix("people:searchContacts") { return json(["results": [["person": contact]]]) }
            if path.contains("people") { return json(contact) }
            fatalError("Unexpected endpoint \(path)")
        }
        ActionFixtureProtocol.response = fixture
        func run(_ op: String, _ args: [String: Any], _ id: String = UUID().uuidString, otherOwner: String? = nil, otherAccount: String? = nil, allowed: Set<String>? = nil, authorize: @escaping @MainActor () async throws -> Void = {}) async throws -> [String: Any] {
            try await runner.execute(owner: otherOwner ?? owner, account: otherAccount ?? account, token: fakeToken, granted: allowed ?? grants, operation: op, args: args, requestId: id, authorize: authorize)
        }
        let jsonArgs = try JSONSerialization.jsonObject(with: Data("{\"limit\":1}".utf8)) as! [String: Any]
        check(try! NativeGoogleActions.limit(jsonArgs) == 1, "JSON numeric one is not mistaken for boolean")
        check(NativeGoogleActions.boundedRange("A1") && NativeGoogleActions.boundedRange("'Test Sheet'!Z9"), "Standard explicit single-cell A1 ranges accepted")
        check((try? NativeGoogleActions.validate("gmail.modify", ["id": "message1", "trash": NSNumber(value: 1)])) == nil, "Numeric trash flag is not mistaken for boolean")
        let claimId = UUID().uuidString
        let claimBody: [String: Any] = ["requestId": claimId, "expectedOwner": owner, "operation": "gmail.read", "args": ["id": "message1"]]
        let claimAction: [String: Any] = ["id": claimId, "ownerId": owner, "state": "running", "operation": "gmail.read", "args": ["id": "message1"]]
        check(NativeGoogleActions.matchesClaim(["action": claimAction], body: claimBody, owner: owner), "Native accepts matching authenticated executable claim")
        for (field, value) in [("id", UUID().uuidString as Any), ("ownerId", "other" as Any), ("state", "review" as Any), ("operation", "gmail.send" as Any), ("args", ["id": "other"] as Any)] {
            var wrong = claimAction; wrong[field] = value
            check(!NativeGoogleActions.matchesClaim(["action": wrong], body: claimBody, owner: owner), "Native rejects mismatched authenticated claim \(field)")
        }
        let samples: [(String, [String: Any])] = [
            ("gmail.search", ["query": "subject:Synthetic", "limit": 3]), ("gmail.read", ["id": "message1"]),
            ("gmail.draft", ["to": ["synthetic@example.invalid"], "subject": "Synthetic", "body": "Draft only"]),
            ("gmail.send", ["to": ["synthetic@example.invalid"], "subject": "Synthetic", "body": "Mock transport only"]),
            ("gmail.modify", ["id": "message1", "addLabelIds": ["STARRED"]]),
            ("calendar.list", ["limit": 3]), ("calendar.create", ["summary": "Synthetic", "start": "2026-11-13T10:00:00Z", "end": "2026-11-13T11:00:00Z"]), ("calendar.update", ["id": "event1", "summary": "Updated"]),
            ("drive.list", ["limit": 3]), ("drive.read", ["id": "file1"]), ("drive.create", ["name": "Synthetic", "content": "Content"]), ("drive.update", ["id": "file1", "name": "Changed"]), ("drive.trash", ["id": "file1"]),
            ("sheets.read", ["spreadsheetId": "sheet1", "range": "A1:B2"]), ("sheets.create", ["title": "Synthetic"]), ("sheets.write", ["spreadsheetId": "sheet1", "range": "A1:B2", "values": [["=NOT_A_FORMULA", 1]]]), ("sheets.append", ["spreadsheetId": "sheet1", "range": "A1:B2", "values": [["Synthetic", 2]]]),
            ("contacts.search", ["query": "Synthetic"]), ("contacts.create", ["givenName": "Synthetic", "email": "synthetic@example.invalid"]), ("contacts.update", ["resourceName": "people/person1", "givenName": "Changed", "email": "changed@example.invalid", "phone": "+15555550103", "organization": "Changed"])
        ]
        for (op, args) in samples {
            let result = try await run(op, args)
            check(result["status"] as? String == "completed", "\(op) executes through fixed synthetic endpoint")
            let encoded = try JSONSerialization.data(withJSONObject: result)
            check(encoded.count <= 24000 && !String(decoding: encoded, as: UTF8.self).contains(fakeToken), "\(op) result bounded and token-free")
        }
        let contactBody = try JSONSerialization.jsonObject(with: ActionFixtureProtocol.bodies.last!) as! [String: Any]
        check((contactBody["emailAddresses"] as? [[String: Any]])?.count == 2 && (contactBody["phoneNumbers"] as? [[String: Any]])?.count == 2 && (contactBody["organizations"] as? [[String: Any]])?.count == 2, "Contact edit preserves secondary email phone and organization")
        check((contactBody["emailAddresses"] as? [[String: Any]])?[1]["value"] as? String == "secondary@example.invalid" && (contactBody["names"] as? [[String: Any]])?.first?["middleName"] as? String == "Preserve", "Contact edit retains unrelated name and secondary values")
        check(((contactBody["metadata"] as? [String: Any])?["sources"] as? [[String: Any]])?.first?["etag"] as? String == "source-etag", "Contact mutation carries exact current CONTACT source etag")
        check(ActionFixtureProtocol.requests.filter { $0.url!.path.contains("/values/") && $0.httpMethod != "GET" }.allSatisfy { $0.url!.query!.contains("valueInputOption=RAW") }, "Sheets never evaluates supplied formulas")
        check(ActionFixtureProtocol.requests.filter { $0.httpMethod == "PATCH" && $0.url!.path.contains("/drive/") }.allSatisfy { $0.value(forHTTPHeaderField: "If-Match") == "\"version1\"" }, "Drive mutations bind exact provider version")
        check(ActionFixtureProtocol.requests.allSatisfy { $0.httpMethod != "DELETE" && $0.value(forHTTPHeaderField: "Authorization") == "Bearer " + fakeToken }, "No permanent deletes or renderer-token requests")
        let send = samples[3], replayID = UUID().uuidString
        _ = try await run(send.0, send.1, replayID); let count = ActionFixtureProtocol.requests.count
        let replay = try await run(send.0, send.1, replayID)
        check(replay["replayed"] as? Bool == true && ActionFixtureProtocol.requests.count == count, "Completed send replays receipt without another request")
        for changed in ["account", "args"] {
            do { _ = try await run(send.0, changed == "args" ? ["to": ["other@example.invalid"], "subject": "Changed", "body": "Changed"] : send.1, replayID, otherAccount: changed == "account" ? "other-account" : nil); fatalError("Conflicting receipt accepted") } catch { check(ActionFixtureProtocol.requests.count == count, "Receipt rejects changed \(changed) without dispatch") }
        }
        _ = try await run(send.0, send.1, replayID, otherOwner: "other-owner")
        check(ActionFixtureProtocol.requests.count == count + 1, "Receipts are isolated by local owner")
        let unknownID = UUID().uuidString
        ActionFixtureProtocol.networkFailure = true
        let unknown = try await run(send.0, send.1, unknownID)
        ActionFixtureProtocol.networkFailure = false; let afterUnknown = ActionFixtureProtocol.requests.count
        let unknownReplay = try await NativeGoogleActions(storage: store, session: session).execute(owner: owner, account: account, token: fakeToken, granted: grants, operation: send.0, args: send.1, requestId: unknownID, authorize: {})
        check(unknown["status"] as? String == "unknown" && unknownReplay["replayed"] as? Bool == true && ActionFixtureProtocol.requests.count == afterUnknown, "Lost send response survives executor restart without resend")
        ActionFixtureProtocol.response = { _ in json(["error": fakeToken], status: 403) }
        let denied = try await run(send.0, send.1)
        check(denied["status"] as? String == "failed" && !(denied["error"] as? String ?? "").contains(fakeToken), "Definite provider rejection is sanitized failed receipt")
        ActionFixtureProtocol.response = fixture
        store.denyWrites = true; let journalCount = ActionFixtureProtocol.requests.count
        do { _ = try await run(send.0, send.1); fatalError("Unjournaled write") } catch { check(ActionFixtureProtocol.requests.count == journalCount, "Unavailable journal blocks provider mutation") }; store.denyWrites = false
        store.denyReads = true
        let inaccessible = try await run(send.0, send.1, replayID)
        check(inaccessible["status"] as? String == "unknown" && ActionFixtureProtocol.requests.count == journalCount, "Unavailable prior receipt remains unknown without redispatch")
        store.denyReads = false
        let invalid: [(String, [String: Any])] = [("gmail.delete", ["id": "message1"]), ("gmail.send", ["to": ["a@example.invalid\r\nBcc:x@y.invalid"], "subject": "s", "body": "b"]), ("gmail.send", ["to": ["a@example.invalid"], "subject": "s\nBcc:x", "body": "b"]), ("drive.update", ["id": "../other", "name": "bad"]), ("drive.create", ["name": "bad", "url": "https://attacker.invalid"]), ("sheets.write", ["spreadsheetId": "sheet1", "range": "A1:A1", "values": [[1,2]]]), ("sheets.read", ["spreadsheetId": "sheet1", "range": "A:A"]), ("calendar.create", ["summary": "x", "start": "2026-11-13T11:00:00Z", "end": "2026-11-13T10:00:00Z"]), ("contacts.update", ["resourceName": "people/../me", "givenName": "x"])]
        for (op, args) in invalid { let before = ActionFixtureProtocol.requests.count; do { _ = try await run(op, args); fatalError("Invalid input accepted") } catch { check(ActionFixtureProtocol.requests.count == before, "Rejects invalid \(op) before dispatch") } }
        do { _ = try await run(send.0, send.1, allowed: []); fatalError("Missing grant") } catch { check(true, "Write requires exact service scope") }
        for op in ["gmail.search", "calendar.list", "drive.list", "sheets.read", "contacts.search"] {
            ActionFixtureProtocol.response = { _ in json(["items": "malformed", "messages": "malformed", "files": "malformed", "values": "malformed", "connections": "malformed", "results": "malformed"]) }
            let args: [String: Any] = op == "sheets.read" ? ["spreadsheetId": "sheet1", "range": "A1:B2"] : [:]
            do { _ = try await run(op, args); fatalError("Malformed provider accepted") } catch { check(true, "Malformed \(op) response fails closed") }
        }
        ActionFixtureProtocol.response = { r in let result = fixture(r); return (result.0, result.1, ["Content-Type": "application/json"]) }
        let beforeMissingVersion = ActionFixtureProtocol.requests.count
        do { _ = try await run("drive.trash", ["id": "file1"]); fatalError("Missing Drive version") } catch { check(ActionFixtureProtocol.requests.count == beforeMissingVersion + 1 && ActionFixtureProtocol.requests.last?.httpMethod == "GET", "Drive without ETag cannot mutate") }
        ActionFixtureProtocol.response = fixture; ActionFixtureProtocol.delay = 0.1
        var valid = true
        let beforeRetirement = ActionFixtureProtocol.requests.count
        let retired = Task { @MainActor in try await run("contacts.update", ["resourceName": "people/person1", "givenName": "Retired"], authorize: { if !valid { throw NSError(domain: "owner-retired", code: 401) } }) }
        try await Task.sleep(nanoseconds: 20_000_000); valid = false
        do { _ = try await retired.value; fatalError("Retired owner wrote") } catch { check(ActionFixtureProtocol.requests.count == beforeRetirement + 1 && ActionFixtureProtocol.requests.last?.httpMethod == "GET", "Owner retirement after preflight prevents contact write") }
        let first = Task { @MainActor in try await run("gmail.search", [:]) }; try await Task.sleep(nanoseconds: 20_000_000)
        let serializationCount = ActionFixtureProtocol.requests.count
        do { _ = try await run(send.0, send.1); fatalError("Concurrent write") } catch { check(ActionFixtureProtocol.requests.count == serializationCount, "Per-owner execution serializes while first request awaits") }; _ = try await first.value
        ActionFixtureProtocol.delay = 0
        let pendingID = UUID().uuidString, pendingKey = owner + ":action-" + pendingID.lowercased()
        valid = true; ActionFixtureProtocol.delay = 0.1
        let afterDispatch = Task { @MainActor in try await run(send.0, send.1, pendingID, authorize: { if !valid { throw NSError(domain: "retired", code: 401) } }) }
        try await Task.sleep(nanoseconds: 20_000_000); valid = false
        let retiredOutput = try await afterDispatch.value
        check(retiredOutput["status"] as? String == "unknown" && store.records[pendingKey]?["state"] as? String == "pending", "Owner retirement after dispatch retains pending unknown receipt")
        ActionFixtureProtocol.delay = 0
        check(NativeGoogleActions.catalog.count == 20, "Catalog contains exactly 20 supported operations")
        print(String(data: try JSONSerialization.data(withJSONObject: ["passed": true, "checks": checks, "checkCount": checks.count, "liveProviderCalls": 0, "realCredentials": false], options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    }
}
