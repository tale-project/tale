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
    local exit_code=$?
    if [ "${KEEP_RUNNING:-false}" = "true" ]; then
        echo -e "${YELLOW}KEEP_RUNNING=true — skipping teardown${NC}"
        echo -e "To stop: cd ${PROJECT_ROOT} && ${COMPOSE_CMD} down -v"
        return
    fi
    cd "${PROJECT_ROOT}"
    # Dump container state + logs before teardown when the script is exiting
    # non-zero, so CI captures them before `compose down -v` destroys them.
    if [ "$exit_code" -ne 0 ]; then
        header "Container state on failure"
        ${COMPOSE_CMD} ps -a 2>&1 || true
        header "Container logs (last 200 lines per service) on failure"
        ${COMPOSE_CMD} logs --tail=200 --no-color 2>&1 || true
    fi
    header "Tearing down test containers"
    ${COMPOSE_CMD} down -v --remove-orphans 2>/dev/null || true
    # The sandbox network is declared `external:` in compose.yml — `compose
    # down` won't remove it. Drop it manually so the next run starts clean.
    docker network rm tale-sandbox-net >/dev/null 2>&1 || true
    # Only remove .env if we created it (CREATED_ENV=1). Otherwise we'd
    # clobber a developer's real .env when the smoke test exits.
    if [ "${CREATED_ENV:-0}" = "1" ]; then
        rm -f "${PROJECT_ROOT}/.env"
    fi
}

trap cleanup EXIT

# Clean up any stale containers/volumes from previous runs (e.g. killed CI jobs
# on reused runners) to avoid "file exists" errors when Docker tries to
# initialise volume mount-points.
cd "${PROJECT_ROOT}"
${COMPOSE_CMD} down -v --remove-orphans 2>/dev/null || true

# Pre-create the sandbox bridge. It's declared `external:` in compose.yml
# because the CLI (`tale start` / `tale deploy`) owns its lifecycle —
# `--internal --ipv6=false` can't be expressed atomically in a compose
# `networks:` block. Smoke tests don't go through the CLI, so we create it
# here with the same shape ensureSandboxNetwork() uses.
docker network rm tale-sandbox-net >/dev/null 2>&1 || true
docker network create \
    --internal \
    --ipv6=false \
    --driver=bridge \
    tale-sandbox-net >/dev/null

# Ensure dummy .env exists to satisfy compose.yml env_file declarations.
# Track whether we created it so the cleanup trap doesn't delete a real
# .env if one already existed on a developer's box.
CREATED_ENV=0
if [ ! -f "${PROJECT_ROOT}/.env" ]; then
    echo -e "  ${YELLOW}⚠ No .env file found — creating placeholder with defaults${NC}"
    cp "${PROJECT_ROOT}/.env.test" "${PROJECT_ROOT}/.env"
    CREATED_ENV=1
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
    for svc in db convex crawler rag platform proxy sandbox sandbox-egress; do
        # Get the image name from compose config. Use anchored grep so we
        # don't match service names that *contain* the target (e.g. "db"
        # would otherwise match "tale-san**db**ox-egress").
        img=$(cd "${PROJECT_ROOT}" && ${COMPOSE_CMD} config --images 2>/dev/null | grep "/tale-${svc}:" | head -1)
        if [ -z "$img" ]; then
            # Fallback: look for tale images in docker images list
            img=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep "tale-${svc}:" | head -1)
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

SERVICES=(db convex crawler rag platform proxy sandbox sandbox-egress)
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

# Phase 2 (split): Convex lives in its own container. We probe it directly.
CONVEX_CONTAINER=$(get_container_name convex)
if docker exec "${CONVEX_CONTAINER}" curl -sf http://localhost:3210/version >/dev/null 2>&1; then
    pass "Convex backend /version"
else
    fail "Convex backend /version"
fi

if docker exec "${CONVEX_CONTAINER}" test -f /tmp/convex-ready >/dev/null 2>&1; then
    pass "Convex readiness marker (/tmp/convex-ready)"
else
    fail "Convex readiness marker (/tmp/convex-ready)"
fi

# Platform: Vite server with platform-ready marker. Takes longer in CI
# because platform must finish pushing functions + env to convex.
PLATFORM_CONTAINER=$(get_container_name platform)
vite_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:13000/api/health" 2>/dev/null || echo "000")
if [ "$vite_code" = "200" ]; then
    pass "Platform /api/health: HTTP ${vite_code}"
else
    fail "Platform /api/health: expected HTTP 200, got ${vite_code}"
fi

# Readiness marker only present after deploy_convex_functions succeeds; this
# distinguishes "Vite serving but Convex deploy failed" from "fully ready".
if docker exec "${PLATFORM_CONTAINER}" test -f /tmp/platform-ready >/dev/null 2>&1; then
    pass "Platform readiness marker (/tmp/platform-ready)"
else
    fail "Platform readiness marker (/tmp/platform-ready)"
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

# Phase 2 critical path: Platform must reach Convex over the docker network
# using the DNS name `convex`. This is what `bunx convex deploy` does at
# startup; if this is broken, everything downstream is broken.
if docker exec "${PLATFORM_CONTAINER}" curl -sf http://convex:3210/version >/dev/null 2>&1; then
    pass "Platform → Convex /version connectivity"
