#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-contact-handoff-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc "$root/Sources/BotHQ/NativeContactHandoff.swift" "$root/tests/NativeContactHandoffTests.swift" -o "$test_dir/contact-handoff-test"
"$test_dir/contact-handoff-test"
