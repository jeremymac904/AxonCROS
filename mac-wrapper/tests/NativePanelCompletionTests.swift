import Foundation
@main struct PanelCompletionTests {
    static func main() {
        var values: [String] = []
        let failed = NativePanelCompletion<String> { values.append($0) }
        assert(failed.settle("cancel"))
        assert(!failed.settle("late-success"))
        let retry = NativePanelCompletion<String> { values.append($0) }
        assert(retry.settle("retry-success"))
        assert(!failed.settle("late-failure"))
        assert(values == ["cancel", "retry-success"])
        var recursive: NativePanelCompletion<String>!
        var count = 0
        recursive = NativePanelCompletion { _ in count += 1; assert(!recursive.settle("recursive")) }
        assert(recursive.settle("cancel-before-OS-response"))
        assert(!recursive.settle("OS-cancel-response"))
        assert(count == 1)
        print("PASS: failed request releases once, next request succeeds, late/cancel/reentrant callbacks ignored")
        testTransitions()
    }
    static func testTransitions() {
        final class Clock {
            var time: TimeInterval = 0
            var jobs: [(TimeInterval, () -> Void)] = []
            func schedule(_ delay: TimeInterval, _ work: @escaping () -> Void) { jobs.append((time + delay, work)) }
            func next() { jobs.sort { $0.0 < $1.0 }; let job = jobs.removeFirst(); time = job.0; job.1() }
            func drain() { var count = 0; while !jobs.isEmpty { next(); count += 1; precondition(count < 300) } }
        }
        // Real AppKit ordering: completion fires while attachedSheet still points
        // at the old dialog, then removal happens on a later run-loop turn.
        for stage in ["helper → recovery", "recovery → path", "path → validation", "validation error → path", "recovery → retry"] {
            let clock = Clock(); var attached = true; var results: [Bool] = []
            NativeSheetTransition.wait(isCurrent: { true }, isDetached: { !attached }, now: { clock.time }, schedule: clock.schedule) { results.append($0) }
            assert(results.isEmpty) // Never invoke nested presentation on callback stack.
            clock.next(); assert(results.isEmpty)
            clock.schedule(0.05) { attached = false }
            clock.drain(); assert(results == [true]); assert(clock.time < 0.1)
            print("PASS: sheet detachment gates \(stage)")
        }
        do {
            let clock = Clock(); var current = true; var results: [Bool] = []
            NativeSheetTransition.wait(isCurrent: { current }, isDetached: { false }, now: { clock.time }, schedule: clock.schedule) { results.append($0) }
            clock.next(); current = false; clock.drain(); assert(results == [false])
            print("PASS: cancel/navigation invalidates pending sheet transition")
        }
        do {
            let clock = Clock(); var results: [Bool] = []
            NativeSheetTransition.wait(isCurrent: { true }, isDetached: { false }, now: { clock.time }, schedule: clock.schedule) { results.append($0) }
            clock.drain(); assert(results == [false]); assert(clock.time >= 2 && clock.time < 2.1)
            print("PASS: attached/replacement sheet fails closed at bounded deadline")
        }
        do {
            let clock = Clock(); var results: [Bool] = []
            NativeSheetTransition.wait(isCurrent: { true }, isDetached: { true }, now: { clock.time }, schedule: clock.schedule) { results.append($0) }
            assert(results.isEmpty); clock.drain(); assert(results == [true])
            print("PASS: already-detached sheet still leaves callback stack")
        }
    }

}
