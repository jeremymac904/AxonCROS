import Foundation

/// Main-queue ownership for a pending permission request. OS authorization
/// callbacks can arrive after cancellation or timeout; only one can settle it.
final class NativePermissionRequest {
    typealias Scheduler = (TimeInterval, @escaping () -> Void) -> (() -> Void)
    let id: String
    private var reply: ((Any?, String?) -> Void)?
    private var cancelTimeout: (() -> Void)?
    var isPending: Bool { reply != nil }

    init(id: String, reply: @escaping (Any?, String?) -> Void) {
        self.id = id
        self.reply = reply
    }

    func armTimeout(after seconds: TimeInterval, message: String,
                    schedule: Scheduler = NativePermissionRequest.schedule,
                    onTimeout: @escaping () -> Void) {
        guard isPending else { return }
        cancelTimeout?()
        cancelTimeout = schedule(seconds) { [weak self] in
            guard let self, self.settle(nil, message) else { return }
            onTimeout()
        }
    }

    @discardableResult
    func settle(_ value: Any?, _ error: String?) -> Bool {
        guard let reply else { return false }
        self.reply = nil
        cancelTimeout?(); cancelTimeout = nil
        reply(value, error)
        return true
    }

    private static func schedule(_ seconds: TimeInterval, _ action: @escaping () -> Void) -> (() -> Void) {
        let work = DispatchWorkItem(block: action)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
        return { work.cancel() }
    }
}
