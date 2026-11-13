import Foundation
import CryptoKit
import CoreFoundation
import PDFKit

/// Typed native executor. No renderer-provided URL, HTTP verb, token or raw MIME.
/// Receipts share the existing private Workspace Keychain service, never JS secrets.
final class NativeGoogleActions {
    struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }
    struct HTTPFailure: Error { let status: Int }
    private let storage: ContactCredentialStorage
    private let session: URLSession
    private let signatureDirectory: URL?
    private var running: Set<String> = []
    init(storage: ContactCredentialStorage, session: URLSession, signatureDirectory: URL? = nil) { self.storage = storage; self.session = session; self.signatureDirectory = signatureDirectory }
    static let fields: [String: [String]] = [
        "gmail.search": ["query", "limit"], "gmail.read": ["id"],
        "gmail.draft": ["to", "subject", "body", "cc", "bcc", "threadId"], "gmail.send": ["to", "subject", "body", "cc", "bcc", "threadId"],
        "gmail.modify": ["id", "addLabelIds", "removeLabelIds", "trash"],
        "calendar.list": ["calendarId", "query", "timeMin", "timeMax", "limit"],
        "calendar.create": ["calendarId", "summary", "start", "end", "description", "location", "attendees", "sendUpdates"],
        "calendar.update": ["calendarId", "id", "etag", "summary", "start", "end", "description", "location", "attendees", "sendUpdates"],
        "drive.list": ["query", "limit"], "drive.read": ["id"],
        "drive.create": ["name", "content", "mimeType", "parentId"],
        "drive.update": ["id", "name", "content", "addParentId", "removeParentId", "expectedModifiedTime"],
        "drive.trash": ["id", "expectedModifiedTime"],
        "sheets.read": ["spreadsheetId", "range"], "sheets.create": ["title"],
        "sheets.write": ["spreadsheetId", "range", "values"], "sheets.append": ["spreadsheetId", "range", "values"],
        "contacts.search": ["query", "limit"], "contacts.create": ["givenName", "familyName", "email", "phone", "organization"],
        "contacts.update": ["resourceName", "etag", "givenName", "familyName", "email", "phone", "organization"]
    ]
    static let reads: Set<String> = ["gmail.search", "gmail.read", "calendar.list", "drive.list", "drive.read", "sheets.read", "contacts.search"]
    static var catalog: [[String: Any]] { fields.keys.sorted().map { ["operation": $0, "write": !reads.contains($0), "allowedArgs": fields[$0]!, "requestId": "UUID; retained idempotent receipt", "maxResponseBytes": 24000] } }
    /// Compare against the authenticated server's immutable, currently executable
    /// queue entry. Renderer-provided policy or claimed owner never grants access.
    static func matchesClaim(_ payload: [String: Any], body: [String: Any], owner: String) -> Bool {
        guard let action = payload["action"] as? [String: Any], action["state"] as? String == "running",
              action["ownerId"] as? String == owner, body["expectedOwner"] as? String == owner,
              let id = body["requestId"] as? String, UUID(uuidString: id) != nil, action["id"] as? String == id,
              let operation = body["operation"] as? String, action["operation"] as? String == operation,
              let args = body["args"] as? [String: Any], let claimed = action["args"] as? [String: Any],
              JSONSerialization.isValidJSONObject(args), JSONSerialization.isValidJSONObject(claimed),
              let expected = try? JSONSerialization.data(withJSONObject: args, options: .sortedKeys),
              let actual = try? JSONSerialization.data(withJSONObject: claimed, options: .sortedKeys) else { return false }
        return expected == actual
    }
    static func requiredScope(_ operation: String) -> String {
        let family = operation.split(separator: ".").first.map(String.init) ?? ""
        return "https://www.googleapis.com/auth/" + (["gmail": "gmail.modify", "calendar": "calendar.events", "drive": "drive", "sheets": "spreadsheets", "contacts": "contacts"][family] ?? "unsupported")
    }
    static func text(_ a: [String: Any], _ key: String, required: Bool = false, max: Int = 1000) throws -> String? {
        guard let value = a[key] else { if required { throw Failure(message: "Missing argument: \(key).") }; return nil }
        guard let s = value as? String, s.utf8.count <= max, !s.contains("\0"), !required || !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw Failure(message: "Invalid argument: \(key).") }
        return s
    }
    static func id(_ a: [String: Any], _ key: String) throws -> String {
        let s = try text(a, key, required: true, max: 200)!
        guard s.range(of: "^[A-Za-z0-9_-]{1,200}$", options: .regularExpression) != nil else { throw Failure(message: "Invalid resource identity: \(key).") }; return s
    }
    static func email(_ value: String) -> Bool { value.utf8.count <= 254 && value.range(of: "^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$", options: .regularExpression) != nil }
    static func emails(_ a: [String: Any], _ key: String, required: Bool = false) throws -> [String] {
        guard let value = a[key] else { if required { throw Failure(message: "Provide at least one recipient.") }; return [] }
        guard let rows = value as? [String], rows.count <= 20, (!required || !rows.isEmpty), rows.allSatisfy(email) else { throw Failure(message: "Invalid email list: \(key).") }; return rows
    }
    static func isBoolean(_ value: Any) -> Bool { CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID() }
    static func limit(_ a: [String: Any]) throws -> Int {
        guard let value = a["limit"] else { return 10 }
        guard let n = value as? Int, !isBoolean(value), (1...25).contains(n) else { throw Failure(message: "Limit must be an integer from 1 to 25.") }; return n
    }
    static func date(_ value: String) -> Date? { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f.date(from: value) ?? ISO8601DateFormatter().date(from: value) }
    static func boundedRange(_ value: String) -> Bool {
        guard value.count <= 160, let r = value.range(of: "^(?:'[^'\\r\\n]{1,80}'!|[A-Za-z_][A-Za-z0-9_ ]{0,79}!)?[A-Z]{1,3}[1-9][0-9]{0,5}(?::[A-Z]{1,3}[1-9][0-9]{0,5})?$", options: .regularExpression) else { return false }
        guard r.lowerBound == value.startIndex else { return false }
        let cells = value.split(separator: "!").last!.split(separator: ":")
        func position(_ s: Substring) -> (Int, Int) { let letters = s.prefix { $0.isLetter }; return (letters.utf8.reduce(0) { $0 * 26 + Int($1) - 64 }, Int(s.dropFirst(letters.count)) ?? 0) }
        let a = position(cells[0]), b = position(cells.last!); return b.0 >= a.0 && b.1 >= a.1 && b.0 - a.0 < 50 && b.1 - a.1 < 100 && (b.0-a.0+1)*(b.1-a.1+1) <= 500
    }
    static func validate(_ operation: String, _ a: [String: Any]) throws {
        guard let allowed = fields[operation], Set(a.keys).isSubset(of: Set(allowed)), JSONSerialization.isValidJSONObject(a), try JSONSerialization.data(withJSONObject: a).count <= 65536 else { throw Failure(message: "Unsupported operation or arguments.") }
        for k in ["query", "subject", "summary", "description", "location", "name", "title", "givenName", "familyName", "phone", "organization", "etag", "expectedModifiedTime"] where a[k] != nil { _ = try text(a, k, max: k == "description" ? 8000 : 1000) }
        for k in ["id", "spreadsheetId", "parentId", "addParentId", "removeParentId", "threadId"] where a[k] != nil { _ = try id(a, k) }
        if a["calendarId"] != nil { let c = try text(a, "calendarId", required: true, max: 254)!; guard c == "primary" || email(c) else { throw Failure(message: "Use primary or a calendar email identity.") } }
        if a["limit"] != nil { _ = try limit(a) }
        for k in ["body", "content"] where a[k] != nil { _ = try text(a, k, max: 40000) }
        if operation == "gmail.draft" || operation == "gmail.send" {
            let recipients = try emails(a, "to", required: true) + emails(a, "cc") + emails(a, "bcc")
            guard recipients.count <= 20 else { throw Failure(message: "At most 20 total recipients are allowed.") }
            let s = try text(a, "subject", required: true)!; guard !s.unicodeScalars.contains(where: { $0.value == 10 || $0.value == 13 }) else { throw Failure(message: "Subject cannot contain header delimiters.") }; _ = try text(a, "body", required: true, max: 40000)
        }
        if ["gmail.read", "gmail.modify", "drive.read", "drive.update", "drive.trash", "calendar.update"].contains(operation) { _ = try id(a, "id") }
        if operation == "gmail.modify" {
            if let trash = a["trash"] { guard isBoolean(trash), a["addLabelIds"] == nil, a["removeLabelIds"] == nil else { throw Failure(message: "Trash/untrash is separate from label edits.") } }
            else {
                var count = 0
                for k in ["addLabelIds", "removeLabelIds"] { if let v = a[k] { guard let ids = v as? [String], ids.count <= 30, ids.allSatisfy({ $0.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil }) else { throw Failure(message: "Invalid label IDs.") }; count += ids.count } }
                guard count > 0 else { throw Failure(message: "Provide label changes or trash state.") }
            }
        }
        if operation.hasPrefix("calendar.") {
            for k in ["start", "end", "timeMin", "timeMax"] where a[k] != nil { guard let s = a[k] as? String, date(s) != nil else { throw Failure(message: "\(k) must be an RFC3339 timestamp with timezone.") } }
            if operation == "calendar.create" { _ = try text(a, "summary", required: true); guard a["start"] != nil, a["end"] != nil else { throw Failure(message: "Start and end are required.") } }
            if let s = a["start"] as? String, let e = a["end"] as? String { guard date(e)! > date(s)! else { throw Failure(message: "Event end must follow start.") } }
            if a["attendees"] != nil { _ = try emails(a, "attendees") }
            if let send = a["sendUpdates"] as? String { guard ["none", "all"].contains(send) else { throw Failure(message: "Invalid notification setting.") } } else if a["sendUpdates"] != nil { throw Failure(message: "Invalid notification setting.") }
            if operation == "calendar.update" { guard ["summary", "start", "end", "description", "location", "attendees"].contains(where: { a[$0] != nil }) else { throw Failure(message: "Provide event fields to update.") } }
        }
        if operation == "drive.create" { _ = try text(a, "name", required: true); let m = a["mimeType"] as? String ?? "text/plain"; guard ["text/plain", "text/markdown", "text/csv", "application/json", "application/vnd.google-apps.folder"].contains(m), a["mimeType"] == nil || a["mimeType"] is String, m != "application/vnd.google-apps.folder" || a["content"] == nil else { throw Failure(message: "Unsupported file type or folder content.") } }
        if operation == "drive.update" { guard ["name", "content", "addParentId", "removeParentId"].contains(where: { a[$0] != nil }) else { throw Failure(message: "Provide file content, name or parent changes.") } }
        if operation.hasPrefix("sheets.") && operation != "sheets.create" {
            _ = try id(a, "spreadsheetId"); guard let range = a["range"] as? String, boundedRange(range) else { throw Failure(message: "Use an explicit A1 range of at most 500 cells (e.g. Sheet1!A1:D20).") }
            if operation != "sheets.read" {
                guard let rows = a["values"] as? [[Any]], !rows.isEmpty, rows.count <= 100, rows.reduce(0, { $0 + $1.count }) <= 500, rows.allSatisfy({ !$0.isEmpty && $0.count <= 50 && $0.allSatisfy { v in (v is String && (v as! String).utf8.count <= 2000) || v is NSNumber } }) else { throw Failure(message: "Values must contain at most 500 text, number or boolean cells.") }
                let cells = range.split(separator: "!").last!.split(separator: ":")
                func position(_ cell: Substring) -> (Int, Int) { let letters = cell.prefix { $0.isLetter }; return (letters.utf8.reduce(0) { $0 * 26 + Int($1) - 64 }, Int(cell.dropFirst(letters.count))!) }
                let start = position(cells[0]), end = position(cells.last!)
                guard rows.count <= end.1 - start.1 + 1, rows.allSatisfy({ $0.count <= end.0 - start.0 + 1 }) else { throw Failure(message: "Values exceed the explicitly selected range dimensions.") }
            }
        }
        if operation == "sheets.create" { _ = try text(a, "title", required: true) }
        if operation.hasPrefix("contacts.") {
            if let mail = a["email"] as? String { guard email(mail) else { throw Failure(message: "Invalid contact email.") } } else if a["email"] != nil { throw Failure(message: "Invalid contact email.") }
            if operation == "contacts.create" { _ = try text(a, "givenName", required: true) }
            if operation == "contacts.update" { guard let r = a["resourceName"] as? String, r.range(of: "^people/[A-Za-z0-9_-]{1,160}$", options: .regularExpression) != nil, ["givenName", "familyName", "email", "phone", "organization"].contains(where: { a[$0] != nil }) else { throw Failure(message: "Provide a contact resourceName and fields to update.") } }
        }
    }
    @MainActor func execute(owner: String, account: String, token: String, granted: Set<String>, operation: String, args: [String: Any], requestId: String, senderEmail: String? = nil, authorize: @escaping @MainActor () async throws -> Void) async throws -> [String: Any] {
        guard !running.contains(owner) else { throw Failure(message: "A Google action is already running for this owner.") }
        running.insert(owner); defer { running.remove(owner) }
        try Self.validate(operation, args)
        guard UUID(uuidString: requestId) != nil, !account.isEmpty, granted.contains(Self.requiredScope(operation)) else { throw Failure(message: "Invalid request identity or missing Google action permission. Reconnect with the requested scopes.") }
        try await authorize()
        let hashData = try JSONSerialization.data(withJSONObject: ["account": account, "operation": operation, "args": args], options: .sortedKeys)
        let hash = SHA256.hash(data: hashData).map { String(format: "%02x", $0) }.joined(), key = "action-" + requestId.lowercased()
        let saved: [String: Any]?
        do { saved = try storage.read(owner, key) }
        catch {
            // A locked/unavailable journal is not proof that this UUID has never
            // been dispatched. Never encourage a blind retry with a new UUID.
            return ["requestId": requestId, "operation": operation, "status": "unknown", "replayed": false, "error": "The private action receipt is unavailable. Nothing was dispatched now. Unlock the Mac and review the prior outcome before any new request."]
        }
        if let prior = saved {
            guard prior["hash"] as? String == hash else { throw Failure(message: "This request ID belongs to different arguments or a different Google account.") }
            var output = prior["output"] as? [String: Any] ?? ["requestId": requestId, "operation": operation, "status": "unknown", "error": "A previous attempt may have reached Google. Review its outcome before creating a new request."]
            output["replayed"] = true; return output
        }
        var dispatched = false
        let beginWrite: () throws -> Void = {
            try self.storage.write(owner, key, ["hash": hash, "operation": operation, "state": "pending", "createdAt": Date().timeIntervalSince1970])
            dispatched = true
        }
        do {
            let value = try await perform(operation, args, token: token, senderEmail: senderEmail, authorize: authorize, beginWrite: beginWrite)
            try await authorize()
            guard try JSONSerialization.data(withJSONObject: value).count <= 23000 else { throw Failure(message: "Google result exceeded the saved action limit.") }
            let output: [String: Any] = ["requestId": requestId, "operation": operation, "status": "completed", "replayed": false, "result": value]
            try storage.write(owner, key, ["hash": hash, "operation": operation, "state": "completed", "output": output]); return output
        } catch {
            if dispatched {
                let rejected = (error as? HTTPFailure).map { (400...499).contains($0.status) && ![408, 499].contains($0.status) } ?? false
                let output: [String: Any] = ["requestId": requestId, "operation": operation, "status": rejected ? "failed" : "unknown", "replayed": false, "error": rejected ? "Google rejected this action. Review permissions or resource state before a new request." : "The action may have reached Google. Nothing was retried. Review the provider before attempting it with a new request ID."]
                // A retired session cannot overwrite receipts; pending remains an
                // unknown outcome and prevents replay after restart.
                if (try? await authorize()) != nil { try? storage.write(owner, key, ["hash": hash, "operation": operation, "state": output["status"]!, "output": output]) }
                return output
            }
            if let f = error as? Failure { throw f }
            throw Failure(message: "Google action could not be completed. Check access and retry explicitly; no write was dispatched.")
        }
    }
    private func url(_ base: String, _ query: [String: String] = [:]) -> URL { var c = URLComponents(string: base)!; c.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }; return c.url! }
    private func component(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.~")))! }
    @MainActor private func perform(_ op: String, _ a: [String: Any], token: String, senderEmail: String?, authorize: @escaping @MainActor () async throws -> Void, beginWrite: () throws -> Void) async throws -> [String: Any] {
        func send(_ address: URL, method: String = "GET", json: [String: Any]? = nil, data: Data? = nil, contentType: String? = nil, etag: String? = nil) async throws -> (Data, HTTPURLResponse) {
            try await authorize()
            guard address.scheme == "https", ["gmail.googleapis.com", "www.googleapis.com", "sheets.googleapis.com", "people.googleapis.com"].contains(address.host ?? ""), address.user == nil, address.password == nil else { throw Failure(message: "Unsupported Google endpoint.") }
            var r = URLRequest(url: address); r.httpMethod = method; r.timeoutInterval = 30; r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            if let json { r.httpBody = try JSONSerialization.data(withJSONObject: json); r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            if let data { r.httpBody = data; r.setValue(contentType, forHTTPHeaderField: "Content-Type") }
            if let etag { guard !etag.unicodeScalars.contains(where: { $0.value == 10 || $0.value == 13 }), etag.count <= 500 else { throw Failure(message: "Invalid resource version.") }; r.setValue(etag, forHTTPHeaderField: "If-Match") }
            if method != "GET" { try beginWrite() }
            let (bytes, response) = try await session.bytes(for: r); defer { bytes.task.cancel() }
            guard let http = response as? HTTPURLResponse, response.expectedContentLength <= 2 * 1024 * 1024 else { throw Failure(message: "Google response exceeded the safe limit.") }
            guard (200...299).contains(http.statusCode) else { throw HTTPFailure(status: http.statusCode) }
            var result = Data(); for try await b in bytes { guard result.count < 2 * 1024 * 1024 else { throw Failure(message: "Google response exceeded the safe limit.") }; result.append(b) }
            try await authorize(); return (result, http)
        }
        func object(_ address: URL, method: String = "GET", json: [String: Any]? = nil, data: Data? = nil, contentType: String? = nil, etag: String? = nil) async throws -> [String: Any] {
            let (d, h) = try await send(address, method: method, json: json, data: data, contentType: contentType, etag: etag)
            guard var v = try JSONSerialization.jsonObject(with: d) as? [String: Any] else { throw Failure(message: "Google returned an invalid result.") }
            if let e = h.value(forHTTPHeaderField: "ETag") { v["_etag"] = e }; return v
        }
        func selected(_ v: [String: Any], _ names: [String]) -> [String: Any] { v.filter { names.contains($0.key) } }
        func verified(_ v: [String: Any], _ key: String = "id", _ expected: String? = nil) throws -> [String: Any] { guard let id = v[key] as? String, !id.isEmpty, id.count <= 300, expected == nil || id == expected else { throw Failure(message: "Google returned an unexpected resource identity.") }; return v }
        let n = try Self.limit(a), gmail = "https://gmail.googleapis.com/gmail/v1/users/me", drive = "https://www.googleapis.com/drive/v3/files", sheets = "https://sheets.googleapis.com/v4/spreadsheets", people = "https://people.googleapis.com/v1"
        switch op {
        case "gmail.search":
            let r = try await object(url(gmail + "/messages", ["q": a["query"] as? String ?? "", "maxResults": String(n)])); guard r["resultSizeEstimate"] is NSNumber, r["messages"] == nil || r["messages"] is [[String: Any]] else { throw Failure(message: "Gmail returned malformed search data.") }; return ["items": Array((r["messages"] as? [[String: Any]] ?? []).prefix(n)).map { selected($0, ["id", "threadId"]) }, "nextPageToken": r["nextPageToken"] ?? NSNull()]
        case "gmail.read":
            let r = try verified(await object(url(gmail + "/messages/" + Self.id(a, "id"), ["format": "full"])), "id", a["id"] as? String)
            let payload = r["payload"] as? [String: Any] ?? [:]
            var texts: [String] = []
            func visit(_ p: [String: Any], _ depth: Int) { guard depth < 8, texts.joined().count < 12000 else { return }; if p["mimeType"] as? String == "text/plain", let b = p["body"] as? [String: Any], let s = b["data"] as? String { let standard = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/"); if let d = Data(base64Encoded: standard + String(repeating: "=", count: (4-standard.count%4)%4)), let t = String(data: d, encoding: .utf8) { texts.append(String(t.prefix(12000))) } }; for child in (p["parts"] as? [[String: Any]] ?? []).prefix(30) { visit(child, depth+1) } }
            visit(payload, 0)
            return ["id": r["id"]!, "threadId": r["threadId"] ?? "", "labelIds": r["labelIds"] ?? [], "snippet": String((r["snippet"] as? String ?? "").prefix(1000)), "headers": (payload["headers"] as? [[String: Any]] ?? []).filter { ["from", "to", "cc", "subject", "date"].contains(($0["name"] as? String ?? "").lowercased()) }.prefix(12).map { ["name": $0["name"] as? String ?? "", "value": String(($0["value"] as? String ?? "").prefix(1000))] }, "text": String(texts.joined(separator: "\n").prefix(12000)), "notice": "Plain-text parts only; HTML and attachment bodies are not executed or automatically downloaded."]
        case "gmail.draft", "gmail.send":
            var headers = ["To: " + (try Self.emails(a, "to", required: true)).joined(separator: ", ")]
            for k in ["cc", "bcc"] { let e = try Self.emails(a, k); if !e.isEmpty { headers.append(k.capitalized + ": " + e.joined(separator: ", ")) } }
            headers += ["Subject: " + NativeEmailSignature.encodedSubject(a["subject"] as! String), "MIME-Version: 1.0"]
            let signature: NativeEmailSignature?
            do { signature = try NativeEmailSignature.load(directory: signatureDirectory, senderEmail: senderEmail) }
            catch { throw Failure(message: "The configured email signature could not be verified. Restore its approved private assets before sending; no email was sent.") }
            let message = headers.joined(separator: "\r\n") + "\r\n" + NativeEmailSignature.mime(body: a["body"] as! String, signature: signature)
            var input: [String: Any] = ["raw": Data(message.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")]; if let thread = a["threadId"] { input["threadId"] = thread }
            let r = try verified(await object(url(gmail + (op == "gmail.draft" ? "/drafts" : "/messages/send")), method: "POST", json: op == "gmail.draft" ? ["message": input] : input)); var result = selected(r, ["id", "threadId", "labelIds"]); if let message = r["message"] as? [String: Any] { result["message"] = selected(message, ["id", "threadId", "labelIds"]) }; return result
        case "gmail.modify":
            let id = try Self.id(a, "id"), suffix = (a["trash"] as? Bool).map { $0 ? "/trash" : "/untrash" } ?? "/modify"
            let r = try verified(await object(url(gmail + "/messages/" + id + suffix), method: "POST", json: suffix == "/modify" ? selected(a, ["addLabelIds", "removeLabelIds"]) : [:]), "id", id); return selected(r, ["id", "threadId", "labelIds"])
        case "calendar.list", "calendar.create", "calendar.update":
            let calendar = a["calendarId"] as? String ?? "primary", base = "https://www.googleapis.com/calendar/v3/calendars/" + component(calendar) + "/events"
            if op == "calendar.list" { var q = ["maxResults": String(n), "singleEvents": "true", "orderBy": "startTime", "timeMin": a["timeMin"] as? String ?? ISO8601DateFormatter().string(from: Date())]; for (k,v) in [("q",a["query"]),("timeMax",a["timeMax"])] { if let s = v as? String { q[k] = s } }; let r = try await object(url(base,q)); guard r["kind"] as? String == "calendar#events", r["items"] == nil || r["items"] is [[String: Any]] else { throw Failure(message: "Calendar returned malformed list data.") }; return ["items": Array((r["items"] as? [[String: Any]] ?? []).prefix(n)).map { selected($0,["id","summary","description","location","start","end","etag","status","attendees"]) }] }
            var b = selected(a,["summary","description","location"]); for k in ["start","end"] { if let s = a[k] { b[k] = ["dateTime":s] } }; if let e = a["attendees"] as? [String] { b["attendees"] = e.map { ["email":$0] } }
            let q = ["sendUpdates": a["sendUpdates"] as? String ?? "none"]
            var e: String?, address = base, method = "POST"
            if op == "calendar.update" { address += "/" + (try Self.id(a,"id")); method = "PATCH"; let previous = try verified(await object(url(address)), "id", a["id"] as? String); e = previous["etag"] as? String; guard e != nil, a["etag"] == nil || a["etag"] as? String == e else { throw Failure(message: "Event changed; read it again before updating.") }; let s = a["start"] as? String ?? (previous["start"] as? [String:Any])?["dateTime"] as? String; let end = a["end"] as? String ?? (previous["end"] as? [String:Any])?["dateTime"] as? String; if let s, let end, let sd=Self.date(s), let ed=Self.date(end) { guard ed>sd else { throw Failure(message:"Event end must follow start.") } } }
            let r = try verified(await object(url(address,q), method:method,json:b,etag:e)); return selected(r,["id","summary","start","end","etag","htmlLink"])
        case "drive.list":
            let r = try await object(url(drive,["pageSize":String(n),"q":a["query"] as? String ?? "trashed = false","fields":"kind,files(id,name,mimeType,modifiedTime,parents,trashed),nextPageToken"])); guard r["kind"] as? String == "drive#fileList", r["files"] == nil || r["files"] is [[String: Any]] else { throw Failure(message: "Drive returned malformed list data.") }; return ["items":Array((r["files"] as? [[String:Any]] ?? []).prefix(n)).map { selected($0,["id","name","mimeType","modifiedTime","parents","trashed"]) }]
        case "drive.read", "drive.update", "drive.trash":
            let id = try Self.id(a,"id"), address = drive + "/" + id
            let previous = try verified(await object(url(address,["fields":"id,name,mimeType,modifiedTime,parents,trashed,size"])),"id",id)
            if op == "drive.read" {
                var out = selected(previous,["id","name","mimeType","modifiedTime","parents","trashed"]); let mime = previous["mimeType"] as? String ?? ""
                if mime == "application/vnd.google-apps.folder" { return out }
                let googleDoc = mime == "application/vnd.google-apps.document"
                if !googleDoc && !["text/plain","text/markdown","text/csv","application/json","application/pdf"].contains(mime) { out["notice"]="Content extraction is supported for text, JSON, CSV, PDF and Google Docs only."; return out }
                let (d,_) = try await send(url(address + (googleDoc ? "/export" : ""), googleDoc ? ["mimeType":"text/plain"] : ["alt":"media"]))
                var text: String?
                if mime == "application/pdf", let pdf=PDFDocument(data:d) { text=(0..<min(pdf.pageCount,20)).compactMap { pdf.page(at:$0)?.string }.joined(separator:"\n") } else { text=String(data:d,encoding:.utf8) }
                guard let text else { throw Failure(message:"The file did not contain supported readable text.") }; out["text"]=String(text.prefix(12000)); out["truncated"]=text.count>12000; return out
            }
            guard let currentETag = previous["_etag"] as? String, !currentETag.isEmpty else { throw Failure(message: "Drive did not return a safe resource version. No file was changed.") }
            if let expected=a["expectedModifiedTime"] as? String, expected != previous["modifiedTime"] as? String { throw Failure(message:"File changed; read it again before updating.") }
            if op == "drive.trash" { let r=try verified(await object(url(address,["fields":"id,name,trashed,modifiedTime"]),method:"PATCH",json:["trashed":true],etag:currentETag),"id",id);return selected(r,["id","name","trashed","modifiedTime"]) }
            var q=["fields":"id,name,mimeType,modifiedTime,parents"];if let p=a["addParentId"] as? String{q["addParents"]=p};if let p=a["removeParentId"] as? String{q["removeParents"]=p}
            let metadata=selected(a,["name"])
            if let content=a["content"] as? String { let mime=previous["mimeType"] as? String ?? "";guard ["text/plain","text/markdown","text/csv","application/json"].contains(mime) else {throw Failure(message:"Updating bytes is supported only for text, Markdown, CSV or JSON files.")};let multipart=Self.multipart(metadata,content,mime);q["uploadType"]="multipart";let r=try verified(await object(url("https://www.googleapis.com/upload/drive/v3/files/"+id,q),method:"PATCH",data:multipart.0,contentType:multipart.1,etag:currentETag),"id",id);return selected(r,["id","name","mimeType","modifiedTime","parents"]) }
            let r=try verified(await object(url(address,q),method:"PATCH",json:metadata,etag:currentETag),"id",id);return selected(r,["id","name","mimeType","modifiedTime","parents"])
        case "drive.create":
            let mime=a["mimeType"] as? String ?? "text/plain";var meta:[String:Any]=["name":a["name"]!,"mimeType":mime];if let p=a["parentId"]{meta["parents"]=[p]}
            let r:[String:Any]
            if mime == "application/vnd.google-apps.folder" {r=try await object(url(drive,["fields":"id,name,mimeType,parents"]),method:"POST",json:meta)}else{let m=Self.multipart(meta,a["content"] as? String ?? "",mime);r=try await object(url("https://www.googleapis.com/upload/drive/v3/files",["uploadType":"multipart","fields":"id,name,mimeType,parents"]),method:"POST",data:m.0,contentType:m.1)}
            return selected(try verified(r),["id","name","mimeType","parents"])
        case "sheets.create":
            let r=try verified(await object(url(sheets),method:"POST",json:["properties":["title":a["title"]!]]),"spreadsheetId");return selected(r,["spreadsheetId","spreadsheetUrl","properties"])
        case "sheets.read", "sheets.write", "sheets.append":
            let id=try Self.id(a,"spreadsheetId"),range=a["range"] as! String,base=sheets+"/"+id+"/values/"+component(range)
            if op == "sheets.read" {let r=try await object(url(base));guard r["range"] is String, r["values"] == nil || r["values"] is [[Any]] else { throw Failure(message: "Sheets returned malformed range data.") }; let rows=r["values"] as? [[Any]] ?? []; guard rows.reduce(0, { $0 + $1.count }) <= 500 else { throw Failure(message: "Sheets returned more than 500 cells.") }; return ["range":r["range"] ?? range,"values":rows.prefix(100).map {Array($0.prefix(50)).map {v -> Any in if let s=v as? String{return String(s.prefix(2000))};return v is NSNumber ? v : NSNull()} }]}
            let append=op == "sheets.append",r=try await object(url(base+(append ? ":append":""),["valueInputOption":"RAW","includeValuesInResponse":"false"]),method:append ? "POST":"PUT",json:["range":range,"majorDimension":"ROWS","values":a["values"]!]);guard r["spreadsheetId"] as? String==id else{throw Failure(message:"Google returned a different spreadsheet identity.")};return selected(r,["spreadsheetId","updatedRange","updatedRows","updatedColumns","updatedCells","tableRange","updates"])
        case "contacts.search":
            let query=a["query"] as? String ?? "",r:[String:Any],list:[[String:Any]]
            if query.isEmpty {r=try await object(url(people+"/people/me/connections",["personFields":"names,emailAddresses,phoneNumbers,organizations,metadata","pageSize":String(n)]));guard r["totalPeople"] is NSNumber || r["connections"] != nil, r["connections"] == nil || r["connections"] is [[String: Any]] else { throw Failure(message: "Contacts returned malformed list data.") }; list=r["connections"] as? [[String:Any]] ?? []}else{_ = try await object(url(people+"/people:searchContacts",["query":"","readMask":"names,emailAddresses,phoneNumbers,organizations,metadata","pageSize":"1"]));r=try await object(url(people+"/people:searchContacts",["query":query,"readMask":"names,emailAddresses,phoneNumbers,organizations,metadata","pageSize":String(min(n,30))]));guard r["results"] == nil || r["results"] is [[String: Any]] else { throw Failure(message: "Contacts returned malformed search data.") }; list=(r["results"] as? [[String:Any]] ?? []).compactMap{$0["person"] as? [String:Any]}}
            return ["items":Array(list.prefix(n)).map{Self.contactSummary($0)}]
        case "contacts.create", "contacts.update":
            var b:[String:Any]=[:],masks:[String]=[],previous:[String:Any]=[:]
            let update=op == "contacts.update",resource=a["resourceName"] as? String ?? ""
            if update {previous=try verified(await object(url(people+"/"+resource,["personFields":"names,emailAddresses,phoneNumbers,organizations,metadata"])),"resourceName",resource);guard let metadata=previous["metadata"] as? [String:Any],let sources=metadata["sources"] as? [[String:Any]],let source=sources.first(where:{$0["type"] as? String=="CONTACT"}),source["etag"] is String else{throw Failure(message:"Only an existing contact source can be updated.")};if let expected=a["etag"] as? String,expected != previous["etag"] as? String{throw Failure(message:"Contact changed; read it again before updating.")};b["metadata"]=["sources":[source]]}
            if a["givenName"] != nil || a["familyName"] != nil {var name = ((previous["names"] as? [[String:Any]])?.first ?? [:]).filter { ["givenName", "familyName", "middleName", "honorificPrefix", "honorificSuffix", "phoneticGivenName", "phoneticMiddleName", "phoneticFamilyName"].contains($0.key) }; for key in ["givenName", "familyName"] { if let value = a[key] { name[key] = value } }; b["names"] = [name]; masks.append("names")}
            for (arg,field,key) in [("email","emailAddresses","value"),("phone","phoneNumbers","value"),("organization","organizations","name")] {
                if let v = a[arg] {
                    var rows = previous[field] as? [[String: Any]] ?? []
                    if rows.isEmpty { rows = [[key: v]] } else {
                        let primary = rows.firstIndex { ($0["metadata"] as? [String: Any])?["primary"] as? Bool == true } ?? 0
                        rows[primary][key] = v
                    }
                    // Preserve secondary entries and their labels; metadata is read-only.
                    b[field] = rows.map { $0.filter { $0.key != "metadata" && $0.key != "formattedType" } }; masks.append(field)
                }
            }
            let address=update ? people+"/"+resource+":updateContact":people+"/people:createContact",q=update ? ["updatePersonFields":masks.joined(separator:","),"personFields":"names,emailAddresses,phoneNumbers,organizations,metadata"]:["personFields":"names,emailAddresses,phoneNumbers,organizations,metadata"]
            let r=try verified(await object(url(address,q),method:update ? "PATCH":"POST",json:b),"resourceName",update ? resource:nil);return Self.contactSummary(r)
        default: throw Failure(message:"Unsupported Google operation.")
        }
    }
    private static func multipart(_ metadata:[String:Any],_ content:String,_ mime:String)->(Data,String){let boundary="axon-"+UUID().uuidString;var d=Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".utf8);d.append(try! JSONSerialization.data(withJSONObject:metadata));d.append(Data("\r\n--\(boundary)\r\nContent-Type: \(mime); charset=UTF-8\r\n\r\n\(content)\r\n--\(boundary)--\r\n".utf8));return(d,"multipart/related; boundary=\(boundary)")}
    private static func contactSummary(_ p: [String: Any]) -> [String: Any] {
        var out = p.filter { ["resourceName", "etag"].contains($0.key) }
        for (field, keys) in [("names", ["displayName", "givenName", "familyName"]), ("emailAddresses", ["value"]), ("phoneNumbers", ["value"]), ("organizations", ["name"])] {
            out[field] = (p[field] as? [[String: Any]] ?? []).prefix(5).map { row in row.filter { keys.contains($0.key) }.mapValues { String(($0 as? String ?? "").prefix(1000)) } }
        }
        return out
    }
}
