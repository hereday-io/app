#!/usr/bin/env bash
# gather_git.sh — dump the past week's git activity in a format that's easy to summarize.
# Usage: ./gather_git.sh [repo_path] [days_back]
# Defaults: current directory, 7 days.

set -euo pipefail

REPO_PATH="${1:-.}"
DAYS="${2:-7}"

cd "$REPO_PATH"

echo "=== REPO: $(basename "$(pwd)") ==="
echo "=== WINDOW: last $DAYS days (through $(date +%Y-%m-%d)) ==="
echo ""

echo "=== COMMITS ==="
git log --since="${DAYS} days ago" --pretty=format:"%h | %ad | %an | %s" --date=short --no-merges || echo "(no commits)"
echo ""
echo ""

echo "=== MERGES ==="
git log --since="${DAYS} days ago" --merges --pretty=format:"%h | %ad | %s" --date=short || echo "(no merges)"
echo ""
echo ""

echo "=== FILES CHANGED (top 20) ==="
git log --since="${DAYS} days ago" --no-merges --name-only --pretty=format: \
  | grep -v '^$' | sort | uniq -c | sort -rn | head -20 || echo "(no file changes)"
echo ""

echo "=== CONTRIBUTORS ==="
git log --since="${DAYS} days ago" --no-merges --pretty=format:"%an" \
  | sort | uniq -c | sort -rn || echo "(no contributors)"
echo ""

# Optional: GitHub PRs if gh is installed and authed
if command -v gh >/dev/null 2>&1; then
  echo ""
  echo "=== MERGED PRs (GitHub) ==="
  SINCE_DATE=$(date -d "${DAYS} days ago" +%Y-%m-%d 2>/dev/null || date -v-${DAYS}d +%Y-%m-%d)
  gh pr list --state merged --search "merged:>=${SINCE_DATE}" \
    --json number,title,author,mergedAt,url \
    --template '{{range .}}#{{.number}} | {{.mergedAt}} | @{{.author.login}} | {{.title}} | {{.url}}{{"\n"}}{{end}}' \
    2>/dev/null || echo "(gh CLI not authenticated or no PRs)"
fi

# Optional: GitLab MRs if glab is installed
if command -v glab >/dev/null 2>&1; then
  echo ""
  echo "=== MERGED MRs (GitLab) ==="
  SINCE_DATE=$(date -d "${DAYS} days ago" +%Y-%m-%d 2>/dev/null || date -v-${DAYS}d +%Y-%m-%d)
  glab mr list --state merged --updated-after="${SINCE_DATE}" 2>/dev/null || echo "(glab CLI not authenticated or no MRs)"
fi
