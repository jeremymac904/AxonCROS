#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-actions-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc -framework Foundation -framework Security -framework PDFKit \
 "$root/Sources/BotHQ/ContactSecrets.swift" "$root/Sources/BotHQ/NativeEmailSignature.swift" "$root/Sources/BotHQ/NativeGoogleActions.swift" \
 "$root/tests/NativeGoogleActionTests.swift" -o "$test_dir/actions-test"
"$test_dir/actions-test"
