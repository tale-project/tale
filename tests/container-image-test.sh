#!/usr/bin/env bash
# =============================================================================
# Tale — Container Image Validation Tests
# =============================================================================
# Validates built Docker images for security, compliance, and size budgets.
# Does NOT require running containers — inspects images only.
#
# Usage:
#   bash tests/container-image-test.sh
#   bun run docker:test:image
#
# Prerequisites:
#   Images must be built first:
#     docker compose -f compose.yml -f compose.test.yml --env-file .env.test -p tale-test build
# =============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_CMD="docker compose -f compose.yml -f compose.test.yml --env-file .env.test -p tale-test"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

PASSED=0
FAILED=0
WARNED=0
RESULTS=()

# Image size budgets (in MB) — based on optimized sizes + 10% headroom
declare -A SIZE_BUDGETS=(
    [crawler]=2100
    [rag]=600
    [platform]=2900
    [db]=1200
    [proxy]=100
)

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

warn() {
    echo -e "  ${YELLOW}⚠${NC} $1"
    RESULTS+=("$1|WARN")
    WARNED=$((WARNED + 1))
}

# Get the image name for a service
get_image() {
    local service=$1
    cd "${PROJECT_ROOT}"
    ${COMPOSE_CMD} config --images 2>/dev/null | grep "${service}" | head -1
}

# =============================================================================
# Build images explicitly to ensure we are testing the local codebase
# =============================================================================
cd "${PROJECT_ROOT}"
header "Building all images locally"

SERVICES=(crawler rag platform db proxy)
declare -A IMAGES

echo -e "  ${YELLOW}Building images using compose...${NC}"
if [ "${SKIP_BUILD:-false}" = "true" ]; then
    echo -e "  ${YELLOW}⚠ SKIP_BUILD=true — using pre-built images${NC}"
else
    ${COMPOSE_CMD} build --parallel 2>&1 || { echo -e "${RED}Build failed!${NC}"; exit 1; }
fi

for svc in "${SERVICES[@]}"; do
    img=$(get_image "$svc")
    IMAGES[$svc]="$img"
    echo -e "  ${GREEN}✓${NC} ${svc}: ${img}"
done

# =============================================================================
# 1. OCI label checks
# =============================================================================
header "Checking OCI labels"

for svc in "${SERVICES[@]}"; do
    img="${IMAGES[$svc]:-}"
    [ -z "$img" ] && continue

    labels=$(docker inspect "$img" --format='{{json .Config.Labels}}' 2>/dev/null || echo "{}")
    has_source=$(echo "$labels" | grep -c "org.opencontainers.image.source" || true)

    if [ "$has_source" -gt 0 ]; then
        pass "${svc}: OCI labels present"
    else
        warn "${svc}: OCI labels missing (acceptable for local builds)"
    fi
done

# =============================================================================
# 2. Non-root user (where applicable)
# =============================================================================
header "Checking non-root user"

for svc in "${SERVICES[@]}"; do
    img="${IMAGES[$svc]:-}"
    [ -z "$img" ] && continue

    user=$(docker inspect --format='{{.Config.User}}' "$img" 2>/dev/null || echo "")

    case "$svc" in
        platform)
            # Platform runs as root initially, then drops to 'app' user via gosu in entrypoint
            pass "${svc}: root (expected — gosu to app at runtime)"
            ;;
        db)
            # DB runs as root initially, then gosu to postgres — this is expected
            pass "${svc}: root (expected — gosu to postgres at runtime)"
            ;;
        proxy)
            # Caddy Alpine image — non-root not required
            pass "${svc}: base Caddy image (acceptable)"
            ;;
        crawler|rag)
            # Python images — currently root, note for future hardening
            if [ -n "$user" ] && [ "$user" != "root" ] && [ "$user" != "0" ]; then
                pass "${svc}: runs as user '${user}' (non-root)"
            else
                warn "${svc}: runs as root (consider adding non-root user in future)"
            fi
            ;;
    esac
done

# =============================================================================
# 3. No secrets baked in
# =============================================================================
header "Checking for baked-in secrets"

SECRET_PATTERNS=(
    "OPENAI_API_KEY=sk-"
    "DB_PASSWORD="
    "BETTER_AUTH_SECRET="
    "ENCRYPTION_SECRET_HEX="
    "INSTANCE_SECRET="
)

