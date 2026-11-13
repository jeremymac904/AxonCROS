import AppKit
import NativePanelFactory

/// Google People integration for this app only. OAuth material is held in its
/// own Keychain service, never read from Hermes, Codex or another application's
/// account. Pull sync is acknowledged only after the reviewed local commit.
final class NativeGoogleContacts {
    private let secrets: ContactCredentialStorage
    private let session: URLSession
    private var busy: Set<String> = []
    private var receiver: ContactOAuthReceiver?
    private var pendingSync: [String: (scope: String, auth: [String: Any], expires: Date)] = [:]
    private var proposals: [String: (scope: String, person: [String: Any], fields: String, expires: Date)] = [:]
    private let personFields = "names,emailAddresses,phoneNumbers,organizations,metadata"
    init(service: String, storage: ContactCredentialStorage? = nil, transport: URLSession? = nil) {
        secrets = storage ?? ContactSecrets(service: service)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30; config.timeoutIntervalForResource = 60
        config.httpCookieStorage = nil; config.urlCache = nil
        session = transport ?? URLSession(configuration: config, delegate: ContactHTTPRedirects(), delegateQueue: nil)
    }
    func handles(_ action: String) -> Bool {
        ["googleContactsStatus", "configureGoogleContacts", "connectGoogleContacts", "cancelGoogleContactsAuth",
         "readGoogleContacts", "ackGoogleContactsSync", "disconnectGoogleContacts", "previewGoogleContactUpdate", "applyGoogleContactUpdate"].contains(action)
    }
    private func status(_ scope: String) throws -> [String: Any] {
        let client = try secrets.read(scope, "client")
        let auth = try secrets.read(scope, "authorization")
        return ["native": true, "configured": client != nil, "connected": auth != nil,
                "accountId": auth?["accountId"] ?? NSNull(), "accountName": auth?["accountName"] ?? NSNull(),
                "direction": auth?["direction"] ?? "not-connected", "lastSuccessfulSync": auth?["lastSuccessfulSync"] ?? NSNull(),
                "busy": busy.contains(scope), "needsReconnect": auth?["needsReconnect"] ?? false,
                "dependency": client == nil ? "Choose an existing Google Desktop OAuth client JSON with the People API enabled, then explicitly authorize this app. No client or account has been created." : "Google sign-in and consent occurs only in the system browser when you choose Connect. Contacts access does not grant email, SMS or calls."]
    }
    func handle(_ action: String, body: [String: Any], window: NSWindow?, authorize: @escaping @MainActor () async throws -> Void = {}, reply: @escaping (Any?, String?) -> Void) {
        guard let scope = body["scope"] as? String,
              scope.range(of: "^[A-Za-z0-9_.-]{1,96}$", options: .regularExpression) != nil else { reply(nil, "The local owner scope is invalid. Reopen AxonCROS."); return }
        if action == "cancelGoogleContactsAuth" { receiver?.cancel(); receiver = nil; reply(["cancelled": true], nil); return }
        if action == "configureGoogleContacts" {
            guard !busy.contains(scope), let window else { reply(nil, "Finish the current Google Contacts operation first."); return }
            NativePanels.shared.present(for: window, request: NativePanelRequest(title: "Choose existing Google Desktop OAuth client", message: "Choose an existing Desktop client JSON. It stays in this app’s Keychain. This does not create an account or authorize access.")) { [self] panel, result in
                guard result == .OK, let url = panel?.url else { reply(["cancelled": true], nil); return }
                Task { @MainActor in
                do {
                    try await authorize()
                    let attrs = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard attrs.isRegularFile == true, (attrs.fileSize ?? 100_001) <= 100_000 else { throw Failure.message("Choose a Desktop OAuth JSON file smaller than 100 KB.") }
                    let data = try Data(contentsOf: url)
                    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let installed = root["installed"] as? [String: Any],
                          let clientID = installed["client_id"] as? String,
                          clientID.hasSuffix(".apps.googleusercontent.com"), clientID.count < 500 else { throw Failure.message("This is not a Google Desktop OAuth client JSON. No configuration changed.") }
                    guard try secrets.read(scope, "authorization") == nil else { throw Failure.message("Disconnect this app's existing Google connection before changing its OAuth client. Local contacts and notes will remain.") }
                    try secrets.write(scope, "client", ["client_id": clientID, "client_secret": installed["client_secret"] as? String ?? ""])
                    reply(try status(scope), nil)
                } catch let Failure.message(message) { reply(nil, message) }
                catch { reply(nil, "The OAuth client could not be stored in this app's Keychain. No credentials were returned.") }
                }
            }
            return
        }
        if action == "googleContactsStatus" { do { reply(try status(scope), nil) } catch { reply(nil, "Google Contacts Keychain metadata is unavailable. Unlock the Mac and retry.") }; return }
        guard !busy.contains(scope) else { reply(nil, "A Google Contacts operation is already in progress. Wait for it to finish before retrying."); return }
        busy.insert(scope)
        Task { @MainActor [self] in
            defer { busy.remove(scope) }
            do {
                try await authorize()
                let output: [String: Any]
                switch action {
                case "connectGoogleContacts": output = try await connect(scope, body: body, authorize: authorize)
                case "readGoogleContacts": output = try await read(scope)
                case "ackGoogleContactsSync":
                    guard let batchID = body["batchId"] as? String,
                          let batch = pendingSync[batchID], batch.scope == scope, batch.expires > Date(),
                          body["committed"] as? Bool == true else { throw Failure.message("This contact preview expired. Fetch it again; existing contacts were preserved.") }
                    guard var auth = try secrets.read(scope, "authorization"), auth["accountId"] as? String == batch.auth["accountId"] as? String else { throw Failure.message("The connected account changed. Fetch a new preview before importing.") }
                    auth["syncToken"] = batch.auth["syncToken"]; auth["fullSyncAt"] = batch.auth["fullSyncAt"]
                    auth["lastSuccessfulSync"] = Date().timeIntervalSince1970 * 1000
                    try secrets.write(scope, "authorization", auth)
                    pendingSync = pendingSync.filter { $0.value.scope != scope }
                    output = try status(scope)
                case "disconnectGoogleContacts":
                    // Local disconnect removes this app's token only. It does not
                    // revoke all grants on an OAuth project shared with other apps.
                    try secrets.remove(scope, "authorization")
                    pendingSync = pendingSync.filter { $0.value.scope != scope }
                    proposals = proposals.filter { $0.value.scope != scope }
                    output = ["disconnected": true, "notice": "This app's local token was removed. Contacts and notes remain. Review Google Account permissions separately to revoke the provider grant."]
                case "previewGoogleContactUpdate": output = try await previewUpdate(scope, body: body)
                case "applyGoogleContactUpdate": output = try await applyUpdate(scope, body: body, authorize: authorize)
                default: throw Failure.message("This Google Contacts operation is unavailable.")
                }
                try await authorize()
                reply(output, nil)
            } catch let Failure.message(message) { reply(nil, message) }
            catch is ContactOAuthReceiver.OAuthError { reply(nil, "Google authorization was cancelled, denied or timed out. No contacts were imported. You can retry Connect.") }
            catch { reply(nil, "Google Contacts could not finish. Check the connection and account permission, then retry. Local contacts and notes remain; no credentials were returned.") }
        }
    }
    @MainActor private func connect(_ scope: String, body: [String: Any], authorize: @escaping @MainActor () async throws -> Void) async throws -> [String: Any] {
        guard let client = try secrets.read(scope, "client"), let clientID = client["client_id"] as? String else { throw Failure.message("Choose an existing Google Desktop OAuth client JSON first. Creating a project, enabling services or granting new account access requires your separate action.") }
        guard receiver == nil else { throw Failure.message("Finish or cancel the current authorization first.") }
        let direction = body["direction"] as? String ?? "import-only"
        guard ["import-only", "two-way-reviewed"].contains(direction) else { throw Failure.message("Choose Import only or Reviewed two-way updates.") }
        let contactsScope = "https://www.googleapis.com/auth/" + (direction == "import-only" ? "contacts.readonly" : "contacts")
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
                            "scope": "openid email " + contactsScope, "code_challenge": receiver.challenge,
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
        guard let access = token["access_token"] as? String,
              let granted = token["scope"] as? String, granted.split(separator: " ").contains(Substring(contactsScope)) else { throw Failure.message("Google did not grant the requested Contacts scope. No connected state was saved.") }
        let identity = try await request("https://openidconnect.googleapis.com/v1/userinfo", token: access)
        guard let accountID = identity["sub"] as? String, let email = identity["email"] as? String else { throw Failure.message("Google did not return a verifiable account identity.") }
        var auth = token
        auth["accountId"] = accountID; auth["accountName"] = email; auth["direction"] = direction
        auth["expiresAt"] = Date().timeIntervalSince1970 + (token["expires_in"] as? Double ?? 3600)
        auth["needsReconnect"] = false
        try await authorize()
        try secrets.write(scope, "authorization", auth)
        pendingSync = pendingSync.filter { $0.value.scope != scope }
        proposals = proposals.filter { $0.value.scope != scope }
        NSApp.activate(ignoringOtherApps: true)
        return try status(scope)
    }
    private func authorization(_ scope: String) async throws -> [String: Any] {
        guard var auth = try secrets.read(scope, "authorization") else { throw Failure.message("Google Contacts is not connected to this app.") }
        if (auth["expiresAt"] as? Double ?? 0) > Date().timeIntervalSince1970 + 60 { return auth }
        guard let refresh = auth["refresh_token"] as? String, let client = try secrets.read(scope, "client"),
              let clientID = client["client_id"] as? String else { throw Failure.message("Google authorization expired. Reconnect this app in the system browser.") }
        do {
            let token = try await request("https://oauth2.googleapis.com/token", method: "POST", form: ["client_id": clientID,
                "client_secret": client["client_secret"] as? String ?? "", "refresh_token": refresh, "grant_type": "refresh_token"])
            guard let access = token["access_token"] as? String else { throw Failure.message("Google did not return a refreshed token. Reconnect.") }
            auth["access_token"] = access; auth["expiresAt"] = Date().timeIntervalSince1970 + (token["expires_in"] as? Double ?? 3600)
            auth["needsReconnect"] = false; try secrets.write(scope, "authorization", auth); return auth
        } catch {
            auth["needsReconnect"] = true; try? secrets.write(scope, "authorization", auth)
            throw Failure.message("Google could not refresh this connection. Retry when online or reconnect if permission was revoked; local contacts remain.")
        }
    }
    private func read(_ scope: String) async throws -> [String: Any] {
        var auth = try await authorization(scope)
        guard let token = auth["access_token"] as? String else { throw Failure.message("Reconnect Google Contacts.") }
        var sync = auth["syncToken"] as? String
        if Date().timeIntervalSince1970 - (auth["fullSyncAt"] as? Double ?? 0) >= 6 * 86400 { sync = nil }
        var records: [[String: Any]] = []; var deleted: [String] = []; var page: String?; var nextSync: String?
        var pages = 0; var reset = false
        while true {
            var parts = URLComponents(string: "https://people.googleapis.com/v1/people/me/connections")!
            var query = ["personFields": personFields, "pageSize": "500", "requestSyncToken": "true", "sources": "READ_SOURCE_TYPE_CONTACT"]
            query["syncToken"] = sync; query["pageToken"] = page
            parts.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
            let result: [String: Any]
            do { result = try await request(parts.url!.absoluteString, token: token) }
            catch Failure.expiredSync where sync != nil && !reset {
                sync = nil; page = nil; records = []; deleted = []; pages = 0; reset = true; continue
            }
            for person in result["connections"] as? [[String: Any]] ?? [] {
                if (person["metadata"] as? [String: Any])?["deleted"] as? Bool == true {
                    if let externalID = person["resourceName"] as? String { deleted.append(externalID) }
                } else { records.append(Self.record(person)) }
            }
            page = result["nextPageToken"] as? String; nextSync = result["nextSyncToken"] as? String
            pages += 1
            guard records.count + deleted.count <= 10_000, pages <= 25 else { throw Failure.message("This sync exceeds the 10,000-contact safety limit. Import selected contacts instead. No new sync checkpoint was saved.") }
            if page == nil { break }
        }
        guard let nextSync else { throw Failure.message("Google did not finish the sync snapshot. Retry; no checkpoint was advanced.") }
        auth["syncToken"] = nextSync
        if sync == nil { auth["fullSyncAt"] = Date().timeIntervalSince1970 }
        let batchID = UUID().uuidString
        pendingSync = pendingSync.filter { $0.value.expires > Date() && $0.value.scope != scope }
        pendingSync[batchID] = (scope, auth, Date().addingTimeInterval(900))
        return ["batchId": batchID, "contacts": records, "deletedExternalIds": deleted, "fullSnapshot": sync == nil,
                "accountId": auth["accountId"] ?? "", "accountName": auth["accountName"] ?? "", "provider": "google",
                "direction": auth["direction"] ?? "import-only", "fetchedAt": Date().timeIntervalSince1970 * 1000]
    }
    static func record(_ p: [String: Any]) -> [String: Any] {
        let name = (p["names"] as? [[String: Any]])?.first ?? [:]
        let organization = (p["organizations"] as? [[String: Any]])?.first ?? [:]
        let values: (String) -> [[String: String]] = { field in (p[field] as? [[String: Any]] ?? []).compactMap { item in
            guard let value = item["value"] as? String else { return nil }
            return ["value": value, "label": item["type"] as? String ?? "other"]
        } }
        return ["externalId": p["resourceName"] as? String ?? "", "version": p["etag"] as? String ?? "",
                "givenName": name["givenName"] as? String ?? "", "familyName": name["familyName"] as? String ?? "",
                "displayName": name["displayName"] as? String ?? "", "organization": organization["name"] as? String ?? "",
                "phones": values("phoneNumbers"), "emails": values("emailAddresses")]
    }
    private func previewUpdate(_ scope: String, body: [String: Any]) async throws -> [String: Any] {
        let auth = try await authorization(scope)
        guard auth["direction"] as? String == "two-way-reviewed", let token = auth["access_token"] as? String else { throw Failure.message("This connection is import-only. Reviewed Google updates require separately granted Contacts write access.") }
        guard let resource = body["externalId"] as? String, resource.range(of: "^people/[A-Za-z0-9_-]{1,200}$", options: .regularExpression) != nil,
              let version = body["version"] as? String, let patch = body["patch"] as? [String: String], !patch.isEmpty,
              Set(patch.keys).isSubset(of: ["givenName", "familyName", "organization", "addPhone", "addEmail"]),
              patch.values.allSatisfy({ $0.count <= 500 && !$0.contains("\u{0}") }) else { throw Failure.message("Review a valid Google contact edit first.") }
        var person = try await request("https://people.googleapis.com/v1/\(resource)?personFields=\(personFields)&sources=READ_SOURCE_TYPE_CONTACT", token: token)
        guard person["etag"] as? String == version else { throw Failure.message("This Google contact changed. Sync and review the latest values before writing.") }
        let current = Self.record(person); var fields: [String] = []
        if patch["givenName"] != nil || patch["familyName"] != nil {
            var name = (person["names"] as? [[String: Any]])?.first ?? [:]
            if let value = patch["givenName"] { name["givenName"] = value }
            if let value = patch["familyName"] { name["familyName"] = value }
            person["names"] = [name]; fields.append("names")
        }
        if let value = patch["organization"] {
            var entries = person["organizations"] as? [[String: Any]] ?? []
            if entries.isEmpty { entries = [["name": value]] } else { entries[0]["name"] = value }
            person["organizations"] = entries; fields.append("organizations")
        }
        for (key, field) in [("addEmail", "emailAddresses"), ("addPhone", "phoneNumbers")] {
            if let value = patch[key], !value.isEmpty {
                var entries = person[field] as? [[String: Any]] ?? []
                if !entries.contains(where: { ($0["value"] as? String)?.lowercased() == value.lowercased() }) { entries.append(["value": value, "type": "other"]) }
                person[field] = entries; fields.append(field)
            }
        }
        guard !fields.isEmpty else { throw Failure.message("There is no contact change to review.") }
        let proposalID = UUID().uuidString
        proposals = proposals.filter { $0.value.expires > Date() }
        proposals[proposalID] = (scope, person, fields.joined(separator: ","), Date().addingTimeInterval(300))
        return ["proposalId": proposalID, "current": current, "proposed": Self.record(person), "patch": patch,
                "notice": "Apply changes writes only these reviewed fields to Google. Existing phone/email entries and local notes remain."]
    }
    private func applyUpdate(_ scope: String, body: [String: Any], authorize: @escaping @MainActor () async throws -> Void) async throws -> [String: Any] {
        guard body["confirmed"] as? Bool == true, let proposalID = body["proposalId"] as? String,
              let proposal = proposals.removeValue(forKey: proposalID), proposal.scope == scope, proposal.expires > Date(),
              let resource = proposal.person["resourceName"] as? String else { throw Failure.message("This contact edit expired or was already attempted. Sync before reviewing another write.") }
        let auth = try await authorization(scope)
        guard auth["direction"] as? String == "two-way-reviewed", let token = auth["access_token"] as? String else { throw Failure.message("Google Contacts write access is unavailable.") }
        let latest = try await request("https://people.googleapis.com/v1/\(resource)?personFields=\(personFields)&sources=READ_SOURCE_TYPE_CONTACT", token: token)
        guard latest["etag"] as? String == proposal.person["etag"] as? String else { throw Failure.message("The Google contact changed after review. Nothing was written. Sync and review again.") }
        try await authorize()
        let updated = try await request("https://people.googleapis.com/v1/\(resource):updateContact?updatePersonFields=\(proposal.fields)&personFields=\(personFields)", method: "PATCH", token: token, json: proposal.person)
        return ["contact": Self.record(updated), "provider": "google", "confirmed": true, "updatedAt": Date().timeIntervalSince1970 * 1000]
    }
    private func request(_ address: String, method: String = "GET", token: String? = nil,
                         form: [String: String]? = nil, json: [String: Any]? = nil) async throws -> [String: Any] {
        guard let url = URL(string: address), url.scheme == "https",
              ["oauth2.googleapis.com", "openidconnect.googleapis.com", "people.googleapis.com"].contains(url.host ?? "") else { throw Failure.message("Unsupported Google endpoint.") }
        var request = URLRequest(url: url); request.httpMethod = method
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let form {
            var encoded = URLComponents(); encoded.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
            request.httpBody = Data((encoded.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        }
        if let json { request.httpBody = try JSONSerialization.data(withJSONObject: json); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard data.count <= 8 * 1024 * 1024, let http = response as? HTTPURLResponse else { throw Failure.message("Google returned an invalid or oversized response.") }
        if http.statusCode == 410 { throw Failure.expiredSync }
        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 401 || http.statusCode == 403 { throw Failure.message("Google refused this request (\(http.statusCode)). Check this app's account scopes and People API access, then reconnect if needed.") }
            if http.statusCode == 429 { throw Failure.message("Google Contacts is rate limited. Wait before retrying; the prior sync checkpoint is preserved.") }
            if method == "PATCH" { throw Failure.message("Google did not confirm this contact update (\(http.statusCode)). Sync and inspect the contact before retrying; no automatic repeat was attempted.") }
            throw Failure.message("Google Contacts request failed (\(http.statusCode)). Retry later; local records remain.")
        }
        guard let output = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.message("Google returned an unreadable result.") }
        return output
    }
    private enum Failure: Error { case message(String), expiredSync }
}

private final class ContactHTTPRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Provider credentials must never follow a redirect to another origin.
        completionHandler(request.url?.scheme == "https" && request.url?.host == task.originalRequest?.url?.host ? request : nil)
    }
}
