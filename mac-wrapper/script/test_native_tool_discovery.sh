#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-tool-discovery-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
swiftc "$root/Sources/BotHQ/NativeToolDiscovery.swift" "$root/tests/NativeToolDiscoveryTests.swift" -o "$test_dir/tool-discovery-test"
"$test_dir/tool-discovery-test" "$@"
