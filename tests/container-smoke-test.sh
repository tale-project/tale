#!/usr/bin/env bash
# =============================================================================
# Tale — Container Smoke Tests
# =============================================================================
# Builds all Docker images, starts services with non-conflicting ports,
# waits for health checks, validates HTTP endpoints, then tears down.
#
# Usage:
#   bash tests/container-smoke-test.sh
#   bun run docker:test
#
# Environment variables:
#   SMOKE_TEST_TIMEOUT   - Max seconds to wait for services (default: 300)
#   SKIP_BUILD           - Set to 'true' to skip docker compose build
#   KEEP_RUNNING         - Set to 'true' to skip teardown (for debugging)
# =============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_CMD="docker compose -f compose.yml -f compose.test.yml --env-file .env.test -p tale-test"
TIMEOUT="${SMOKE_TEST_TIMEOUT:-300}"

# Colors
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
    if [ "${KEEP_RUNNING:-false}" = "true" ]; then
        echo -e "${YELLOW}KEEP_RUNNING=true — skipping teardown${NC}"
        echo -e "To stop: cd ${PROJECT_ROOT} && ${COMPOSE_CMD} down -v"
        return
    fi
    header "Tearing down test containers"
    cd "${PROJECT_ROOT}"
    ${COMPOSE_CMD} down -v --remove-orphans 2>/dev/null || true
}

trap cleanup EXIT

# Ensure dummy .env exists to satisfy compose.yml env_file declarations
if [ ! -f "${PROJECT_ROOT}/.env" ]; then
    echo -e "  ${YELLOW}⚠ No .env file found — creating placeholder with defaults${NC}"
    cp "${PROJECT_ROOT}/.env.test" "${PROJECT_ROOT}/.env"
fi

# =============================================================================
# 0. Show Docker Compose version (for CI debugging)
# =============================================================================
echo "Docker Compose version:"
docker compose version 2>&1 || echo "  docker compose not available"

# =============================================================================
# 1. Build images
# =============================================================================
cd "${PROJECT_ROOT}"

if [ "${SKIP_BUILD:-false}" != "true" ]; then
    header "Building Docker images"
    BUILD_START=$(date +%s)

    # Build all services in parallel
    if ! ${COMPOSE_CMD} build --parallel 2>&1; then
        echo -e "${RED}Build failed!${NC}"
        exit 1
    fi

    BUILD_END=$(date +%s)
    BUILD_ELAPSED=$((BUILD_END - BUILD_START))
    echo -e "  ${GREEN}✓${NC} All images built in ${BOLD}${BUILD_ELAPSED}s${NC}"

    # Show image sizes
    header "Docker Image Sizes"
    printf "  ${BOLD}%-15s %-45s %10s${NC}\n" "SERVICE" "IMAGE" "SIZE"
    echo "  ─────────────────────────────────────────────────────────────────────"
    TOTAL_SIZE_MB=0
    for svc in db crawler rag platform proxy; do
        # Get the image name from compose config
        img=$(cd "${PROJECT_ROOT}" && ${COMPOSE_CMD} config --images 2>/dev/null | grep "${svc}" | head -1)
        if [ -z "$img" ]; then
            # Fallback: look for tale images in docker images list
            img=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep "tale-${svc}" | head -1)
        fi
        if [ -n "$img" ]; then
            size=$(docker images --format '{{.Size}}' "$img" 2>/dev/null | head -1)
            size_bytes=$(docker inspect "$img" --format='{{.Size}}' 2>/dev/null | head -1)
            if [ -n "$size_bytes" ]; then
                size_mb=$((size_bytes / 1048576))
                TOTAL_SIZE_MB=$((TOTAL_SIZE_MB + size_mb))
            fi
        else
            size="N/A"
            img="(not found)"
        fi
        printf "  %-15s %-45s %10s\n" "${svc}" "${img}" "${size:-N/A}"
    done
    echo "  ─────────────────────────────────────────────────────────────────────"
    printf "  ${BOLD}%-15s %-45s %8s MB${NC}\n" "TOTAL" "" "${TOTAL_SIZE_MB}"
    echo ""
    echo -e "  ${CYAN}Build time: ${BUILD_ELAPSED}s (no-cache on CI)${NC}"
