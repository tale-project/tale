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
#   ./scripts/deploy.sh cleanup   # Remove old containers
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

# Timeouts (in seconds)
HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-180}"  # Max time to wait for health
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-3}"   # Interval between checks
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-30}"                  # Time to drain old containers

# Services to deploy (stateless services only)
# Stateful services (db, proxy) are not included in blue-green rotation
STATELESS_SERVICES="platform rag crawler search graph-db"

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

# Build compose command with overlay file
compose_cmd() {
  local color="$1"
  echo "docker compose -f ${PROJECT_ROOT}/compose.yml -f ${PROJECT_ROOT}/compose.${color}.yml"
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

  while [ $elapsed -lt $HEALTH_CHECK_TIMEOUT ]; do
    local all_healthy=true

    for service in $STATELESS_SERVICES; do
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
    for service in $STATELESS_SERVICES; do
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

  while [ $elapsed -lt $HEALTH_CHECK_TIMEOUT ]; do
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
  if docker exec tale-proxy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null; then
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

  # Get the compose command
  local cmd
  cmd=$(compose_cmd "$color")

  if [ "$force" = "true" ]; then
    # Force stop immediately
    $cmd down --remove-orphans 2>/dev/null || true
  else
    # Graceful stop - SIGTERM will trigger graceful shutdown in entrypoint
    $cmd stop 2>/dev/null || true
    $cmd rm -f 2>/dev/null || true
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

  # Step 2: Ensure stateful services are running
  log_step "Ensuring stateful services (db, proxy) are running..."
  docker compose -f "${PROJECT_ROOT}/compose.yml" up -d db proxy
  sleep 5  # Give stateful services time to start

  # Step 3: Build new version
  log_step "Building ${target_color} containers..."
  local compose_target
  compose_target=$(compose_cmd "$target_color")

  if ! $compose_target build; then
    log_error "Build failed!"
    return 1
  fi

  # Step 4: Start new version
  log_step "Starting ${target_color} containers..."
  if ! $compose_target up -d; then
    log_error "Failed to start ${target_color} containers!"
    return 1
  fi

  # Step 5: Wait for health
  if ! wait_for_health "$target_color"; then
    log_error "New deployment failed health checks!"
    log_warning "Rolling back - stopping ${target_color} containers..."
    cleanup_color "$target_color" true
    return 1
  fi

  # Step 6: Reload Caddy (optional - health checks should handle routing)
  reload_caddy

  # Step 7: Drain and cleanup old version
  if [ "$current_color" != "none" ]; then
    log_step "Draining ${current_color} containers (${DRAIN_TIMEOUT}s)..."

    # The old containers will receive SIGTERM which triggers graceful shutdown
    # Wait for drain period
    local drain_elapsed=0
    while [ $drain_elapsed -lt $DRAIN_TIMEOUT ]; do
      echo -ne "\r   Draining... (${drain_elapsed}s/${DRAIN_TIMEOUT}s)    "
      sleep 5
      drain_elapsed=$((drain_elapsed + 5))
    done
    echo ""

    # Cleanup old containers
    cleanup_color "$current_color"
  fi

  # Step 8: Save state
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

  # Check if rollback containers exist (maybe from failed deployment)
  if docker ps -a --format '{{.Names}}' | grep -q "tale-platform-${rollback_color}"; then
    # Try to start existing containers
    log_step "Starting existing ${rollback_color} containers..."
    local compose_target
    compose_target=$(compose_cmd "$rollback_color")
    $compose_target up -d

    if wait_for_health "$rollback_color"; then
      log_success "Rollback containers started!"

      # Drain and cleanup current
      log_step "Draining ${current_color} containers..."
      sleep "$DRAIN_TIMEOUT"
      cleanup_color "$current_color"

      save_deployment_color "$rollback_color"
      log_success "Rollback complete! Now running: ${rollback_color}"
      return 0
    else
      log_error "Rollback containers failed health check"
      return 1
    fi
  fi

  log_error "No ${rollback_color} containers found for rollback"
  log_info "Hint: Rollback works best immediately after a failed deployment"
  log_info "For a fresh deployment, use: ./scripts/deploy.sh deploy"
  return 1
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

  # Stateful services
  echo "  Stateful Services:"
  for service in db proxy; do
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
  for service in $STATELESS_SERVICES; do
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
  for service in $STATELESS_SERVICES; do
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

# Cleanup all blue-green containers
cmd_cleanup() {
  log_step "Cleaning up all deployment containers..."

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
  echo "  cleanup   Remove inactive containers"
  echo "  help      Show this help message"
  echo ""
  echo "ENVIRONMENT VARIABLES:"
  echo "  HEALTH_CHECK_TIMEOUT  Max time to wait for health (default: 180s)"
  echo "  HEALTH_CHECK_INTERVAL Interval between checks (default: 3s)"
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
}

# ============================================================================
# Main Entry Point
# ============================================================================

main() {
  local command="${1:-help}"

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
