#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-permission-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc "$root/Sources/BotHQ/NativePermissionRequest.swift" "$root/tests/NativePermissionRequestTests.swift" -o "$test_dir/permission-test"
"$test_dir/permission-test"
