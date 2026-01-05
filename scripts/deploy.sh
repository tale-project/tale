#!/bin/bash
# ============================================================================
# Tale Platform - Blue-Green Deployment Script
# ============================================================================
#
# This script orchestrates zero-downtime deployments using blue-green strategy.
# Two versions of stateless services run simultaneously during deployment,
# with traffic switched only after the new version is healthy.
#
# USAGE:
#   ./scripts/deploy.sh deploy    # Deploy new version
#   ./scripts/deploy.sh rollback  # Rollback to previous version
#   ./scripts/deploy.sh status    # Show current deployment status
#   ./scripts/deploy.sh cleanup   # Remove inactive containers
#   ./scripts/deploy.sh reset     # Remove ALL blue-green containers
#
# REQUIREMENTS:
#   - Docker and Docker Compose
#   - At least 12-16 GB RAM (runs 2x services during deployment)
#
# HOW IT WORKS:
#   1. Detect current color (blue/green/none)
#   2. Build and start opposite color
#   3. Wait for health checks to pass
#   4. Traffic automatically routes to healthy backend (Caddy handles this)
#   5. Drain and cleanup old containers
#
# ============================================================================

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# State file to track current deployment color
STATE_FILE="${PROJECT_ROOT}/.deployment-color"

# Lock file to prevent concurrent deployments
LOCK_FILE="${PROJECT_ROOT}/.deployment-lock"

# Timeouts (in seconds)
HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-180}"  # Max time to wait for health
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-1}"   # Interval between checks
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-30}"                  # Time to drain old containers

# Base service names for blue-green rotation
# These are "rotatable" services - they can run in parallel during deployment:
# - platform: Application server, no local state
# - rag: RAG service, data stored in shared volume (rag-data)
# - crawler: Web crawler, no local state
# - search: Search engine, no local state
#
# Services NOT included (shared between blue/green, single instance only):
# - db: TimescaleDB - single instance required for data consistency
# - proxy: Caddy - single entry point for traffic routing
# - graph-db: Kuzu - requires exclusive file lock, cannot run two instances
#
# The actual service names in compose files are suffixed with color:
# e.g., platform-blue, platform-green, rag-blue, rag-green, etc.
ROTATABLE_SERVICE_BASES="platform rag crawler search"

# Helper to get service names for a color
get_services_for_color() {
  local color="$1"
  local services=""
  for base in $ROTATABLE_SERVICE_BASES; do
    services="${services} ${base}-${color}"
  done
  echo "$services"
}

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
# Helper Functions
# ============================================================================

# Acquire deployment lock
acquire_lock() {
  if [ -f "$LOCK_FILE" ]; then
    local lock_pid
    lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      log_error "Another deployment is in progress (PID: $lock_pid)"
      return 1
    fi
    # Stale lock file, remove it
    rm -f "$LOCK_FILE"
  fi
  echo $$ > "$LOCK_FILE"
  trap 'rm -f "$LOCK_FILE"' EXIT
  return 0
}

# Release deployment lock
release_lock() {
  rm -f "$LOCK_FILE"
}

# Get the opposite color
opposite_color() {
  local color="$1"
  if [ "$color" = "blue" ]; then
    echo "green"
  else
    echo "blue"
  fi
}

# Detect which color is currently running
detect_current_color() {
  # Check state file first
  if [ -f "$STATE_FILE" ]; then
    local saved_color
    saved_color=$(cat "$STATE_FILE")
    if [ "$saved_color" = "blue" ] || [ "$saved_color" = "green" ]; then
      # Verify the container is actually running
      if docker ps --format '{{.Names}}' | grep -q "tale-platform-${saved_color}"; then
        echo "$saved_color"
        return
      fi
    fi
  fi

  # Fallback: check running containers
  if docker ps --format '{{.Names}}' | grep -q "tale-platform-blue"; then
    echo "blue"
  elif docker ps --format '{{.Names}}' | grep -q "tale-platform-green"; then
    echo "green"
  else
    echo "none"
  fi
}

