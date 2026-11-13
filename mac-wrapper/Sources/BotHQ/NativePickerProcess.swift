import Foundation
import Darwin

struct NativePanelRequest: Codable {
    var kind = "open"
    var title: String
    var message = ""
    var chooseFiles = true
    var chooseDirectories = false
    var multiple = false
    var suggestedName = ""
}
struct NativePanelSelection { let urls: [URL]; var url: URL? { urls.first } }
enum NativePickerOutcome { case selected([URL]), cancelled, failed(String) }

/// Owns exactly one subprocess and private pipes. No AppKit work can block this process.
/// All state is main-queue owned; the stdout reader only forwards bounded chunks.
final class NativePickerProcess {
    private let process = Process(), input = Pipe(), output = Pipe()
    private let startupTimeout: TimeInterval, selectionTimeout: TimeInterval
    private let completion: (NativePickerOutcome) -> Void
    private var timer: DispatchWorkItem?
    private var buffer = Data(), total = 0, ready = false, eof = false, exited: Int32?
    private var result: NativePickerOutcome?, settled = false
    private let errorText = "macOS could not open its file chooser in time. The chooser was stopped; your app and files are unchanged. You can retry."
    init(executable: URL, arguments: [String] = [], startupTimeout: TimeInterval = 12, selectionTimeout: TimeInterval = 600, completion: @escaping (NativePickerOutcome) -> Void) {
        self.startupTimeout = startupTimeout; self.selectionTimeout = selectionTimeout; self.completion = completion
        process.executableURL = executable; process.arguments = arguments
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        let environment = ProcessInfo.processInfo.environment
        process.environment = ["HOME": FileManager.default.homeDirectoryForCurrentUser.path, "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "TMPDIR": environment["TMPDIR"] ?? "/tmp", "LANG": environment["LANG"] ?? "en_US.UTF-8"]
    }
    func start(_ request: NativePanelRequest) {
        guard !settled else { return }
        guard let executable = process.executableURL, FileManager.default.isExecutableFile(atPath: executable.path),
              let data = try? JSONEncoder().encode(request), data.count <= 16384 else { finish(.failed("The packaged file chooser is unavailable. Reinstall this app; no file was selected.")); return }
        process.terminationHandler = { [weak self] child in DispatchQueue.main.async { self?.exited = child.terminationStatus; self?.finishIfComplete() } }
        do { try process.run() }
        catch { finish(.failed("The packaged file chooser could not start. No file was selected.")); return }
        arm(startupTimeout)
        let reader = output.fileHandleForReading
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var received = 0
            while true {
                let chunk = reader.availableData
                received += chunk.count
                if received > 262144 {
                    DispatchQueue.main.async { self?.finish(.failed("The file chooser returned an oversized response. No selection was accepted.")) }
                    try? reader.close(); break
                }
                if chunk.isEmpty { DispatchQueue.main.async { self?.eof = true; self?.finishIfComplete() }; break }
                DispatchQueue.main.async { self?.receive(chunk) }
            }
        }
        do { try input.fileHandleForWriting.write(contentsOf: data); try input.fileHandleForWriting.close() }
        catch { finish(.failed("The file chooser could not receive its request.")) }
    }
    func cancel() { finish(.cancelled) }
    private func arm(_ seconds: TimeInterval) {
        timer?.cancel(); let work = DispatchWorkItem { [weak self] in guard let self else { return }; self.finish(.failed(self.errorText)) }
        timer = work; DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }
    private func receive(_ data: Data) {
        guard !settled else { return }
        total += data.count
        guard total <= 262144 else { finish(.failed("The file chooser returned an oversized response. No selection was accepted.")); return }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = Data(buffer[..<newline]); buffer.removeSubrange(...newline)
            guard !line.isEmpty, let frame = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let event = frame["event"] as? String else { finish(.failed("The file chooser returned an invalid response.")); return }
            if event == "ready", !ready, result == nil { ready = true; arm(selectionTimeout) }
            else if event == "result", result == nil {
                guard let ok = frame["ok"] as? Bool else { finish(.failed("The file chooser returned an invalid selection.")); return }
                if !ok { result = .cancelled; continue }
                guard ready, let strings = frame["urls"] as? [String], !strings.isEmpty, strings.count <= 32 else { finish(.failed("The file chooser returned an invalid selection.")); return }
                let urls = strings.compactMap { value -> URL? in
                    guard value.utf8.count <= 16384, let url = URL(string: value), url.isFileURL, url.host == nil || url.host == "" || url.host == "localhost", url.path.hasPrefix("/"), url.path.utf8.count <= 4096, !url.path.contains("\0"), url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return nil }
                    return url.standardizedFileURL
                }
                guard urls.count == strings.count else { finish(.failed("Only explicit local file selections are accepted.")); return }
                result = .selected(urls)
            } else { finish(.failed("The file chooser returned an unexpected response.")); return }
        }
    }
    private func finishIfComplete() {
        guard !settled, eof, let exited else { return }
        guard exited == 0, buffer.isEmpty, let result else { finish(.failed("The file chooser closed unexpectedly. No file selection was accepted; retry when macOS is ready.")); return }
        finish(result)
    }
    private func finish(_ outcome: NativePickerOutcome) {
        guard !settled else { return }; settled = true; timer?.cancel(); timer = nil
        if process.isRunning {
            process.terminate()
            let child = process
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { if child.isRunning { kill(child.processIdentifier, SIGKILL) } }
        }
        completion(outcome)
    }
    deinit { timer?.cancel(); if process.isRunning { process.terminate() } }
}
