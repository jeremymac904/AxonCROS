#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-picker-tests.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc "$root/Sources/BotHQ/NativePickerProcess.swift" "$root/tests/NativePickerProcessTests.swift" -o "$test_dir/picker-tests"
"$test_dir/picker-tests"
