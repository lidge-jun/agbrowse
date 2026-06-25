#!/usr/bin/env bash
# release-preview.sh - compute a preview version and dispatch release.sh.
# Usage:
#   npm run release:preview
#   npm run release:preview -- 0.2.0
#   npm run release:preview -- --publish
#   PREID=rc STAMP=20260621040500 npm run release:preview -- 0.2.0 --publish
set -euo pipefail

cd "$(dirname "$0")/.."

PACKAGE_NAME="agbrowse"
BASE_VERSION=""
EXTRA_ARGS=()

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      cat <<'USAGE'
Usage:
  npm run release:preview [-- <base-version> [--publish]]

Creates <base-version>-preview.<timestamp> and dispatches release.yml with
npm dist-tag preview. Dry-run is the default.
USAGE
      exit 0
      ;;
    --publish)
      EXTRA_ARGS+=("--publish")
      ;;
    *)
      if [ -z "$BASE_VERSION" ]; then
        BASE_VERSION="$arg"
      else
        echo "Unexpected argument: $arg"
        exit 1
      fi
      ;;
  esac
done

NPM_LATEST="$(npm view "$PACKAGE_NAME" dist-tags.latest 2>/dev/null || true)"
PKG_VERSION="$(node -p "require('./package.json').version")"
RAW_VERSION="${NPM_LATEST:-$PKG_VERSION}"
RAW_VERSION="${RAW_VERSION%%-*}"

IFS='.' read -r MAJOR MINOR PATCH <<< "$RAW_VERSION"
BASE_VERSION="${BASE_VERSION:-$MAJOR.$MINOR.$((PATCH + 1))}"
PREID="${PREID:-preview}"
STAMP="${STAMP:-$(date +%Y%m%d%H%M%S)}"
VERSION="$BASE_VERSION-$PREID.$STAMP"

if [[ ! "$BASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Base version must look like 0.2.0, got: $BASE_VERSION"
  exit 1
fi

echo "agbrowse preview release"
echo "========================"
echo "npm latest:      ${NPM_LATEST:-'(not published)'}"
echo "package.json:    $PKG_VERSION"
echo "preview version: $VERSION"

if [ "${#EXTRA_ARGS[@]}" -gt 0 ]; then
  exec bash scripts/release.sh "$VERSION" --tag preview "${EXTRA_ARGS[@]}"
else
  exec bash scripts/release.sh "$VERSION" --tag preview
fi
