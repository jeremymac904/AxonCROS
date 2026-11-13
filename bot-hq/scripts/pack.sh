#!/usr/bin/env bash
# Build the app and pack what the computer needs to run it (no secrets, no node_modules).
# Usage: scripts/pack.sh [output.tgz]
# On the computer: scripts/install-on-computer.sh <the .tgz> does the rest (it is also inside the pack).
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-hq-app.tgz}"
rm -rf server/dist web/dist
npm run build
legal_stage=$(mktemp -d "${TMPDIR:-/tmp}/axoncros-legal.XXXXXX")
trap 'rm -rf "$legal_stage"' EXIT
mkdir -p "$legal_stage/Legal"
cp ../LICENSE "$legal_stage/Legal/AxonCROS-LICENSE"
cp ../ARTWORK_LICENSE.md ../ASSET_POLICY.md ../LICENSES/CC-BY-4.0.txt "$legal_stage/Legal/"
tar -czf "$out" \
  package.json package-lock.json .env.example LICENSE THIRD_PARTY_NOTICES.md \
  server/package.json server/dist server/box \
  web/package.json web/dist web/src/avatar/shapes.gen.ts \
  scripts/install-on-computer.sh scripts/add-hq-to-hermes.py scripts/sign-in-link.sh \
  -C "$legal_stage" Legal
echo "packed $(du -h "$out" | cut -f1) -> $out"
echo 'This is the legacy full-mode runtime package, not the sanitized local-Mac source release.'
echo 'For a redistribution candidate use: python3 ../script/prepare-source-release.py --output-dir <outside-checkout-directory>'
