#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Xcode's SwiftPM build database can stall in an iCloud/File Provider checkout.
# Keep disposable compiler output local and private; the source stays in place.
build_root=$(mktemp -d "${TMPDIR:-/tmp}/axoncros-swift-build.XXXXXX")
trap 'rm -rf "$build_root"' EXIT
export CLANG_MODULE_CACHE_PATH="$build_root/clang-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$build_root/swift-cache"
swift build --disable-sandbox --scratch-path "$build_root" -c release
bin_path=$(swift build --disable-sandbox --scratch-path "$build_root" -c release --show-bin-path)
verification_build="${AXONCROS_VERIFICATION_BUILD:-0}"
if [[ "$verification_build" == "1" ]]; then
  : "${AXONCROS_VERIFICATION_ROOT:?Set the private task-created verification profile root}"
  [[ "${AXONCROS_VERIFICATION_PORT:-18885}" == "18885" ]] || { printf '%s\n' 'Verification requires loopback port 18885' >&2; exit 1; }
  bundle="$PWD/dist/AxonCROS Verification.app"
elif [[ "$verification_build" == "0" ]]; then
  bundle="$PWD/dist/AxonCROS.app"
else
  printf '%s\n' 'AXONCROS_VERIFICATION_BUILD must be 0 or 1' >&2
  exit 1
fi
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$bin_path/BotHQ" "$bundle/Contents/MacOS/BotHQ"
iconset="$build_root/AxonCROS.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" Resources/AxonCROS_Symbol.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" Resources/AxonCROS_Symbol.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$bundle/Contents/Resources/AppIcon.icns"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>BotHQ</string>
<key>CFBundleIdentifier</key><string>local.bot-hq.desktop</string>
<key>CFBundleName</key><string>AxonCROS</string>
<key>CFBundleDisplayName</key><string>AxonCROS</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleVersion</key><string>19</string>
<key>CFBundleShortVersionString</key><string>3.2.0</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>NSMicrophoneUsageDescription</key><string>AxonCROS uses the microphone only when you start dictation or a voice conversation.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>AxonCROS converts your speech to editable text using on-device recognition when you request dictation.</string>
<key>NSContactsUsageDescription</key><string>AxonCROS reads contacts you choose to synchronize from this Mac and applies only contact edits you explicitly review. Your AxonCROS notes remain local.</string>
</dict></plist>
PLIST
if [[ "$verification_build" == "1" ]]; then
  plutil -replace CFBundleIdentifier -string local.bot-hq.desktop.verification "$bundle/Contents/Info.plist"
  plutil -replace CFBundleName -string 'AxonCROS Verification' "$bundle/Contents/Info.plist"
  plutil -replace CFBundleDisplayName -string 'AxonCROS Verification' "$bundle/Contents/Info.plist"
  plutil -insert AXONCROSVerificationRoot -string "$AXONCROS_VERIFICATION_ROOT" "$bundle/Contents/Info.plist"
  plutil -insert AXONCROSVerificationPort -integer 18885 "$bundle/Contents/Info.plist"
fi
helper="$bundle/Contents/Helpers/AxonCROS File Picker.app"
mkdir -p "$helper/Contents/MacOS"
cp "$bin_path/NativeFilePicker" "$helper/Contents/MacOS/NativeFilePicker"
cat > "$helper/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>NativeFilePicker</string>
<key>CFBundleIdentifier</key><string>local.bot-hq.desktop.filepicker</string>
<key>CFBundleName</key><string>AxonCROS File Picker</string>
<key>CFBundleDisplayName</key><string>AxonCROS File Picker</string>
<key>CFBundleVersion</key><string>19</string>
<key>CFBundleShortVersionString</key><string>3.2.0</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
parent_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$bundle/Contents/Info.plist")
parent_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$bundle/Contents/Info.plist")
parent_build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$bundle/Contents/Info.plist")
plutil -replace CFBundleIdentifier -string "$parent_id.filepicker" "$helper/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$parent_version" "$helper/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$parent_build" "$helper/Contents/Info.plist"
printf '%s\n' "$bundle"
