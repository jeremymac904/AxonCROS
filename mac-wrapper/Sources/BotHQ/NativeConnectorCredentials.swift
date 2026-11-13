import AppKit
import NativePanelFactory

/// Picker-to-loopback credential provisioning. Secret bytes never enter WebKit.
final class NativeConnectorCredentials {
    private var busy = false
    static let providers: Set<String> = ["withings", "plaid", "whatsapp", "zapier", "buffer"]
    static func validated(_ input: [String: Any], provider: String) throws -> [String: Any] {
        guard providers.contains(provider) else { throw Invalid.file }
        let fields = ["zapier", "buffer"].contains(provider) ? ["connectionToken"] : provider == "plaid" ? ["clientId", "clientSecret", "accessToken"] : provider == "whatsapp" ? ["accessToken", "phoneNumberId"] : ["accessToken"]
        if ["zapier", "buffer"].contains(provider), Set(input.keys) != Set(["connectionToken"]) { throw Invalid.file }
        var result: [String: Any] = [:]
        for field in fields {
            guard let value = input[field] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, value.utf8.count <= 8192, !value.unicodeScalars.contains(where: { $0.value == 0 || $0.value == 10 || $0.value == 13 }) else { throw Invalid.file }
            if field == "connectionToken" {
                // RFC 6750 b64token. Reject masked UI text before native submission
                // or encrypted storage; never include credential bytes in errors.
                guard value.utf8.count >= 8, value.range(of: "\\A[A-Za-z0-9._~+/-]+=*\\z", options: .regularExpression) != nil else { throw Invalid.bearer }
            }
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
                } catch Invalid.bearer { reply(nil, "Choose the actual existing API or connection token using the provider’s Copy or Reveal control, not its masked display. Only an ASCII bearer token is accepted; no settings changed.") }
                catch is Invalid { reply(nil, "Invalid connector JSON. Required fields: \(["zapier", "buffer"].contains(provider) ? "connectionToken only (no server URL)" : provider == "plaid" ? "clientId, clientSecret, accessToken, environment: sandbox (production is blocked)" : provider == "whatsapp" ? "accessToken and numeric phoneNumberId" : "accessToken"). Choose an existing file under 32 KB; no settings changed.") }
                catch { reply(nil, "Connector credentials could not be saved. Check that the local app is unlocked and retry. No secret values were returned.") }
            }
        }
    }
    enum Invalid: Error { case file, bearer }
}
final class NativeLocalNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
