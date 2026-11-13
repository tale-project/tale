#!/usr/bin/env bash
# tools/cli/e2e/incus/suites.sh <choice>: which suites a run was asked for, as
# `<suite>=true|false` lines for $GITHUB_OUTPUT. `all` (or nothing) is every
# suite; otherwise a comma-separated choice. A misspelt name fails the run at
# once instead of skipping a suite in silence. The list is the order the
# workflow runs them in (harness.test.ts keeps the two and suites/ in step).

set -euo pipefail

readonly SUITES=(bootstrap managed fresh-noop logs crash-loop stop sandbox export-client secrets)

choice="${1//[[:space:]]/}"
choice="${choice:-all}"
if [ "$choice" != all ]; then
  IFS=, read -r -a names <<<"$choice"
  for name in "${names[@]}"; do
    [ -n "$name" ] || continue
    known=false
    for suite in "${SUITES[@]}"; do
      [ "$name" != "$suite" ] || known=true
    done
    if [ "$known" = false ]; then
      echo "::error::unknown suite '$name': choose from ${SUITES[*]}, or all" >&2
      exit 1
    fi
  done
fi
for suite in "${SUITES[@]}"; do
  if [ "$choice" = all ] || [[ ",$choice," == *",$suite,"* ]]; then
    echo "$suite=true"
  else
    echo "$suite=false"
  fi
done