else
    fail "Platform → Convex /version connectivity"
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
# 6. Sandbox /v1/execute end-to-end probe
# =============================================================================
# Submits a 1-line python program signed with the test SANDBOX_TOKEN and
# asserts the SSE stream emits an `event: result` payload with status
# "completed". The spawner pulls tale-sandbox-runtime at boot; we don't
# probe the runtime image directly here — if the spawner is healthy and
# the boot pull succeeded, /v1/execute will exercise it.
header "Sandbox /v1/execute end-to-end"

# Pull SANDBOX_TOKEN from .env.test rather than re-defining it, so any local
# rotation only has to happen in one place.
SANDBOX_TOKEN_VAL=$(grep -E '^SANDBOX_TOKEN=' "${PROJECT_ROOT}/.env.test" | head -1 | cut -d= -f2-)
if [ -z "${SANDBOX_TOKEN_VAL}" ]; then
    fail "Sandbox e2e: SANDBOX_TOKEN missing from .env.test"
else
    # Unique per-run executionId so re-running the test (or a stale entry
    # left in the spawner's in-flight registry from a previous run) doesn't
    # return 409 Duplicate.
    SMOKE_EXEC_ID="smoke-$$-$(date +%s)$(date +%N | head -c 6)"
    SANDBOX_BODY="{\"executionId\":\"${SMOKE_EXEC_ID}\",\"organizationId\":\"smoke\",\"language\":\"python\",\"code\":\"print(1)\",\"timeoutMs\":30000}"
    SANDBOX_TS=$(($(date +%s%N) / 1000000))
    SANDBOX_PATH="/v1/execute"
    # New signing contract (auth.ts): METHOD\npath\ntimestamp\nsha256Hex(body)
    SANDBOX_BODY_HASH=$(printf '%s' "${SANDBOX_BODY}" \
        | openssl dgst -sha256 -r 2>/dev/null \
        | awk '{print $1}')
    SANDBOX_SIGNED_STRING=$(printf 'POST\n%s\n%s\n%s' "${SANDBOX_PATH}" "${SANDBOX_TS}" "${SANDBOX_BODY_HASH}")
    SANDBOX_SIG=$(printf '%s' "${SANDBOX_SIGNED_STRING}" \
        | openssl dgst -sha256 -hmac "${SANDBOX_TOKEN_VAL}" -r 2>/dev/null \
        | awk '{print $1}')
    if [ -z "${SANDBOX_SIG}" ]; then
        fail "Sandbox e2e: failed to compute HMAC signature"
    else
        SANDBOX_OUT=$(mktemp)
        # The endpoint streams SSE; --max-time bounds the probe. A 1-line
        # python program completes in under 5s once the runtime image is
        # warm, but allow 60s to absorb cold-image pulls on a fresh runner.
        SANDBOX_HTTP=$(curl -sS \
            -o "${SANDBOX_OUT}" \
            -w "%{http_code}" \
            --max-time 60 \
            -X POST \
            -H "content-type: application/json" \
            -H "x-tale-sandbox-signature: ${SANDBOX_SIG}" \
            -H "x-tale-sandbox-timestamp: ${SANDBOX_TS}" \
            --data-binary "${SANDBOX_BODY}" \
            "http://localhost:8003${SANDBOX_PATH}" 2>/dev/null || echo "000")

        if [ "${SANDBOX_HTTP}" = "200" ] \
           && grep -q '^event: result' "${SANDBOX_OUT}" \
           && grep -q '"status":"completed"' "${SANDBOX_OUT}"; then
            pass "Sandbox /v1/execute: completed result"
        else
            echo -e "  ${YELLOW}sandbox response (HTTP ${SANDBOX_HTTP}):${NC}"
            head -c 4000 "${SANDBOX_OUT}" | sed 's/^/    /' || echo "    (empty body)"
            echo ""
            fail "Sandbox /v1/execute: expected HTTP 200 + completed result"
        fi
        rm -f "${SANDBOX_OUT}"
    fi

    # ---- Negative cases ----
    # Missing signature header → 401. Defense-in-depth that the spawner
    # actually enforces HMAC under .env.test (which DOES define a token).
    NEG_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 \
        -X POST \
        -H "content-type: application/json" \
        --data-binary '{"executionId":"unauth","organizationId":"smoke","language":"python","code":"print(1)"}' \
        "http://localhost:8003/v1/execute" 2>/dev/null || echo "000")
    if [ "${NEG_HTTP}" = "401" ]; then
        pass "Sandbox /v1/execute: 401 without signature"
    else
        fail "Sandbox /v1/execute: expected 401 without signature, got ${NEG_HTTP}"
    fi

    # 256 KB + 1 body → 413. Tests the streaming body cap before HMAC
    # check; we don't bother signing because the byte cap fires first.
    #
    # The body has to come from a file rather than be passed inline: the
    # Linux kernel caps a single argv string at MAX_ARG_STRLEN (128 KiB),
    # independent of ARG_MAX, so `--data-binary "${TOO_BIG}"` with 256 KiB
    # of payload fails the execve before curl ever runs.
    TOO_BIG_FILE="$(mktemp)"
    head -c 262145 /dev/zero | tr '\0' 'x' > "${TOO_BIG_FILE}"
    NEG_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 \
        -X POST \
        -H "content-type: application/json" \
        --data-binary "@${TOO_BIG_FILE}" \
        "http://localhost:8003/v1/execute" 2>/dev/null || echo "000")
    rm -f "${TOO_BIG_FILE}"
    if [ "${NEG_HTTP}" = "413" ]; then
        pass "Sandbox /v1/execute: 413 on oversized body"
    else
        fail "Sandbox /v1/execute: expected 413 on oversized body, got ${NEG_HTTP}"
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
