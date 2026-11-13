#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-run}"
case "$mode" in run|--verify|--logs|--install-only) ;; *) echo "Usage: $0 [--verify|--logs|--install-only]" >&2; exit 2;; esac
export PATH="$HOME/.local/bin:$PATH"
support="$HOME/Library/Application Support/Bot HQ"
installed="$HOME/Applications/AxonCROS.app"
legacy="$HOME/Applications/Bot HQ.app"
# Quit only this wrapper, leaving Hermes and other applications alone.
if pgrep -x BotHQ >/dev/null; then
  if [[ "$mode" == --install-only ]]; then
    echo 'Quit AxonCROS before using --install-only.' >&2; exit 1
  fi
  osascript -e 'tell application id "local.bot-hq.desktop" to quit'
  for attempt in {1..30}; do pgrep -x BotHQ >/dev/null || break; sleep 0.2; done
  if pgrep -x BotHQ >/dev/null; then echo 'AxonCROS did not quit; build canceled.' >&2; exit 1; fi
fi
# A changed lockfile must not silently keep an older dependency tree.
lock_hash=$(shasum -a 256 bot-hq/package-lock.json | awk '{print $1}')
if [[ ! -f bot-hq/node_modules/.axoncros-lock-hash ]] || [[ "$(cat bot-hq/node_modules/.axoncros-lock-hash)" != "$lock_hash" ]]; then
  (cd bot-hq && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --prefer-offline --no-audit --no-fund)
  printf '%s\n' "$lock_hash" > bot-hq/node_modules/.axoncros-lock-hash
fi
(cd bot-hq && node server/scripts/build-profile-catalog.mjs --check && node server/scripts/build-research-catalog.mjs --check && npm run typecheck && npm run build)
bash mac-wrapper/script/build.sh
umask 077
mkdir -p "$support/backups" "$HOME/Applications"
stage=$(mktemp -d "$support/.build-stage.XXXXXX")
backup="$support/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$backup" "$stage/app/server" "$stage/app/web"
# Package explicit runtime paths, never a source .env, database or test output.
ditto bot-hq/node_modules "$stage/app/node_modules"
ditto bot-hq/server/dist "$stage/app/server/dist"
ditto bot-hq/web/dist "$stage/app/web/dist"
cp bot-hq/package.json bot-hq/package-lock.json bot-hq/LICENSE bot-hq/THIRD_PARTY_NOTICES.md "$stage/app/"
[[ ! -d bot-hq/LICENSES ]] || ditto bot-hq/LICENSES "$stage/app/LICENSES"
cp bot-hq/server/package.json "$stage/app/server/"
cp bot-hq/web/package.json "$stage/app/web/"
# Sign outside the iCloud/File Provider checkout; Finder metadata may reappear there.
ditto --norsrc --noextattr 'mac-wrapper/dist/AxonCROS.app' "$stage/AxonCROS.app"
xattr -cr "$stage/AxonCROS.app"
if [[ -d "$stage/AxonCROS.app/Contents/Helpers/AxonCROS File Picker.app" ]]; then
  codesign --force --sign - "$stage/AxonCROS.app/Contents/Helpers/AxonCROS File Picker.app"
fi
codesign --force --sign - "$stage/AxonCROS.app"
codesign --verify --deep --strict "$stage/AxonCROS.app"
[[ ! -f "$support/.env" ]] || cp -p "$support/.env" "$backup/config.env"
[[ ! -f "$support/server.log" ]] || cp -p "$support/server.log" "$backup/server.log"
# Preserve both installed artifacts for rollback; leave user data and gateway intact.
[[ ! -d "$support/app" ]] || mv "$support/app" "$backup/app"
if ! mv "$stage/app" "$support/app"; then
  [[ ! -d "$backup/app" ]] || mv "$backup/app" "$support/app"
  exit 1
fi
[[ ! -d "$installed" ]] || mv "$installed" "$backup/AxonCROS.app"
if ! mv "$stage/AxonCROS.app" "$installed"; then
  [[ ! -d "$backup/AxonCROS.app" ]] || mv "$backup/AxonCROS.app" "$installed"
  mv "$support/app" "$stage/app"
  [[ ! -d "$backup/app" ]] || mv "$backup/app" "$support/app"
  exit 1
fi
[[ ! -d "$legacy" ]] || mv "$legacy" "$backup/Bot HQ.app"
rmdir "$stage"
if [[ "$(git rev-parse --show-toplevel 2>/dev/null || true)" == "$PWD" ]]; then
  git rev-parse HEAD > "$support/installed-source-commit.txt"
elif [[ -f RELEASE_MANIFEST.json ]]; then
  node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("RELEASE_MANIFEST.json","utf8"));console.log(String(m.baseCommit||m.sourceCommit||"source-archive")+(m.dirtyWorktree?" (reviewed source changes)":""))' > "$support/installed-source-commit.txt"
else
  printf '%s\n' 'local-source-build (no Git or release manifest)' > "$support/installed-source-commit.txt"
fi
xattr -cr "$installed"
codesign --verify --deep --strict "$installed"
node script/setup-local.mjs
if [[ "$mode" != --install-only ]]; then open -n "$installed"; fi
if [[ "$mode" == --verify ]]; then
  sleep 2
  pgrep -x BotHQ >/dev/null
  echo 'Installed AxonCROS launched. Verify the window and local chat before acceptance.'
fi
printf 'Previous installation preserved at: %s\n' "$backup"
if [[ "$mode" == --logs ]]; then
  /usr/bin/log stream --info --style compact --predicate 'process == "BotHQ"'
fi
