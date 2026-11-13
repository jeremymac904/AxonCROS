#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-workspace-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/NativePanelFactory"
cp "$root/Sources/NativePanelFactory/include/NativePanelFactory.h" "$test_dir/NativePanelFactory/"
printf 'module NativePanelFactory { header "NativePanelFactory.h" export * }\n' > "$test_dir/NativePanelFactory/module.modulemap"
clang -fobjc-arc -fblocks -c -I "$root/Sources/NativePanelFactory/include" "$root/Sources/NativePanelFactory/NativePanelFactory.m" -o "$test_dir/panels.o"
swiftc -I "$test_dir" -framework AppKit -framework Security -framework Network \
 "$root/Sources/BotHQ/ContactSecrets.swift" "$root/Sources/BotHQ/ContactOAuthReceiver.swift" \
 "$root/Sources/BotHQ/NativeGoogleWorkspace.swift" "$root/Sources/BotHQ/NativeConnectorCredentials.swift" \
 "$root/Sources/BotHQ/NativePathSelection.swift" "$root/Sources/BotHQ/NativePickerProcess.swift" "$root/Sources/BotHQ/NativePanels.swift" "$root/Sources/BotHQ/NativePanelCompletion.swift" \
 "$root/tests/NativeWorkspaceTests.swift" "$test_dir/panels.o" -o "$test_dir/workspace-test"
"$test_dir/workspace-test"
