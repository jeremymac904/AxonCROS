import Foundation

/// Main-thread owned. Clear before invoking callbacks so cancellation and late OS replies cannot settle twice.
final class NativePanelCompletion<Value> {
    private var completion: ((Value) -> Void)?
    init(_ completion: @escaping (Value) -> Void) { self.completion = completion }
    @discardableResult func settle(_ value: Value) -> Bool {
        guard let completion else { return false }
        self.completion = nil
        completion(value)
        return true
    }
}

/// AppKit can call a sheet's completion before removing it from attachedSheet.
/// Always leave that callback stack, then wait for actual detachment. Never
/// block the main thread or carry a cancelled request into a new sheet.
enum NativeSheetTransition {
    static func wait(isCurrent: @escaping () -> Bool, isDetached: @escaping () -> Bool,
                     now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
                     schedule: @escaping (TimeInterval, @escaping () -> Void) -> Void = { delay, work in DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work) },
                     completion: @escaping (Bool) -> Void) {
        let deadline = now() + 2
        let once = NativePanelCompletion<Bool>(completion)
        func check() {
            guard isCurrent() else { once.settle(false); return }
            if isDetached() { once.settle(true); return }
            guard now() < deadline else { once.settle(false); return }
            schedule(0.02, check)
        }
        schedule(0, check)
    }
}
