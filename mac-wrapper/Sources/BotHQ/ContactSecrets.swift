import Foundation
import Security

/// Native-only credential storage. There is intentionally no JavaScript read API.
protocol ContactCredentialStorage {
    func read(_ scope: String, _ name: String) throws -> [String: Any]?
    func write(_ scope: String, _ name: String, _ value: [String: Any]) throws
    func remove(_ scope: String, _ name: String) throws
}
final class ContactSecrets: ContactCredentialStorage {
    let service: String
    init(service: String) { self.service = service }
    func read(_ scope: String, _ name: String) throws -> [String: Any]? {
        var query = try base(scope, name)
        query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let bytes = value as? Data,
              let record = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw SecretError.unavailable }
        return record
    }
    func write(_ scope: String, _ name: String, _ value: [String: Any]) throws {
        let query = try base(scope, name)
        let bytes = try JSONSerialization.data(withJSONObject: value)
        let changes: [String: Any] = [kSecValueData as String: bytes]
        var status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query.merging(changes) { _, new in new }
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw SecretError.unavailable }
    }
    func remove(_ scope: String, _ name: String) throws {
        let status = SecItemDelete(try base(scope, name) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw SecretError.unavailable }
    }
    private func base(_ scope: String, _ name: String) throws -> [String: Any] {
        guard scope.range(of: "^[A-Za-z0-9_.-]{1,96}$", options: .regularExpression) != nil else { throw SecretError.invalidScope }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                kSecAttrAccount as String: scope + ":" + name]
    }
    enum SecretError: Error { case unavailable, invalidScope }
}
