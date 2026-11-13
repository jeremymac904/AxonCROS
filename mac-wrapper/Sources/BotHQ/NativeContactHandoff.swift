import Foundation

/// Only a user-activated link from the trusted main frame can hand off a single
/// recipient and an optional draft body. No commands, attachments or extra headers.
enum NativeContactHandoff {
    static let schemes: Set<String> = ["mailto", "sms", "tel"]

    static func validatedURL(_ url: URL, explicitLink: Bool, trustedMainFrame: Bool) -> URL? {
        guard explicitLink, trustedMainFrame,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = parts.scheme?.lowercased(), schemes.contains(scheme),
              parts.host == nil, parts.user == nil, parts.password == nil,
              parts.port == nil, parts.fragment == nil,
              url.absoluteString.utf8.count <= 150_000 else { return nil }
        let recipient = parts.path
        let destination: String
        if scheme == "mailto" {
            // Exactly one ordinary mailbox; no display names, recipient lists,
            // control characters, or percent-encoded second decoding layer.
            guard recipient.utf8.count <= 254,
                  recipient.range(of: "^[A-Za-z0-9.!#$&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$", options: .regularExpression) != nil else { return nil }
            destination = recipient
        } else {
            guard recipient.range(of: "^\\+?[0-9 ()\\.-]+$", options: .regularExpression) != nil else { return nil }
            destination = recipient.filter { $0 == "+" || $0.isNumber }
            let digits = destination.filter(\.isNumber).count
            guard digits >= 3, digits <= 20 else { return nil }
        }
        let query = parts.queryItems ?? []
        guard scheme != "tel" || query.isEmpty,
              query.count <= 1, query.allSatisfy({ $0.name == "body" && $0.value != nil }) else { return nil }
        if let body = query.first?.value {
            guard body.count <= 12_000,
                  !body.unicodeScalars.contains(where: { ($0.value < 32 && $0.value != 9 && $0.value != 10) || $0.value == 127 }),
                  body.range(of: "%0[ad]", options: [.regularExpression, .caseInsensitive]) == nil else { return nil }
        }
        // Reconstruct, ensuring body text stays within its single query value.
        var clean = URLComponents()
        clean.scheme = scheme
        clean.path = destination
        if !query.isEmpty { clean.queryItems = query }
        return clean.url
    }
}