# Save current deployment color to state file
save_deployment_color() {
  local color="$1"
  echo "$color" > "$STATE_FILE"
}

# Check if a service is healthy
check_service_health() {
  local color="$1"
  local service="$2"
  local container_name="tale-${service}-${color}"

  # Check if container exists and is running
  if ! docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
    return 1
  fi

  # Check container health status
  local health_status
  health_status=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "none")

  [ "$health_status" = "healthy" ]
}

# Wait for all services to be healthy
wait_for_health() {
  local color="$1"
  local elapsed=0

  log_step "Waiting for ${color} services to be healthy..."

  while [ "$elapsed" -lt "$HEALTH_CHECK_TIMEOUT" ]; do
    local all_healthy=true

    for service in $ROTATABLE_SERVICE_BASES; do
      if ! check_service_health "$color" "$service"; then
        all_healthy=false
        break
      fi
    done

    if $all_healthy; then
      log_success "All ${color} services are healthy!"
      return 0
    fi

    # Show progress
    local progress_services=""
    for service in $ROTATABLE_SERVICE_BASES; do
      if check_service_health "$color" "$service"; then
        progress_services="${progress_services} ${service}:${GREEN}OK${NC}"
      else
        progress_services="${progress_services} ${service}:${YELLOW}...${NC}"
      fi
    done
    echo -ne "\r   Status (${elapsed}s/${HEALTH_CHECK_TIMEOUT}s):${progress_services}    "

    sleep "$HEALTH_CHECK_INTERVAL"
    elapsed=$((elapsed + HEALTH_CHECK_INTERVAL))
  done

  echo ""
  log_error "Health check timeout after ${HEALTH_CHECK_TIMEOUT}s"
  return 1
}

# Wait for platform health endpoint specifically
wait_for_platform_health() {
  local color="$1"
  local elapsed=0

  log_info "Waiting for platform-${color} health endpoint..."

  while [ "$elapsed" -lt "$HEALTH_CHECK_TIMEOUT" ]; do
    # Try to hit the health endpoint via Docker network
    if docker exec "tale-platform-${color}" curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
      log_success "Platform ${color} health endpoint responding!"
      return 0
    fi

    sleep "$HEALTH_CHECK_INTERVAL"
    elapsed=$((elapsed + HEALTH_CHECK_INTERVAL))
    echo -ne "\r   Waiting... (${elapsed}s/${HEALTH_CHECK_TIMEOUT}s)    "
  done

  echo ""
  log_error "Platform health check timeout"
  return 1
}

# Reload Caddy to refresh upstream health
reload_caddy() {
  log_info "Reloading Caddy configuration..."
  if docker exec tale-proxy caddy reload --config /config/Caddyfile 2>/dev/null; then
    log_success "Caddy reloaded successfully"
    return 0
  else
    log_warning "Caddy reload failed (may not affect health-based routing)"
    return 0
  fi
}

# Stop and remove containers for a color
cleanup_color() {
  local color="$1"
  local force="${2:-false}"

  log_step "Cleaning up ${color} containers..."

  # Build list of container names for this color
  local containers=""
  for service in $ROTATABLE_SERVICE_BASES; do
    containers="${containers} tale-${service}-${color}"
  done

  if [ "$force" = "true" ]; then
    # Force stop immediately
    docker rm -f $containers 2>/dev/null || true
  else
    # Graceful stop - SIGTERM will trigger graceful shutdown
    docker stop $containers 2>/dev/null || true
    docker rm $containers 2>/dev/null || true
  fi

  log_success "${color} containers cleaned up"
}

# ============================================================================
# Main Commands
# ============================================================================

