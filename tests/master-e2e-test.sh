#!/bin/bash
# =============================================================================
# Tale — Master E2E Test Suite
# =============================================================================
# Invokes existing Vitest (server + UI) tests via the project's test scripts.
# New E2E tests will be added in Phase 2.
#
# Usage: bash tests/master-e2e-test.sh
# =============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

RESULTS=()
PASSED=0
FAILED=0
START_TIME=$(date +%s)

header() {
    echo ""
    echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║  $1${NC}${BOLD}  ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
}
section() { echo -e "${CYAN}${BOLD}━━━ $1 ━━━${NC}"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         Tale — Master E2E Test Suite                    ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"

# =============================================================================
# 1. Vitest — Server Tests (Convex, Libs, Utils)
# =============================================================================
header "Vitest — Server Tests                    "
section "Running: bunx vitest --run --project server"

svc_start=$(date +%s)
cd "${PROJECT_ROOT}/services/platform"
if bunx vitest --run --project server 2>&1; then
    dur=$(( $(date +%s) - svc_start ))
    echo -e "  ${GREEN}✓${NC} Server tests passed (${dur}s)"
    RESULTS+=("Vitest:Server|PASS|${dur}")
    PASSED=$((PASSED + 1))
else
    dur=$(( $(date +%s) - svc_start ))
    echo -e "  ${RED}✗${NC} Server tests failed (${dur}s)"
    RESULTS+=("Vitest:Server|FAIL|${dur}")
    FAILED=$((FAILED + 1))
fi
cd "${PROJECT_ROOT}"

# =============================================================================
# 2. Vitest — UI Component Tests (jsdom)
# =============================================================================
header "Vitest — UI Component Tests              "
section "Running: bunx vitest --run --config vitest.ui.config.ts"

svc_start=$(date +%s)
cd "${PROJECT_ROOT}/services/platform"
if bunx vitest --run --config vitest.ui.config.ts 2>&1; then
    dur=$(( $(date +%s) - svc_start ))
    echo -e "  ${GREEN}✓${NC} UI component tests passed (${dur}s)"
    RESULTS+=("Vitest:UI|PASS|${dur}")
    PASSED=$((PASSED + 1))
else
    dur=$(( $(date +%s) - svc_start ))
    echo -e "  ${RED}✗${NC} UI component tests failed (${dur}s)"
    RESULTS+=("Vitest:UI|FAIL|${dur}")
    FAILED=$((FAILED + 1))
fi
cd "${PROJECT_ROOT}"

# =============================================================================
# FINAL SUMMARY
# =============================================================================
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
TOTAL=$((PASSED + FAILED))

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║              MASTER E2E TEST RESULTS                    ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"

for r in "${RESULTS[@]}"; do
    IFS='|' read -r name status dur <<< "$r"
    if [ "$status" = "PASS" ]; then
        printf "  ${GREEN}✅ %-15s${NC} PASSED  (%ss)\n" "$name" "$dur"
    else
        printf "  ${RED}❌ %-15s${NC} FAILED  (%ss)\n" "$name" "$dur"
    fi
done

echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "  Suites: ${TOTAL}  |  ${GREEN}Passed: ${PASSED}${NC}  |  ${RED}Failed: ${FAILED}${NC}  |  ⏱  ${TOTAL_TIME}s"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo -e "  ${GREEN}${BOLD}🎉 ALL TEST SUITES PASSED${NC}"
fi

echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

[ $FAILED -eq 0 ] || exit 1