else
    echo -e "${YELLOW}Skipping build (SKIP_BUILD=true)${NC}"
fi

# =============================================================================
# 2. Start services
# =============================================================================
header "Starting services"
${COMPOSE_CMD} up -d 2>&1

# Show container status for debugging
echo ""
echo "Container status:"
${COMPOSE_CMD} ps 2>&1 || true

# =============================================================================
# Helper: Get container name for a service using docker compose
# =============================================================================
get_container_name() {
    local service=$1
    # docker compose ps -q returns the container ID, then we get the name
    local cid
    cid=$(cd "${PROJECT_ROOT}" && ${COMPOSE_CMD} ps -q "${service}" 2>/dev/null | head -1)
    if [ -n "$cid" ]; then
        docker inspect --format='{{.Name}}' "$cid" 2>/dev/null | sed 's|^/||'
    else
        # Fallback to explicit container_name from compose.yml
        echo "tale-${service}"
    fi
}

# =============================================================================
# 3. Wait for health checks
# =============================================================================
header "Waiting for services to become healthy (timeout: ${TIMEOUT}s)"

wait_for_healthy() {
    local service=$1
    local container_name
    container_name=$(get_container_name "$service")
    local start_time=$(date +%s)

    while true; do
        local elapsed=$(( $(date +%s) - start_time ))
        if [ $elapsed -ge $TIMEOUT ]; then
            echo -e "  ${RED}✗${NC} ${service}: timed out after ${TIMEOUT}s"
            # Show last logs for debugging
            echo -e "  ${YELLOW}Last 20 lines of ${service} logs:${NC}"
            ${COMPOSE_CMD} logs --tail=20 "${service}" 2>&1 | sed 's/^/    /'
            return 1
        fi

        local status
        status=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no_healthcheck{{end}}' "${container_name}" 2>/dev/null || echo "not_found")

        case "$status" in
            healthy)
                echo -e "  ${GREEN}✓${NC} ${service}: healthy (${elapsed}s)"
                return 0
                ;;
            unhealthy)
                # Don't fail immediately — Docker may mark as unhealthy during
                # long startup (e.g. platform Convex deploy). Keep waiting.
                printf "\r  ⏳ ${service}: unhealthy (${elapsed}s) — still waiting...          "
                sleep 10
                ;;
            not_found)
                # Container doesn't exist yet or exited
                local running
                running=$(docker inspect --format='{{.State.Status}}' "${container_name}" 2>/dev/null || echo "missing")
                if [ "$running" = "exited" ] || [ "$running" = "dead" ]; then
                    echo -e "  ${RED}✗${NC} ${service}: container ${running}"
                    ${COMPOSE_CMD} logs --tail=20 "${service}" 2>&1 | sed 's/^/    /'
                    return 1
                fi
                printf "\r  ⏳ ${service}: waiting for container (${elapsed}s)..."
                sleep 5
                ;;
            *)
                printf "\r  ⏳ ${service}: ${status} (${elapsed}s)...          "
                sleep 5
                ;;
        esac
    done
}

SERVICES=(db crawler rag platform proxy)
HEALTH_FAILED=0

for svc in "${SERVICES[@]}"; do
    if wait_for_healthy "$svc"; then
        pass "${svc} health check"
    else
        fail "${svc} health check"
        HEALTH_FAILED=1
    fi
done

# If any service failed health check, show all logs and exit early
if [ $HEALTH_FAILED -eq 1 ]; then
    echo ""
    echo -e "${RED}Some services failed health checks. Full logs:${NC}"
    ${COMPOSE_CMD} logs --tail=50 2>&1
fi

# =============================================================================
# 4. Validate HTTP health endpoints
# =============================================================================
header "Validating HTTP health endpoints"

