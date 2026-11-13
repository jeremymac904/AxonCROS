import AppKit
import NativePanelFactory

/// Separate consent and credential namespace from Contacts. No tokens enter JavaScript.
final class NativeGoogleWorkspace {
    static let scopes = ["gmail": "https://www.googleapis.com/auth/gmail.modify", "google-calendar": "https://www.googleapis.com/auth/calendar.events", "google-drive": "https://www.googleapis.com/auth/drive", "google-sheets": "https://www.googleapis.com/auth/spreadsheets", "google-contacts": "https://www.googleapis.com/auth/contacts"]
    private let secrets: ContactCredentialStorage
    private let session: URLSession
    private let actions: NativeGoogleActions
    private var busy: Set<String> = []
    private var receiver: ContactOAuthReceiver?
    private var authorizationGeneration = 0
    init(service: String, storage: ContactCredentialStorage? = nil, transport: URLSession? = nil, signatureDirectory: URL? = nil) {
        secrets = storage ?? ContactSecrets(service: service)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 30
        config.httpCookieStorage = nil; config.urlCache = nil
        session = transport ?? URLSession(configuration: config, delegate: WorkspaceHTTPRedirects(), delegateQueue: nil)
        actions = NativeGoogleActions(storage: secrets, session: session, signatureDirectory: signatureDirectory)
    }
    func handles(_ action: String) -> Bool {
        ["executeGoogleAction", "googleActionCatalog", "cancelGoogleActions", "googleWorkspaceStatus", "configureGoogleWorkspace", "connectGoogleWorkspace", "cancelGoogleWorkspaceAuth", "disconnectGoogleWorkspace", "readGoogleWorkspace", "checkGoogleWorkspace"].contains(action)
    }
    private func status(_ scope: String) throws -> [String: Any] {
        let client = try secrets.read(scope, "client"), auth = try secrets.read(scope, "authorization")
        let grants = Set((auth?["scope"] as? String ?? "").split(separator: " ").map(String.init))
        let reconnect = auth?["needsReconnect"] as? Bool ?? false
        let checks = auth?["checks"] as? [String: Double] ?? [:]
        let errors = auth?["errors"] as? [String: String] ?? [:]
        let connectors: [[String: Any]] = Self.scopes.keys.sorted().map { provider in
            let authorized = auth != nil && grants.contains(Self.scopes[provider]!) && !reconnect
            let connected = authorized && checks[provider] != nil && errors[provider] == nil
            return ["id": provider, "authorized": authorized, "connected": connected, "status": errors[provider] != nil || reconnect ? "needs-attention" : connected ? "connected" : authorized ? "configured" : "not-configured", "dependency": errors[provider] ?? "", "transport": "native-google", "lastCheckedAt": checks[provider] as Any? ?? NSNull()]
        }
        return ["native": true, "configured": client != nil, "connected": connectors.allSatisfy { $0["connected"] as? Bool == true }, "connectors": connectors, "accountName": auth?["accountName"] ?? NSNull(), "busy": busy.contains(scope), "needsReconnect": reconnect, "direction": "read-write", "actionCatalog": NativeGoogleActions.catalog, "scopes": Self.scopes.values.sorted(), "notice": "Workspace consent supports typed Google actions. Writes require the selected chat policy; existing legacy Contacts, other apps and Hermes remain separate."]
    }
    func handle(_ action: String, body: [String: Any], window: NSWindow?, authorize: @escaping @MainActor () async throws -> Void = {}, reply: @escaping (Any?, String?) -> Void) {
        guard let scope = body["scope"] as? String, scope.range(of: "^[A-Za-z0-9_.-]{1,96}$", options: .regularExpression) != nil else { reply(nil, "Invalid local owner scope."); return }
        if action == "cancelGoogleWorkspaceAuth" || action == "cancelGoogleActions" { authorizationGeneration += 1; receiver?.cancel(); reply(["cancelled": true], nil); return }
        if action == "googleActionCatalog" { reply(["operations": NativeGoogleActions.catalog], nil); return }
        if action == "executeGoogleAction", body["expectedOwner"] as? String != scope { reply(nil, "This action belongs to another local owner."); return }
        if action == "googleWorkspaceStatus" { do { reply(try status(scope), nil) } catch { reply(nil, "Workspace Keychain metadata is unavailable. Unlock the Mac and retry.") }; return }
        guard !busy.contains(scope) else { reply(nil, "A Workspace operation is in progress. Finish or cancel it first."); return }
        if action == "configureGoogleWorkspace" {
            guard let window else { reply(nil, "Open the AxonCROS window first."); return }
            busy.insert(scope)
            NativePanels.shared.present(for: window, request: NativePanelRequest(title: "Choose existing Google Desktop OAuth client", message: "Enable Gmail, Calendar, Drive, Sheets and People APIs in your existing project. This stores the client only in this app’s Workspace Keychain, without connecting an account.")) { [self] panel, result in
                Task { @MainActor in
                    defer { busy.remove(scope) }
                    guard result == .OK, let url = panel?.url else { reply(["cancelled": true], nil); return }
                    do {
                        try await authorize()
                        let attrs = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                        guard attrs.isRegularFile == true, (attrs.fileSize ?? 100001) <= 100000 else { throw Failure.message("Choose a Desktop OAuth JSON file smaller than 100 KB.") }
                        let data = try Data(contentsOf: url)
                        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any], let installed = root["installed"] as? [String: Any], let clientID = installed["client_id"] as? String, clientID.hasSuffix(".apps.googleusercontent.com"), clientID.count < 500 else { throw Failure.message("This is not a Desktop OAuth client JSON. No settings changed.") }
                        guard try secrets.read(scope, "authorization") == nil else { throw Failure.message("Disconnect this app’s Workspace grant before changing its client. Contacts remain connected separately.") }
                        try secrets.write(scope, "client", ["client_id": clientID, "client_secret": installed["client_secret"] as? String ?? ""])
                        reply(try status(scope), nil)
                    } catch let Failure.message(message) { reply(nil, message) }
                    catch { reply(nil, "The OAuth client could not be read or stored. No credentials were returned.") }
                }
            }
            return
        }
        busy.insert(scope)
        Task { @MainActor [self] in
            defer { busy.remove(scope) }
            do {
                try await authorize()
                let output: [String: Any]
                switch action {
                case "executeGoogleAction": output = try await executeAction(scope, body: body, authorize: authorize)
                case "connectGoogleWorkspace": output = try await connect(scope, body: body, authorize: authorize)
                case "readGoogleWorkspace", "checkGoogleWorkspace": output = try await read(scope, body: body, checkOnly: action == "checkGoogleWorkspace", authorize: authorize)
                case "disconnectGoogleWorkspace": try secrets.remove(scope, "authorization"); output = ["disconnected": true, "notice": "Only this app’s Workspace token was removed. Contacts and provider data remain. Revoke the grant separately in Google Account permissions if desired."]
                default: throw Failure.message("Unsupported Workspace operation.")
                }
                try await authorize(); reply(output, nil)
            } catch let Failure.message(message) {
                if ["readGoogleWorkspace", "checkGoogleWorkspace"].contains(action), let provider = body["provider"] as? String, Self.scopes[provider] != nil {
                    do { try await authorize(); if var auth = try secrets.read(scope, "authorization") {
                        var errors = auth["errors"] as? [String: String] ?? [:]; errors[provider] = message; auth["errors"] = errors; try secrets.write(scope, "authorization", auth)
                    } } catch { /* A retired owner cannot mutate credential metadata. */ }
                }
                reply(nil, message)
            }
            catch let error as NativeGoogleActions.Failure { reply(nil, error.message) }
            catch is ContactOAuthReceiver.OAuthError { reply(nil, "Workspace authorization was cancelled, denied or timed out. No connection was saved.") }
            catch { reply(nil, "Workspace could not finish. Check your network and account permission, then retry. No credentials were returned.") }
        }
    }
    @MainActor private func executeAction(_ scope: String, body: [String: Any], authorize: @escaping @MainActor () async throws -> Void) async throws -> [String: Any] {
        guard body["expectedOwner"] as? String == scope, let operation = body["operation"] as? String, let args = body["args"] as? [String: Any], let requestId = body["requestId"] as? String else { throw Failure.message("Invalid owner-bound Google action.") }
        do {
        try NativeGoogleActions.validate(operation, args)
        let generation = authorizationGeneration
        let initial = try secrets.read(scope, "authorization")
        guard let account = initial?["accountId"] as? String, !account.isEmpty else { throw Failure.message("Reconnect Workspace to verify its Google account identity.") }
        let check: @MainActor () async throws -> Void = { [self] in
            try await authorize()
            guard generation == authorizationGeneration, try secrets.read(scope, "authorization")?["accountId"] as? String == account else { throw Failure.message("Google action was cancelled or its account changed. Review any dispatched outcome before retrying.") }
        }
        let auth = try await authorization(scope, authorize: check)
        try await check()
        guard let token = auth["access_token"] as? String, auth["needsReconnect"] as? Bool != true else { throw Failure.message("Reconnect Workspace before using Google actions.") }
        let grants = Set((auth["scope"] as? String ?? "").split(separator: " ").map(String.init))
        return try await actions.execute(owner: scope, account: account, token: token, granted: grants, operation: operation, args: args, requestId: requestId, senderEmail: auth["accountName"] as? String, authorize: check)
        } catch {
            // NativeGoogleActions returns unknown after dispatch; a thrown error is
            // pre-dispatch. Never translate an owner/session loss into a receipt.
            try await authorize()
            let message: String
            if case Failure.message(let detail) = error { message = detail }
            else if let failure = error as? NativeGoogleActions.Failure { message = failure.message }
            else { message = "Google access is unavailable. Reconnect Workspace before retrying." }
            return ["requestId": requestId, "operation": operation, "status": "failed", "replayed": false, "error": message + " No write was dispatched."]
        }
    }
    @MainActor private func connect(_ scope: String, body: [String: Any], authorize: @escaping @MainActor () async throws -> Void) async throws -> [String: Any] {
        guard let client = try secrets.read(scope, "client"), let clientID = client["client_id"] as? String else { throw Failure.message("Choose an existing Google Desktop OAuth client JSON first. Creating a project, enabling services or granting new account access requires your separate action.") }
        guard receiver == nil else { throw Failure.message("Finish or cancel the current authorization first.") }
        authorizationGeneration += 1; let generation = authorizationGeneration
        let requestedScopes = Self.scopes.values.sorted()
        let receiver = try ContactOAuthReceiver(); self.receiver = receiver
        defer { self.receiver = nil }
        var redirect: URL?
        let code: String = try await withCheckedThrowingContinuation { continuation in
            do {
                try receiver.start(onReady: { result in
                    switch result {
                    case .failure: receiver.cancel()
                    case .success(let callback):
                        redirect = callback
                        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
                        url.queryItems = ["client_id": clientID, "redirect_uri": callback.absoluteString, "response_type": "code",
                            "scope": "openid email " + requestedScopes.joined(separator: " "), "code_challenge": receiver.challenge,
                            "code_challenge_method": "S256", "state": receiver.state, "access_type": "offline", "prompt": "consent"].map { URLQueryItem(name: $0.key, value: $0.value) }
                        guard let target = url.url, NSWorkspace.shared.open(target) else { receiver.cancel(); return }
                    }
                }, completion: { continuation.resume(with: $0) })
            } catch { continuation.resume(throwing: error) }
        }
        guard let redirect else { throw Failure.message("The local authorization callback was unavailable.") }
        let token = try await request("https://oauth2.googleapis.com/token", method: "POST", form: [
            "client_id": clientID, "client_secret": client["client_secret"] as? String ?? "", "code": code,
            "redirect_uri": redirect.absoluteString, "code_verifier": receiver.verifier, "grant_type": "authorization_code"])
        return try await finalizeAuthorization(scope, token: token, generation: generation, authorize: authorize)
    }
    // Kept separate so a cancelled browser callback cannot commit after a slow HTTP response.
    @MainActor func finalizeAuthorization(_ scope: String, token: [String: Any], generation: Int, authorize: @escaping @MainActor () async throws -> Void) async throws -> [String: Any] {
        guard generation == authorizationGeneration else { throw Failure.message("Workspace authorization was cancelled. No connection was saved.") }
        guard let access = token["access_token"] as? String,
              let granted = token["scope"] as? String, Self.scopes.values.allSatisfy({ granted.split(separator: " ").contains(Substring($0)) }) else { throw Failure.message("Google did not grant the requested Workspace action scopes. No connected state was saved.") }
        let identity = try await request("https://openidconnect.googleapis.com/v1/userinfo", token: access)
        guard let accountID = identity["sub"] as? String, let email = identity["email"] as? String else { throw Failure.message("Google did not return a verifiable account identity.") }
        guard generation == authorizationGeneration else { throw Failure.message("Workspace authorization was cancelled. No connection was saved.") }
        var auth = token
        auth["accountId"] = accountID; auth["accountName"] = email; auth["direction"] = "read-write"
        auth["expiresAt"] = Date().timeIntervalSince1970 + (token["expires_in"] as? Double ?? 3600)
        auth["needsReconnect"] = false
        try await authorize()
        guard generation == authorizationGeneration else { throw Failure.message("Workspace authorization was cancelled. No connection was saved.") }
        try secrets.write(scope, "authorization", auth)
        NSApp.activate(ignoringOtherApps: true)
        return try status(scope)
    }
    private func authorization(_ scope: String, authorize: @escaping @MainActor () async throws -> Void) async throws -> [String: Any] {
        guard var auth = try secrets.read(scope, "authorization") else { throw Failure.message("Google Workspace is not connected to this app.") }
        if (auth["expiresAt"] as? Double ?? 0) > Date().timeIntervalSince1970 + 60 { return auth }
        guard let refresh = auth["refresh_token"] as? String, let client = try secrets.read(scope, "client"),
              let clientID = client["client_id"] as? String else { throw Failure.message("Google authorization expired. Reconnect this app in the system browser.") }
        do {
            let token = try await request("https://oauth2.googleapis.com/token", method: "POST", form: ["client_id": clientID,
                "client_secret": client["client_secret"] as? String ?? "", "refresh_token": refresh, "grant_type": "refresh_token"])
            guard let access = token["access_token"] as? String else { throw Failure.message("Google did not return a refreshed token. Reconnect.") }
            auth["access_token"] = access; if let refreshedScopes = token["scope"] as? String { auth["scope"] = refreshedScopes }; auth["expiresAt"] = Date().timeIntervalSince1970 + (token["expires_in"] as? Double ?? 3600)
            auth["needsReconnect"] = false; try await authorize(); try secrets.write(scope, "authorization", auth); return auth
        } catch {
            try await authorize()
            auth["needsReconnect"] = true; try? secrets.write(scope, "authorization", auth)
            throw Failure.message("Google could not refresh this connection. Retry when online or reconnect if permission was revoked; local records remain.")
        }
    }
    private func read(_ scope: String, body: [String: Any], checkOnly: Bool, authorize: @escaping @MainActor () async throws -> Void) async throws -> [String: Any] {
        guard let provider = body["provider"] as? String, let required = Self.scopes[provider] else { throw Failure.message("Choose a supported Workspace service.") }
        var auth = try await authorization(scope, authorize: authorize)
        guard let token = auth["access_token"] as? String,
              (auth["scope"] as? String ?? "").split(separator: " ").contains(Substring(required)) else { throw Failure.message("This Workspace grant lacks the requested permission. Reconnect explicitly; Contacts permissions cannot be reused.") }
        let limit = checkOnly ? 1 : min(10, max(1, body["limit"] as? Int ?? 3))
        var items: [[String: Any]] = []
        var extra: [String: Any] = [:]
        switch provider {
        case "gmail":
            let list = try await request(endpoint("https://gmail.googleapis.com/gmail/v1/users/me/messages", ["maxResults": String(limit), "includeSpamTrash": "false"]), token: token)
            guard list["resultSizeEstimate"] is NSNumber, list["messages"] == nil || list["messages"] is [[String: Any]] else { throw Failure.message("Gmail returned malformed metadata; access was not verified.") }
            if !checkOnly {
                for row in (list["messages"] as? [[String: Any]] ?? []).prefix(limit) {
                    guard let id = row["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else { continue }
                    let message = try await request(endpoint("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id, ["format": "metadata", "fields": "id,payload/headers", "metadataHeaders": "Subject"]), token: token)
                    guard message["id"] as? String == id else { throw Failure.message("Gmail returned an unexpected message identity.") }
                    let payload = message["payload"] as? [String: Any], headers = payload?["headers"] as? [[String: Any]] ?? []
                    let subject = headers.first { ($0["name"] as? String)?.lowercased() == "subject" }?["value"] as? String ?? "No subject"
                    items.append(["id": id, "title": String(subject.prefix(1000)), "detail": "Header only — message body was not requested"])
                }
            }
            extra["notice"] = "This preview reads headers only. Agent actions separately support message text, drafts, send and labels under the selected chat policy."
        case "google-calendar":
            let date = ISO8601DateFormatter().string(from: Date())
            let result = try await request(endpoint("https://www.googleapis.com/calendar/v3/calendars/primary/events", ["maxResults": String(limit), "singleEvents": "true", "orderBy": "startTime", "timeMin": date, "fields": "kind,items(id,summary,start,end,status)"]), token: token)
            guard result["kind"] as? String == "calendar#events", result["items"] == nil || result["items"] is [[String: Any]] else { throw Failure.message("Calendar returned malformed data; access was not verified.") }
            if !checkOnly { items = (result["items"] as? [[String: Any]] ?? []).prefix(limit).map { row in ["id": row["id"] ?? "", "title": row["summary"] ?? "Untitled event", "start": row["start"] ?? [:], "end": row["end"] ?? [:], "status": row["status"] ?? ""] } }
            extra["notice"] = "Upcoming primary-calendar events, read-only. No attendees requested; no event was created or edited."
        case "google-drive":
            let result = try await request(endpoint("https://www.googleapis.com/drive/v3/files", ["pageSize": String(limit), "q": "trashed = false", "fields": "kind,files(id,name,mimeType,modifiedTime)"]), token: token)
            guard result["kind"] as? String == "drive#fileList", result["files"] == nil || result["files"] is [[String: Any]] else { throw Failure.message("Drive returned malformed data; access was not verified.") }
            if !checkOnly { items = (result["files"] as? [[String: Any]] ?? []).prefix(limit).map { row in ["id": row["id"] ?? "", "title": row["name"] ?? "Untitled file", "mimeType": row["mimeType"] ?? "", "modifiedTime": row["modifiedTime"] ?? ""] } }
            extra["notice"] = "File metadata only. No file bytes, downloads or modifications."
        case "google-contacts":
            let result = try await request(endpoint("https://people.googleapis.com/v1/people/me/connections", ["pageSize": String(limit), "personFields": "names,emailAddresses,phoneNumbers"]), token: token)
            guard result["connections"] == nil || result["connections"] is [[String: Any]], result["totalPeople"] is NSNumber || result["connections"] != nil else { throw Failure.message("Contacts returned malformed data; access was not verified.") }
            if !checkOnly { items = (result["connections"] as? [[String: Any]] ?? []).prefix(limit).map { row in ["id": row["resourceName"] ?? "", "title": (row["names"] as? [[String: Any]])?.first?["displayName"] ?? "Unnamed contact", "detail": "Contact preview only; no local import or provider edit"] } }
            extra["notice"] = "This preview reads a bounded contact list. It does not import or change contacts."
        case "google-sheets":
            guard let id = body["spreadsheetId"] as? String, id.range(of: "^[A-Za-z0-9_-]{10,150}$", options: .regularExpression) != nil else { throw Failure.message("Enter the ID of an existing spreadsheet you intend to read. Use a synthetic test sheet.") }
            if checkOnly {
                let sheet = try await request(endpoint("https://sheets.googleapis.com/v4/spreadsheets/" + id, ["fields": "spreadsheetId"]), token: token)
                guard sheet["spreadsheetId"] as? String == id else { throw Failure.message("Sheets did not confirm the requested spreadsheet identity.") }
            } else {
                let range = body["range"] as? String ?? "A1:D5"
                guard Self.boundedRange(range) else { throw Failure.message("Choose a bounded A1 range of at most 100 cells, 20 rows and 10 columns, such as A1:D5. Optional sheet names use letters, numbers, spaces or underscores.") }
                let escaped = range.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
                let result = try await request(endpoint("https://sheets.googleapis.com/v4/spreadsheets/" + id + "/values/" + escaped, ["valueRenderOption": "FORMATTED_VALUE"]), token: token)
                guard let returnedRange = result["range"] as? String, !returnedRange.isEmpty, result["values"] == nil || result["values"] is [[Any]] else { throw Failure.message("Sheets returned malformed range data.") }
                extra["range"] = returnedRange
                extra["rows"] = (result["values"] as? [[Any]] ?? []).prefix(20).map { row in row.prefix(10).map { String(String(describing: $0).prefix(2000)) } }
            }
            extra["notice"] = "Only the explicitly selected spreadsheet/range is read. No sheet was edited; values are not sent to the model or saved in chat."
        default: throw Failure.message("Unsupported service.")
        }
        try await authorize()
        let checkedAt = Date().timeIntervalSince1970 * 1000
        var checks = auth["checks"] as? [String: Double] ?? [:]; checks[provider] = checkedAt; auth["checks"] = checks
        var errors = auth["errors"] as? [String: String] ?? [:]; errors.removeValue(forKey: provider); auth["errors"] = errors
        try secrets.write(scope, "authorization", auth)
        return ["provider": provider, "connected": true, "checkedAt": checkedAt, "readOnly": true, "items": items, "result": extra, "workspace": try status(scope)]
    }
    static func boundedRange(_ range: String) -> Bool {
        guard range.count <= 120, let expression = try? NSRegularExpression(pattern: "^(?:'?[A-Za-z0-9_ ]{1,60}'?!)?([A-Z]{1,2})([1-9][0-9]{0,5}):([A-Z]{1,2})([1-9][0-9]{0,5})$"), let match = expression.firstMatch(in: range, range: NSRange(range.startIndex..., in: range)) else { return false }
        func value(_ i: Int) -> String { String(range[Range(match.range(at: i), in: range)!]) }
        func column(_ text: String) -> Int { text.utf8.reduce(0) { $0 * 26 + Int($1) - 64 } }
        let columns = column(value(3)) - column(value(1)) + 1, rows = Int(value(4))! - Int(value(2))! + 1
        return rows > 0 && rows <= 20 && columns > 0 && columns <= 10 && rows * columns <= 100
    }
    private func endpoint(_ base: String, _ parameters: [String: String]) -> String {
        var parts = URLComponents(string: base)!; parts.queryItems = parameters.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }; return parts.url!.absoluteString
    }
    private func request(_ address: String, method: String = "GET", token: String? = nil, form: [String: String]? = nil) async throws -> [String: Any] {
        guard let url = URL(string: address), url.scheme == "https", ["oauth2.googleapis.com", "openidconnect.googleapis.com", "gmail.googleapis.com", "www.googleapis.com", "sheets.googleapis.com", "people.googleapis.com"].contains(url.host ?? ""), method == "GET" || (url.host == "oauth2.googleapis.com" && method == "POST") else { throw Failure.message("Unsupported read-only Google endpoint.") }
        var request = URLRequest(url: url); request.httpMethod = method
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let form {
            var encoded = URLComponents(); encoded.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
            request.httpBody = Data((encoded.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        }
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse, response.expectedContentLength <= 2 * 1024 * 1024 else { throw Failure.message("Google returned an invalid or oversized response.") }
        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 401 || http.statusCode == 403 { throw Failure.message("Google refused access (\(http.statusCode)). Check the enabled service API and Workspace consent scopes. Your existing Contacts grant is separate.") }
            if http.statusCode == 429 { throw Failure.message("Google rate limit reached. Wait before retrying; no automatic retries or paid fallback occur.") }
            throw Failure.message("Google read failed (\(http.statusCode)). Nothing was written or sent.")
        }
        var data = Data()
        for try await byte in bytes { guard data.count < 2 * 1024 * 1024 else { throw Failure.message("Google response exceeded the 2 MB safety limit.") }; data.append(byte) }
        guard let output = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.message("Google returned an unreadable result.") }
        return output
    }
    private enum Failure: LocalizedError { case message(String); var errorDescription: String? { if case .message(let text) = self { return text }; return nil } }
}
private final class WorkspaceHTTPRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
