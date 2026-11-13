import Foundation
import Darwin
@main struct NativePickerProcessTests {
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("axon-picker-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        var checks: [String] = []
        func check(_ value: @autoclosure () -> Bool, _ name: String, diagnostic: String = "") { guard value() else { fatalError(name + "; " + diagnostic) }; checks.append(name) }
        func describe(_ outcome: NativePickerOutcome) -> String {
            switch outcome { case .selected(let urls): return "selected(\(urls.count) URLs)"; case .cancelled: return "cancelled"; case .failed(let reason): return "failed: " + reason }
        }
        func run(_ code: String, startupTimeout: Double = 10, selectionTimeout: Double = 5,
                 cancelWhenReady: Bool = false, requireReady: Bool = false, heartbeat: (() -> Void)? = nil) async throws -> (NativePickerOutcome, Double, Int, Double?) {
            let file = root.appendingPathComponent(UUID().uuidString + ".py")
            let marker = root.appendingPathComponent(UUID().uuidString + ".ready")
            // The fixture writes its PID only AFTER installing signal handlers and
            // emitting ready. Cancellation must never race Python cold startup.
            let prelude = "import sys,json,time,signal,os\nsys.stdin.read()\ndef mark_ready():\n    with open(" + String(reflecting: marker.path) + ", 'w') as f: f.write(str(os.getpid()))\n    os.utime(" + String(reflecting: marker.path) + ", None)\n"
            try (prelude + code + "\n").write(to: file, atomically: true, encoding: .utf8)
            let started = Date(); var count = 0; var process: NativePickerProcess?
            var handshakeObserved = false
            var cancellationTask: Task<Void, Never>?
            let result: NativePickerOutcome = await withCheckedContinuation { continuation in
                let child = NativePickerProcess(executable: URL(fileURLWithPath: "/usr/bin/python3"), arguments: [file.path], startupTimeout: startupTimeout, selectionTimeout: selectionTimeout) { outcome in count += 1; if count == 1 { continuation.resume(returning: outcome) } }
                process = child; child.start(NativePanelRequest(title: "Synthetic test"))
                if cancelWhenReady {
                    cancellationTask = Task { @MainActor in
                        while count == 0 && !Task.isCancelled && Date().timeIntervalSince(started) < startupTimeout + 1 {
                            if let value = try? String(contentsOf: marker, encoding: .utf8), Int32(value) != nil {
                                handshakeObserved = true; child.cancel(); child.cancel(); return
                            }
                            try? await Task.sleep(nanoseconds: 20_000_000)
                        }
                    }
                }
                if let heartbeat { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { heartbeat() } }
            }
            let settledAt = Date()
            let elapsed = settledAt.timeIntervalSince(started)
            let readyAt = (try? FileManager.default.attributesOfItem(atPath: marker.path)[.modificationDate]) as? Date
            let readyElapsed = readyAt.map { settledAt.timeIntervalSince($0) }
            cancellationTask?.cancel()
            if cancelWhenReady && !handshakeObserved { fatalError("Cancellation fixture never became ready; outcome=\(describe(result)), elapsed=\(elapsed)s") }
            if requireReady && !FileManager.default.fileExists(atPath: marker.path) { fatalError("Fixture never reached ready; outcome=\(describe(result)), elapsed=\(elapsed)s") }
            // Keep the coordinator retained to exercise duplicate/late EOF. Do not
            // assume SIGKILL/reaping has completed after one fixed short sleep.
            if let value = try? String(contentsOf: marker, encoding: .utf8), let pid = Int32(value) {
                let cleanupDeadline = Date().addingTimeInterval(3)
                while kill(pid, 0) == 0 && Date() < cleanupDeadline { try await Task.sleep(nanoseconds: 20_000_000) }
                guard kill(pid, 0) != 0 && errno == ESRCH else { fatalError("Owned fixture still alive after bounded cleanup; outcome=\(describe(result))") }
            }
            try await Task.sleep(nanoseconds: 100_000_000); _ = process
            return (result, elapsed, count, readyElapsed)
        }
        let ready = "print(json.dumps({'event':'ready'}),flush=True)\n"
        let selected = "print(json.dumps({'event':'result','ok':True,'urls':['file:///tmp/synthetic.txt']}),flush=True)\n"
        func failed(_ outcome: NativePickerOutcome) -> Bool { if case .failed = outcome { return true }; return false }
        var result = try await run("time.sleep(.4)\n" + ready + selected)
        if case .selected(let urls) = result.0 { check(urls.count == 1 && urls[0].path == "/tmp/synthetic.txt", "Clean helper result accepts explicitly selected local URL") } else { fatalError("Expected selection; outcome=\(describe(result.0)), elapsed=\(result.1)s") }
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
            result = try await run(code)
            // A startup timeout must not falsely pass a malformed-protocol test.
            let timeout = describe(result.0).contains("could not open its file chooser in time")
            check(failed(result.0) && !timeout && result.2 == 1, label, diagnostic: "outcome=\(describe(result.0)), elapsed=\(result.1)s")
        }
        var responsive = false
        result = try await run("time.sleep(20)", startupTimeout: 0.25, heartbeat: { responsive = true })
        check(failed(result.0) && result.1 < 2 && responsive, "Startup hang is bounded and parent main queue remains responsive", diagnostic: "outcome=\(describe(result.0)), elapsed=\(result.1)s")
        result = try await run(ready + "mark_ready()\ntime.sleep(20)", selectionTimeout: 0.35, requireReady: true)
        check(failed(result.0) && result.3 != nil && result.3! >= 0 && result.3! < 2, "Visible chooser also has bounded selection lifetime", diagnostic: "outcome=\(describe(result.0)), totalElapsed=\(result.1)s, readyElapsed=\(String(describing: result.3))s")
        result = try await run("time.sleep(.4)\ndef late_result(*args):\n    " + selected.trimmingCharacters(in: .newlines) + "\n    sys.exit(0)\nsignal.signal(signal.SIGTERM,late_result)\n" + ready + "mark_ready()\ntime.sleep(20)", cancelWhenReady: true)
        if case .cancelled = result.0 { check(result.2 == 1, "Cancel and late result settle once without accepting selection") } else { fatalError("Expected cancel; outcome=\(describe(result.0)), elapsed=\(result.1)s") }
        let pidFile = root.appendingPathComponent("owned-helper.pid")
        let survivor = Process(); survivor.executableURL = URL(fileURLWithPath: "/bin/sleep"); survivor.arguments = ["30"]; try survivor.run(); defer { if survivor.isRunning { survivor.terminate() } }
        result = try await run("time.sleep(.4)\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nopen(" + String(reflecting: pidFile.path) + ", 'w').write(str(os.getpid()))\n" + ready + "mark_ready()\ntime.sleep(20)", cancelWhenReady: true)
        if case .cancelled = result.0 { check(result.2 == 1, "Cancellation remains responsive when helper ignores SIGTERM") } else { fatalError("Expected cancel; outcome=\(describe(result.0)), elapsed=\(result.1)s") }
        let pid = Int32(try String(contentsOf: pidFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))!
        check(kill(pid, 0) != 0 && errno == ESRCH, "Only owned hung helper is force-stopped after grace period")
        check(survivor.isRunning, "Unrelated process is not signalled")
        print(String(data: try JSONSerialization.data(withJSONObject: ["passed": true, "checks": checks, "realOSPanels": 0, "realFilesRead": 0], options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    }
}
