#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-messages-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc -framework AppKit -framework Security -framework ApplicationServices \
 "$root/Sources/BotHQ/ContactSecrets.swift" "$root/Sources/BotHQ/NativeMessages.swift" \
 "$root/tests/NativeMessagesTests.swift" -o "$test_dir/messages-test"
"$test_dir/messages-test"
