import Foundation
import Darwin

struct NativeVerificationProfile {
    static let bundleIdentifier = "local.bot-hq.desktop.verification"
    // Keep the synthetic bootstrap off File Provider-backed Documents: even a
    // small marker's open/read can stall there before the app creates a window.
    static var allowedParent: URL {
        let temporary = FileManager.default.temporaryDirectory
        // Foundation can retain macOS's /var alias after resolvingSymlinksInPath;
        // fixture creators use realpath (/private/var). Compare one exact path.
        let resolved: URL
        if let path = realpath(temporary.path, nil) {
            defer { free(path) }
            resolved = URL(fileURLWithPath: String(cString: path), isDirectory: true)
        } else {
            resolved = temporary.resolvingSymlinksInPath()
        }
        return resolved.appendingPathComponent("axoncros-native-verification", isDirectory: true)
    }
    let root: URL
    let port: UInt16
    let instanceID: String
    let launchToken: String
    let profileID: String
    let launchBundledRuntime: Bool
    var storage: URL { root.appendingPathComponent("native-store", isDirectory: true) }
    var keychainService: String { "local.bot-hq.desktop.AxonCROS.verification.\(profileID)" }

    static func load(bundleID: String?, info: [String: Any], parent: URL = allowedParent) throws -> NativeVerificationProfile? {
        let locator = info["AXONCROSVerificationRoot"]
        let configuredPort = info["AXONCROSVerificationPort"]
        if bundleID != bundleIdentifier && locator == nil && configuredPort == nil { return nil }
        guard bundleID == bundleIdentifier, let rawRoot = locator as? String, rawRoot.hasPrefix("/"),
              let plistPort = configuredPort as? NSNumber, plistPort.intValue == 18885 else { throw InvalidProfile() }
        let root = URL(fileURLWithPath: rawRoot, isDirectory: true)
        let expectedParent = parent
        guard root.path == rawRoot, root.deletingLastPathComponent() == expectedParent,
              canonicalPath(root) == root.path,
              canonicalPath(expectedParent) == expectedParent.path,
              root.lastPathComponent.hasPrefix("native-profile-") else { throw InvalidProfile() }
        let suffix = String(root.lastPathComponent.dropFirst("native-profile-".count))
        guard UUID(uuidString: suffix) != nil else { throw InvalidProfile() }
        try privateItem(root, directory: true)
        let marker = root.appendingPathComponent(".axoncros-verification.json")
        let markerStat = try privateItem(marker, directory: false)
        guard markerStat.st_size <= 8192,
              let object = try JSONSerialization.jsonObject(with: Data(contentsOf: marker)) as? [String: Any],
              object["purpose"] as? String == "AxonCROS isolated native verification",
              let port = object["port"] as? NSNumber, port.intValue == plistPort.intValue,
              let profileID = object["profileId"] as? String, UUID(uuidString: profileID) != nil,
              profileID.lowercased() == suffix.lowercased(),
              let instance = object["instanceId"] as? String, instance.lowercased() == "axoncros-native-\(profileID.lowercased())",
              let token = object["launchToken"] as? String,
              token.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil else { throw InvalidProfile() }
        let storage = root.appendingPathComponent("native-store", isDirectory: true)
        if FileManager.default.fileExists(atPath: storage.path) { try privateItem(storage, directory: true) }
        if let value = object["launchBundledRuntime"], !(value is Bool) { throw InvalidProfile() }
        return NativeVerificationProfile(root: root, port: UInt16(port.intValue), instanceID: instance, launchToken: token, profileID: profileID.lowercased(), launchBundledRuntime: object["launchBundledRuntime"] as? Bool ?? false)
    }

    private static func canonicalPath(_ url: URL) -> String? {
        guard let path = realpath(url.path, nil) else { return nil }
        defer { free(path) }
        return String(cString: path)
    }

    @discardableResult private static func privateItem(_ url: URL, directory: Bool) throws -> stat {
        // Foundation's attributesOfItem also reads extended attributes. On a
        // File Provider folder that can block the main thread during launch.
        // lstat supplies every required ownership/type/mode check without xattrs.
        var a = stat()
        guard lstat(url.path, &a) == 0,
              a.st_mode & S_IFMT == (directory ? S_IFDIR : S_IFREG),
              a.st_uid == getuid(), a.st_mode & 0o7777 == (directory ? 0o700 : 0o600),
              canonicalPath(url) == url.path else { throw InvalidProfile() }
        return a
    }
    struct InvalidProfile: Error {}
}
