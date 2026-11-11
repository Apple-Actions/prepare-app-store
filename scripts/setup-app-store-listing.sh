#!/usr/bin/env bash
# Populate App Store Connect listing metadata from store/listing.yml.
# Wrapper around dist/listing.js (built from src/listing-cli.ts).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LISTING_JS="$ROOT_DIR/dist/listing.js"

if [[ ! -f "$LISTING_JS" ]]; then
  echo "Missing $LISTING_JS — run 'yarn build' in $ROOT_DIR first." >&2
  exit 1
fi

exec node "$LISTING_JS" "$@"
