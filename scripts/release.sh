#!/usr/bin/env bash
# release.sh — verify, version, tag, push, and publish agbrowse.
# Usage:
#   npm run release          -> first release keeps current version; later releases bump patch
#   npm run release -- minor -> minor bump
#   npm run release -- major -> major bump
#   npm run release -- 0.2.0 -> explicit version
set -euo pipefail

cd "$(dirname "$0")/.."

PACKAGE_NAME="agbrowse"
REPO_SLUG="lidge-jun/agbrowse"

echo "agbrowse release script"
echo "======================="

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean. Commit or stash changes before releasing."
  exit 1
fi

NPM_LATEST="$(npm view "$PACKAGE_NAME" dist-tags.latest 2>/dev/null || true)"
PKG_VERSION="$(node -p "require('./package.json').version")"

echo "npm latest:   ${NPM_LATEST:-'(not published)'}"
echo "package.json: $PKG_VERSION"

BUMP_ARG="${1:-}"

if [[ -z "$BUMP_ARG" ]]; then
  if [[ -z "$NPM_LATEST" ]]; then
    echo "First release: keeping package.json version $PKG_VERSION"
  else
    npm version patch --no-git-tag-version
  fi
elif [[ "$BUMP_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  npm version "$BUMP_ARG" --no-git-tag-version
else
  npm version "$BUMP_ARG" --no-git-tag-version
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"

echo "release version: $VERSION"

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
npm publish --dry-run --access public >/dev/null

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  git add package.json package-lock.json
  git commit -m "[agent] chore: release $TAG"
fi

echo "Creating tag $TAG..."
git tag "$TAG"

echo "Pushing branch and tag..."
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git push origin "$CURRENT_BRANCH"
git push origin "$TAG"

echo "Publishing to npm..."
if [[ "${AGBROWSE_PUBLISH_VIA_GITHUB:-0}" == "1" ]]; then
  gh workflow run release.yml --repo "$REPO_SLUG" --ref "$TAG" -f tag="$TAG"
  echo "Triggered GitHub Actions release workflow for $TAG."
else
  npm publish --access public
  echo "Creating GitHub release..."
  if command -v gh >/dev/null 2>&1; then
    gh release create "$TAG" \
      --repo "$REPO_SLUG" \
      --title "$TAG" \
      --generate-notes \
      --latest || true
  fi
fi

echo ""
echo "Published $PACKAGE_NAME@$VERSION"
echo "Install: npm install -g $PACKAGE_NAME"
echo "Repo:    https://github.com/$REPO_SLUG"
