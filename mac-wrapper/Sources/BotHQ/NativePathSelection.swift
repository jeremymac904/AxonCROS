import Foundation
import Darwin

/// Explicit user-entered native path selection. No shell expansion or file reads.
enum NativePathSelection {
    struct Rejection: LocalizedError { let text: String; var errorDescription: String? { text } }
    static func validate(_ input: String, request: NativePanelRequest, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> URL {
        let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, raw.utf8.count <= 4096, !raw.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }), raw.hasPrefix("/") || raw == "~" || raw.hasPrefix("~/") else { throw Rejection(text: "Enter one absolute local path, or a path beginning with ~/. Do not paste a file URL or shell command.") }
        let path = raw == "~" ? home.path : raw.hasPrefix("~/") ? home.appendingPathComponent(String(raw.dropFirst(2))).path : raw
        let selected = URL(fileURLWithPath: path).standardizedFileURL
        var info = stat()
        if request.kind == "save" {
            // lstat rejects existing files and even dangling symbolic links.
            guard lstat(selected.path, &info) != 0 && errno == ENOENT else { throw Rejection(text: "A file or folder already exists here. Choose a new filename to preserve the existing item.") }
            let parent = selected.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL
            guard stat(parent.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR, access(parent.path, W_OK | X_OK) == 0 else { throw Rejection(text: "Choose an existing local folder you can write to. No folders or files were created.") }
            return parent.appendingPathComponent(selected.lastPathComponent)
        }
        guard request.kind == "open" else { throw Rejection(text: "This selection type is unsupported.") }
        let resolved = selected.resolvingSymlinksInPath().standardizedFileURL
        guard stat(resolved.path, &info) == 0 else { throw Rejection(text: "That path is not available. Check the spelling and make sure the item is downloaded locally.") }
        let kind = info.st_mode & S_IFMT
        guard (kind == S_IFREG && request.chooseFiles) || (kind == S_IFDIR && request.chooseDirectories) else { throw Rejection(text: request.chooseDirectories && !request.chooseFiles ? "Choose an existing folder, not a file." : "Choose an existing regular file, not a folder or device.") }
        let permissions = kind == S_IFDIR ? R_OK | X_OK : R_OK
        guard access(resolved.path, permissions) == 0 else { throw Rejection(text: "This app cannot read that item. Choose a readable local item; no system permissions were changed.") }
        return resolved
    }
}
