#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-signature-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc -framework Foundation "$root/Sources/BotHQ/NativeEmailSignature.swift" "$root/tests/NativeEmailSignatureTests.swift" -o "$test_dir/signature-test"
"$test_dir/signature-test"
