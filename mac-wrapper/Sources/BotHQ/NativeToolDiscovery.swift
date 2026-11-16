import Foundation

/// Detect command line tools that are already installed on this Mac.
///
/// The idea follows the approach used by AionUi's agent hub: keep a small
/// catalog of known tools, report which ones are actually present, and show
/// where they live. Nothing is installed, updated or run beyond a bounded
/// version query, and no tool is ever launched on the user's behalf.
enum NativeToolDiscovery {

    /// One tool in the catalog. `route` is the model route this tool can
    /// serve, when it can serve one at all.
    struct Tool {
        let id: String
        let name: String
        let role: String
        let binary: String
        let path: String
        let version: String?
        let route: String?
        let routeModel: String?
        var dictionary: [String: Any] {
            var out: [String: Any] = ["id": id, "name": name, "role": role, "binary": binary, "path": path]
            if let version { out["version"] = version }
            if let route { out["route"] = route }
            if let routeModel { out["routeModel"] = routeModel }
            return out
        }
    }

    /// The known catalog. This is a list of tools a person might have; it
    /// never asserts that any of them are installed.
    static let catalog: [(id: String, name: String, role: String, binary: String, route: String?, routeModel: String?)] = [
        ("codex", "Codex CLI", "model", "codex", "codex-cli", "gpt-6.1-sol"),
        ("ollama", "Ollama", "model", "ollama", "ollama-local", "qwen3:4b-instruct"),
        ("claude", "Claude Code", "agent", "claude", nil, nil),
        ("gemini", "Gemini CLI", "agent", "gemini", nil, nil),
        ("opencode", "OpenCode", "agent", "opencode", nil, nil),
        ("aider", "Aider", "agent", "aider", nil, nil),
        ("gh", "GitHub CLI", "other", "gh", nil, nil),
        ("node", "Node.js", "runtime", "node", nil, nil),
        ("python3", "Python", "runtime", "python3", nil, nil),
    ]

    /// Directories that may hold an installed tool. The user's own PATH comes
    /// first, then the usual install locations.
    private static func candidateDirectories() -> [URL] {
        var seen = Set<String>()
        var directories: [URL] = []
        func add(_ path: String) {
            let expanded = (path as NSString).expandingTildeInPath
            guard !expanded.isEmpty, seen.insert(expanded).inserted else { return }
            directories.append(URL(fileURLWithPath: expanded, isDirectory: true))
        }
        let environmentPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
        for entry in environmentPath.split(separator: ":") { add(String(entry)) }
        for fixed in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/sbin", "/usr/sbin"] { add(fixed) }
        add((NSHomeDirectory() as NSString).appendingPathComponent(".local/bin"))
        add((NSHomeDirectory() as NSString).appendingPathComponent("bin"))
        return directories
    }

    /// Tools bundled inside an installed application, such as the Codex CLI
    /// inside a chat application. The search is shallow and bounded.
    private static func bundledBinaryLocations(binary: String) -> [URL] {
        var found: [URL] = []
        let fileManager = FileManager.default
        for applications in ["/Applications", (NSHomeDirectory() as NSString).appendingPathComponent("Applications")] {
            guard let apps = try? fileManager.contentsOfDirectory(atPath: applications) else { continue }
            for app in apps where app.hasSuffix(".app") {
                let resources = URL(fileURLWithPath: applications).appendingPathComponent(app).appendingPathComponent("Contents/Resources", isDirectory: true)
                found += search(binary: binary, in: resources, depth: 3)
            }
        }
        return found
    }

    /// Look for <binary> in a MacOS executable folder a few levels down.
    private static func search(binary: String, in directory: URL, depth: Int) -> [URL] {
        guard depth > 0 else { return [] }
        var found: [URL] = []
        let fileManager = FileManager.default
        let macOS = directory.appendingPathComponent("Contents/MacOS", isDirectory: true)
        let direct = macOS.appendingPathComponent(binary)
        if fileManager.isExecutableFile(atPath: direct.path) { found.append(direct) }
        guard let entries = try? fileManager.contentsOfDirectory(atPath: directory.path) else { return found }
        for entry in entries where entry.hasSuffix(".app") || !entry.hasPrefix(".") {
            let child = directory.appendingPathComponent(entry, isDirectory: true)
            var isDirectory: ObjCBool = false
            guard fileManager.fileExists(atPath: child.path, isDirectory: &isDirectory), isDirectory.boolValue else { continue }
            found += search(binary: binary, in: child, depth: depth - 1)
        }
        return found
    }

