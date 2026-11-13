import AppKit
import Contacts
import CryptoKit

/// Accesses only the Mac's authorized address book. No remote iPhone query,
/// contact-note entitlement, or implicit background read is involved.
final class NativeContacts {
    private let store = CNContactStore()
    private let queue = DispatchQueue(label: "AxonCROS.Contacts")
    private let keys: [CNKeyDescriptor] = [CNContactIdentifierKey, CNContactGivenNameKey,
        CNContactFamilyNameKey, CNContactOrganizationNameKey, CNContactPhoneNumbersKey,
        CNContactEmailAddressesKey] as [CNKeyDescriptor]
    private var lastReadAt: Double?
    private var proposals: [String: (String, String, [String: String], Date)] = [:]
    func handles(_ action: String) -> Bool {
        ["contactsStatus", "requestContactsAccess", "readContacts", "previewAppleContactUpdate", "applyAppleContactUpdate"].contains(action)
    }
    static func permission() -> String {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .notDetermined: return "notDetermined"
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "limited"
        }
    }
    private var permitted: Bool { ["granted", "limited"].contains(Self.permission()) }
    func status() -> [String: Any] {
        ["native": true, "permission": Self.permission(), "direction": "import-and-reviewed-updates",
         "lastReadAt": lastReadAt as Any? ?? NSNull(), "containers": [],
         "notice": "Mac Contacts only, including accounts already synchronized to this Mac. iPhone propagation is not verified. AxonCROS notes remain local."]
    }
    func handle(_ action: String, body: [String: Any], authorize: @escaping (@escaping (Bool) -> Void) -> Void = { $0(true) }, reply: @escaping (Any?, String?) -> Void) {
        if action == "contactsStatus" { reply(status(), nil); return }
        if action == "requestContactsAccess" {
            // This action is called only by an explicit labeled permission button.
            store.requestAccess(for: .contacts) { [weak self] _, _ in
                DispatchQueue.main.async { reply(self?.status(), nil) }
            }
            return
        }
        guard permitted else { reply(nil, "Mac Contacts access is not granted. Use Allow Mac Contacts, or import a vCard. If denied, review Privacy & Security → Contacts in System Settings."); return }
        queue.async { [self] in
            do {
                var output: [String: Any]
                switch action {
                case "readContacts":
                    let containers = try store.containers(matching: nil)
                    var records: [[String: Any]] = []
                    for container in containers {
                        let request = CNContactFetchRequest(keysToFetch: keys)
                        request.unifyResults = false
                        request.predicate = CNContact.predicateForContactsInContainer(withIdentifier: container.identifier)
                        try store.enumerateContacts(with: request) { contact, stop in
                            if records.count >= 10_000 { stop.pointee = true; return }
                            var item = Self.record(contact)
                            item["containerId"] = container.identifier; item["containerName"] = container.name
                            records.append(item)
                        }
                        if records.count >= 10_000 { throw ContactError.message("This address book exceeds 10,000 contacts. Export a selected vCard group for a bounded import; no contacts were committed.") }
                    }
                    let at = Date().timeIntervalSince1970 * 1000
                    output = ["contacts": records, "containers": containers.map { ["id": $0.identifier, "name": $0.name, "type": $0.type.rawValue] },
                              "lastReadAt": at, "direction": "import-and-reviewed-updates", "accountId": "mac-contact-store", "provider": "apple", "fullSnapshot": true]
                    DispatchQueue.main.async { self.lastReadAt = at }
                case "previewAppleContactUpdate":
                    guard let identifier = body["externalId"] as? String, identifier.count <= 500,
                          let expected = body["version"] as? String,
                          let patch = body["patch"] as? [String: String], !patch.isEmpty,
                          Set(patch.keys).isSubset(of: ["givenName", "familyName", "organization", "addPhone", "addEmail"]),
                          patch.values.allSatisfy({ $0.count <= 500 && !$0.contains("\u{0}") }) else { throw ContactError.message("Review a valid contact edit before applying it.") }
                    let contact = try exactContact(identifier)
                    let current = Self.record(contact)
                    guard current["version"] as? String == expected else { throw ContactError.message("The Apple contact changed. Read it again and review the current fields before updating.") }
                    let token = UUID().uuidString
                    proposals = proposals.filter { $0.value.3 > Date() }
                    proposals[token] = (identifier, expected, patch, Date().addingTimeInterval(300))
                    output = ["proposalId": token, "current": current, "patch": patch,
                              "notice": "Apply changes writes to Mac Contacts and may propagate through its configured account. Existing destinations and AxonCROS notes are preserved."]
                case "applyAppleContactUpdate":
                    let gate = DispatchSemaphore(value: 0)
                    var authorized = false
                    authorize { allowed in authorized = allowed; gate.signal() }
                    guard gate.wait(timeout: .now() + 6) == .success, authorized else { throw ContactError.message("The local session ended. Reopen AxonCROS and review the contact before updating.") }
                    guard let token = body["proposalId"] as? String, body["confirmed"] as? Bool == true,
                          let proposal = proposals.removeValue(forKey: token), proposal.3 > Date() else { throw ContactError.message("This reviewed edit expired or was already attempted. Read the contact and review again.") }
                    let contact = try exactContact(proposal.0)
                    guard Self.record(contact)["version"] as? String == proposal.1 else { throw ContactError.message("The Apple contact changed after review. Nothing was written. Refresh and review again.") }
                    let mutable = contact.mutableCopy() as! CNMutableContact
                    if let value = proposal.2["givenName"] { mutable.givenName = value }
                    if let value = proposal.2["familyName"] { mutable.familyName = value }
                    if let value = proposal.2["organization"] { mutable.organizationName = value }
                    if let value = proposal.2["addPhone"], !value.isEmpty,
                       !mutable.phoneNumbers.contains(where: { $0.value.stringValue == value }) {
                        mutable.phoneNumbers.append(CNLabeledValue(label: CNLabelOther, value: CNPhoneNumber(stringValue: value)))
                    }
                    if let value = proposal.2["addEmail"], !value.isEmpty,
                       !mutable.emailAddresses.contains(where: { ($0.value as String).lowercased() == value.lowercased() }) {
                        mutable.emailAddresses.append(CNLabeledValue(label: CNLabelOther, value: value as NSString))
                    }
                    let request = CNSaveRequest(); request.update(mutable); try store.execute(request)
                    let updated = try exactContact(proposal.0)
                    output = ["contact": Self.record(updated), "confirmed": true, "provider": "apple", "updatedAt": Date().timeIntervalSince1970 * 1000]
                default: throw ContactError.message("This Contacts action is unavailable.")
                }
                DispatchQueue.main.async {
                    authorize { allowed in
                        if allowed { reply(output, nil) }
                        else { reply(nil, "The local session ended. Reopen AxonCROS before viewing Contacts.") }
                    }
                }
            } catch let ContactError.message(message) { DispatchQueue.main.async { reply(nil, message) } }
            catch { DispatchQueue.main.async { reply(nil, "Mac Contacts could not complete this operation. Access may have changed or the account may be unavailable. Local contacts and notes were preserved.") } }
        }
    }
    private func exactContact(_ identifier: String) throws -> CNContact {
        let request = CNContactFetchRequest(keysToFetch: keys)
        request.unifyResults = false
        request.predicate = CNContact.predicateForContacts(withIdentifiers: [identifier])
        var found: CNContact?
        try store.enumerateContacts(with: request) { contact, stop in found = contact; stop.pointee = true }
        guard let found else { throw ContactError.message("This Mac contact is no longer available. Refresh its source; local notes remain.") }
        return found
    }
    static func record(_ c: CNContact) -> [String: Any] {
        let label: (String?) -> String = { $0.map { CNLabeledValue<NSString>.localizedString(forLabel: $0) } ?? "other" }
        var result: [String: Any] = ["externalId": c.identifier, "givenName": c.givenName, "familyName": c.familyName,
            "displayName": [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " "), "organization": c.organizationName,
            "phones": c.phoneNumbers.map { ["value": $0.value.stringValue, "label": label($0.label)] },
            "emails": c.emailAddresses.map { ["value": $0.value as String, "label": label($0.label)] }]
        if let bytes = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) {
            result["version"] = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        }
        return result
    }
    private enum ContactError: Error { case message(String) }
}
