#!/bin/bash
# ============================================================================
# Tale Platform - One-Click Upgrade Script
# ============================================================================
#
# This script simplifies the upgrade process for Tale platform deployments.
# It pulls the specified version from GHCR and performs a zero-downtime
# blue-green deployment.
#
# PREREQUISITES:
#   - Docker logged into GHCR: docker login ghcr.io
#   - Existing Tale deployment running
#
# USAGE:
#   ./scripts/upgrade.sh <version>
#
# EXAMPLES:
#   ./scripts/upgrade.sh v1.0.0    # Upgrade to specific version
#   ./scripts/upgrade.sh latest    # Upgrade to latest version
#
# ROLLBACK:
#   ./scripts/deploy.sh rollback   # Rollback to previous version
#   ./scripts/upgrade.sh v0.9.0    # Or upgrade to a specific older version
#
# ============================================================================

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# Logging Functions
# ============================================================================

log_info() {
  echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
  echo -e "\n${BLUE}==>${NC} $1"
}

# ============================================================================
# Main
# ============================================================================

main() {
  local version="${1:-}"

  # Validate version argument
  if [[ -z "$version" ]]; then
    echo ""
    echo "Tale Platform - One-Click Upgrade Script"
    echo ""
    echo "Usage: ./scripts/upgrade.sh <version>"
    echo ""
    echo "Examples:"
    echo "  ./scripts/upgrade.sh v1.0.0    # Upgrade to specific version"
    echo "  ./scripts/upgrade.sh latest    # Upgrade to latest version"
    echo ""
    echo "Available versions can be found at:"
    echo "  https://github.com/tale-project/tale/pkgs/container/tale%2Ftale-platform"
    echo ""
    exit 1
  fi

  # Normalize version (strip 'v' prefix for image tags if present)
  local image_tag="$version"
  if [[ "$version" == v* ]]; then
    image_tag="${version#v}"
  fi

  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "              Tale Platform Upgrade to ${version}              "
  echo "═══════════════════════════════════════════════════════════════"
  echo ""

  # Change to project root
  cd "$PROJECT_ROOT"

  # Step 1: Show current status
  log_step "Current deployment status"
  ./scripts/deploy.sh status 2>/dev/null || log_warning "No existing deployment found"

  # Step 2: Check GHCR authentication
  log_step "Checking GHCR authentication..."
  if ! docker pull ghcr.io/tale-project/tale/tale-platform:"$image_tag" --quiet 2>/dev/null; then
    log_error "Failed to pull image. Please ensure you're logged into GHCR:"
    echo ""
    echo "  docker login ghcr.io -u <github-username>"
    echo ""
    echo "You'll need a Personal Access Token with 'read:packages' scope."
    exit 1
  fi
  log_success "GHCR authentication verified"

  # Step 3: Pull all images
  log_step "Pulling Tale images (version: ${image_tag})..."
  local images=(
    "tale-platform"
    "tale-rag"
    "tale-crawler"
    "tale-db"
    "tale-graph-db"
    "tale-proxy"
    "tale-search"
  )

  for image in "${images[@]}"; do
    echo -n "  Pulling ${image}:${image_tag}... "
    if docker pull "ghcr.io/tale-project/tale/${image}:${image_tag}" --quiet >/dev/null 2>&1; then
      echo -e "${GREEN}OK${NC}"
    else
      echo -e "${YELLOW}SKIP${NC} (image not found)"
    fi
  done
  log_success "Images pulled successfully"

  # Step 4: Deploy with PULL_POLICY=always
  log_step "Deploying ${version} with zero-downtime..."
  echo ""

  # Export environment variables for deploy.sh
  export PULL_POLICY=always
  export VERSION="$image_tag"

  # Run the deploy script
  if ./scripts/deploy.sh deploy; then
    echo ""
    log_success "Upgrade to ${version} complete!"
    echo ""

    # Step 5: Verify version
    log_step "Verifying deployment version..."
    sleep 2  # Brief wait for services to stabilize

    # Try to get version from health endpoint
    local domain_host
    domain_host=$(grep -E "^HOST=" "${PROJECT_ROOT}/.env" 2>/dev/null | cut -d= -f2 || echo "tale.local")
    domain_host="${domain_host:-tale.local}"

    local health_response
    if health_response=$(curl -sf -k --max-time 5 "https://${domain_host}/api/health" 2>/dev/null); then
      local running_version
      running_version=$(echo "$health_response" | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
      log_success "Running version: ${running_version}"
    else
      log_warning "Could not verify version via health endpoint"
    fi

    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "                    Upgrade Complete!                          "
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "  To check status:    ./scripts/deploy.sh status"
    echo "  To rollback:        ./scripts/deploy.sh rollback"
    echo "  To upgrade again:   ./scripts/upgrade.sh <version>"
    echo ""
  else
    log_error "Upgrade failed!"
    echo ""
    echo "The previous version should still be running."
    echo "Check logs with: docker compose logs"
    exit 1
  fi
}

main "$@"
