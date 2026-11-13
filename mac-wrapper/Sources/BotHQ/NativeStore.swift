import NativePanelFactory
import AppKit
import Security

/// Owner-local metadata and deliberately selected, read-only folder access.
/// Secret values have no read API into JavaScript or the model runtime.
final class NativeStore {
    private let service: String
    private let support: URL
    private let allowedFolderRoot: URL?
    var contactCredentialService: String { service + ".contacts" }
    init(support: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Bot HQ"),
         service: String = "local.bot-hq.desktop.AxonCROS", allowedFolderRoot: URL? = nil) {
        self.support = support; self.service = service; self.allowedFolderRoot = allowedFolderRoot
    }
    private struct Grant: Codable { let id: String; let name: String; let path: String; let bookmark: Data }
    private var grantsURL: URL { support.appendingPathComponent("native-folder-grants.json") }
    private let actions: Set<String> = ["listSecrets", "setSecret", "deleteSecret", "listFolderGrants", "chooseFolder", "revokeFolder", "listFolder", "readGrantedFile"]
    func handles(_ action: String) -> Bool { actions.contains(action) }

    func handle(_ action: String, body: [String: Any], window: NSWindow?, authorize: @escaping @MainActor () async throws -> Void = {}, reply: @escaping (Any?, String?) -> Void) {
        do {
            if action.hasSuffix("Secret") || action == "listSecrets" { reply(try secrets(action, body), nil); return }
            switch action {
            case "listFolderGrants": reply(["grants": try load().map(metadata)], nil)
            case "chooseFolder":
                guard let window else { reply(nil, "The application window is unavailable."); return }
                NativePanels.shared.present(for: window, request: NativePanelRequest(title: "Allow read-only folder access in AxonCROS", message: "Choose a project folder. This grants only this app’s folder browser access; it does not give agents computer control.", chooseFiles: false, chooseDirectories: true)) { panel, result in
                    guard result == .OK, let chosen = panel?.url else { reply(["cancelled": true], nil); return }
                    Task { @MainActor in
                    do {
                        try await authorize()
                        let url = chosen.resolvingSymlinksInPath().standardizedFileURL
                        guard !self.protected(url) else { reply(nil, "Choose a project folder outside credential stores and system folders."); return }
                        var grants = try self.load()
                        if let existing = grants.first(where: { $0.path == url.path }) { reply(["grant": self.metadata(existing)], nil); return }
                        let bookmark = try url.bookmarkData(options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess], includingResourceValuesForKeys: nil, relativeTo: nil)
                        let grant = Grant(id: UUID().uuidString, name: url.lastPathComponent, path: url.path, bookmark: bookmark)
                        grants.append(grant); try self.save(grants); reply(["grant": self.metadata(grant)], nil)
                    } catch { reply(nil, "The folder grant could not be saved. Existing grants were preserved.") }
                    }
                }
            case "revokeFolder":
                guard let id = body["grantId"] as? String else { throw StoreError.invalid }
                var grants = try load(); grants.removeAll { $0.id == id }; try save(grants); reply(["ok": true], nil)
            case "listFolder", "readGrantedFile":
                guard let id = body["grantId"] as? String, let grant = try load().first(where: { $0.id == id }) else { throw StoreError.invalid }
                var stale = false
                let root = try URL(resolvingBookmarkData: grant.bookmark, options: [.withSecurityScope, .withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
                guard !stale else { reply(nil, "The folder grant is stale. Revoke it and choose the folder again."); return }
                let accessed = root.startAccessingSecurityScopedResource()
                defer { if accessed { root.stopAccessingSecurityScopedResource() } }
                let relative = body["relativePath"] as? String ?? ""
                guard relative.count <= 1000, !relative.hasPrefix("/"), !relative.split(separator: "/").contains(where: { $0.hasPrefix(".") }) else { throw StoreError.invalid }
                let canonicalRoot = root.resolvingSymlinksInPath().standardizedFileURL
                let target = root.appendingPathComponent(relative).resolvingSymlinksInPath().standardizedFileURL
                guard contains(target, root: canonicalRoot), !protected(target) else { throw StoreError.invalid }
                if action == "listFolder" {
                    let urls = try FileManager.default.contentsOfDirectory(at: target, includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey], options: [.skipsHiddenFiles])
                    let entries: [[String: Any]] = try urls.prefix(1000).compactMap { url in
                        let real = url.resolvingSymlinksInPath().standardizedFileURL
                        guard self.contains(real, root: canonicalRoot), !self.protected(real) else { return nil }
                        let attrs = try url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
                        return ["name": url.lastPathComponent, "directory": attrs.isDirectory ?? false, "size": attrs.fileSize ?? 0]
                    }
                    reply(["entries": entries, "truncated": urls.count > 1000], nil)
                } else {
                    let attrs = try target.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard attrs.isRegularFile == true, let size = attrs.fileSize, size <= 10 * 1024 * 1024 else { reply(nil, "Choose a regular file no larger than 10 MB."); return }
                    let file = try FileHandle(forReadingFrom: target)
                    defer { try? file.close() }
                    let bytes = try file.read(upToCount: 10 * 1024 * 1024 + 1) ?? Data()
                    guard bytes.count <= 10 * 1024 * 1024 else { throw StoreError.invalid }
                    reply(["name": target.lastPathComponent, "base64": bytes.base64EncodedString(), "size": bytes.count], nil)
                }
            default: throw StoreError.invalid
            }
        } catch StoreError.keychain(let status, let operation) {
            let reason = SecCopyErrorMessageString(status, nil) as String? ?? "macOS did not provide an error description."
            reply(nil, "Keychain \(operation) failed (macOS \(status)): \(reason) No secret value was returned.")
        } catch StoreError.secretInput(let message) {
            reply(nil, message)
        } catch { reply(nil, "This native storage operation failed. Check its scope and permissions; no secret value was returned.") }
    }

