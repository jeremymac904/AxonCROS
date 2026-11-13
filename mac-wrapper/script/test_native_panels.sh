#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-panel-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
clang -fobjc-arc -fblocks -framework AppKit -I "$root/Sources/NativePanelFactory/include" "$root/tests/NativePanelFactoryTests.m" -o "$test_dir/factory-test"
"$test_dir/factory-test"
swiftc "$root/Sources/BotHQ/NativePanelCompletion.swift" "$root/tests/NativePanelCompletionTests.swift" -o "$test_dir/completion-test"
"$test_dir/completion-test"
