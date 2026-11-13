import AppKit
import NativePanelFactory

/// Picker-to-loopback credential provisioning. Secret bytes never enter WebKit.
final class NativeConnectorCredentials {
    private var busy = false
    static let providers: Set<String> = ["withings", "plaid", "whatsapp"]
    static func validated(_ input: [String: Any], provider: String) throws -> [String: Any] {
        guard providers.contains(provider) else { throw Invalid.file }
        let fields = provider == "plaid" ? ["clientId", "clientSecret", "accessToken"] : provider == "whatsapp" ? ["accessToken", "phoneNumberId"] : ["accessToken"]
        var result: [String: Any] = [:]
        for field in fields {
            guard let value = input[field] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, value.count <= 8192 else { throw Invalid.file }
            result[field] = value
        }
        if provider == "plaid" { guard input["environment"] as? String == "sandbox" else { throw Invalid.file }; result["environment"] = "sandbox" }
        if provider == "whatsapp", let id = result["phoneNumberId"] as? String, id.range(of: "^[0-9]{5,40}$", options: .regularExpression) == nil { throw Invalid.file }
        return result
    }
    func handle(provider: String, window: NSWindow?, authorize: @escaping @MainActor () async throws -> Void, submit: @escaping @MainActor ([String: Any]) async throws -> [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard Self.providers.contains(provider), !busy, let window else { reply(nil, "Choose a supported connector and finish the current native picker first."); return }
        busy = true
        NativePanels.shared.present(for: window, request: NativePanelRequest(title: "Choose existing \(provider.capitalized) credentials", message: "Choose your existing connector JSON. Values go directly to this app’s private encrypted local store, never through chat or WebKit. No account is created and no provider call occurs.")) { [self] panel, result in
            Task { @MainActor in
                defer { busy = false }
                guard result == .OK, let url = panel?.url else { reply(["cancelled": true], nil); return }
                do {
                    try await authorize()
                    let attrs = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard attrs.isRegularFile == true, (attrs.fileSize ?? 32769) <= 32768 else { throw Invalid.file }
                    guard let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] else { throw Invalid.file }
                    let payload = try Self.validated(root, provider: provider)
                    let response = try await submit(payload)
                    try await authorize()
                    reply(response, nil)
                } catch is Invalid { reply(nil, "Invalid connector JSON. Required fields: \(provider == "plaid" ? "clientId, clientSecret, accessToken, environment: sandbox (production is blocked)" : provider == "whatsapp" ? "accessToken and numeric phoneNumberId" : "accessToken"). Choose an existing file under 32 KB; no settings changed.") }
                catch { reply(nil, "Connector credentials could not be saved. Check that the local app is unlocked and retry. No secret values were returned.") }
            }
        }
    }
    enum Invalid: Error { case file }
}
final class NativeLocalNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