    private func secrets(_ action: String, _ body: [String: Any]) throws -> [String: Any] {
        guard let scope = body["scope"] as? String, valid(scope) else { throw StoreError.secretInput("The local owner scope is invalid. Reopen AxonCROS before trying again.") }
        if action == "listSecrets" {
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                       kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw StoreError.keychain(status, "metadata lookup") }
            let rows = result as? [[String: Any]] ?? []
            let entries: [[String: Any]] = rows.compactMap { row in
                guard let account = row[kSecAttrAccount as String] as? String, account.hasPrefix(scope + ":") else { return nil }
                return ["name": String(account.dropFirst(scope.count + 1)), "updatedAt": (row[kSecAttrModificationDate as String] as? Date)?.timeIntervalSince1970 ?? 0, "masked": true]
            }
            return ["entries": entries]
        }
        guard let name = body["name"] as? String, valid(name) else { throw StoreError.secretInput("Use an entry name of 1–96 letters, digits, underscores, periods or hyphens.") }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: scope + ":" + name]
        if action == "deleteSecret" {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw StoreError.keychain(status, "removal") }
        } else {
            guard let value = body["value"] as? String, !value.isEmpty, value.utf8.count <= 16_384 else { throw StoreError.secretInput("Enter a nonempty secret value no larger than 16 KB directly in the secure field.") }
            let changes: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrLabel as String: "AxonCROS · \(name)"]
            var operation = "update"
            var status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
            if status == errSecItemNotFound {
                operation = "add"
                var item = query.merging(changes) { _, new in new }
                item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                status = SecItemAdd(item as CFDictionary, nil)
            }
            guard status == errSecSuccess else { throw StoreError.keychain(status, operation) }
        }
        return ["ok": true]
    }
    private func valid(_ value: String) -> Bool { value.range(of: "^[A-Za-z0-9_.-]{1,96}$", options: .regularExpression) != nil }
    private func load() throws -> [Grant] {
        guard FileManager.default.fileExists(atPath: grantsURL.path) else { return [] }
        return try JSONDecoder().decode([Grant].self, from: Data(contentsOf: grantsURL))
    }
    private func save(_ grants: [Grant]) throws {
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(grants).write(to: grantsURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: grantsURL.path)
    }
    private func metadata(_ grant: Grant) -> [String: Any] { ["id": grant.id, "name": grant.name, "path": grant.path, "access": "read-only"] }
    private func contains(_ url: URL, root: URL) -> Bool { url.path == root.path || url.path.hasPrefix(root.path + "/") }
    private func protected(_ url: URL) -> Bool {
        if let allowedFolderRoot, !contains(url, root: allowedFolderRoot) { return true }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let roots = [".hermes", ".codex", ".ssh", ".aws", ".azure", ".config", ".bot-hq-gateway", "Library", ".gnupg"].map { home.appendingPathComponent($0) }
        if roots.contains(where: { contains(url, root: $0) }) { return true }
        let systemRoots = ["/System", "/Library", "/private", "/etc", "/var", "/usr", "/bin", "/sbin"].map { URL(fileURLWithPath: $0) }
        return contains(home, root: url) || systemRoots.contains(where: { contains(url, root: $0) })
            || url.pathComponents.contains(where: { $0.hasPrefix(".") }) || url.lastPathComponent == "auth.json"
    }
    private enum StoreError: Error { case invalid, keychain(OSStatus, String), secretInput(String) }
}