check_http() {
    local name=$1
    local url=$2
    local expected_code=${3:-200}

    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")

    if [ "$code" = "$expected_code" ]; then
        pass "${name}: HTTP ${code}"
    else
        fail "${name}: expected HTTP ${expected_code}, got ${code}"
    fi
}

check_http "Crawler /health" "http://localhost:18002/health"
check_http "RAG /health"     "http://localhost:18001/health"

# Proxy health is on internal port 2020, not exposed — check via docker exec
PROXY_CONTAINER=$(get_container_name proxy)
if docker exec "${PROXY_CONTAINER}" wget --no-verbose --tries=1 --spider http://127.0.0.1:2020/health 2>/dev/null; then
    pass "Proxy /health (internal :2020)"
else
    fail "Proxy /health (internal :2020)"
fi

# DB: use pg_isready via docker exec
DB_CONTAINER=$(get_container_name db)
if docker exec "${DB_CONTAINER}" pg_isready -U tale -d tale >/dev/null 2>&1; then
    pass "DB pg_isready"
else
    fail "DB pg_isready"
fi

# Platform: Convex backend is the critical component.
# TanStack Start (Vite) may not be ready in CI because Convex function
# deployment takes 5+ minutes. We check it but don't fail on it.
PLATFORM_CONTAINER=$(get_container_name platform)
if docker exec "${PLATFORM_CONTAINER}" curl -sf http://localhost:3210/version >/dev/null 2>&1; then
    pass "Convex backend /version"
else
    fail "Convex backend /version"
fi

# Vite server check — warn only (may not be ready due to slow Convex deploy)
vite_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:13000/api/health" 2>/dev/null || echo "000")
if [ "$vite_code" = "200" ]; then
    pass "Platform /api/health: HTTP ${vite_code}"
else
    echo -e "  ${YELLOW}⚠${NC} Platform /api/health: HTTP ${vite_code} (Vite not ready — expected in CI)"
    # Don't count as failure — Convex backend check above is what matters
fi

# =============================================================================
# 5. Validate inter-service connectivity
# =============================================================================
header "Validating inter-service connectivity"

# Platform can reach RAG
if docker exec "${PLATFORM_CONTAINER}" curl -sf http://rag:8001/health >/dev/null 2>&1; then
    pass "Platform → RAG connectivity"
else
    fail "Platform → RAG connectivity"
fi

# Platform can reach Crawler
if docker exec "${PLATFORM_CONTAINER}" curl -sf http://crawler:8002/health >/dev/null 2>&1; then
    pass "Platform → Crawler connectivity"
else
    fail "Platform → Crawler connectivity"
fi

# RAG can reach DB
RAG_CONTAINER=$(get_container_name rag)
if docker exec "${RAG_CONTAINER}" pg_isready -h db -U tale -d tale >/dev/null 2>&1 || \
   docker exec "${RAG_CONTAINER}" curl -sf http://db:5432 >/dev/null 2>&1; then
    pass "RAG → DB connectivity"
else
    # RAG doesn't have pg_isready, try Python
    if docker exec "${RAG_CONTAINER}" python3 -c "import socket; s=socket.create_connection(('db',5432),5); s.close()" 2>/dev/null; then
        pass "RAG → DB connectivity"
    else
        fail "RAG → DB connectivity"
    fi
fi

# =============================================================================
# SUMMARY
# =============================================================================
TOTAL=$((PASSED + FAILED))

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║           CONTAINER SMOKE TEST RESULTS                  ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"

for r in "${RESULTS[@]}"; do
    IFS='|' read -r name status <<< "$r"
    if [ "$status" = "PASS" ]; then
        printf "  ${GREEN}✅ %-45s${NC} PASSED\n" "$name"
    else
        printf "  ${RED}❌ %-45s${NC} FAILED\n" "$name"
    fi
done

echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "  Tests: ${TOTAL}  |  ${GREEN}Passed: ${PASSED}${NC}  |  ${RED}Failed: ${FAILED}${NC}"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo -e "  ${GREEN}${BOLD}🎉 ALL CONTAINER SMOKE TESTS PASSED${NC}"
fi

echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

[ $FAILED -eq 0 ] || exit 1