# Deploy new version
cmd_deploy() {
  local current_color
  local target_color

  # Prevent concurrent deployments
  if ! acquire_lock; then
    return 1
  fi

  log_step "Starting blue-green deployment"
  echo ""

  # Step 1: Detect current state
  current_color=$(detect_current_color)
  log_info "Current deployment: ${current_color}"

  if [ "$current_color" = "none" ]; then
    target_color="blue"
    log_info "First deployment - targeting blue"
  else
    target_color=$(opposite_color "$current_color")
    log_info "Targeting: ${target_color}"
  fi

  # Step 2: Ensure required Docker volumes exist
  # Blue-green compose files declare these as external volumes
  log_step "Ensuring required Docker volumes exist..."
  for volume in tale_platform-convex-data tale_caddy-data tale_rag-data; do
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
      log_info "Creating volume: ${volume}"
      docker volume create "$volume"
    fi
  done

  # Step 3: Ensure stateful services are running
  # These services run as single instances (not blue-green rotated)
  log_step "Ensuring stateful services (db, proxy, graph-db) are running..."

  # Check if proxy is already healthy - avoid recreating it to preserve TLS state
  local proxy_healthy=false
  if docker ps --format '{{.Names}}' | grep -q "^tale-proxy$"; then
    local proxy_health
    proxy_health=$(docker inspect --format='{{.State.Health.Status}}' "tale-proxy" 2>/dev/null || echo "none")
    if [ "$proxy_health" = "healthy" ]; then
      proxy_healthy=true
      log_info "Proxy already healthy, skipping recreation to preserve TLS certificates"
    fi
  fi

  if [ "$proxy_healthy" = "true" ]; then
    # Only start db and graph-db, leave proxy alone
    docker compose -f "${PROJECT_ROOT}/compose.yml" up -d db graph-db
  else
    # Rebuild proxy to ensure latest image (entrypoint changes, etc.)
    log_info "Building proxy image..."
    docker compose -f "${PROJECT_ROOT}/compose.yml" build proxy
    docker compose -f "${PROJECT_ROOT}/compose.yml" up -d db proxy graph-db
  fi

  # Wait for stateful services to be healthy
  log_info "Waiting for stateful services to be ready..."
  local stateful_wait=0
  local stateful_timeout=60
  while [ "$stateful_wait" -lt "$stateful_timeout" ]; do
    local all_ready=true
    for service in db proxy graph-db; do
      local health
      health=$(docker inspect --format='{{.State.Health.Status}}' "tale-${service}" 2>/dev/null || echo "none")
      if [ "$health" != "healthy" ]; then
        all_ready=false
        break
      fi
    done

    if $all_ready; then
      log_success "Stateful services are ready"
      break
    fi

    sleep 2
    stateful_wait=$((stateful_wait + 2))
  done

  if [ "$stateful_wait" -ge "$stateful_timeout" ]; then
    log_warning "Stateful services may not be fully ready, continuing anyway..."
  fi

  # Step 4: Build new version
  # The compose.{color}.yml files define separate services (platform-blue, platform-green, etc.)
  # so they won't conflict with each other
  log_step "Building ${target_color} containers..."
  local target_services
  target_services=$(get_services_for_color "$target_color")

  if ! docker compose -f "${PROJECT_ROOT}/compose.${target_color}.yml" build $target_services; then
    log_error "Build failed!"
    return 1
  fi

  # Step 5: Start new version
  # Since blue/green services have different names (platform-blue vs platform-green),
  # starting one color won't affect the other color's containers
  log_step "Starting ${target_color} containers..."
  if ! docker compose -f "${PROJECT_ROOT}/compose.${target_color}.yml" up -d $target_services; then
    log_error "Failed to start ${target_color} containers!"
    return 1
  fi

  # Step 6: Wait for health
  if ! wait_for_health "$target_color"; then
    log_error "New deployment failed health checks!"
    log_warning "Rolling back - stopping ${target_color} containers..."
    cleanup_color "$target_color" true
    return 1
  fi

  # Step 7: Reload Caddy (optional - health checks should handle routing)
  reload_caddy

  # Step 8: Wait for Caddy to route traffic to new services
  # This ensures Caddy's health checks have detected the new healthy backends
  # before we start draining the old ones
  #
  # Caddy uses health_passes=2 and health_interval=2s, so we need at least 4s
  # after Docker marks the container healthy before Caddy will route to it.
  # We add extra buffer for safety.
  log_step "Waiting for Caddy to detect ${target_color} as healthy..."

  # Wait for Caddy's health checks (health_interval=2s * health_passes=2 = 4s minimum)
  # Plus extra buffer for network latency and processing
  local caddy_stabilize_time=10
  echo "   Waiting ${caddy_stabilize_time}s for Caddy health checks to stabilize..."
  sleep "$caddy_stabilize_time"

  # Verify traffic is being served through proxy
  # Note: -k flag accepts self-signed certs (TLS_MODE=selfsigned in local dev)
  # Load DOMAIN_HOST from .env file (defaults to tale.local for local dev)
  local domain_host
  domain_host=$(grep -E "^DOMAIN_HOST=" "${PROJECT_ROOT}/.env" 2>/dev/null | cut -d= -f2 || echo "tale.local")
  domain_host="${domain_host:-tale.local}"

  local caddy_verify_attempts=0
  local caddy_verify_max=5
  while [ "$caddy_verify_attempts" -lt "$caddy_verify_max" ]; do
    if curl -sf -o /dev/null -k --max-time 3 "https://${domain_host}/api/health" 2>/dev/null; then
      log_success "Proxy is serving traffic successfully"
      break
    fi
    caddy_verify_attempts=$((caddy_verify_attempts + 1))
    echo "   Retry ${caddy_verify_attempts}/${caddy_verify_max}..."
    sleep 2
  done

  if [ "$caddy_verify_attempts" -ge "$caddy_verify_max" ]; then
    log_error "Could not verify proxy routing after ${caddy_verify_max} attempts"
    log_error "Refusing to drain old containers - new services may not be serving traffic"
    log_warning "Rolling back - stopping ${target_color} containers..."
    cleanup_color "$target_color" true
    return 1
  fi

  # Step 9: Drain and cleanup old version
  if [ "$current_color" != "none" ]; then
    log_step "Draining ${current_color} containers (${DRAIN_TIMEOUT}s)..."

    # The old containers will receive SIGTERM which triggers graceful shutdown
    # Wait for drain period
    local drain_elapsed=0
    while [ "$drain_elapsed" -lt "$DRAIN_TIMEOUT" ]; do
      echo -ne "\r   Draining... (${drain_elapsed}s/${DRAIN_TIMEOUT}s)    "
      sleep 5
      drain_elapsed=$((drain_elapsed + 5))
    done
    echo ""

    # Cleanup old containers
    cleanup_color "$current_color"
  fi

  # Step 10: Save state
  save_deployment_color "$target_color"

  echo ""
  log_success "Deployment complete! Now running: ${target_color}"
  echo ""
  cmd_status
}

