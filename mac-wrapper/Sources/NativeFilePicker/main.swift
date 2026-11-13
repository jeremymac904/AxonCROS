import AppKit
import NativePanelFactory

// Private stdin/stdout protocol shared with the parent. No file contents or credentials.
private struct PickerRequest: Decodable {
    let kind: String, title: String, message: String
    let chooseFiles: Bool, chooseDirectories: Bool, multiple: Bool
    let suggestedName: String
}
private func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value), data.count < 262144 else { exit(72) }
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
}
let bytes = FileHandle.standardInput.readDataToEndOfFile()
guard bytes.count <= 16384, let request = try? JSONDecoder().decode(PickerRequest.self, from: bytes), ["open", "save"].contains(request.kind), request.title.count <= 200, request.message.count <= 4000, request.suggestedName.count <= 255 else { exit(64) }
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
// A helper-local last resort. The parent has a shorter independent startup
// deadline and can kill only this process without freezing the workspace.
DispatchQueue.global().asyncAfter(deadline: .now() + 660) { exit(70) }
RunLoop.main.perform(inModes: [.default, .common]) {
    let panel: NSSavePanel?
    if request.kind == "open" {
        let open = AxonCreateOpenPanel(); open?.canChooseFiles = request.chooseFiles; open?.canChooseDirectories = request.chooseDirectories
        open?.allowsMultipleSelection = request.multiple; open?.resolvesAliases = true; panel = open
    } else {
        let save = AxonCreateSavePanel(); save?.nameFieldStringValue = URL(fileURLWithPath: request.suggestedName).lastPathComponent; save?.canCreateDirectories = true; panel = save
    }
    guard let panel else { exit(71) }
    panel.title = request.title; panel.message = request.message
    panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads", isDirectory: true)
    var ready = false
    func markReady() { if !ready && panel.isVisible { ready = true; emit(["event": "ready"]) } }
    // AppKit stays on this helper's main run loop, outside a main GCD drain.
    let started = AxonBeginStandalonePanel(panel) { response in
        if response == .OK {
            if !ready { ready = true; emit(["event": "ready"]) }
            let urls = (panel as? NSOpenPanel)?.urls ?? panel.url.map { [$0] } ?? []
            guard !urls.isEmpty, urls.count <= 32 else { exit(72) }
            emit(["event": "result", "ok": true, "urls": urls.map(\.absoluteString)])
        } else { emit(["event": "result", "ok": false]) }
        exit(0)
    }
    guard started else { exit(71) }
    app.activate(ignoringOtherApps: true); markReady()
    Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in markReady(); if ready { timer.invalidate() } }
}
app.run()
