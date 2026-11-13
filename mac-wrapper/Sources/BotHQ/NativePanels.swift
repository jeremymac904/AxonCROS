import AppKit
import NativePanelFactory

/// Isolate the macOS remote file-panel service from the main app.
/// A bounded helper serves upload, download and folder selection alike.
final class NativePanels {
    static let shared = NativePanels()
    private var token: UUID?
    private var cancellationVersion = 0
    private var picker: NativePickerProcess?
    private var alert: NSAlert?
    private var cancelPanelRequest: (() -> Void)?

    func present(for window: NSWindow?, request configuration: NativePanelRequest,
                 completion: @escaping (NativePanelSelection?, NSApplication.ModalResponse) -> Void) {
        guard token == nil, let window, window.attachedSheet == nil, window.isVisible else { completion(nil, .cancel); return }
        let request = UUID(); token = request
        let generation = cancellationVersion
        let final = NativePanelCompletion<(NativePanelSelection?, NSApplication.ModalResponse)> { completion($0.0, $0.1) }
        let deliver: (NativePanelSelection?, NSApplication.ModalResponse) -> Void = { final.settle(($0, $1)) }
        let once = NativePanelCompletion<NativePickerOutcome> { [weak window] outcome in
            guard self.token == request else { return }
            self.cancelPanelRequest = nil; self.picker = nil
            let progress = self.alert
            if let progress, let parent = progress.window.sheetParent { parent.endSheet(progress.window, returnCode: .cancel) }
            NativeSheetTransition.wait(isCurrent: { self.token == request && self.cancellationVersion == generation && window?.isVisible == true },
                                       isDetached: { window?.attachedSheet == nil && progress?.window.sheetParent == nil }) { detached in
                guard self.token == request else { deliver(nil, .cancel); return }
                self.token = nil; self.alert = nil
                guard detached, let window else { deliver(nil, .cancel); return }
                NSApp.activate(ignoringOtherApps: true)
                switch outcome {
                case .selected(let urls): deliver(NativePanelSelection(urls: urls), .OK)
                case .cancelled: deliver(nil, .cancel)
                case .failed(let message):
                    self.offerRecovery(for: window, configuration: configuration, message: message, generation: generation, completion: deliver)
                }
            }
        }
        let helper = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/AxonCROS File Picker.app/Contents/MacOS/NativeFilePicker")
        let picker = NativePickerProcess(executable: helper) { outcome in once.settle(outcome) }
        self.picker = picker; cancelPanelRequest = { picker.cancel() }
        // This ordinary AppKit alert has no remote FileProvider dependency. Its
        // Cancel remains available even when the helper's OS panel is stuck.
        let progress = NSAlert(); self.alert = progress
        progress.messageText = "Opening macOS file chooser"
        progress.informativeText = "Choose your file in the separate AxonCROS File Picker window. If macOS cannot open it within 12 seconds, only that chooser is stopped. You can cancel here at any time."
        progress.addButton(withTitle: "Cancel file selection")
        progress.beginSheetModal(for: window) { _ in if self.token == request { picker.cancel() } }
        // No NSOpenPanel/NSSavePanel is ever constructed in this process.
        picker.start(configuration)
    }

    private func offerRecovery(for window: NSWindow, configuration: NativePanelRequest, message: String, generation: Int,
                               completion: @escaping (NativePanelSelection?, NSApplication.ModalResponse) -> Void) {
        guard generation == cancellationVersion else { completion(nil, .cancel); return }
        presentAlert(for: window, create: {
            let alert = NSAlert(); alert.messageText = "File chooser unavailable"
            alert.informativeText = message + " You can choose one local item by pasting its path in a native field instead. No file contents or credentials are entered in chat."
            alert.addButton(withTitle: "Choose by path")
            alert.addButton(withTitle: "Retry macOS chooser")
            alert.addButton(withTitle: "Cancel").keyEquivalent = "\u{1b}"
            return alert
        }) { _, response in
            guard generation == self.cancellationVersion else { completion(nil, .cancel); return }
            if response == .alertFirstButtonReturn { self.chooseByPath(for: window, configuration: configuration, generation: generation, completion: completion) }
            else if response == .alertSecondButtonReturn { self.present(for: window, request: configuration, completion: completion) }
            else { completion(nil, .cancel) }
        }
    }