# Rollback to previous version
cmd_rollback() {
  local current_color
  local rollback_color

  log_step "Starting rollback"

  current_color=$(detect_current_color)

  if [ "$current_color" = "none" ]; then
    log_error "No deployment found to rollback from"
    return 1
  fi

  rollback_color=$(opposite_color "$current_color")
  log_info "Current: ${current_color}"
  log_info "Rolling back to: ${rollback_color}"

  # Start rollback containers (will use existing images)
  # Since blue/green have separate service definitions, no conflict occurs
  log_step "Starting ${rollback_color} containers..."
  local rollback_services
  rollback_services=$(get_services_for_color "$rollback_color")

  if ! docker compose -f "${PROJECT_ROOT}/compose.${rollback_color}.yml" up -d $rollback_services; then
    log_error "Failed to start ${rollback_color} containers"
    return 1
  fi

  if wait_for_health "$rollback_color"; then
    log_success "Rollback containers started!"

    # Drain and cleanup current
    log_step "Draining ${current_color} containers (${DRAIN_TIMEOUT}s)..."
    local drain_elapsed=0
    while [ "$drain_elapsed" -lt "$DRAIN_TIMEOUT" ]; do
      echo -ne "\r   Draining... (${drain_elapsed}s/${DRAIN_TIMEOUT}s)    "
      sleep 5
      drain_elapsed=$((drain_elapsed + 5))
    done
    echo ""

    cleanup_color "$current_color"

    save_deployment_color "$rollback_color"
    log_success "Rollback complete! Now running: ${rollback_color}"
    return 0
  else
    log_error "Rollback containers failed health check"
    log_warning "Cleaning up failed rollback containers..."
    cleanup_color "$rollback_color" true
    return 1
  fi
}

