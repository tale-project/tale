#!/usr/bin/env bash
# =============================================================================
# Tale — Static-site container test helper (web / docs)
# =============================================================================
# Shared helper for container-web-test.sh and container-docs-test.sh. Both
# services run the same shape: a Bun server fronting a static SPA dist with a
# /api/health endpoint. This script builds, validates, and smoke-tests one of
# them via its standalone compose files.
#
# Required env:
#   STATIC_SITE_NAME         logical service name, e.g. "web" or "docs"
#   STATIC_SITE_PORT         host port for the test container, e.g. 13001
#   STATIC_SITE_SIZE_BUDGET  size budget in MB
#
# Optional env:
#   SMOKE_TEST_TIMEOUT       max seconds to wait for healthy (default: 120)
#   SKIP_BUILD               'true' to use pre-built images (release pipeline)
#   PULL_POLICY              'never' to skip pulling (release pipeline)
#   KEEP_RUNNING             'true' to skip teardown (debugging)
# =============================================================================

set -euo pipefail

: "${STATIC_SITE_NAME:?STATIC_SITE_NAME is required}"
: "${STATIC_SITE_PORT:?STATIC_SITE_PORT is required}"
: "${STATIC_SITE_SIZE_BUDGET:?STATIC_SITE_SIZE_BUDGET is required}"

SVC="${STATIC_SITE_NAME}"
HOST_PORT="${STATIC_SITE_PORT}"
SIZE_BUDGET_MB="${STATIC_SITE_SIZE_BUDGET}"
TIMEOUT="${SMOKE_TEST_TIMEOUT:-120}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_NAME="tale-${SVC}-test"
COMPOSE_CMD="docker compose -f compose.${SVC}.yml -f compose.${SVC}.test.yml --env-file .env.test -p ${PROJECT_NAME}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

PASSED=0
FAILED=0
RESULTS=()

