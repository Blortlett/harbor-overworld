#!/usr/bin/env bash
set -euo pipefail

artifacts=$(realpath "${1:?release directory}")
repo=${GITHUB_REPOSITORY:?}
commit=${GITHUB_SHA:?}
app=$(cd "$(dirname "$0")/.." && pwd)
version=$(node -p 'require(process.argv[1]).version' "$app/package.json")
tag="overworld-v$version-build.${GITHUB_RUN_NUMBER:?}"
files=("$artifacts"/harbor-overworld{.tar.gz,-presence.zip} "$artifacts/build.json")

# A rerun of an older push must never promote it over the branch head.
latest_head=$(gh api "repos/$repo/git/ref/heads/overworld" --jq .object.sha)
if [[ "$latest_head" != "$commit" ]]; then
  printf 'Commit %s was superseded by %s.\n' "$commit" "$latest_head"
  exit 0
fi
node -e 'if (require(process.argv[1]).commit !== process.argv[2]) process.exit(1)' "$artifacts/build.json" "$commit"

existing=$(gh release view "$tag" -R "$repo" --json isDraft --jq .isDraft 2>/dev/null || true)
if [[ -z "$existing" ]]; then
  gh release create "$tag" -R "$repo" --draft --target "$commit" \
    --title "Harbor Overworld $version build $GITHUB_RUN_NUMBER" \
    --notes "Built and tested from commit $commit."
  existing=true
fi
if [[ "$existing" == true ]]; then
  gh release upload "$tag" -R "$repo" --clobber "${files[@]}"
  if [[ "$(gh api "repos/$repo/git/ref/heads/overworld" --jq .object.sha)" != "$commit" ]]; then
    printf 'Commit %s was superseded while preparing its release.\n' "$commit"
    exit 0
  fi
  gh release edit "$tag" -R "$repo" --draft=false --latest
fi
printf 'published=true\ntag=%s\n' "$tag" >> "${GITHUB_OUTPUT:?}"