# Show current deployment status
cmd_status() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "                  Tale Platform Deployment Status              "
  echo "═══════════════════════════════════════════════════════════════"
  echo ""

  # Current color
  local current_color
  current_color=$(detect_current_color)
  echo -e "  Active Deployment: ${GREEN}${current_color}${NC}"
  echo ""

  # Stateful services (single instance, not rotated)
  echo "  Stateful Services:"
  for service in db proxy graph-db; do
    local container_name="tale-${service}"
    if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
      local health
      health=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "N/A")
      echo -e "    ${service}: ${GREEN}running${NC} (health: ${health})"
    else
      echo -e "    ${service}: ${RED}not running${NC}"
    fi
  done
  echo ""

  # Blue services
  echo "  Blue Services:"
  for service in $ROTATABLE_SERVICE_BASES; do
    local container_name="tale-${service}-blue"
    if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
      local health
      health=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "N/A")
      if [ "$current_color" = "blue" ]; then
        echo -e "    ${service}: ${GREEN}running${NC} (health: ${health}) ${CYAN}[ACTIVE]${NC}"
      else
        echo -e "    ${service}: ${YELLOW}running${NC} (health: ${health})"
      fi
    else
      echo -e "    ${service}: ${RED}not running${NC}"
    fi
  done
  echo ""

  # Green services
  echo "  Green Services:"
  for service in $ROTATABLE_SERVICE_BASES; do
    local container_name="tale-${service}-green"
    if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
      local health
      health=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "N/A")
      if [ "$current_color" = "green" ]; then
        echo -e "    ${service}: ${GREEN}running${NC} (health: ${health}) ${CYAN}[ACTIVE]${NC}"
      else
        echo -e "    ${service}: ${YELLOW}running${NC} (health: ${health})"
      fi
    else
      echo -e "    ${service}: ${RED}not running${NC}"
    fi
  done
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
}

# Cleanup inactive blue-green containers (preserves active deployment)
cmd_cleanup() {
  log_step "Cleaning up inactive deployment containers..."

  local current_color
  current_color=$(detect_current_color)

  if [ "$current_color" != "none" ]; then
    log_warning "Current deployment (${current_color}) will be preserved"
    local other_color
    other_color=$(opposite_color "$current_color")
    cleanup_color "$other_color" true
  else
    log_info "No active deployment found, cleaning both colors..."
    cleanup_color "blue" true
    cleanup_color "green" true
  fi

  log_success "Cleanup complete"
}

