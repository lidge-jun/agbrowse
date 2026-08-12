#!/bin/bash
# Vision-click QA loop against canvas-targets.html ground truth.
# Usage: bash test/fixtures/vision-qa/run-qa.sh
cd "$(dirname "$0")/../../.." || exit 1
BROWSER=skills/browser/browser.mjs
declare -a IDS=(play stop settings save tiny-x zoom-in zoom-out upload)
declare -a DESCS=(
  "green Play button"
  "red Stop button"
  "Settings gear icon"
  "blue Save draft button"
  "tiny purple x close button"
  "teal plus zoom-in button"
  "teal minus zoom-out button"
  "orange Upload file button"
)
pass=0; fail=0
for i in "${!IDS[@]}"; do
  id="${IDS[$i]}"; desc="${DESCS[$i]}"
  node "$BROWSER" evaluate "window.__lastHit=null" >/dev/null 2>&1
  out=$(node skills/vision-click/vision-click.mjs "$desc" --json < /dev/null 2>/dev/null)
  hit=$(node "$BROWSER" evaluate "JSON.stringify(window.__lastHit||null)" 2>/dev/null | python3 -c "import json,sys; v=json.loads(json.loads(sys.stdin.read())); print(v['hit'] if v else 'no-click')" 2>/dev/null)
  if [ "$hit" = "$id" ]; then
    echo "PASS  $id  <- \"$desc\""
    pass=$((pass+1))
  else
    echo "FAIL  $id  got=$hit  <- \"$desc\""
    fail=$((fail+1))
  fi
done
echo "---"
echo "result: $pass/$((pass+fail)) targets hit"
