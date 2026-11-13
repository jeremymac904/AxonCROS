import AppKit
import AVFoundation
import Speech
import WebKit

/// A small, main-frame-only bridge. Audio never leaves this Mac through Speech:
/// recognition requires Apple's on-device model, with no cloud fallback.
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply, AVSpeechSynthesizerDelegate {
    weak var webView: WKWebView?
    let port: UInt16
    private let engine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private let store: NativeStore
    private let contacts = NativeContacts()
    private let connectorCredentials = NativeConnectorCredentials()
    private let googleContacts: NativeGoogleContacts
    private let googleWorkspace: NativeGoogleWorkspace
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var tapInstalled = false
    private var captureTimer: Timer?
    private var finishTimer: Timer?
    private var captureSession: String?
    private var pendingStart: NativePermissionRequest?
    private var captureState = "idle"
    private var transcript = ""
    private var speechSession: String?
    private var utterance: AVSpeechUtterance?
    var isCapturing: Bool { captureSession != nil }

    init(port: UInt16, store: NativeStore = NativeStore()) {
        self.port = port
        self.store = store
        self.googleContacts = NativeGoogleContacts(service: store.contactCredentialService)
        self.googleWorkspace = NativeGoogleWorkspace(service: store.contactCredentialService + ".workspace")
        super.init()
        synthesizer.delegate = self
    }

    private func trusted(_ frame: WKFrameInfo) -> Bool {
        frame.isMainFrame && frame.securityOrigin.protocol == "http"
            && frame.securityOrigin.host == "127.0.0.1" && frame.securityOrigin.port == Int(port)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard trusted(message.frameInfo), let body = message.body as? [String: Any],
              let action = body["action"] as? String else { replyHandler(nil, "Native controls are available only inside AxonCROS."); return }
        // Cleanup must remain available when the app server or login disappears.
        // These actions return no stored data and can only stop this app's work.
        if ["cancelDictation", "stopSpeaking", "cancelGoogleContactsAuth", "cancelGoogleWorkspaceAuth", "cancelGoogleActions"].contains(action) {
            var cleanup = body; cleanup["scope"] = "cleanup"
            dispatch(action, body: cleanup, owner: "cleanup", replyHandler: replyHandler)
            return
        }
        authenticatedOwner { [weak self] owner in
            guard let self else { replyHandler(nil, "The app window is unavailable."); return }
            guard let owner else {
                if action == "stopDictation", let id = self.captureSession { self.finishCapture(id, state: "cancelled") }
                replyHandler(nil, "Open and unlock AxonCROS before using native controls."); return
            }
            if let requested = body["scope"] as? String, requested != owner { replyHandler(nil, "This native operation belongs to another local session."); return }
            if action == "executeGoogleAction", body["expectedOwner"] as? String != owner { replyHandler(nil, "This action belongs to another local owner."); return }
            var owned = body; owned["scope"] = owner
            self.dispatch(action, body: owned, owner: owner, replyHandler: replyHandler)
        }
    }

    /// Resolve the owner through the real server using this WKWebView's cookie
    /// store, not a renderer-supplied ID or a renderer-overridable fetch result.
    func fileSelectionOwner(_ completion: @escaping (String?) -> Void) { authenticatedOwner(completion) }
    private func authenticatedOwner(_ completion: @escaping (String?) -> Void) {
        guard let webView else { completion(nil); return }
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self, let url = URL(string: "http://127.0.0.1:\(self.port)/api/auth/me") else { completion(nil); return }
            var request = URLRequest(url: url); request.timeoutInterval = 5
            let matching = cookies.filter { $0.domain == "127.0.0.1" && url.path.hasPrefix($0.path) && !$0.isSecure }
            request.allHTTPHeaderFields = HTTPCookie.requestHeaderFields(with: matching)
            let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.urlCache = nil
            let session = URLSession(configuration: config)
            session.dataTask(with: request) { data, response, _ in
                defer { session.finishTasksAndInvalidate() }
                let root = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                let user = root?["user"] as? [String: Any]
                let owner = (response as? HTTPURLResponse)?.statusCode == 200 ? user?["id"] as? String : nil
                DispatchQueue.main.async { completion(owner) }
            }.resume()
        }
    }
    @MainActor private func ensureOwner(_ owner: String) async throws {
        let current: String? = await withCheckedContinuation { continuation in authenticatedOwner { continuation.resume(returning: $0) } }
        guard current == owner else { throw NSError(domain: "AxonCROS.Session", code: 401) }
    }
    @MainActor private func ensureGoogleAction(_ body: [String: Any], owner: String) async throws {
        try await ensureOwner(owner)
        guard let webView, let id = body["requestId"] as? String, UUID(uuidString: id) != nil else { throw NSError(domain: "AxonCROS.Action", code: 400) }
        let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { continuation.resume(returning: $0) } }
        let url = URL(string: "http://127.0.0.1:\(port)/api/local/agent-actions/\(id)/execution")!
        var request = URLRequest(url: url); request.timeoutInterval = 5
        request.allHTTPHeaderFields = HTTPCookie.requestHeaderFields(with: cookies.filter { $0.domain == "127.0.0.1" && url.path.hasPrefix($0.path) && !$0.isSecure })
        let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.urlCache = nil
        let session = URLSession(configuration: config, delegate: NativeLocalNoRedirect(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 128_000,
              let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              NativeGoogleActions.matchesClaim(payload, body: body, owner: owner) else { throw NSError(domain: "AxonCROS.Action", code: 409) }
        try await ensureOwner(owner)
    }
    @MainActor private func provisionConnector(_ provider: String, owner: String, payload: [String: Any]) async throws -> [String: Any] {
        guard NativeConnectorCredentials.providers.contains(provider), let webView else { throw NSError(domain: "AxonCROS.Connector", code: 400) }
        try await ensureOwner(owner)
        let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { continuation.resume(returning: $0) } }
        let url = URL(string: "http://127.0.0.1:\(port)/api/local/connectors/\(provider)/credentials")!
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 20
        request.allHTTPHeaderFields = HTTPCookie.requestHeaderFields(with: cookies.filter { $0.domain == "127.0.0.1" && url.path.hasPrefix($0.path) && !$0.isSecure })
        request.setValue("http://127.0.0.1:\(port)", forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload.merging(["expectedOwner": owner]) { _, trusted in trusted })
        let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.urlCache = nil
        let session = URLSession(configuration: config, delegate: NativeLocalNoRedirect(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode), data.count < 65536,
              let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], let connector = result["connector"] as? [String: Any] else { throw NSError(domain: "AxonCROS.Connector", code: 502) }
        try await ensureOwner(owner)
        let safe = connector.filter { ["id", "name", "status", "connected", "configured", "dependency", "lastCheckedAt", "transport", "capabilities", "notice"].contains($0.key) }
        return ["connector": safe, "saved": true]
    }
    private func dispatch(_ action: String, body: [String: Any], owner: String, replyHandler: @escaping (Any?, String?) -> Void) {
        if action == "configureConnectorToken" {
            connectorCredentials.handle(provider: body["provider"] as? String ?? "", window: webView?.window, authorize: { [weak self] in
                guard let self else { throw NSError(domain: "AxonCROS.Session", code: 401) }; try await self.ensureOwner(owner)
            }, submit: { [weak self] payload in
                guard let self else { throw NSError(domain: "AxonCROS.Session", code: 401) }
                return try await self.provisionConnector(body["provider"] as? String ?? "", owner: owner, payload: payload)
            }, reply: replyHandler)
            return
        }

        if store.handles(action) { store.handle(action, body: body, window: webView?.window, authorize: { [weak self] in guard let self else { throw NSError(domain: "AxonCROS.Session", code: 401) }; try await self.ensureOwner(owner) }, reply: replyHandler); return }
        if contacts.handles(action) {
            contacts.handle(action, body: body, authorize: { [weak self] callback in
                DispatchQueue.main.async {
                    guard let self else { callback(false); return }
                    self.authenticatedOwner { callback($0 == owner) }
                }
            }, reply: replyHandler)
            return
        }
        if googleContacts.handles(action) {
            googleContacts.handle(action, body: body, window: webView?.window, authorize: { [weak self] in
                let current: String? = await withCheckedContinuation { continuation in
                    guard let self else { continuation.resume(returning: nil); return }
                    self.authenticatedOwner { continuation.resume(returning: $0) }
                }
                guard current == owner else { throw NSError(domain: "AxonCROS.Session", code: 401) }
            }, reply: replyHandler)
            return
        }
        if googleWorkspace.handles(action) {
            googleWorkspace.handle(action, body: body, window: webView?.window, authorize: { [weak self] in
                let current: String? = await withCheckedContinuation { continuation in
                    guard let self else { continuation.resume(returning: nil); return }
                    self.authenticatedOwner { continuation.resume(returning: $0) }
                }
                guard current == owner else { throw NSError(domain: "AxonCROS.Session", code: 401) }
                if action == "executeGoogleAction" {
                    guard let self else { throw NSError(domain: "AxonCROS.Session", code: 401) }
                    try await self.ensureGoogleAction(body, owner: owner)
                }
            }, reply: replyHandler)
            return
        }
        switch action {
        case "capabilities":
            let language = body["language"] as? String ?? "en-US"
            let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language))
            replyHandler(["native": true, "filePicker": true, "downloads": true, "secureStore": true, "folderGrants": true, "contacts": true, "googleWorkspace": true, "connectorCredentialPicker": true,
                          "dictation": recognizer?.supportsOnDeviceRecognition == true,
                          "dictationProvider": "Apple on-device Speech", "cloudFallback": false,
                          "microphonePermission": microphonePermission(),
                          "speechPermission": speechPermission(), "captureState": captureState,
                          "speechPlayback": true,
                          "voices": AVSpeechSynthesisVoice.speechVoices().map { ["id": $0.identifier, "name": $0.name, "language": $0.language] }], nil)
        case "startDictation":
            guard let id = validSession(body), captureSession == nil, !synthesizer.isSpeaking else {
                replyHandler(nil, "Finish the current audio session before starting dictation."); return
            }
            let language = body["language"] as? String ?? "en-US"
            guard language.count <= 40, let speech = SFSpeechRecognizer(locale: Locale(identifier: language)), speech.supportsOnDeviceRecognition else {
                replyHandler(nil, "On-device dictation is unavailable for this language. Install its speech resources in macOS Settings or choose another language. No cloud transcription was used."); return
            }
            captureSession = id; captureState = "authorizing"
            let pending = NativePermissionRequest(id: id, reply: replyHandler)
            pendingStart = pending
            let timeoutMessage = "Microphone or Speech permission did not finish within 60 seconds. Capture was cancelled. Review the macOS permission dialog or Privacy & Security settings, then start again."
            pending.armTimeout(after: 60, message: timeoutMessage) { [weak self] in
                guard let self, self.pendingStart === pending else { return }
                self.finishCapture(id, state: "error", message: timeoutMessage)
            }
            // Leave the WebKit callback before invoking an OS permission flow.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.captureSession == id, pending.isPending else { return }
                AVCaptureDevice.requestAccess(for: .audio) { [weak self] allowed in
                    DispatchQueue.main.async {
                        guard let self, self.captureSession == id, self.pendingStart === pending, pending.isPending else { return }
                        guard allowed else { self.finishCapture(id, state: "error", message: "Microphone access is denied. Enable AxonCROS in System Settings → Privacy & Security → Microphone."); return }
                        SFSpeechRecognizer.requestAuthorization { [weak self] authorization in
                            DispatchQueue.main.async {
                                guard let self, self.captureSession == id, self.pendingStart === pending, pending.isPending else { return }
                                guard authorization == .authorized else {
                                    self.finishCapture(id, state: "error", message: "Speech recognition access is denied. Enable AxonCROS in System Settings → Privacy & Security → Speech Recognition."); return
                                }
                                do {
                                    try self.beginCapture(id, recognizer: speech)
                                    self.pendingStart = nil
                                    pending.settle(["sessionId": id, "state": "recording"], nil)
                                } catch { self.finishCapture(id, state: "error", message: "The microphone could not start. Check the input device in macOS Sound settings.") }
                            }
                        }
                    }
                }
            }
        case "stopDictation":
            guard let id = validSession(body), captureSession == id else { replyHandler(nil, "This dictation session is no longer active."); return }
            stopCapture(id); replyHandler(["sessionId": id, "state": captureState], nil)
        case "cancelDictation":
            guard let id = validSession(body) else { replyHandler(nil, "A session ID is required."); return }
            if captureSession == id { finishCapture(id, state: "cancelled") }
            replyHandler(["sessionId": id, "state": "cancelled"], nil)
        case "speak":
            guard let id = validSession(body), let text = body["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  text.count <= 20_000, captureSession == nil else { replyHandler(nil, "Speech needs text of 1–20,000 characters and an idle microphone."); return }
            stopSpeech()
            let item = AVSpeechUtterance(string: text)
            if let voice = body["voice"] as? String {
                guard let selected = AVSpeechSynthesisVoice(identifier: voice) else { replyHandler(nil, "This system voice is unavailable."); return }
                item.voice = selected
            } else { item.voice = AVSpeechSynthesisVoice(language: body["language"] as? String ?? "en-US") }
            if let rate = body["rate"] as? Double, rate.isFinite { item.rate = Float(min(0.6, max(0.1, rate))) }
            speechSession = id; utterance = item
            synthesizer.speak(item); emit(["type": "speech", "sessionId": id, "state": "speaking"])
            replyHandler(["sessionId": id, "state": "speaking"], nil)
        case "stopSpeaking":
            if body["sessionId"] == nil || body["sessionId"] as? String == speechSession { stopSpeech() }
            replyHandler(["state": "stopped"], nil)
        default: replyHandler(nil, "This native operation is not supported.")
        }
    }

    private func validSession(_ body: [String: Any]) -> String? {
        guard let id = body["sessionId"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,96}$", options: .regularExpression) != nil else { return nil }
        return id
    }
    private func microphonePermission() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "notDetermined"
        }
    }
    private func speechPermission() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "notDetermined"
        }
    }
    private func beginCapture(_ id: String, recognizer: SFSpeechRecognizer) throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "AxonCROS.Audio", code: 1) }
        self.recognizer = recognizer
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        recognitionRequest = request; transcript = ""
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        tapInstalled = true
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.captureSession == id else { return }
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                    if result.isFinal { self.finishCapture(id, state: "complete"); return }
                    self.emit(["type": "dictation", "sessionId": id, "state": self.captureState, "text": self.transcript])
                }
                if error != nil { self.finishCapture(id, state: "error", message: "On-device speech recognition stopped. Check the microphone and installed language resources, then retry. No cloud fallback was used.") }
            }
        }
        engine.prepare(); try engine.start(); captureState = "recording"
        captureTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { [weak self] _ in self?.stopCapture(id) }
        emit(["type": "dictation", "sessionId": id, "state": "recording", "text": ""])
    }
    private func stopCapture(_ id: String) {
        guard captureSession == id else { return }
        if captureState == "authorizing" { finishCapture(id, state: "cancelled"); return }
        guard captureState == "recording" else { return }
        captureState = "transcribing"; stopInput(); recognitionRequest?.endAudio()
        emit(["type": "dictation", "sessionId": id, "state": "transcribing", "text": transcript])
        finishTimer = Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in
            guard let self, self.captureSession == id else { return }
            self.finishCapture(id, state: self.transcript.isEmpty ? "error" : "complete", message: self.transcript.isEmpty ? "No speech was recognized. Check the input device and try again." : nil)
        }
    }
    private func stopInput() {
        captureTimer?.invalidate(); captureTimer = nil
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }
    private func finishCapture(_ id: String, state: String, message: String? = nil) {
        guard captureSession == id else { return }
        let text = transcript
        captureSession = nil; captureState = "idle"
        if let pending = pendingStart, pending.id == id {
            pendingStart = nil
            pending.settle(nil, message ?? "Dictation was cancelled before capture started.")
        }
        finishTimer?.invalidate(); finishTimer = nil; stopInput()
        recognitionTask?.cancel(); recognitionTask = nil; recognitionRequest = nil; recognizer = nil; transcript = ""
        var event: [String: Any] = ["type": "dictation", "sessionId": id, "state": state]
        if state == "complete" { event["text"] = text }
        if let message { event["message"] = message }
        emit(event)
    }
    private func stopSpeech() {
        let old = speechSession
        speechSession = nil; utterance = nil; synthesizer.stopSpeaking(at: .immediate)
        if let old { emit(["type": "speech", "sessionId": old, "state": "cancelled"]) }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard self.utterance === utterance, let id = speechSession else { return }
        self.utterance = nil; speechSession = nil; emit(["type": "speech", "sessionId": id, "state": "complete"])
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        guard self.utterance === utterance, let id = speechSession else { return }
        self.utterance = nil; speechSession = nil; emit(["type": "speech", "sessionId": id, "state": "cancelled"])
    }
    func stopAll() {
        googleWorkspace.handle("cancelGoogleActions", body: ["scope": "cleanup"], window: nil) { _, _ in }
        if let id = captureSession { finishCapture(id, state: "cancelled") }
        stopSpeech()
    }
    func emit(_ event: [String: Any]) {
        guard let webView, let url = webView.url, url.scheme == "http", url.host == "127.0.0.1", url.port == Int(port) else { return }
        webView.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('axoncros:native', {detail: event}))", arguments: ["event": event], in: nil, in: .page, completionHandler: nil)
    }
}
