import Foundation
import Security
import Darwin

/// A portable app initializes only its own new private profile. Existing files win.
enum LocalInstallation {
    static func createConfigurationIfMissing(support: URL) throws {
        let fm = FileManager.default
        let config = support.appendingPathComponent(".env")
        if fm.fileExists(atPath: config.path) { return }
        try fm.createDirectory(at: support, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try fm.createDirectory(at: support.appendingPathComponent("data"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var bytes = [UInt8](repeating: 0, count: 48)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw SetupError.random }
        let secret = bytes.map { String(format: "%02x", $0) }.joined()
        let text = """
        # AxonCROS private local configuration. Never share or commit this file.
        BOT_HQ_MODE=local-text
        AXON_MODEL_PROVIDER=ollama-local
        AXON_LOCAL_MODEL_URL=http://127.0.0.1:11434
        AXON_LOCAL_MODEL=qwen3:4b-instruct
        PORT=8787
        APP_URL=http://127.0.0.1:8787
        SERVER_URL=http://127.0.0.1:8787
        SESSION_SECRET=\(secret)
        ALLOWED_EMAILS=local@axoncros.local
        DEV_LOGIN=0
        GROKBOT_NO_SCHEDULER=1

        """
        let fd = Darwin.open(config.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0o600)
        if fd < 0 { if errno == EEXIST { return }; throw SetupError.write }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        do { try handle.write(contentsOf: Data(text.utf8)); try handle.synchronize(); try handle.close() }
        catch { try? handle.close(); try? fm.removeItem(at: config); throw error }
    }
    enum SetupError: Error { case random, write }
}
