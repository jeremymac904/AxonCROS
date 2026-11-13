#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-first-run-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc "$root/Sources/BotHQ/LocalInstallation.swift" "$root/tests/LocalInstallationTests.swift" -o "$test_dir/first-run-test"
"$test_dir/first-run-test"
