import Foundation
import CryptoKit
import Darwin

/// Private, fixed-directory signature package. No renderer URL/path or model HTML.
/// Public source contains neither sender identity nor signature artwork.
struct NativeEmailSignature {
    struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }
    struct Asset: Decodable { let file: String; let cid: String; let mimeType: String; let sha256: String }
    struct Manifest: Decodable {
        let version: Int; let senderEmail: String; let htmlFile: String; let textFile: String
        let htmlSHA256: String; let textSHA256: String; let assets: [Asset]
    }
    let html: String
    let text: String
    let assets: [(Asset, Data)]
    static let maxAssetBytes = 4 * 1024 * 1024
    static let maxPackageBytes = 8 * 1024 * 1024
    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private static func fail() -> Failure { Failure(message: "The configured email signature is missing, changed or unsafe. Restore its approved local package before sending; no email was sent.") }
    private static func fileName(_ value: String) -> Bool { value.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", options: .regularExpression) != nil && !value.contains("..") }
    private static func read(_ directory: Int32, _ name: String, limit: Int) throws -> Data {
        guard fileName(name) else { throw fail() }
        let fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw fail() }; defer { close(fd) }
        var info = stat(); guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
            info.st_uid == getuid(), info.st_nlink == 1, info.st_mode & 0o022 == 0,
            info.st_size >= 0, info.st_size <= limit else { throw fail() }
        var result = Data(), buffer = [UInt8](repeating: 0, count: 16384)
        while true {
            let count = Darwin.read(fd, &buffer, buffer.count)
            guard count >= 0 else { throw fail() }; if count == 0 { break }
            guard result.count + count <= limit else { throw fail() }; result.append(buffer, count: count)
        }
        return result
    }
    static func load(directory: URL?, senderEmail: String?) throws -> NativeEmailSignature? {
        guard let directory else { return nil }
        var metadata = stat()
        if lstat(directory.path, &metadata) != 0 {
            if errno == ENOENT { return nil }; throw fail()
        }
        guard metadata.st_mode & S_IFMT == S_IFDIR, metadata.st_uid == getuid(), metadata.st_mode & 0o077 == 0 else { throw fail() }
        // Walk every path component without following symlinks, not just the leaf.
        var fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard fd >= 0, directory.isFileURL, directory.path.hasPrefix("/") else { if fd >= 0 { close(fd) }; throw fail() }
        for component in directory.path.split(separator: "/") {
            let next = openat(fd, String(component), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            close(fd); guard next >= 0 else { throw fail() }; fd = next
        }
        defer { close(fd) }
        let manifest: Manifest
        do { manifest = try JSONDecoder().decode(Manifest.self, from: read(fd, "manifest.json", limit: 32768)) } catch { throw fail() }
        guard manifest.version == 1, !manifest.senderEmail.isEmpty, !manifest.senderEmail.unicodeScalars.contains(where: { $0.value == 10 || $0.value == 13 }) else { throw fail() }
        guard senderEmail?.caseInsensitiveCompare(manifest.senderEmail) == .orderedSame else { return nil }
        guard manifest.assets.count == 12, Set(manifest.assets.map(\.cid)).count == 12,
            Set(manifest.assets.map(\.file)).count == 12, manifest.htmlFile.hasSuffix(".html"), manifest.textFile.hasSuffix(".txt") else { throw fail() }
        let htmlBytes = try read(fd, manifest.htmlFile, limit: 100_000), textBytes = try read(fd, manifest.textFile, limit: 40_000)
        guard digest(htmlBytes) == manifest.htmlSHA256, digest(textBytes) == manifest.textSHA256,
            let html = String(data: htmlBytes, encoding: .utf8), let text = String(data: textBytes, encoding: .utf8), !html.isEmpty, !text.isEmpty else { throw fail() }
        // HTML is pinned by local manifest. Reject active content and remote image
        // sources even if a locally edited manifest tries to bless new bytes.
        guard html.range(of: "<\\s*(script|iframe|object|embed|form|link|base|svg|video|audio)\\b|\\bon[a-z]+\\s*=|javascript\\s*:|url\\s*\\(", options: [.regularExpression, .caseInsensitive]) == nil else { throw fail() }
        let tags = try NSRegularExpression(pattern: "</?([A-Za-z][A-Za-z0-9]*)\\b")
        let allowedTags = Set(["p", "table", "tr", "td", "img", "div", "a", "br", "span"])
        guard tags.matches(in: html, range: NSRange(html.startIndex..., in: html)).allSatisfy({ match in
            guard let range = Range(match.range(at: 1), in: html) else { return false }; return allowedTags.contains(html[range].lowercased())
        }), html.range(of: "\\bsrcset\\s*=|\\bbackground\\s*=|@import", options: [.regularExpression, .caseInsensitive]) == nil else { throw fail() }
        let imagePattern = try NSRegularExpression(pattern: "<img\\b[^>]*>", options: .caseInsensitive)
        let imageTags = imagePattern.matches(in: html, range: NSRange(html.startIndex..., in: html)).compactMap { Range($0.range, in: html).map { String(html[$0]) } }
        let sourcePattern = try NSRegularExpression(pattern: "\\bsrc\\s*=\\s*[\"']([^\"']+)[\"']", options: .caseInsensitive)
        let references = sourcePattern.matches(in: html, range: NSRange(html.startIndex..., in: html)).compactMap { match in Range(match.range(at: 1), in: html).map { String(html[$0]) } }
        guard imageTags.count == 12, imageTags.allSatisfy({ sourcePattern.numberOfMatches(in: $0, range: NSRange($0.startIndex..., in: $0)) == 1 }), references.count == 12, Set(references) == Set(manifest.assets.map { "cid:" + $0.cid }) else { throw fail() }
        var total = htmlBytes.count + textBytes.count, loaded: [(Asset, Data)] = []
        for asset in manifest.assets {
            guard asset.cid.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil,
                ["image/png", "image/jpeg", "image/gif"].contains(asset.mimeType) else { throw fail() }
            let bytes = try read(fd, asset.file, limit: maxAssetBytes)
            guard !bytes.isEmpty, digest(bytes) == asset.sha256 else { throw fail() }
            let validHeader = asset.mimeType == "image/png" ? bytes.starts(with: [137,80,78,71,13,10,26,10]) : asset.mimeType == "image/jpeg" ? bytes.starts(with: [255,216,255]) : bytes.starts(with: Data("GIF87a".utf8)) || bytes.starts(with: Data("GIF89a".utf8))
            guard validHeader else { throw fail() }; total += bytes.count; guard total <= maxPackageBytes else { throw fail() }
            loaded.append((asset, bytes))
        }
        return NativeEmailSignature(html: html, text: text, assets: loaded)
    }
    static func base64(_ bytes: Data) -> String { bytes.base64EncodedString(options: [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed]) }
    static func escapedHTML(_ text: String) -> String { text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&#39;") }
    static func encodedSubject(_ text: String) -> String {
        var pieces: [String] = [], current = ""
        for character in text { let next = String(character); if !current.isEmpty && (current + next).utf8.count > 42 { pieces.append(current); current = "" }; current += next }
        if !current.isEmpty { pieces.append(current) }
        return pieces.map { "=?UTF-8?B?" + Data($0.utf8).base64EncodedString() + "?=" }.joined(separator: "\r\n ")
    }
    /// Returns MIME headers/body; the caller owns only validated address headers.
    static func mime(body: String, signature: NativeEmailSignature?) -> String {
        guard let signature else { return "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + base64(Data(body.utf8)) }
        let related = "axon-related-" + UUID().uuidString, alternative = "axon-alt-" + UUID().uuidString
        let plain = body + "\n\n\n" + signature.text
        let html = "<div style=\"white-space:pre-wrap;\">" + escapedHTML(body) + "</div>\n<br><br>\n" + signature.html
        var result = "Content-Type: multipart/related; boundary=\"\(related)\"\r\n\r\n--\(related)\r\nContent-Type: multipart/alternative; boundary=\"\(alternative)\"\r\n\r\n"
        for (mime, content) in [("text/plain", plain), ("text/html", html)] {
            result += "--\(alternative)\r\nContent-Type: \(mime); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + base64(Data(content.utf8)) + "\r\n"
        }
        result += "--\(alternative)--\r\n"
        for (asset, bytes) in signature.assets {
            result += "--\(related)\r\nContent-Type: \(asset.mimeType); name=\"\(asset.file)\"\r\nContent-ID: <\(asset.cid)>\r\nContent-Disposition: inline; filename=\"\(asset.file)\"\r\nContent-Transfer-Encoding: base64\r\n\r\n" + base64(bytes) + "\r\n"
        }
        return result + "--\(related)--\r\n"
    }
}
