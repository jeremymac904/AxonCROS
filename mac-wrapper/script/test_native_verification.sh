#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-verification-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc "$root/Sources/BotHQ/NativeVerificationProfile.swift" "$root/tests/NativeVerificationProfileTests.swift" -o "$test_dir/verification-test"
"$test_dir/verification-test" "$@"
