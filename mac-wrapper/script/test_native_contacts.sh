#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/axoncros-contacts-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/NativePanelFactory"
cp "$root/Sources/NativePanelFactory/include/NativePanelFactory.h" "$test_dir/NativePanelFactory/"
cat > "$test_dir/NativePanelFactory/module.modulemap" <<'MAP'
module NativePanelFactory { header "NativePanelFactory.h" export * }
MAP
clang -fobjc-arc -fblocks -c -I "$root/Sources/NativePanelFactory/include" "$root/Sources/NativePanelFactory/NativePanelFactory.m" -o "$test_dir/panels.o"
swiftc -I "$test_dir" -framework AppKit -framework Contacts -framework Security -framework Network \
  "$root/Sources/BotHQ/ContactSecrets.swift" "$root/Sources/BotHQ/ContactOAuthReceiver.swift" \
  "$root/Sources/BotHQ/NativeContacts.swift" "$root/Sources/BotHQ/NativeGoogleContacts.swift" \
  "$root/Sources/BotHQ/NativePathSelection.swift" "$root/Sources/BotHQ/NativePickerProcess.swift" "$root/Sources/BotHQ/NativePanels.swift" "$root/Sources/BotHQ/NativePanelCompletion.swift" \
  "$root/tests/NativeContactsTests.swift" "$test_dir/panels.o" -o "$test_dir/contacts-test"
"$test_dir/contacts-test"