# Reset: Remove ALL blue-green containers and state
# Use this to return to normal docker compose mode
cmd_reset() {
  log_step "Resetting blue-green deployment state..."
  log_warning "This will remove ALL blue and green containers!"
  echo ""

  # Check if there are any blue-green containers running
  local has_blue=false
  local has_green=false

  for service in $ROTATABLE_SERVICE_BASES; do
    if docker ps -a --format '{{.Names}}' | grep -q "^tale-${service}-blue$"; then
      has_blue=true
    fi
    if docker ps -a --format '{{.Names}}' | grep -q "^tale-${service}-green$"; then
      has_green=true
    fi
  done

  if [ "$has_blue" = "false" ] && [ "$has_green" = "false" ]; then
    log_info "No blue-green containers found"
    # Still clean up state file if it exists
    if [ -f "$STATE_FILE" ]; then
      rm -f "$STATE_FILE"
      log_info "Removed deployment state file"
    fi
    log_success "Reset complete - ready for normal docker compose"
    return 0
  fi

  # Show what will be removed
  echo "  The following containers will be removed:"
  echo ""
  if [ "$has_blue" = "true" ]; then
    echo -e "  ${BLUE}Blue:${NC}"
    for service in $ROTATABLE_SERVICE_BASES; do
      local container_name="tale-${service}-blue"
      if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        local status
        status=$(docker inspect --format='{{.State.Status}}' "$container_name" 2>/dev/null || echo "unknown")
        echo "    - ${container_name} (${status})"
      fi
    done
  fi
  if [ "$has_green" = "true" ]; then
    echo -e "  ${GREEN}Green:${NC}"
    for service in $ROTATABLE_SERVICE_BASES; do
      local container_name="tale-${service}-green"
      if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        local status
        status=$(docker inspect --format='{{.State.Status}}' "$container_name" 2>/dev/null || echo "unknown")
        echo "    - ${container_name} (${status})"
      fi
    done
  fi
  echo ""

  # Prompt for confirmation unless --force flag is passed
  if [ "${1:-}" != "--force" ] && [ "${1:-}" != "-f" ]; then
    echo -n "  Are you sure you want to continue? [y/N] "
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
      log_info "Reset cancelled"
      return 0
    fi
  fi

  echo ""

  # Stop and remove all blue-green containers
  if [ "$has_blue" = "true" ]; then
    cleanup_color "blue" true
  fi
  if [ "$has_green" = "true" ]; then
    cleanup_color "green" true
  fi

  # Remove state file
  if [ -f "$STATE_FILE" ]; then
    rm -f "$STATE_FILE"
    log_info "Removed deployment state file"
  fi

  echo ""
  log_success "Reset complete!"
  echo ""
  echo "  You can now use normal docker compose commands:"
  echo "    docker compose up -d"
  echo ""
}

# Show usage
cmd_help() {
  echo ""
  echo "Tale Platform - Blue-Green Deployment Script"
  echo ""
  echo "USAGE:"
  echo "  ./scripts/deploy.sh <command>"
  echo ""
  echo "COMMANDS:"
  echo "  deploy    Deploy a new version (zero-downtime)"
  echo "  rollback  Rollback to previous version"
  echo "  status    Show current deployment status"
  echo "  cleanup   Remove inactive containers (preserves active deployment)"
  echo "  reset     Remove ALL blue-green containers and return to normal mode"
  echo "  help      Show this help message"
  echo ""
  echo "ENVIRONMENT VARIABLES:"
  echo "  HEALTH_CHECK_TIMEOUT  Max time to wait for health (default: 180s)"
  echo "  HEALTH_CHECK_INTERVAL Interval between checks (default: 1s)"
  echo "  DRAIN_TIMEOUT         Time to drain old containers (default: 30s)"
  echo ""
  echo "EXAMPLES:"
  echo "  # Normal deployment"
  echo "  ./scripts/deploy.sh deploy"
  echo ""
  echo "  # Deploy with custom timeout"
  echo "  HEALTH_CHECK_TIMEOUT=300 ./scripts/deploy.sh deploy"
  echo ""
  echo "  # Quick rollback after failed deployment"
  echo "  ./scripts/deploy.sh rollback"
  echo ""
  echo "  # Remove all blue-green containers (return to docker compose mode)"
  echo "  ./scripts/deploy.sh reset"
  echo ""
  echo "  # Force reset without confirmation"
  echo "  ./scripts/deploy.sh reset --force"
  echo ""
}

# ============================================================================
# Main Entry Point
# ============================================================================

main() {
  local command="${1:-help}"
  shift || true  # Remove command from arguments

  # Change to project root
  cd "$PROJECT_ROOT"

  case "$command" in
    deploy)
      cmd_deploy
      ;;
    rollback)
      cmd_rollback
      ;;
    status)
      cmd_status
      ;;
    cleanup)
      cmd_cleanup
      ;;
    reset)
      cmd_reset "$@"
      ;;
    help|--help|-h)
      cmd_help
      ;;
    *)
      log_error "Unknown command: ${command}"
      cmd_help
      exit 1
      ;;
  esac
}

main "$@"
