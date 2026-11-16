#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
node "$root/mac-wrapper/tests/tools-contract-check.mjs" "$@"
