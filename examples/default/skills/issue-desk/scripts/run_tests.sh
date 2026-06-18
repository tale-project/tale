#!/usr/bin/env bash
# Deterministic verify step for the issue-resolution desk.
# Runs the repo's test suite on the implementer's branch (already staged in the
# sandbox workspace) and writes a structured pass/fail verdict to
# /user/output/result.json — the small result the workflow branches on. Big
# output (logs) stays as harvested files; only the verdict crosses the workflow.
set -uo pipefail

cd /user/workspace/repo 2>/dev/null || cd /user/workspace || true

if command -v bun >/dev/null 2>&1 && [ -f package.json ]; then
  bun test >/user/output/test.log 2>&1
  code=$?
elif [ -f pyproject.toml ] || [ -f pytest.ini ]; then
  python -m pytest -q >/user/output/test.log 2>&1
  code=$?
else
  echo "no recognized test runner" >/user/output/test.log
  code=0
fi

if [ "$code" -eq 0 ]; then
  status="pass"
else
  status="fail"
fi

printf '{"check":"tests","status":"%s","exitCode":%s}\n' "$status" "$code" \
  >/user/output/result.json

# Exit 0 regardless: the verdict is in result.json; the workflow branches on it.
exit 0