header() {
    echo ""
    echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║  $1${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
}

pass() {
    echo -e "  ${GREEN}✓${NC} $1"
    RESULTS+=("$1|PASS")
    PASSED=$((PASSED + 1))
}

fail() {
    echo -e "  ${RED}✗${NC} $1"
    RESULTS+=("$1|FAIL")
    FAILED=$((FAILED + 1))
}

cleanup() {
    local exit_code=$?
    if [ "${KEEP_RUNNING:-false}" = "true" ]; then
        echo -e "${YELLOW}KEEP_RUNNING=true — skipping teardown${NC}"
        return
    fi
    cd "${PROJECT_ROOT}"
    if [ "$exit_code" -ne 0 ]; then
        header "Container logs (last 100 lines) on failure"
        ${COMPOSE_CMD} logs --tail=100 --no-color 2>&1 || true
    fi
    header "Tearing down ${SVC} test containers"
    ${COMPOSE_CMD} down -v --remove-orphans 2>/dev/null || true
}

trap cleanup EXIT

cd "${PROJECT_ROOT}"

# Ensure dummy .env files exist so compose env_file directives don't fail.
if [ ! -f "${PROJECT_ROOT}/services/${SVC}/.env" ]; then
    echo -e "  ${YELLOW}⚠ No services/${SVC}/.env — creating empty placeholder${NC}"
    : > "${PROJECT_ROOT}/services/${SVC}/.env"
fi
if [ ! -f "${PROJECT_ROOT}/.env.test" ]; then
    echo "Missing .env.test at project root" >&2
    exit 1
fi

# Always start clean (in case a previous run left containers around).
${COMPOSE_CMD} down -v --remove-orphans 2>/dev/null || true

# =============================================================================
# 1. Build (or skip when reusing pre-pulled images)
# =============================================================================
if [ "${SKIP_BUILD:-false}" != "true" ]; then
    header "Building ${SVC} image"
    ${COMPOSE_CMD} build 2>&1 || { echo -e "${RED}Build failed!${NC}"; exit 1; }
fi

IMAGE=$(${COMPOSE_CMD} config --images 2>/dev/null | head -1)
if [ -z "${IMAGE}" ]; then
    echo "Failed to resolve ${SVC} image name from compose"
    exit 1
fi
echo -e "  ${CYAN}Image: ${IMAGE}${NC}"

# =============================================================================
# 2. Image-level checks
# =============================================================================
header "Image checks"

labels=$(docker inspect "${IMAGE}" --format='{{json .Config.Labels}}' 2>/dev/null || echo "{}")
title=$(echo "${labels}" | grep -o "\"org.opencontainers.image.title\":\"[^\"]*\"" | head -1)
if echo "${title}" | grep -q "tale-${SVC}"; then
    pass "${SVC}: OCI title label present (tale-${SVC})"
else
    fail "${SVC}: OCI title label missing or wrong"
fi

user=$(docker inspect --format='{{.Config.User}}' "${IMAGE}" 2>/dev/null || echo "")
if [ -n "${user}" ] && [ "${user}" != "root" ] && [ "${user}" != "0" ]; then
    pass "${SVC}: runs as non-root user '${user}'"
else
    fail "${SVC}: runs as root (expected non-root for static site)"
fi

healthcheck=$(docker inspect --format='{{.Config.Healthcheck}}' "${IMAGE}" 2>/dev/null || echo "")
if [ -n "${healthcheck}" ] && [ "${healthcheck}" != "<nil>" ]; then
    pass "${SVC}: HEALTHCHECK defined"
else
    fail "${SVC}: no HEALTHCHECK instruction"
fi

size_bytes=$(docker inspect --format='{{.Size}}' "${IMAGE}" 2>/dev/null || echo "0")
size_mb=$((size_bytes / 1024 / 1024))
if [ ${size_mb} -le ${SIZE_BUDGET_MB} ]; then
    pass "${SVC}: ${size_mb} MB ≤ ${SIZE_BUDGET_MB} MB budget"
else
    fail "${SVC}: ${size_mb} MB exceeds ${SIZE_BUDGET_MB} MB budget"
fi

# =============================================================================
# 3. Smoke test: bring up + probe /api/health
# =============================================================================
header "Smoke test: ${SVC} /api/health"

${COMPOSE_CMD} up -d 2>&1
container_name=$(${COMPOSE_CMD} ps -q "${SVC}" 2>/dev/null | head -1)
container_name=$(docker inspect --format='{{.Name}}' "${container_name}" 2>/dev/null | sed 's|^/||' || echo "tale-${SVC}")

start_time=$(date +%s)
healthy=0
while :; do
    elapsed=$(( $(date +%s) - start_time ))
    if [ ${elapsed} -ge ${TIMEOUT} ]; then
        echo -e "  ${RED}✗${NC} ${SVC}: timed out after ${TIMEOUT}s"
        ${COMPOSE_CMD} logs --tail=40 "${SVC}" 2>&1 | sed 's/^/    /'
        break
    fi
    status=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no_healthcheck{{end}}' "${container_name}" 2>/dev/null || echo "not_found")
    if [ "${status}" = "healthy" ]; then
        healthy=1
        echo -e "  ${GREEN}✓${NC} ${SVC}: healthy (${elapsed}s)"
        break
    fi
    sleep 3
done

if [ ${healthy} -eq 1 ]; then
    pass "${SVC} health check"
else
    fail "${SVC} health check"
fi

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:${HOST_PORT}/api/health" 2>/dev/null || echo "000")
if [ "${code}" = "200" ]; then
    pass "${SVC}: /api/health HTTP 200"
else
    fail "${SVC}: /api/health expected 200, got ${code}"
fi

# =============================================================================
# Summary
# =============================================================================
TOTAL=$((PASSED + FAILED))

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  ${SVC} CONTAINER TEST RESULTS${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
for r in "${RESULTS[@]}"; do
    IFS='|' read -r name status <<< "$r"
    if [ "$status" = "PASS" ]; then
        printf "  ${GREEN}✅ %-50s${NC}\n" "$name"
    else
        printf "  ${RED}❌ %-50s${NC}\n" "$name"
    fi
done
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "  Tests: ${TOTAL}  |  ${GREEN}Passed: ${PASSED}${NC}  |  ${RED}Failed: ${FAILED}${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

[ ${FAILED} -eq 0 ] || exit 1