    private func chooseByPath(for window: NSWindow, configuration: NativePanelRequest, generation: Int, value: String? = nil, error: String? = nil,
                              completion: @escaping (NativePanelSelection?, NSApplication.ModalResponse) -> Void) {
        guard generation == cancellationVersion else { completion(nil, .cancel); return }
        presentAlert(for: window, create: {
            let alert = NSAlert(); alert.messageText = configuration.kind == "save" ? "Choose a new save path" : "Choose local item by path"
            alert.informativeText = (error.map { $0 + "\n\n" } ?? "") + "The macOS chooser is unavailable. Paste one absolute path or ~/ path below. " + (configuration.kind == "save" ? "The parent folder must exist. Existing items will never be overwritten." : "The item must exist and be readable. This selects only the path you confirm.")
            let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 460, height: 26))
            field.stringValue = value ?? (configuration.kind == "save" ? "~/Downloads/" + configuration.suggestedName : "~/Downloads/")
            field.placeholderString = "~/Downloads/example.json"; field.setAccessibilityLabel("Local file path")
            alert.accessoryView = field; alert.window.initialFirstResponder = field
            alert.addButton(withTitle: configuration.kind == "save" ? "Use new save path" : "Select this path")
            alert.addButton(withTitle: "Cancel").keyEquivalent = "\u{1b}"
            return alert
        }) { alert, response in
            guard response == .alertFirstButtonReturn, generation == self.cancellationVersion, let text = (alert?.accessoryView as? NSTextField)?.stringValue else { completion(nil, .cancel); return }
            self.validatePath(for: window, configuration: configuration, generation: generation, value: text, completion: completion)
        }
    }

    private func validatePath(for window: NSWindow, configuration: NativePanelRequest, generation: Int, value: String,
                              completion: @escaping (NativePanelSelection?, NSApplication.ModalResponse) -> Void) {
        var result: Result<URL, Error>?, active = true
        var deadline: DispatchWorkItem?
        presentAlert(for: window, create: {
            let alert = NSAlert(); alert.messageText = "Checking local path"
            alert.informativeText = "Checking the selected item only. No contents are read and no files are changed."
            alert.addButton(withTitle: "Cancel").keyEquivalent = "\u{1b}"
            let settle: (Result<URL, Error>) -> Void = { outcome in
                guard active, result == nil else { return }; result = outcome; deadline?.cancel()
                if let parent = alert.window.sheetParent { parent.endSheet(alert.window, returnCode: .alertFirstButtonReturn) }
            }
            let timeout = DispatchWorkItem { settle(.failure(NativePathSelection.Rejection(text: "The path check took too long. Choose a downloaded local item; no selection was accepted."))) }
            deadline = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: timeout)
            DispatchQueue.global(qos: .userInitiated).async {
                let checked = Result { try NativePathSelection.validate(value, request: configuration) }
                DispatchQueue.main.async { settle(checked) }
            }
            return alert
        }) { _, response in
            active = false; deadline?.cancel()
            guard response == .alertFirstButtonReturn, generation == self.cancellationVersion, let result else { completion(nil, .cancel); return }
            switch result {
            case .success(let url): completion(NativePanelSelection(urls: [url]), .OK)
            case .failure(let error): self.chooseByPath(for: window, configuration: configuration, generation: generation, value: value, error: error.localizedDescription, completion: completion)
            }
        }
    }

    func presentAlert(for window: NSWindow?, create: @escaping () -> NSAlert,
                      completion: @escaping (NSAlert?, NSApplication.ModalResponse) -> Void) {
        guard token == nil, let window, window.attachedSheet == nil else { completion(nil, .cancel); return }
        let request = UUID()
        let generation = cancellationVersion
        token = request
        DispatchQueue.main.async { [weak window] in
            guard self.token == request else { completion(nil, .cancel); return }
            guard let window, window.isVisible, window.attachedSheet == nil else {
                self.token = nil; completion(nil, .cancel); return
            }
            let alert = create()
            self.alert = alert
            alert.beginSheetModal(for: window) { response in
                guard self.token == request else { completion(nil, .cancel); return }
                NativeSheetTransition.wait(isCurrent: { self.token == request && self.cancellationVersion == generation && window.isVisible },
                                           isDetached: { window.attachedSheet == nil && alert.window.sheetParent == nil }) { detached in
                    guard self.token == request else { completion(nil, .cancel); return }
                    self.token = nil; self.alert = nil
                    completion(detached ? alert : nil, detached ? response : .cancel)
                }
            }
        }
    }

    func cancel() {
        cancellationVersion += 1
        if let cancelPanelRequest {
            cancelPanelRequest()
        }
        else if let alert, let parent = alert.window.sheetParent { parent.endSheet(alert.window, returnCode: .cancel) }
        else { token = nil }
    }
}
