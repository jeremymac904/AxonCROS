import Foundation
import Darwin
@main struct NativePathSelectionTests {
    static func main() throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent("axon-path-test-" + UUID().uuidString)
        try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]); defer { try? fm.removeItem(at: root) }
        let file = root.appendingPathComponent("synthetic sample.json"), original = Data("{\"synthetic\":true}".utf8)
        try original.write(to: file)
        let open = NativePanelRequest(title: "Test"), folder = NativePanelRequest(title: "Folder", chooseFiles: false, chooseDirectories: true), save = NativePanelRequest(kind: "save", title: "Save")
        var checks: [String] = []
        func check(_ condition: Bool, _ label: String) { guard condition else { fatalError(label) }; checks.append(label) }
        func denied(_ path: String, _ request: NativePanelRequest = NativePanelRequest(title: "Test")) -> Bool { (try? NativePathSelection.validate(path, request: request)) == nil }
        check(try NativePathSelection.validate(file.path, request: open) == file.resolvingSymlinksInPath(), "Readable absolute file accepted without reading contents")
        check(try NativePathSelection.validate("~/synthetic sample.json", request: open, home: root) == file.resolvingSymlinksInPath(), "Tilde path expands only the current owner home")
        check(try NativePathSelection.validate(root.path, request: folder) == root.resolvingSymlinksInPath(), "Directory selection accepts existing readable folder")
        check(denied(file.path, folder) && denied(root.path, open), "File and folder modes cannot be confused")
        for value in ["relative.json", "https://example.invalid/file", "file:///tmp/file", "~another-user/file", "", " ", file.path + "\0", file.path + "\nother"] { check(denied(value), "Invalid path form rejected: case \(checks.count)") }
        check(denied(root.appendingPathComponent("missing.json").path), "Missing open item rejected")
        check(denied("/dev/null"), "Device paths rejected")
        let fifo = root.appendingPathComponent("synthetic-pipe"); guard mkfifo(fifo.path, 0o600) == 0 else { fatalError("FIFO fixture") }
        check(denied(fifo.path), "FIFO rejected without opening or blocking")
        let link = root.appendingPathComponent("symlink.json"); try fm.createSymbolicLink(at: link, withDestinationURL: file)
        check(try NativePathSelection.validate(link.path, request: open) == file.resolvingSymlinksInPath(), "Explicit symlink selection resolves canonical target")
        let newFile = root.appendingPathComponent("new-download.txt")
        check(try NativePathSelection.validate(newFile.path, request: save) == newFile.resolvingSymlinksInPath(), "New save destination in writable existing folder accepted")
        check(!fm.fileExists(atPath: newFile.path), "Validation never creates a file")
        check(denied(file.path, save) && denied(root.path, save), "Save never overwrites an existing file or folder")
        let dangling = root.appendingPathComponent("dangling"); try fm.createSymbolicLink(atPath: dangling.path, withDestinationPath: root.appendingPathComponent("absent-target").path)
        check(denied(dangling.path, save), "Save rejects existing dangling symlink")
        check(denied(root.appendingPathComponent("missing-folder/new.txt").path, save), "Missing save parent rejected without creating folders")
        check(denied("/" + String(repeating: "a", count: 4097)), "Overlong path rejected before filesystem access")
        check(denied(file.path, NativePanelRequest(kind: "other", title: "Invalid")), "Unknown selection type rejected")
        check(try Data(contentsOf: file) == original, "Existing synthetic file bytes preserved across all checks")
        print(String(data: try JSONSerialization.data(withJSONObject: ["passed": true, "checks": checks, "realFilesRead": 0, "syntheticOnly": true, "overwritePolicy": "Existing destinations rejected; choose a new filename"], options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    }
}
