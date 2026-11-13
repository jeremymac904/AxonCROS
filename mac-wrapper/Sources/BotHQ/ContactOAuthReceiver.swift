import AppKit
import CryptoKit
import Network
import Security

/// One-use, random-state, loopback-only OAuth return. The system browser owns
/// Google sign-in; credentials never pass through the app's web renderer.
final class ContactOAuthReceiver {
    let state = UUID().uuidString + UUID().uuidString
    let verifier: String
    var challenge: String { Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded() }
    private var listener: NWListener?
    private var timer: Timer?
    private var ready: ((Result<URL, Error>) -> Void)?
    private var completion: ((Result<String, Error>) -> Void)?
    init() throws {
        var bytes = [UInt8](repeating: 0, count: 64)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw OAuthError.failed }
        verifier = Data(bytes).base64URLEncoded()
    }
    func start(onReady: @escaping (Result<URL, Error>) -> Void, completion: @escaping (Result<String, Error>) -> Void) throws {
        self.ready = onReady; self.completion = completion
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                if let port = listener.port, let url = URL(string: "http://127.0.0.1:\(port.rawValue)/oauth2/callback") {
                    let callback = self.ready; self.ready = nil; callback?(.success(url))
                }
            case .failed: self.finish(.failure(OAuthError.failed))
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            connection.start(queue: .main)
            self?.receive(connection, accumulated: Data())
        }
        timer = Timer.scheduledTimer(withTimeInterval: 180, repeats: false) { [weak self] _ in self?.finish(.failure(OAuthError.timedOut)) }
        listener.start(queue: .main)
    }
    func cancel() { finish(.failure(OAuthError.cancelled)) }
    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, done, error in
            guard let self else { connection.cancel(); return }
            var bytes = accumulated; if let data { bytes.append(data) }
            guard bytes.count <= 16_384, error == nil else { connection.cancel(); return }
            if !bytes.containsHTTPHeaderEnd && !done { self.receive(connection, accumulated: bytes); return }
            let line = String(data: bytes, encoding: .utf8)?.components(separatedBy: "\r\n").first ?? ""
            let pieces = line.split(separator: " ")
            var code: String?
            var denied = false
            if pieces.count == 3, pieces[0] == "GET", pieces[1].hasPrefix("/oauth2/callback?"),
               let components = URLComponents(string: "http://127.0.0.1" + pieces[1]),
               components.queryItems?.filter({ $0.name == "state" }).count == 1,
               components.queryItems?.first(where: { $0.name == "state" })?.value == self.state {
                code = components.queryItems?.first(where: { $0.name == "code" })?.value
                denied = components.queryItems?.contains(where: { $0.name == "error" }) == true
            }
            let valid = (code?.isEmpty == false) || denied
            let body = valid ? "<!doctype html><title>AxonCROS</title><p>Authorization returned. You can return to AxonCROS.</p>" : "Invalid or expired authorization return."
            let response = "HTTP/1.1 \(valid ? "200 OK" : "400 Bad Request")\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: \(body.utf8.count)\r\n\r\n\(body)"
            connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
            if denied { self.finish(.failure(OAuthError.denied)) }
            else if let code, !code.isEmpty { self.finish(.success(code)) }
        }
    }
    private func finish(_ result: Result<String, Error>) {
        timer?.invalidate(); timer = nil; listener?.cancel(); listener = nil
        if let ready { self.ready = nil; ready(.failure(OAuthError.failed)) }
        let callback = completion; completion = nil; callback?(result)
    }
    enum OAuthError: Error { case failed, cancelled, denied, timedOut }
}
extension Data {
    func base64URLEncoded() -> String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    fileprivate var containsHTTPHeaderEnd: Bool { range(of: Data("\r\n\r\n".utf8)) != nil }
}
