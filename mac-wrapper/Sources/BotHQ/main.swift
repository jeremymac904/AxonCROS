import NativePanelFactory
import AppKit
import WebKit
import Darwin
import Security

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var support: URL {
        if let profile = verificationProfile, profile.launchBundledRuntime { return profile.storage }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Bot HQ", isDirectory: true)
    }
    var port: UInt16 = 8787
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var log: FileHandle?
    var quitting = false
    var localTextMode = false
    var launchToken: String?
    let instanceID = UUID().uuidString
    var verificationProfile: NativeVerificationProfile?
    var verificationError = false
    private let verificationSession = URLSession(configuration: .ephemeral)
    lazy var nativeBridge: NativeBridge = {
        if let profile = verificationProfile {
            return NativeBridge(port: port, store: NativeStore(support: profile.storage, service: profile.keychainService, allowedFolderRoot: profile.root))
        }
        return NativeBridge(port: port)
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        do {
            verificationProfile = try NativeVerificationProfile.load(bundleID: Bundle.main.bundleIdentifier, info: Bundle.main.infoDictionary ?? [:])
            if let profile = verificationProfile { port = profile.port; localTextMode = true }
        } catch { verificationError = true }
        installMenus()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = verificationProfile != nil || verificationError ? .nonPersistent() : .default()
        config.preferences.tabFocusesLinks = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addScriptMessageHandler(nativeBridge, contentWorld: .page, name: "axoncros")
        web = WKWebView(frame: .zero, configuration: config)
        nativeBridge.webView = web
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 1000), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = verificationProfile != nil || verificationError ? "AxonCROS Verification" : "AxonCROS"
        window.minSize = NSSize(width: 760, height: 600)
        if let icon = Bundle.main.url(forResource: "AppIcon", withExtension: "icns") { NSApp.applicationIconImage = NSImage(contentsOf: icon) }
        window.center()
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        start()
    }

    func installMenus() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "AxonCROS")
        appMenu.addItem(withTitle: "About AxonCROS", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit AxonCROS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        menu.addItem(editItem)
        let viewItem = NSMenuItem()
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Back", action: #selector(goBack), keyEquivalent: "[")
        view.addItem(withTitle: "Forward", action: #selector(goForward), keyEquivalent: "]")
        viewItem.submenu = view
        menu.addItem(viewItem)
        NSApp.mainMenu = menu
    }

    @objc func goBack() { if web.canGoBack { nativeBridge.stopAll(); web.goBack() } }
    @objc func goForward() { if web.canGoForward { nativeBridge.stopAll(); web.goForward() } }

    func show(_ title: String, _ message: String) {
        func esc(_ s: String) -> String { s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;") }
        let html = """
        <!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:16px -apple-system,sans-serif;background:#f6f5f2;color:#222;padding:8%;line-height:1.6}main{max-width:760px;margin:auto;background:white;padding:32px;border-radius:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><main><h1>\(esc(title))</h1><pre>\(esc(message))</pre></main>
        """
        web.loadHTMLString(html, baseURL: nil)
    }

    func availablePort() -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        // Match Node's bind semantics: a recently closed connection in TIME_WAIT
        // must not look like a running server when the user immediately reopens.
        var reuse: Int32 = 1
        guard setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size)) == 0 else { return false }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr = in_addr(s_addr: in_addr_t(0x7f000001).bigEndian)
        return withUnsafePointer(to: &addr) { p in p.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 } }
    }

    func searchDirectories() -> [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let inherited = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        let candidates = inherited + ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        var seen = Set<String>()
        return candidates.filter { $0.hasPrefix("/") && seen.insert($0).inserted }
    }

    func findNode(in directories: [String]) -> String? {
        let fm = FileManager.default
        for directory in directories {
            let candidate = URL(fileURLWithPath: directory).appendingPathComponent("node").path
            guard fm.isExecutableFile(atPath: candidate) else { continue }
            let check = Process()
            check.executableURL = URL(fileURLWithPath: candidate)
            check.arguments = ["--version"]
            check.environment = ["HOME": fm.homeDirectoryForCurrentUser.path, "PATH": directories.joined(separator: ":")]
            let output = Pipe()
            check.standardOutput = output
            check.standardError = FileHandle.nullDevice
            do {
                try check.run()
                check.waitUntilExit()
                let version = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let major = Int(version.dropFirst().split(separator: ".").first ?? "")
                if check.terminationStatus == 0, version.hasPrefix("v"), let major, major >= 22 { return candidate }
            } catch { continue }
        }
        return nil
    }

    func start() {
        if verificationError {
            show("Verification profile rejected", "The isolated verification bundle requires its private, owned profile marker and matching loopback port. No installed configuration or data was opened.")
            return
        }
        if let profile = verificationProfile, !profile.launchBundledRuntime {
            show("AxonCROS isolated verification", "Connecting only to the task's synthetic loopback server. The installed app, configuration and database remain separate.")
            waitForVerification(profile, attempt: 0)
            return
        }
        let fm = FileManager.default
        let bundledRuntime = Bundle.main.resourceURL?.appendingPathComponent("runtime", isDirectory: true)
        let portable = bundledRuntime.map { fm.fileExists(atPath: $0.appendingPathComponent("server/dist/index.js").path) } ?? false
        if verificationProfile?.launchBundledRuntime == true && !portable {
            show("Verification runtime missing", "The isolated fresh-install check requires a bundled runtime. No installed app runtime or configuration was opened.")
            return
        }
        let app = portable ? bundledRuntime! : support.appendingPathComponent("app", isDirectory: true)
        let config = support.appendingPathComponent(".env")
        if portable {
            do { try LocalInstallation.createConfigurationIfMissing(support: support) }
            catch { show("Private setup could not finish", "Check permissions for \(support.path), then reopen AxonCROS. No existing configuration was replaced."); return }
        }
        guard fm.fileExists(atPath: config.path) else {
            show("Setup required", "Run the source installation command ./script/build_and_run.sh --verify to create a private local-model configuration. This uses a local Ollama runtime and requires no paid API account. Existing configurations are preserved.\n\nConfiguration path:\n\(config.path)")
            return
        }
        let bundledNode = Bundle.main.resourceURL?.appendingPathComponent("node/bin", isDirectory: true).path
        let directories = (portable ? bundledNode.map { [$0] } ?? [] : []) + searchDirectories()
        guard let node = findNode(in: directories) else {
            show("Node.js 22 or newer required", "Install Node.js 22 or newer in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin, or a directory on this app's PATH, then reopen AxonCROS.")
            return
        }
        guard fm.fileExists(atPath: app.appendingPathComponent("server/dist/index.js").path) else {
            show("Installation incomplete", "The built AxonCROS server is missing from \(app.path). Build and install the application, then reopen AxonCROS.")
            return
        }
        // Use Node's own dotenv parser so the setup check matches the server's configuration rules.
        do {
            let check = Process()
            check.executableURL = URL(fileURLWithPath: node)
            check.arguments = ["--env-file=\(config.path)", "-e", "const mode=process.env.BOT_HQ_MODE||'full'; const local=mode==='local-text'; const provider=process.env.AXON_MODEL_PROVIDER||'hermes'; const x=(local?['SESSION_SECRET','ALLOWED_EMAILS',...(provider!=='hermes'?[]:['HERMES_URL','HERMES_HOME_PRIMARY'])]:['XAI_API_KEY','COMPOSIO_API_KEY','SESSION_SECRET']).filter(k=>!process.env[k]?.trim()); if(!['full','local-text'].includes(mode)) x.push('valid BOT_HQ_MODE'); if(!['hermes','ollama-local','openai-local','codex-cli','openrouter'].includes(provider)) x.push('valid AXON_MODEL_PROVIDER'); if(!local&&!process.env.ORGO_API_KEY?.trim()&&!process.env.ORGO_API_KEY_FILE?.trim()) x.push('ORGO_API_KEY (or ORGO_API_KEY_FILE)'); console.log(JSON.stringify({mode,missing:x})); process.exit(x.length?1:0)"]
            check.environment = ["HOME": fm.homeDirectoryForCurrentUser.path, "PATH": "/usr/bin:/bin"]
            let output = Pipe()
            check.standardOutput = output
            check.standardError = Pipe()
            try check.run()
            check.waitUntilExit()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            if check.terminationStatus != 0 {
                let missing = (result?["missing"] as? [String])?.joined(separator: ", ") ?? ""
                show("Setup required", "Configuration is missing required values: \(missing.isEmpty ? "check .env syntax and permissions" : missing).\n\nEdit \(config.path) and reopen AxonCROS. To open it in TextEdit, run in Terminal:\n\nopen -e \"\(config.path)\"")
                return
            }
            guard let mode = result?["mode"] as? String, ["full", "local-text"].contains(mode) else {
                show("Could not read configuration", "The configuration check did not return a valid mode.")
                return
            }
            localTextMode = mode == "local-text"
            if localTextMode {
                var bytes = [UInt8](repeating: 0, count: 32)
                guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
                    show("Could not start securely", "Could not create the one-time local sign-in credential. Reopen AxonCROS.")
                    return
                }
                launchToken = bytes.map { String(format: "%02x", $0) }.joined()
            }
        } catch {
            show("Could not read configuration", "\(error.localizedDescription)\n\nCheck \(config.path) and reopen AxonCROS.")
            return
        }
        guard availablePort() else {
            show("Port \(port) is in use", "AxonCROS did not connect to the existing service. Stop that service and reopen AxonCROS.")
            return
        }
        do {
            try fm.createDirectory(at: support, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let logURL = support.appendingPathComponent("server.log")
            if !fm.fileExists(atPath: logURL.path) { _ = fm.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
            log = try FileHandle(forWritingTo: logURL)
            try log?.truncate(atOffset: 0)
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: node)
            proc.arguments = ["--env-file=\(config.path)", "dist/index.js"]
            proc.currentDirectoryURL = app.appendingPathComponent("server")
            var environment = ["HOME": fm.homeDirectoryForCurrentUser.path, "USER": NSUserName(), "TMPDIR": NSTemporaryDirectory(), "LANG": "en_US.UTF-8"]
            environment["PORT"] = String(port)
            environment["APP_URL"] = "http://127.0.0.1:\(port)"
            environment["SERVER_URL"] = "http://127.0.0.1:\(port)"
            environment["MCP_BASE_URL"] = "http://127.0.0.1:\(port)"
            environment["DB_PATH"] = support.appendingPathComponent(localTextMode ? "data/local-text.db" : "data/grokbot.db").path
            environment["ENGINES_DIR"] = support.appendingPathComponent("data/engines").path
            environment["HQ_LOCAL"] = "0"
            if localTextMode {
                environment["BOT_HQ_LAUNCH_TOKEN"] = launchToken
                environment["BOT_HQ_INSTANCE_ID"] = instanceID
                environment["GROKBOT_NO_SCHEDULER"] = "1"
            }
            let nodeDirectory = URL(fileURLWithPath: node).deletingLastPathComponent().path
            environment["PATH"] = ([nodeDirectory] + directories.filter { $0 != nodeDirectory }).joined(separator: ":")
            proc.environment = environment
            proc.standardOutput = log
            proc.standardError = log
            proc.terminationHandler = { [weak self] process in
                DispatchQueue.main.async {
                    guard let self, !self.quitting else { return }
                    self.show("AxonCROS server stopped", "The local server exited (status \(process.terminationStatus)). Check your configuration and the log at:\n\(logURL.path)\n\nReopen AxonCROS after correcting the issue.")
                }
            }
            try proc.run()
            server = proc
            show("Starting AxonCROS", "Starting the local server…")
            waitForServer(attempt: 0)
        } catch {
            show("Could not start AxonCROS", "\(error.localizedDescription)\n\nCheck installation and configuration, then reopen the app.")
        }
    }

    private func waitForVerification(_ profile: NativeVerificationProfile, attempt: Int) {
        guard !quitting else { return }
        guard attempt < 60 else {
            show("Verification server unavailable", "The expected isolated server did not return its matching instance identity. No fallback connection was made.")
            return
        }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(profile.port)/api/health")!)
        request.timeoutInterval = 0.5
        verificationSession.dataTask(with: request) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self, !self.quitting else { return }
                if let http = response as? HTTPURLResponse, http.statusCode == 200,
                   let data, let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                   body["ok"] as? Bool == true, body["mode"] as? String == "local-text",
                   ["hermes", "ollama-local", "openai-local", "codex-cli", "openrouter"].contains(body["engine"] as? String ?? ""), body["instanceId"] as? String == profile.instanceID {
                    var login = URLRequest(url: URL(string: "http://127.0.0.1:\(profile.port)/api/auth/local")!)
                    login.httpMethod = "POST"
                    login.setValue(profile.launchToken, forHTTPHeaderField: "X-BotHQ-Launch-Token")
                    login.setValue("http://127.0.0.1:\(profile.port)", forHTTPHeaderField: "Origin")
                    self.web.load(login)
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.waitForVerification(profile, attempt: attempt + 1) }
                }
            }
        }.resume()
    }

    func waitForServer(attempt: Int) {
        guard let server, server.isRunning else { return }
        guard attempt < 60 else {
            server.terminate()
            show("AxonCROS did not start", "The server did not become ready. Check server.log in \(support.path).")
            return
        }
        let url = URL(string: "http://127.0.0.1:\(port)/api/health")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.5
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self, let child = self.server, child.isRunning else { return }
                let started = (try? String(contentsOf: self.support.appendingPathComponent("server.log"), encoding: .utf8))?.contains("[grokbot] server on http://localhost:\(self.port)") == true
                if started, let http = response as? HTTPURLResponse, http.statusCode == 200,
                   let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], ["hermes", "ollama-local", "openai-local", "codex-cli", "openrouter"].contains(object["engine"] as? String ?? ""), object["ok"] as? Bool == true,
                   (!self.localTextMode || (object["mode"] as? String == "local-text" && object["instanceId"] as? String == self.instanceID)) {
                    if self.localTextMode, let token = self.launchToken {
                        var login = URLRequest(url: URL(string: "http://127.0.0.1:\(self.port)/api/auth/local")!)
                        login.httpMethod = "POST"
                        login.setValue(token, forHTTPHeaderField: "X-BotHQ-Launch-Token")
                        login.setValue("http://127.0.0.1:\(self.port)", forHTTPHeaderField: "Origin")
                        self.launchToken = nil
                        self.web.load(login)
                    } else {
                        self.web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(self.port)/")!))
                    }
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.waitForServer(attempt: attempt + 1) }
                }
            }
        }.resume()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    private func trusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "http" && url.host == "127.0.0.1" && url.port == Int(port)
    }
    private func trustedDialog(_ webView: WKWebView, frame: WKFrameInfo) -> Bool {
        frame.isMainFrame && frame.securityOrigin.protocol == "http"
            && frame.securityOrigin.host == "127.0.0.1" && frame.securityOrigin.port == Int(port)
            && trusted(webView.url)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard trustedDialog(webView, frame: frame) else { completionHandler(); return }
        NativePanels.shared.presentAlert(for: webView.window, create: {
            let alert = NSAlert()
            alert.messageText = "AxonCROS"
            alert.informativeText = String(message.prefix(2000))
            alert.addButton(withTitle: "OK")
            return alert
        }) { _, _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard trustedDialog(webView, frame: frame) else { completionHandler(false); return }
        NativePanels.shared.presentAlert(for: webView.window, create: {
            let alert = NSAlert()
            alert.messageText = "Confirm AxonCROS action"
            alert.informativeText = String(message.prefix(2000))
            let cancel = alert.addButton(withTitle: "Cancel")
            cancel.keyEquivalent = "\r"
            alert.addButton(withTitle: "Continue").keyEquivalent = ""
            alert.window.defaultButtonCell = cancel.cell as? NSButtonCell
            return alert
        }) { _, response in completionHandler(response == .alertSecondButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard trustedDialog(webView, frame: frame) else { completionHandler(nil); return }
        NativePanels.shared.presentAlert(for: webView.window, create: {
            let alert = NSAlert()
            alert.messageText = "Rename file in AxonCROS"
            alert.informativeText = String(prompt.prefix(2000))
            let cancel = alert.addButton(withTitle: "Cancel")
            cancel.keyEquivalent = "\r"
            alert.addButton(withTitle: "Rename").keyEquivalent = ""
            alert.window.defaultButtonCell = cancel.cell as? NSButtonCell
            let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
            field.stringValue = String((defaultText ?? "").prefix(240))
            alert.accessoryView = field
            alert.window.initialFirstResponder = field
            return alert
        }) { alert, response in
            completionHandler(response == .alertSecondButtonReturn ? (alert?.accessoryView as? NSTextField)?.stringValue : nil)
        }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard frame.isMainFrame, trusted(frame.request.url), trusted(webView.url) else { completionHandler(nil); return }
        nativeBridge.fileSelectionOwner { [weak self, weak webView] owner in
            guard let self, let webView, let owner, self.trusted(webView.url) else { completionHandler(nil); return }
            NativePanels.shared.present(for: webView.window, request: NativePanelRequest(title: "Attach files to AxonCROS", message: "Select up to 32 files.", multiple: parameters.allowsMultipleSelection)) { panel, response in
                guard response == .OK else { completionHandler(nil); return }
                self.nativeBridge.fileSelectionOwner { current in completionHandler(current == owner && self.trusted(webView.url) ? panel?.urls : nil) }
            }
        }
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard frame.isMainFrame, origin.protocol == "http", origin.host == "127.0.0.1", origin.port == Int(port),
              trusted(webView.url), type == .microphone, !nativeBridge.isCapturing else { decisionHandler(.deny); return }
        decisionHandler(.prompt)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let response = navigationResponse.response
        let disposition = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if trusted(response.url), (!navigationResponse.canShowMIMEType || disposition.lowercased().hasPrefix("attachment")) {
            decisionHandler(.download)
        } else { decisionHandler(.allow) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard localTextMode, let url = navigationAction.request.url else { decisionHandler(.allow); return }
        if trusted(url) || (url.scheme == "blob" && url.absoluteString.hasPrefix("blob:http://127.0.0.1:\(port)/") && navigationAction.shouldPerformDownload) {
            decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
            return
        }
        if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if NativeContactHandoff.schemes.contains(url.scheme?.lowercased() ?? "") {
            let explicitLink = navigationAction.navigationType == .linkActivated
            let trustedFrame = trustedDialog(webView, frame: navigationAction.sourceFrame)
            let handoff = NativeContactHandoff.validatedURL(url, explicitLink: explicitLink, trustedMainFrame: trustedFrame)
            decisionHandler(.cancel)
            guard explicitLink, trustedFrame else { return }
            guard let handoff else {
                contactHandoffFailure(webView, message: "This contact link could not be opened safely. Review the saved recipient and draft, then try again.")
                return
            }
            if handoff.scheme == "tel" {
                NativePanels.shared.presentAlert(for: webView.window, create: {
                    let alert = NSAlert()
                    alert.messageText = "Open phone app?"
                    let recipient = URLComponents(url: handoff, resolvingAgainstBaseURL: false)?.path ?? "the selected number"
                    alert.informativeText = "Open the phone app for \(recipient)? Depending on your phone app, this may start a call. AxonCROS will not mark the contact or tracker item complete."
                    let cancel = alert.addButton(withTitle: "Cancel")
                    cancel.keyEquivalent = "\r"
                    alert.addButton(withTitle: "Open phone app").keyEquivalent = ""
                    alert.window.defaultButtonCell = cancel.cell as? NSButtonCell
                    return alert
                }) { [weak self, weak webView] _, response in
                    guard response == .alertSecondButtonReturn, let self, let webView, self.trusted(webView.url) else { return }
                    self.openContactHandoff(handoff, webView: webView)
                }
            } else { openContactHandoff(handoff, webView: webView) }
            return
        }
        if navigationAction.navigationType == .linkActivated, ["https", "http"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }
    private func openContactHandoff(_ url: URL, webView: WKWebView) {
        if !NSWorkspace.shared.open(url) {
            contactHandoffFailure(webView, message: "No available app opened this contact link. Check your default email, messaging or phone app and try again. Nothing was marked sent or completed in AxonCROS.")
        }
    }
    private func contactHandoffFailure(_ webView: WKWebView, message: String) {
        NativePanels.shared.presentAlert(for: webView.window, create: {
            let alert = NSAlert()
            alert.messageText = "Contact app unavailable"
            alert.informativeText = message
            alert.addButton(withTitle: "OK")
            return alert
        }, completion: { _, _ in })
    }
    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        verificationSession.invalidateAndCancel()
        NativePanels.shared.cancel()
        nativeBridge.stopAll()
        if let server, server.isRunning { server.terminate() }
        try? log?.close()
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { NativePanels.shared.cancel(); nativeBridge.stopAll() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { NativePanels.shared.cancel(); nativeBridge.stopAll() }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard trusted(response.url) || (response.url?.absoluteString.hasPrefix("blob:http://127.0.0.1:\(port)/") == true) else { completionHandler(nil); return }
        nativeBridge.fileSelectionOwner { [weak self] owner in
            guard let self, let owner, self.trusted(self.web.url) else { completionHandler(nil); return }
            NativePanels.shared.present(for: self.web.window, request: NativePanelRequest(kind: "save", title: "Save from AxonCROS", suggestedName: URL(fileURLWithPath: suggestedFilename).lastPathComponent)) { panel, result in
                guard result == .OK else { completionHandler(nil); return }
                self.nativeBridge.fileSelectionOwner { current in completionHandler(current == owner && self.trusted(self.web.url) ? panel?.url : nil) }
            }
        }
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(trusted(request.url) ? .allow : .cancel)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        let alert = NSAlert()
        alert.messageText = "Download did not finish"
        alert.informativeText = "The file could not be saved. Check the destination and try again."
        alert.beginSheetModal(for: window)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
