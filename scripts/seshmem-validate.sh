#!/bin/bash
# seshmem-validate.sh — returns 0 on pass, 1 on fail

ERRORS=0; WARNS=0

# File existence
[ -f heartbeat.md ] || { echo "FAIL: heartbeat.md missing"; ERRORS=$((ERRORS+1)); }
[ -f CLAUDE.md ] || { echo "FAIL: CLAUDE.md missing"; ERRORS=$((ERRORS+1)); }
grep -qi "heartbeat" CLAUDE.md 2>/dev/null || { echo "FAIL: CLAUDE.md missing heartbeat directive"; ERRORS=$((ERRORS+1)); }

# Required fields
for field in "Last updated" "Updated by" "Staleness gate" "Focus" "Next Actions" "Session Log" "Quick Commands" "Links"; do
  grep -qi "$field" heartbeat.md 2>/dev/null || { echo "FAIL: heartbeat.md missing '$field'"; ERRORS=$((ERRORS+1)); }
done

# Line count
LINES=$(wc -l < heartbeat.md 2>/dev/null || echo 999)
[ "$LINES" -le 120 ] || { echo "WARN: heartbeat.md is $LINES lines (limit: 120)"; WARNS=$((WARNS+1)); }

# Secret scan
for pat in "sk-" "ghp_" "Bearer " "password=" "api_key="; do
  grep -rqi "$pat" heartbeat.md CLAUDE.md docs/ TASKS.md 2>/dev/null && {
    echo "FAIL: Possible secret (pattern: $pat)"; ERRORS=$((ERRORS+1));
  }
done

# Dead link check
[ -f heartbeat.md ] && grep -oP '\]\(\./\K[^)]+' heartbeat.md 2>/dev/null | while read -r f; do
  [ -f "$f" ] || { echo "WARN: Dead link: $f"; WARNS=$((WARNS+1)); }
done

echo ""
[ $ERRORS -eq 0 ] && echo "✅ Passed ($WARNS warning(s))" && exit 0
echo "❌ Failed: $ERRORS error(s), $WARNS warning(s)" && exit 1
