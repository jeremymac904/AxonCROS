import Foundation
import Darwin
@main struct NativePickerProcessTests {
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("axon-picker-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        var checks: [String] = []
        func check(_ value: @autoclosure () -> Bool, _ name: String) { guard value() else { fatalError(name) }; checks.append(name) }
        func run(_ code: String, cancelAfter: Double? = nil, heartbeat: (() -> Void)? = nil) async throws -> (NativePickerOutcome, Double, Int) {
            let file = root.appendingPathComponent(UUID().uuidString + ".py")
            try ("import sys,json,time,signal,os\nsys.stdin.read()\n" + code + "\n").write(to: file, atomically: true, encoding: .utf8)
            let started = Date(); var count = 0; var process: NativePickerProcess?
            let result: NativePickerOutcome = await withCheckedContinuation { continuation in
                let child = NativePickerProcess(executable: URL(fileURLWithPath: "/usr/bin/python3"), arguments: [file.path], startupTimeout: 0.25, selectionTimeout: 0.35) { outcome in count += 1; if count == 1 { continuation.resume(returning: outcome) } }
                process = child; child.start(NativePanelRequest(title: "Synthetic test"))
                if let cancelAfter { DispatchQueue.main.asyncAfter(deadline: .now() + cancelAfter) { child.cancel(); child.cancel() } }
                if let heartbeat { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { heartbeat() } }
            }
            // Keep the coordinator retained long enough to receive late exit/EOF.
            try await Task.sleep(nanoseconds: 700_000_000); _ = process
            return (result, Date().timeIntervalSince(started), count)
        }
        let ready = "print(json.dumps({'event':'ready'}),flush=True)\n"
        let selected = "print(json.dumps({'event':'result','ok':True,'urls':['file:///tmp/synthetic.txt']}),flush=True)\n"
        func failed(_ outcome: NativePickerOutcome) -> Bool { if case .failed = outcome { return true }; return false }
        var result = try await run(ready + selected)
        if case .selected(let urls) = result.0 { check(urls.count == 1 && urls[0].path == "/tmp/synthetic.txt", "Clean helper result accepts explicitly selected local URL") } else { fatalError("Expected selection") }
        check(result.2 == 1, "Successful helper settles once")
        for (label, code) in [
            ("Unknown exit fails closed", ready + selected + "sys.exit(7)"),
            ("Success before visible-ready fails closed", selected),
            ("Malformed JSON fails closed", "print('not-json',flush=True)"),
            ("Unknown protocol event fails closed", "print(json.dumps({'event':'untrusted'}),flush=True)"),
            ("Missing result fails closed", ready),
            ("Duplicate result fails closed", ready + selected + selected),
            ("Remote URL rejected", ready + "print(json.dumps({'event':'result','ok':True,'urls':['https://example.invalid/file']}),flush=True)"),
            ("File URL credentials rejected", ready + "print(json.dumps({'event':'result','ok':True,'urls':['file://user:password@localhost/tmp/file']}),flush=True)"),
            ("Remote file host rejected", ready + "print(json.dumps({'event':'result','ok':True,'urls':['file://remote.invalid/tmp/file']}),flush=True)"),
            ("Too many URLs rejected", ready + "print(json.dumps({'event':'result','ok':True,'urls':['file:///tmp/f']*33}),flush=True)"),
            ("Oversized stdout bounded", "print('x'*262145,flush=True)"),
            ("Trailing incomplete frame rejected", ready + selected + "sys.stdout.write('tail');sys.stdout.flush()")
        ] {
            result = try await run(code); check(failed(result.0) && result.2 == 1, label)
        }
        var responsive = false
        result = try await run("time.sleep(20)", heartbeat: { responsive = true })
        check(failed(result.0) && result.1 < 2 && responsive, "Startup hang is bounded and parent main queue remains responsive")
        result = try await run(ready + "time.sleep(20)")
        check(failed(result.0) && result.1 < 2, "Visible chooser also has bounded selection lifetime")
        result = try await run(ready + "time.sleep(.15)\n" + selected, cancelAfter: 0.05)
        if case .cancelled = result.0 { check(result.2 == 1, "Cancel and late result settle once without accepting selection") } else { fatalError("Expected cancel") }
        let pidFile = root.appendingPathComponent("owned-helper.pid")
        let survivor = Process(); survivor.executableURL = URL(fileURLWithPath: "/bin/sleep"); survivor.arguments = ["10"]; try survivor.run(); defer { if survivor.isRunning { survivor.terminate() } }
        result = try await run("signal.signal(signal.SIGTERM,signal.SIG_IGN)\nopen(" + String(reflecting: pidFile.path) + ", 'w').write(str(os.getpid()))\n" + ready + "time.sleep(20)", cancelAfter: 0.08)
        if case .cancelled = result.0 { check(result.2 == 1, "Cancellation remains responsive when helper ignores SIGTERM") } else { fatalError("Expected cancel") }
        let pid = Int32(try String(contentsOf: pidFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))!
        check(kill(pid, 0) != 0 && errno == ESRCH, "Only owned hung helper is force-stopped after grace period")
        check(survivor.isRunning, "Unrelated process is not signalled")
        print(String(data: try JSONSerialization.data(withJSONObject: ["passed": true, "checks": checks, "realOSPanels": 0, "realFilesRead": 0], options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    }
}
