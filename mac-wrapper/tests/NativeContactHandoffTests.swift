import Foundation

@main
struct NativeContactHandoffTests {
    static func main() {
        var checks = 0
        func check(_ raw: String, allowed: Bool, explicit: Bool = true, trusted: Bool = true) -> URL? {
            let result = NativeContactHandoff.validatedURL(URL(string: raw)!, explicitLink: explicit, trustedMainFrame: trusted)
            precondition((result != nil) == allowed, "Handoff validation mismatch")
            checks += 1
            return result
        }
        let mail = check("mailto:synthetic%2Btraining%40example.invalid?body=Hello%20%26%20goodbye%0ASecond%20line", allowed: true)!
        let mailParts = URLComponents(url: mail, resolvingAgainstBaseURL: false)!
        precondition(mailParts.path == "synthetic+training@example.invalid")
        precondition(mailParts.queryItems == [URLQueryItem(name: "body", value: "Hello & goodbye\nSecond line")])
        let sms = check("sms:%2B1%20%28904%29%20555-0100?body=Synthetic%20draft", allowed: true)!
        precondition(URLComponents(url: sms, resolvingAgainstBaseURL: false)!.path == "+19045550100")
        _ = check("tel:%2B19045550100", allowed: true)
        _ = check("mailto:synthetic@example.invalid", allowed: true)
        _ = check("mailto:synthetic@example.invalid?body=", allowed: true)
        for value in [
            "mailto:synthetic@example.invalid?bcc=other@example.invalid",
            "mailto:synthetic@example.invalid?body=ok&subject=extra",
            "mailto:synthetic@example.invalid?body=a&body=b",
            "mailto:synthetic@example.invalid?attach=/private/file",
            "mailto:synthetic@example.invalid%0D%0ABcc:other@example.invalid",
            "mailto:synthetic%250A@example.invalid",
            "mailto:one@example.invalid,two@example.invalid",
            "mailto://synthetic@example.invalid",
            "mailto:synthetic@example.invalid#fragment",
            "mailto:synthetic@example.invalid?body=line%0D%0ABcc:other@example.invalid",
            "mailto:synthetic@example.invalid?body=%250aBcc:other@example.invalid",
            "mailto:synthetic@example.invalid?body=%00",
            "sms:+19045550100,+19045550101",
            "sms:+19045550100?subject=hidden",
            "tel:+19045550100;123", "tel:*123%23", "tel:+19045550100?body=x",
            "tel:12", "tel:+123456789012345678901", "https://example.invalid", "file:///tmp/example",
            "tel:+19045550100%0A123", "sms:+19045550100?body=a&to=+19045550101", "mailto:synthetic%09@example.invalid"
        ] { _ = check(value, allowed: false) }
        _ = check("mailto:synthetic@example.invalid", allowed: false, explicit: false)
        _ = check("sms:+19045550100", allowed: false, trusted: false)
        _ = check("mailto:synthetic@example.invalid?body=" + String(repeating: "a", count: 12_001), allowed: false)
        print("PASS \(checks) contact-handoff URL decisions; no NSWorkspace, external app, message, call, permission or account used")
    }
}
