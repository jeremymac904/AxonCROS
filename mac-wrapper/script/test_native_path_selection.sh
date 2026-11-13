#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-path-tests.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc "$root/Sources/BotHQ/NativePickerProcess.swift" "$root/Sources/BotHQ/NativePathSelection.swift" "$root/tests/NativePathSelectionTests.swift" -o "$test_dir/path-tests"
"$test_dir/path-tests"