    /// A short, bounded version query. Never runs anything but the tool's own
    /// version flag, with a hard timeout.
    private static func version(of path: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = ["--version"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
        } catch { return nil }
        let deadline = Date().addingTimeInterval(4)
        while process.isRunning && Date() < deadline {
            usleep(50_000)
        }
        if process.isRunning { process.terminate(); return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let text = String(data: data, encoding: .utf8) else { return nil }
        let line = text.split(separator: "\n").first.map(String.init)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !line.isEmpty else { return nil }
        return String(line.prefix(160))
    }

    /// The marker this app writes above the route it selected.
    static let routeMarker = "# Model route selected from the detected tools on this Mac."

    /// The configuration keys this app manages for the model route.
    static let managedRouteKeys = ["AXON_MODEL_PROVIDER", "AXON_CODEX_CLI_BIN", "AXON_CODEX_CLI_MODEL", "AXON_CODEX_CLI_HOME",
                                   "AXON_LOCAL_MODEL_URL", "AXON_LOCAL_MODEL", "AXON_OPENROUTER_BASE_URL", "AXON_OPENROUTER_MODEL"]

    /// Rewrite the owner's private configuration so a detected tool becomes the
    /// model route. Every other setting is preserved exactly, the previous
    /// file is left as a backup, and the result is owner-readable only.
    static func writeModelRoute(configPath: URL, toolId: String) -> [String: Any] {
        guard let tool = detect(probeVersions: false).first(where: { $0.id == toolId }) else {
            return ["error": "That tool is not installed on this Mac."]
        }
        guard let route = tool.route, let routeModel = tool.routeModel else {
            return ["error": "\(tool.name) cannot serve model turns in this app."]
        }
        let fileManager = FileManager.default
        let existing = (try? String(contentsOf: configPath, encoding: .utf8)) ?? ""
        var kept: [String] = []
        for line in existing.split(separator: "\n", omittingEmptySubsequences: false) {
            let key = line.split(separator: "=", maxSplits: 1).first.map(String.init) ?? ""
            if managedRouteKeys.contains(key.trimmingCharacters(in: .whitespaces)) { continue }
            if String(line).trimmingCharacters(in: .whitespaces) == routeMarker { continue }
            kept.append(String(line))
        }
        while let last = kept.last, last.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { kept.removeLast() }
        kept.append(routeMarker)
        kept.append("AXON_MODEL_PROVIDER=\(route)")
        switch route {
        case "codex-cli":
            kept.append("AXON_CODEX_CLI_BIN=\(tool.path)")
            kept.append("AXON_CODEX_CLI_MODEL=\(routeModel)")
        case "ollama-local":
            kept.append("AXON_LOCAL_MODEL_URL=http://127.0.0.1:11434")
            kept.append("AXON_LOCAL_MODEL=\(routeModel)")
        default: break
        }
        kept.append("")
        let text = kept.joined(separator: "\n")
        do {
            try? fileManager.removeItem(atPath: configPath.path + ".before-route")
            try fileManager.copyItem(atPath: configPath.path, toPath: configPath.path + ".before-route")
        } catch { /* no previous file to keep */ }
        do {
            try text.write(to: configPath, atomically: true, encoding: .utf8)
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configPath.path)
        } catch {
            return ["error": "The private configuration could not be updated."]
        }
        return ["ok": true, "route": route, "model": routeModel, "tool": tool.name, "path": tool.path]
    }

    /// Every catalogued tool that is actually installed on this Mac.
    static func detect(probeVersions: Bool = true) -> [Tool] {
        let fileManager = FileManager.default
        let directories = candidateDirectories()
        var tools: [Tool] = []
        for entry in catalog {
            var resolved: String?
            for directory in directories {
                let candidate = directory.appendingPathComponent(entry.binary)
                if fileManager.isExecutableFile(atPath: candidate.path) { resolved = candidate.path; break }
            }
            if resolved == nil {
                for bundled in bundledBinaryLocations(binary: entry.binary) { resolved = bundled.path; break }
            }
            guard let path = resolved else { continue }
            tools.append(Tool(id: entry.id, name: entry.name, role: entry.role, binary: entry.binary,
                              path: path, version: probeVersions ? version(of: path) : nil,
                              route: entry.route, routeModel: entry.routeModel))
        }
        return tools
    }
}
