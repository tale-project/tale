#!/bin/bash
# ============================================================================
# Tale Platform - Blue-Green Logs Viewer
# ============================================================================
#
# Simplifies viewing logs for blue-green deployments by automatically
# detecting the active deployment color and showing relevant containers.
#
# USAGE:
#   ./scripts/logs.sh                    # View all active service logs (follow)
#   ./scripts/logs.sh platform           # View platform service logs
#   ./scripts/logs.sh platform rag       # View multiple service logs
#   ./scripts/logs.sh --no-follow        # Don't follow, show existing logs
#   ./scripts/logs.sh --tail 100         # Show last 100 lines
#   ./scripts/logs.sh --stateful         # Include db, proxy, graph-db
#
# ============================================================================

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

STATE_FILE="${PROJECT_ROOT}/.deployment-color"

# Rotatable services (blue-green)
ROTATABLE_SERVICE_BASES="platform rag crawler search"

# Stateful services (single instance)
STATEFUL_SERVICES="db proxy graph-db"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
  echo -e "${CYAN}[INFO]${NC} $1" >&2
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Detect which color is currently running
detect_current_color() {
  if [ -f "$STATE_FILE" ]; then
    local saved_color
    saved_color=$(cat "$STATE_FILE")
    if [ "$saved_color" = "blue" ] || [ "$saved_color" = "green" ]; then
      if docker ps --format '{{.Names}}' | grep -q "tale-platform-${saved_color}"; then
        echo "$saved_color"
        return
      fi
    fi
  fi

  if docker ps --format '{{.Names}}' | grep -q "tale-platform-blue"; then
    echo "blue"
  elif docker ps --format '{{.Names}}' | grep -q "tale-platform-green"; then
    echo "green"
  else
    echo "none"
  fi
}

# Check if a service base name is valid
is_valid_rotatable_service() {
  local service="$1"
  for base in $ROTATABLE_SERVICE_BASES; do
    if [ "$service" = "$base" ]; then
      return 0
    fi
  done
  return 1
}

is_valid_stateful_service() {
  local service="$1"
  for s in $STATEFUL_SERVICES; do
    if [ "$service" = "$s" ]; then
      return 0
    fi
  done
  return 1
}

# ============================================================================
# Main Logic
# ============================================================================

cmd_help() {
  echo ""
  echo "Tale Platform - Blue-Green Logs Viewer"
  echo ""
  echo "USAGE:"
  echo "  ./scripts/logs.sh [OPTIONS] [SERVICE...]"
  echo ""
  echo "OPTIONS:"
  echo "  -f, --follow      Follow log output (default)"
  echo "  -n, --no-follow   Don't follow, show existing logs only"
  echo "  -t, --tail N      Number of lines to show (default: 100)"
  echo "  -s, --stateful    Include stateful services (db, proxy, graph-db)"
  echo "  -h, --help        Show this help message"
  echo ""
  echo "SERVICES:"
  echo "  Rotatable (blue-green): platform, rag, crawler, search"
  echo "  Stateful (single):      db, proxy, graph-db"
  echo ""
  echo "EXAMPLES:"
  echo "  ./scripts/logs.sh                    # All active rotatable services"
  echo "  ./scripts/logs.sh platform           # Only platform service"
  echo "  ./scripts/logs.sh platform rag       # Platform and RAG services"
  echo "  ./scripts/logs.sh --stateful         # Include db, proxy, graph-db"
  echo "  ./scripts/logs.sh -n --tail 50       # Last 50 lines, no follow"
  echo "  ./scripts/logs.sh db                 # View database logs"
  echo ""
}

main() {
  local follow=true
  local tail_lines=100
  local include_stateful=false
  local services=()

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        cmd_help
        exit 0
        ;;
      -f|--follow)
        follow=true
        shift
        ;;
      -n|--no-follow)
        follow=false
        shift
        ;;
      -t|--tail)
        if [[ -n "${2:-}" ]] && [[ "$2" =~ ^[0-9]+$ ]]; then
          tail_lines="$2"
          shift 2
        else
          log_error "--tail requires a number"
          exit 1
        fi
        ;;
      -s|--stateful)
        include_stateful=true
        shift
        ;;
      -*)
        log_error "Unknown option: $1"
        cmd_help
        exit 1
        ;;
      *)
        services+=("$1")
        shift
        ;;
    esac
  done

  # Detect current deployment color
  local current_color
  current_color=$(detect_current_color)

  if [ "$current_color" = "none" ]; then
    log_error "No blue-green deployment detected"
    log_info "Use 'docker compose logs' for standard deployments"
    exit 1
  fi

  log_info "Active deployment: ${GREEN}${current_color}${NC}"

  # Build container list
  local containers=()

  if [ ${#services[@]} -eq 0 ]; then
    # No services specified - use all rotatable services
    for base in $ROTATABLE_SERVICE_BASES; do
      containers+=("tale-${base}-${current_color}")
    done
    if [ "$include_stateful" = true ]; then
      for s in $STATEFUL_SERVICES; do
        containers+=("tale-${s}")
      done
    fi
  else
    # Specific services requested
    for service in "${services[@]}"; do
      if is_valid_rotatable_service "$service"; then
        containers+=("tale-${service}-${current_color}")
      elif is_valid_stateful_service "$service"; then
        containers+=("tale-${service}")
      else
        log_error "Unknown service: $service"
        log_info "Valid services: $ROTATABLE_SERVICE_BASES $STATEFUL_SERVICES"
        exit 1
      fi
    done
  fi

  # Verify containers exist
  local valid_containers=()
  for container in "${containers[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
      valid_containers+=("$container")
    else
      log_info "Container not running: ${container}"
    fi
  done

  if [ ${#valid_containers[@]} -eq 0 ]; then
    log_error "No running containers found"
    exit 1
  fi

  # Build docker logs command
  local docker_args=("logs")
  docker_args+=("--tail" "$tail_lines")

  if [ "$follow" = true ]; then
    docker_args+=("-f")
  fi

  # Show logs
  echo ""
  log_info "Showing logs for: ${valid_containers[*]}"
  echo ""

  if [ ${#valid_containers[@]} -eq 1 ]; then
    # Single container - direct docker logs
    docker "${docker_args[@]}" "${valid_containers[0]}"
  else
    # Multiple containers - use docker compose logs with container names
    # We need to use docker logs for each and merge, or use a different approach
    # Using docker compose logs doesn't work well here since containers have different names
    # Use docker logs with multiple containers via a simple approach

    if [ "$follow" = true ]; then
      # For follow mode with multiple containers, we need to interleave
      # Use docker compose logs by matching container names
      docker compose \
        -f "${PROJECT_ROOT}/compose.yml" \
        -f "${PROJECT_ROOT}/compose.${current_color}.yml" \
        logs --tail "$tail_lines" -f "${valid_containers[@]}" 2>/dev/null || {
        # Fallback: show each container separately
        log_info "Falling back to sequential container logs..."
        for container in "${valid_containers[@]}"; do
          echo -e "\n${CYAN}=== ${container} ===${NC}"
          docker logs --tail "$tail_lines" "$container" 2>&1 | tail -20
        done
        log_info "Use single service for follow mode: ./scripts/logs.sh platform"
      }
    else
      # No follow - show each container's logs
      for container in "${valid_containers[@]}"; do
        echo -e "${CYAN}=== ${container} ===${NC}"
        docker logs --tail "$tail_lines" "$container" 2>&1
        echo ""
      done
    fi
  fi
}

main "$@"
