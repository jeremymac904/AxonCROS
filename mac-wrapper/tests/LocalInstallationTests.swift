import Foundation

@main struct LocalInstallationTests {
    static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("axoncros-first-run-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }
        try LocalInstallation.createConfigurationIfMissing(support: root)
        let config = root.appendingPathComponent(".env")
        let before = try Data(contentsOf: config)
        let text = String(data: before, encoding: .utf8)!
        precondition(text.contains("AXON_MODEL_PROVIDER=ollama-local"))
        precondition(!text.contains("HERMES_") && !text.contains("API_KEY"))
        let permissions = try fm.attributesOfItem(atPath: config.path)[.posixPermissions] as! NSNumber
        precondition(permissions.intValue == 0o600)
        try LocalInstallation.createConfigurationIfMissing(support: root)
        let after = try Data(contentsOf: config)
        precondition(after == before)
        try Data("SYNTHETIC_EXISTING_CONFIG\n".utf8).write(to: config)
        try LocalInstallation.createConfigurationIfMissing(support: root)
        let preserved = try String(contentsOf: config,encoding:.utf8)
        precondition(preserved == "SYNTHETIC_EXISTING_CONFIG\n")
        print("PASS native fresh configuration is private, local-model only, idempotent and preserves existing settings")
    }
}