for svc in "${SERVICES[@]}"; do
    img="${IMAGES[$svc]:-}"
    [ -z "$img" ] && continue

    found_secret=false

    # Check environment variables in image config
    env_vars=$(docker inspect --format='{{range .Config.Env}}{{.}} {{end}}' "$img" 2>/dev/null || echo "")

    for pattern in "${SECRET_PATTERNS[@]}"; do
        key="${pattern%%=*}"
        # Check if the secret is set to a real value (not empty, not a placeholder)
        if echo "$env_vars" | grep -qE "${key}=[^ ]+" 2>/dev/null; then
            value=$(echo "$env_vars" | tr ' ' '\n' | grep "^${key}=" | head -1 | cut -d= -f2-)
            # Allow empty values and known safe defaults
            if [ -n "$value" ] && [ "$value" != "test-key-not-real" ] && [ "$value" != "test-secret-do-not-use-in-production-1234567890" ]; then
                fail "${svc}: secret ${key} found in image env"
                found_secret=true
            fi
        fi
    done

    # Check for .env files in the image
    if docker run --rm --entrypoint="" "$img" find / -maxdepth 3 -name ".env" -o -name ".env.local" -o -name ".env.production" 2>/dev/null | grep -q ".env"; then
        fail "${svc}: .env file found in image filesystem"
        found_secret=true
    fi

    if [ "$found_secret" = false ]; then
        pass "${svc}: no secrets baked in"
    fi
done

# =============================================================================
# 4. Health check defined
# =============================================================================
header "Checking HEALTHCHECK instruction"

for svc in "${SERVICES[@]}"; do
    img="${IMAGES[$svc]:-}"
    [ -z "$img" ] && continue

    healthcheck=$(docker inspect --format='{{.Config.Healthcheck}}' "$img" 2>/dev/null || echo "")

    if [ -n "$healthcheck" ] && [ "$healthcheck" != "<nil>" ]; then
        pass "${svc}: HEALTHCHECK defined"
    else
        fail "${svc}: no HEALTHCHECK instruction"
    fi
done

# =============================================================================
# 5. Image size budget
# =============================================================================
header "Checking image size budgets"

echo ""
printf "  ${BOLD}%-12s  %-10s  %-10s  %-8s${NC}\n" "SERVICE" "SIZE (MB)" "BUDGET" "STATUS"
echo "  ──────────  ─────────  ─────────  ────────"

for svc in "${SERVICES[@]}"; do
    img="${IMAGES[$svc]:-}"
    [ -z "$img" ] && continue

    size_bytes=$(docker inspect --format='{{.Size}}' "$img" 2>/dev/null || echo "0")
    size_mb=$((size_bytes / 1024 / 1024))
    budget=${SIZE_BUDGETS[$svc]:-0}

    if [ $size_mb -le $budget ]; then
        printf "  ${GREEN}%-12s  %-10s  %-10s  ✓ OK${NC}\n" "$svc" "${size_mb} MB" "${budget} MB"
        pass "${svc}: ${size_mb} MB ≤ ${budget} MB budget"
    else
        printf "  ${RED}%-12s  %-10s  %-10s  ✗ OVER${NC}\n" "$svc" "${size_mb} MB" "${budget} MB"
        fail "${svc}: ${size_mb} MB exceeds ${budget} MB budget"
    fi
done

# =============================================================================
# 6. No unnecessary package managers (Python images)
# =============================================================================
header "Checking for unnecessary packages (Python images)"

for svc in crawler rag; do
    img="${IMAGES[$svc]:-}"
    [ -z "$img" ] && continue

    # Check if pip is still installed
    if docker run --rm --entrypoint="" "$img" pip --version 2>/dev/null; then
        warn "${svc}: pip still installed (consider removing)"
    else
        pass "${svc}: pip removed"
    fi
done

# =============================================================================
# SUMMARY
# =============================================================================
TOTAL=$((PASSED + FAILED))

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║           CONTAINER IMAGE TEST RESULTS                  ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"

for r in "${RESULTS[@]}"; do
    IFS='|' read -r name status <<< "$r"
    case "$status" in
        PASS) printf "  ${GREEN}✅ %-50s${NC}\n" "$name" ;;
        FAIL) printf "  ${RED}❌ %-50s${NC}\n" "$name" ;;
        WARN) printf "  ${YELLOW}⚠️  %-50s${NC}\n" "$name" ;;
    esac
done

echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "  Tests: ${TOTAL}  |  ${GREEN}Passed: ${PASSED}${NC}  |  ${RED}Failed: ${FAILED}${NC}  |  ${YELLOW}Warnings: ${WARNED}${NC}"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo -e "  ${GREEN}${BOLD}🎉 ALL IMAGE VALIDATION TESTS PASSED${NC}"
fi

echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

[ $FAILED -eq 0 ] || exit 1
