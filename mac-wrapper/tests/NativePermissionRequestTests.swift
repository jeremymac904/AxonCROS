import Foundation

@main
struct NativePermissionRequestTests {
    final class Clock {
        var action: (() -> Void)?
        var cancelled = false
        func schedule(_ seconds: TimeInterval, _ action: @escaping () -> Void) -> (() -> Void) {
            precondition(seconds == 60)
            self.action = action
            return { self.cancelled = true }
        }
        // Simulates a callback already queued before cancellation took effect.
        func fireEvenIfCancelled() { action?() }
    }
    static func main() {
        for outcome in ["success", "denial", "cancel", "navigation", "timeout"] {
            let clock = Clock()
            var replies = 0, timeouts = 0
            var error: String?
            let request = NativePermissionRequest(id: outcome) { _, message in replies += 1; error = message }
            request.armTimeout(after: 60, message: "Permission pending timeout", schedule: clock.schedule) { timeouts += 1 }
            if outcome == "timeout" { clock.fireEvenIfCancelled() }
            else { precondition(request.settle(outcome == "success" ? ["state":"recording"] : nil, outcome == "success" ? nil : "Capture cancelled or denied")) }
            precondition(replies == 1 && !request.isPending && clock.cancelled)
            precondition(timeouts == (outcome == "timeout" ? 1 : 0))
            precondition((error == nil) == (outcome == "success"))
            precondition(!request.settle(["state":"recording"], nil), "Late authorization must not revive a finished request")
            clock.fireEvenIfCancelled()
            precondition(replies == 1 && timeouts <= 1)
        }
        let oldClock = Clock(), newClock = Clock()
        var oldReplies = 0, newReplies = 0
        let old = NativePermissionRequest(id: "old") { _, _ in oldReplies += 1 }
        old.armTimeout(after: 60, message: "Timeout", schedule: oldClock.schedule) {}
        old.settle(nil, "Cancelled")
        let current = NativePermissionRequest(id: "current") { _, _ in newReplies += 1 }
        current.armTimeout(after: 60, message: "Timeout", schedule: newClock.schedule) {}
        oldClock.fireEvenIfCancelled()
        precondition(current.isPending && newReplies == 0 && oldReplies == 1)
        current.settle(["state":"recording"], nil)
        precondition(newReplies == 1)
        print("PASS: success, denial, cancel, navigation and timeout settle once; deferred callbacks cannot revive or cancel a newer request. No permissions or audio requested.")
    }
}
