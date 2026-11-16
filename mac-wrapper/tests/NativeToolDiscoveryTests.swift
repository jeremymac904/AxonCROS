import Foundation

/// Local tool detection and the model-route rewrite. Both run against temporary
/// files and never touch the owner's real configuration.
@main
struct NativeToolDiscoveryTests {
    static func main() throws {
        let fm = FileManager.default
        let testDirectory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("axon-tools-\(UUID().uuidString)")
        try fm.createDirectory(at: testDirectory, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: testDirectory) }

        func check(_ condition: Bool, _ message: String) {
            if !condition { FileHandle.standardError.write("FAIL: \(message)\n".data(using: .utf8)!); exit(1) }
            print("PASS: \(message)")
        }

        // The catalog is a list of tools a person might have. It must never
        // assert that any of them are installed.
        check(!NativeToolDiscovery.catalog.isEmpty, "the tool catalog is not empty")
        check(NativeToolDiscovery.catalog.allSatisfy { $0.name != "" && $0.binary != "" }, "every catalogued tool has a name and a binary")
        check(NativeToolDiscovery.catalog.filter { $0.route != nil }.allSatisfy { $0.routeModel != nil }, "every tool that can serve a route names a model")

        // Detection returns only tools that really exist, with a real path.
        let detected = NativeToolDiscovery.detect()
        check(detected.allSatisfy { fm.isExecutableFile(atPath: $0.path) }, "every detected tool points at an executable file")
        check(detected.count <= NativeToolDiscovery.catalog.count, "no tool is reported twice")
        check(Set(detected.map { $0.path }).count == detected.count, "each detected tool has its own path")
        check(detected.allSatisfy { $0.version == nil || !$0.version!.isEmpty }, "detected versions are plain text")
        for tool in detected { print("      detected: \(tool.name) [\(tool.role)] at \(tool.path) \(tool.version ?? "")") }

        // The rewrite keeps every unrelated setting and replaces only the route keys.
        let config = testDirectory.appendingPathComponent(".env")
        let original = """
        # AxonCROS private local configuration
        BOT_HQ_MODE=local-text
        SESSION_SECRET=synthetic-secret-value
        ALLOWED_EMAILS=local@axoncros.local
        HERMES_URL=http://127.0.0.1:8642
        HERMES_HOME_PRIMARY=/synthetic/hermes
        DEV_LOGIN=0

        """
        try original.write(to: config, atomically: true, encoding: .utf8)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: config.path)

        let codex = NativeToolDiscovery.detect().first { $0.route == "codex-cli" }
        if let codex {
            let result = NativeToolDiscovery.writeModelRoute(configPath: config, toolId: codex.id)
            if result["ok"] == nil { print("      rewrite error: \(result["error"] ?? "unknown")") }
            check(result["ok"] != nil, "the rewrite reports success for a detected tool")
            let written = try String(contentsOf: config, encoding: .utf8)
            check(written.contains("AXON_MODEL_PROVIDER=codex-cli"), "the selected route is written")
            check(written.contains("AXON_CODEX_CLI_BIN=\(codex.path)"), "the detected path is written")
            check(written.contains("AXON_CODEX_CLI_MODEL="), "the route model is written")
            check(written.contains("SESSION_SECRET=synthetic-secret-value"), "unrelated settings are preserved")
            check(written.contains("HERMES_URL=http://127.0.0.1:8642"), "the gateway settings are preserved")
            check(written.contains("ALLOWED_EMAILS=local@axoncros.local"), "the owner email is preserved")
            check(written.components(separatedBy: "AXON_MODEL_PROVIDER=").count == 2, "the route key is written once, not duplicated")
            let permissions = try fm.attributesOfItem(atPath: config.path)[.posixPermissions] as! NSNumber
            check(permissions.intValue == 0o600, "the rewritten configuration stays owner-readable only")
            check(fm.fileExists(atPath: config.path + ".before-route"), "the previous configuration is kept as a backup")

            // Selecting the same route again must not grow the file.
            let first = try String(contentsOf: config, encoding: .utf8)
            _ = NativeToolDiscovery.writeModelRoute(configPath: config, toolId: codex.id)
            let second = try String(contentsOf: config, encoding: .utf8)
            check(first == second, "selecting the same route again changes nothing")
        } else {
            print("SKIP: no Codex CLI detected on this Mac, so the rewrite was not exercised")
        }

        // A tool that cannot serve a route must be refused.
        if let notARoute = NativeToolDiscovery.detect().first(where: { $0.route == nil }) {
            let result = NativeToolDiscovery.writeModelRoute(configPath: config, toolId: notARoute.id)
            check(result["ok"] == nil && result["error"] != nil, "a tool that cannot serve a route is refused")
        }

        // An unknown tool must be refused without touching the configuration.
        let before = try String(contentsOf: config, encoding: .utf8)
        let unknown = NativeToolDiscovery.writeModelRoute(configPath: config, toolId: "not-a-real-tool")
        check(unknown["ok"] == nil, "an unknown tool is refused")
        check(try String(contentsOf: config, encoding: .utf8) == before, "a refused rewrite leaves the configuration untouched")
    }
}
