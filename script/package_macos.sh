#!/bin/bash
# Build a standalone, ad-hoc-signed arm64 test candidate from validated source.
# Never installs, launches, notarizes, publishes or reads application-support data.
set -euo pipefail
[[ $# == 2 ]] || { echo 'Usage: package_macos.sh <extracted-sanitized-source> <outside-output-directory>' >&2; exit 2; }
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo 'This candidate builder supports Apple Silicon macOS only.' >&2; exit 2; }
source_dir=$(cd "$1" && pwd -P)
mkdir -p "$2"
output_dir=$(cd "$2" && pwd -P)
node_version=24.20.0
node_archive="node-v${node_version}-darwin-arm64.tar.gz"
# Pinned from the official version-specific SHASUMS256.txt, 2026-11-13.
node_sha=40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8
work=$(mktemp -d "${TMPDIR:-/tmp}/axoncros-package.XXXXXX")
trap 'rm -rf "$work"' EXIT
umask 077
python3 - "$source_dir" "$work/source" "$output_dir" <<'PY'
from pathlib import Path
import hashlib,json,shutil,sys
source,dest,out=map(lambda p:Path(p).resolve(),sys.argv[1:])
if out==source or source in out.parents: raise SystemExit('Output must be outside source.')
manifest=json.loads((source/'RELEASE_MANIFEST.json').read_text())
if manifest.get('edition')!='sanitized-local-source-candidate' or manifest.get('published') is not False:
    raise SystemExit('Expected an inspected sanitized source candidate.')
for name,meta in manifest['files'].items():
    path=source/name
    if Path(name).is_absolute() or '..' in Path(name).parts or path.is_symlink() or path.resolve()!=path:
        raise SystemExit('Unsafe source member: '+name)
    data=path.read_bytes()
    if len(data)!=meta['bytes'] or hashlib.sha256(data).hexdigest()!=meta['sha256']:
        raise SystemExit('Source hash mismatch: '+name)
    target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    if name.endswith(('.sh','.py')):target.chmod(0o755)
shutil.copyfile(source/'RELEASE_MANIFEST.json',dest/'RELEASE_MANIFEST.json')
PY
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --retry 2 \
  "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
grep -Fx "$node_sha  $node_archive" "$work/SHASUMS256.txt" >/dev/null || { echo 'Official Node checksum differs from reviewed pin.' >&2; exit 1; }
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --retry 2 \
  "https://nodejs.org/dist/v${node_version}/$node_archive" -o "$work/$node_archive"
printf '%s  %s\n' "$node_sha" "$work/$node_archive" | shasum -a 256 -c -
tar -xzf "$work/$node_archive" -C "$work"
node_root="$work/node-v${node_version}-darwin-arm64"
export PATH="$node_root/bin:/usr/bin:/bin:/usr/sbin:/sbin"
[[ "$(node --version)" == "v$node_version" ]] || exit 1
[[ "$(node -p process.arch)" == arm64 ]] || exit 1
cd "$work/source/bot-hq"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
npm run typecheck
npm run build
npm prune --omit=dev --ignore-scripts --no-audit --no-fund
node -e 'const D=require("better-sqlite3"); const d=new D(":memory:"); if(d.prepare("select 1 as n").get().n!==1)process.exit(1);d.close()'
cd "$work/source"
bash mac-wrapper/script/build.sh
app="$work/AxonCROS.app"
ditto --norsrc --noextattr 'mac-wrapper/dist/AxonCROS.app' "$app"
# Official Node24 arm64 targets macOS13.5; do not advertise an older binary floor.
plutil -replace LSMinimumSystemVersion -string 13.5 "$app/Contents/Info.plist"
runtime="$app/Contents/Resources/runtime"
mkdir -p "$runtime/server" "$runtime/web" "$app/Contents/Resources/node/bin" "$app/Contents/Resources/Legal"
ditto bot-hq/node_modules "$runtime/node_modules"
ditto bot-hq/server/dist "$runtime/server/dist"
ditto bot-hq/web/dist "$runtime/web/dist"
cp bot-hq/package.json bot-hq/package-lock.json "$runtime/"
cp bot-hq/server/package.json "$runtime/server/"
cp bot-hq/web/package.json "$runtime/web/"
cp "$node_root/bin/node" "$app/Contents/Resources/node/bin/node"
cp "$node_root/LICENSE" "$app/Contents/Resources/Legal/Node-LICENSE"
cp LICENSE ASSET_POLICY.md ARTWORK_LICENSE.md SECURITY.md RELEASE_MANIFEST.json "$app/Contents/Resources/Legal/"
cp LICENSES/CC-BY-4.0.txt "$app/Contents/Resources/Legal/"
cp bot-hq/LICENSE "$app/Contents/Resources/Legal/Upstream-Bot-HQ-LICENSE"
cp bot-hq/THIRD_PARTY_NOTICES.md "$app/Contents/Resources/Legal/"
python3 - "$runtime/package-lock.json" "$app/Contents/Resources/Legal/DEPENDENCY_INVENTORY.json" <<'PY'
import json,sys
from pathlib import Path
lock=json.loads(Path(sys.argv[1]).read_text())
items=[{'path':name,'version':meta.get('version'),'license':meta.get('license'),'devOnly':meta.get('dev',False)} for name,meta in lock.get('packages',{}).items() if name and not meta.get('link')]
Path(sys.argv[2]).write_text(json.dumps({'source':'npm lockfile; actual runtime pruned to production dependencies','packages':items},indent=2)+'\n')
PY
# Sign nested native addons and Node before signing the outer application.
while IFS= read -r -d '' native; do codesign --force --sign - "$native"; done < <(find "$runtime/node_modules" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)
codesign --force --sign - "$app/Contents/Resources/node/bin/node"
codesign --force --sign - "$app/Contents/Helpers/AxonCROS File Picker.app"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")
build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist")
zip="$output_dir/AxonCROS-${version}-${build}-macOS-arm64-unnotarized.zip"
[[ ! -e "$zip" ]] || { echo 'Candidate exists; use a new output directory.' >&2; exit 1; }
ditto -c -k --norsrc --noextattr --keepParent "$app" "$zip"
shasum -a 256 "$zip" > "$zip.sha256"
python3 - "$zip" "$version" "$build" "$node_version" "$node_sha" "$work/source/RELEASE_MANIFEST.json" <<'PY'
import hashlib,json,sys
from pathlib import Path
zip,version,build,node,node_sha,source=sys.argv[1:]
manifest=json.loads(Path(source).read_text())
receipt={'version':version,'build':build,'architecture':'arm64','minimumMacOS':'13.5','sourceCommit':manifest['baseCommit'],'dirtySource':manifest['dirtyWorktree'],'zip':Path(zip).name,'sha256':hashlib.sha256(Path(zip).read_bytes()).hexdigest(),'nodeVersion':node,'officialNodeArchiveSha256':node_sha,'nodeVerification':'Pinned SHA256 matched official HTTPS SHASUMS256 and downloaded archive; no PGP-signature claim','signing':'ad-hoc; codesign strict/deep verified','notarized':False,'installed':False,'launched':False,'published':False}
Path(zip+'.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
PY
