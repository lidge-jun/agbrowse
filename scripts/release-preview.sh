#!/usr/bin/env bash
# release-preview.sh — verify, version, tag, push, and publish a preview build.
# Usage:
#   npm run release:preview
#   npm run release:preview -- 0.2.0
set -euo pipefail

cd "$(dirname "$0")/.."

PACKAGE_NAME="agbrowse"
REPO_SLUG="lidge-jun/agbrowse"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean. Commit or stash changes before releasing."
  exit 1
fi

NPM_LATEST="$(npm view "$PACKAGE_NAME" dist-tags.latest 2>/dev/null || true)"
PKG_VERSION="$(node -p "require('./package.json').version")"
RAW_VERSION="${NPM_LATEST:-$PKG_VERSION}"
RAW_VERSION="$(echo "$RAW_VERSION" | sed 's/-.*//')"

IFS='.' read -r MAJOR MINOR PATCH <<< "$RAW_VERSION"
BASE_VERSION="${1:-$MAJOR.$MINOR.$((PATCH + 1))}"
PREID="${PREID:-preview}"
STAMP="${STAMP:-$(date +%Y%m%d%H%M%S)}"
VERSION="$BASE_VERSION-$PREID.$STAMP"
TAG="v$VERSION"

if [[ ! "$BASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Base version must look like 0.2.0, got: $BASE_VERSION"
  exit 1
fi

echo "agbrowse preview release"
echo "========================"
echo "npm latest:      ${NPM_LATEST:-'(not published)'}"
echo "package.json:    $PKG_VERSION"
echo "preview version: $VERSION"

npm version "$VERSION" --no-git-tag-version

echo "Installing dependencies from lockfile..."
npm ci

echo "Auditing high-severity vulnerabilities..."
npm audit --audit-level=high

echo "Running tests..."
npm test
npm run test:mcp
npm run test:source-audit
npm run test:trace-policy

echo "Running structure documentation gates..."
npm run test:release-gates

echo "Running fixture evals..."
npm run test:eval-fixtures
npm run eval:web-ai:fixtures
npm run benchmark:trajectory -- --help >/dev/null

echo "Checking diff whitespace..."
git diff --check

echo "Verifying package contents..."
npm pack --dry-run >/dev/null
npm publish --dry-run --tag preview --access public >/dev/null

git add package.json package-lock.json
git commit -m "[agent] chore: preview release $TAG"
git tag "$TAG"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git push origin "$CURRENT_BRANCH"
git push origin "$TAG"

if [[ "${AGBROWSE_PUBLISH_VIA_GITHUB:-0}" == "1" ]]; then
  gh workflow run release.yml --repo "$REPO_SLUG" --ref "$TAG" -f tag="$TAG" -f npm_tag=preview
  echo "Triggered GitHub Actions preview release workflow for $TAG."
else
  TARBALL="$(npm pack | tail -1)"
  trap 'rm -f "$TARBALL"' EXIT
  npm publish "$TARBALL" --tag preview --access public
  if command -v gh >/dev/null 2>&1; then
    gh release create "$TAG" \
      --repo "$REPO_SLUG" \
      --title "$TAG (preview)" \
      --generate-notes \
      --prerelease || true
  fi
fi

echo ""
echo "Published preview $PACKAGE_NAME@$VERSION"
echo "Install: npm install -g $PACKAGE_NAME@preview"
