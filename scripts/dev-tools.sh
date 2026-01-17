#!/bin/bash
# ============================================================================
# Tale Platform - Development Tools Manager
# ============================================================================
#
# Manages development-only visualization tools for RAG service data:
# - Kuzu Explorer: Graph database visualization (nodes and relationships)
# - Lance Data Viewer: Vector database visualization (embeddings)
#
# These tools run in read-only mode and do not affect the RAG service.
# Uses standalone docker run commands - does not modify compose.yml.
#
# IMPORTANT: In multi-tenant mode (ENABLE_BACKEND_ACCESS_CONTROL=true), each
# user/dataset has its own Kuzu database file stored at:
#   .cognee_system/databases/{user_id}/{dataset_id}.pkl
#
# When starting, if multiple databases exist, an interactive menu will let you
# choose which one to view in Kuzu Explorer.
#
# USAGE:
#   ./scripts/dev-tools.sh                    # Show status and URLs
#   ./scripts/dev-tools.sh start              # Start visualization tools
#   ./scripts/dev-tools.sh stop               # Stop visualization tools
#   ./scripts/dev-tools.sh logs               # View logs from tools
#   ./scripts/dev-tools.sh list-kuzu          # List available Kuzu databases
#
# ============================================================================

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Container names
KUZU_CONTAINER="tale-kuzu-explorer"
LANCE_CONTAINER="tale-lance-viewer"

# Ports
KUZU_PORT=8787
LANCE_PORT=8788

# Docker images
KUZU_IMAGE="kuzudb/explorer:0.11.3"
LANCE_IMAGE="ghcr.io/gordonmurray/lance-data-viewer:lancedb-0.24.3"

# Volume name (must match compose.yml)
RAG_DATA_VOLUME="tale_rag-data"

# Docker network (must match compose.yml)
DOCKER_NETWORK="tale_internal"

# PostgreSQL connection for name resolution (must match compose.yml)
PG_CONTAINER="tale-db"
PG_DATABASE="tale_rag"
PG_USER="tale"

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

log_success() {
  echo -e "${GREEN}[OK]${NC} $1" >&2
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

is_container_running() {
  docker ps --filter "name=$1" --format '{{.Names}}' 2>/dev/null | grep -q "^$1$"
}

check_volume_exists() {
  docker volume inspect "${RAG_DATA_VOLUME}" &>/dev/null
}

check_network_exists() {
  docker network inspect "${DOCKER_NETWORK}" &>/dev/null
}

is_rag_running() {
  docker ps --filter "name=tale-rag" --format '{{.Names}}' 2>/dev/null | grep -q "tale-rag"
}

is_pg_available() {
  docker exec "${PG_CONTAINER}" pg_isready -U "${PG_USER}" -d "${PG_DATABASE}" &>/dev/null
}

get_dataset_name() {
  local dataset_id="$1"
  if ! is_pg_available; then
    echo ""
    return
  fi
  docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DATABASE}" -t -A \
    -c "SELECT name FROM datasets WHERE id = '${dataset_id}';" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

get_user_email() {
  local user_id="$1"
  if ! is_pg_available; then
    echo ""
    return
  fi
  docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DATABASE}" -t -A \
    -c "SELECT email FROM users WHERE id = '${user_id}';" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

find_kuzu_databases() {
  # Find all .pkl files that are Kuzu databases in the multi-tenant structure
  docker run --rm -v "${RAG_DATA_VOLUME}:/data:ro" alpine:latest \
    find /data/.cognee_system/databases -name "*.pkl" -type f 2>/dev/null || true
}

get_latest_kuzu_database() {
  # Get the most recently modified Kuzu database file
  docker run --rm -v "${RAG_DATA_VOLUME}:/data:ro" alpine:latest \
    sh -c 'find /data/.cognee_system/databases -name "*.pkl" -type f -exec ls -t {} + 2>/dev/null | head -1' || true
}

select_kuzu_database() {
  # Get all databases into an array
  local databases_raw
  databases_raw=$(find_kuzu_databases)

  if [ -z "$databases_raw" ]; then
    echo ""
    return
  fi

  # Convert to array
  local databases=()
  while IFS= read -r line; do
    [ -n "$line" ] && databases+=("$line")
  done <<< "$databases_raw"

  local count=${#databases[@]}

  # If only one database, return it directly
  if [ "$count" -eq 1 ]; then
    echo "${databases[0]}"
    return
  fi

  # Multiple databases - show interactive menu
  echo "" >&2
  echo -e "${CYAN}Multiple Kuzu databases found. Select one:${NC}" >&2
  echo "" >&2

  local i=1
  for db_path in "${databases[@]}"; do
    # Extract user_id and dataset_id from path
    # Path format: /data/.cognee_system/databases/{user_id}/{dataset_id}.pkl
    local user_id dataset_id
    user_id=$(echo "$db_path" | sed -E 's|.*/databases/([^/]+)/.*|\1|')
    dataset_id=$(basename "$db_path" .pkl)

    # Get friendly names from PostgreSQL (fallback to UUID if unavailable)
    local dataset_name user_email
    dataset_name=$(get_dataset_name "$dataset_id")
    user_email=$(get_user_email "$user_id")

    local display_dataset="${dataset_name:-${dataset_id:0:12}...}"
    local display_user="${user_email:-${user_id:0:12}...}"

    # Get file info
    local info
    info=$(docker run --rm -v "${RAG_DATA_VOLUME}:/data:ro" alpine:latest \
      stat -c "%s bytes, %y" "$db_path" 2>/dev/null | cut -d'.' -f1 || echo "unknown")

    echo -e "  ${GREEN}[$i]${NC} ${display_dataset}" >&2
    echo "      User: ${display_user}" >&2
    echo "      $info" >&2
    ((i++))
  done

  echo "" >&2
  echo -n "Enter selection [1-$count]: " >&2
  read -r selection

  # Validate selection
  if ! [[ "$selection" =~ ^[0-9]+$ ]] || [ "$selection" -lt 1 ] || [ "$selection" -gt "$count" ]; then
    log_error "Invalid selection. Using most recent database." >&2
    local latest
    latest=$(get_latest_kuzu_database)
    echo "${latest:-${databases[0]}}"
    return
  fi

  echo "${databases[$((selection-1))]}"
}

# ============================================================================
# Commands
# ============================================================================

cmd_help() {
  echo ""
  echo "Tale Platform - Development Tools Manager"
  echo ""
  echo "Visualization tools for RAG service data (Kuzu graph + LanceDB vectors)"
  echo ""
  echo "USAGE:"
  echo "  ./scripts/dev-tools.sh [COMMAND]"
  echo ""
  echo "COMMANDS:"
  echo "  start       Start visualization tools (Lance only if RAG is running)"
  echo "  stop        Stop visualization tools"
  echo "  status      Show status and access URLs (default)"
  echo "  logs        View logs from visualization tools"
  echo "  list-kuzu   List available Kuzu database files"
  echo "  -h, --help  Show this help message"
  echo ""
  echo "TOOLS:"
  echo "  Kuzu Explorer     http://localhost:${KUZU_PORT}  Graph database (nodes/relationships)"
  echo "  Lance Data Viewer http://localhost:${LANCE_PORT}  Vector database (embeddings)"
  echo ""
  echo "NOTES:"
  echo "  - Lance Data Viewer works while RAG service is running"
  echo "  - In multi-tenant mode, each user/dataset has its own Kuzu database (.pkl files)"
  echo "  - If multiple databases exist, 'start' shows an interactive menu to select one"
  echo "  - Kuzu uses exclusive file locks: databases actively used by RAG cannot be opened"
  echo "  - Use 'list-kuzu' to preview available databases before starting"
  echo ""
}

cmd_start() {
  log_info "Starting development visualization tools..."

  # Check prerequisites
  if ! check_volume_exists; then
    log_error "RAG data volume '${RAG_DATA_VOLUME}' not found"
    log_info "Start the RAG service first with: docker compose up -d rag"
    exit 1
  fi

  if ! check_network_exists; then
    log_warn "Docker network '${DOCKER_NETWORK}' not found, creating..."
    docker network create "${DOCKER_NETWORK}" 2>/dev/null || true
  fi

  # Stop existing containers if running
  docker rm -f "${KUZU_CONTAINER}" "${LANCE_CONTAINER}" 2>/dev/null || true

  # Note: In multi-tenant mode, each dataset has its own Kuzu database file.
  # Multiple READ_ONLY connections to different databases work concurrently.
  # Only if RAG is actively writing to the SAME database would there be a conflict.

  # Let user select which Kuzu database to view (interactive menu if multiple)
  local kuzu_db_path
  kuzu_db_path=$(select_kuzu_database)

  if [ -z "$kuzu_db_path" ]; then
    log_warn "No Kuzu database files found. Index some documents first."
    log_warn "Skipping Kuzu Explorer..."
  else
    # Extract directory and filename for Kuzu Explorer
    # kuzu_db_path is like: /data/.cognee_system/databases/{user_id}/{dataset_id}.pkl
    # We need to mount the directory containing the .pkl file and set KUZU_FILE to just the filename
    local kuzu_db_dir
    local kuzu_db_filename
    kuzu_db_dir=$(dirname "${kuzu_db_path}")
    kuzu_db_filename=$(basename "${kuzu_db_path}")

    # Convert /data/... path to volume subpath for Docker bind mount
    # tale_rag-data volume is mounted at /app/data in the RAG container
    local volume_subpath="${kuzu_db_dir#/data/}"

    log_info "Starting Kuzu Explorer with database: ${kuzu_db_path}"
    log_info "  Directory: ${volume_subpath}"
    log_info "  Filename: ${kuzu_db_filename}"

    # Mount the specific database directory to /database in the container
    # KUZU_FILE should be just the filename since /database is the database directory
    docker run -d \
      --name "${KUZU_CONTAINER}" \
      --network "${DOCKER_NETWORK}" \
      -p "${KUZU_PORT}:8000" \
      -v "${RAG_DATA_VOLUME}:/_volume:ro" \
      -e MODE=READ_ONLY \
      -e KUZU_DIR="/_volume/${volume_subpath}" \
      -e KUZU_FILE="${kuzu_db_filename}" \
      -e KUZU_BUFFER_POOL_SIZE=268435456 \
      --restart unless-stopped \
      "${KUZU_IMAGE}" >/dev/null 2>&1 || log_warn "Kuzu Explorer failed to start"
  fi

  # Start Lance Data Viewer (works even when RAG is running)
  log_info "Starting Lance Data Viewer..."
  docker run -d \
    --name "${LANCE_CONTAINER}" \
    --network "${DOCKER_NETWORK}" \
    -p "${LANCE_PORT}:8080" \
    -v "${RAG_DATA_VOLUME}:/data:ro" \
    --restart unless-stopped \
    "${LANCE_IMAGE}" >/dev/null

  # Wait a moment for containers to start
  sleep 2

  echo ""
  log_success "Development tools started"
  echo ""
  echo "Access URLs:"
  if is_container_running "${KUZU_CONTAINER}"; then
    echo "  Kuzu Explorer (Graph DB):      http://localhost:${KUZU_PORT}"
  else
    echo "  Kuzu Explorer (Graph DB):      NOT STARTED (no database found)"
  fi
  echo "  Lance Data Viewer (Vector DB): http://localhost:${LANCE_PORT}"
  echo ""
}

cmd_stop() {
  log_info "Stopping development visualization tools..."

  docker stop "${KUZU_CONTAINER}" "${LANCE_CONTAINER}" 2>/dev/null || true
  docker rm "${KUZU_CONTAINER}" "${LANCE_CONTAINER}" 2>/dev/null || true

  log_success "Development tools stopped"
}

cmd_status() {
  echo ""
  echo "Development Tools Status"
  echo "========================"
  echo ""

  local kuzu_status="${RED}stopped${NC}"
  local lance_status="${RED}stopped${NC}"

  if is_container_running "${KUZU_CONTAINER}"; then
    kuzu_status="${GREEN}running${NC}"
  fi

  if is_container_running "${LANCE_CONTAINER}"; then
    lance_status="${GREEN}running${NC}"
  fi

  echo -e "Kuzu Explorer:     ${kuzu_status}  http://localhost:${KUZU_PORT}"
  echo -e "Lance Data Viewer: ${lance_status}  http://localhost:${LANCE_PORT}"
  echo ""

  if ! is_container_running "${KUZU_CONTAINER}" && ! is_container_running "${LANCE_CONTAINER}"; then
    log_info "Start tools with: ./scripts/dev-tools.sh start"
  fi
  echo ""
}

cmd_logs() {
  local containers=()

  if is_container_running "${KUZU_CONTAINER}"; then
    containers+=("${KUZU_CONTAINER}")
  fi

  if is_container_running "${LANCE_CONTAINER}"; then
    containers+=("${LANCE_CONTAINER}")
  fi

  if [ ${#containers[@]} -eq 0 ]; then
    log_error "No development tools are running"
    log_info "Start tools with: ./scripts/dev-tools.sh start"
    exit 1
  fi

  log_info "Showing logs for: ${containers[*]}"
  echo ""

  for container in "${containers[@]}"; do
    echo -e "${CYAN}=== ${container} ===${NC}"
    docker logs --tail 50 "${container}" 2>&1
    echo ""
  done
}

cmd_list_kuzu() {
  echo ""
  echo "Available Kuzu Databases"
  echo "========================"
  echo ""

  if ! check_volume_exists; then
    log_error "RAG data volume '${RAG_DATA_VOLUME}' not found"
    exit 1
  fi

  local databases
  databases=$(find_kuzu_databases)

  if [ -z "$databases" ]; then
    log_warn "No Kuzu database files found"
    log_info "Index some documents first with the RAG service"
    exit 0
  fi

  echo "Multi-tenant mode: Each user/dataset has its own database"
  echo ""

  local i=1
  echo "$databases" | while read -r db_path; do
    # Extract user_id and dataset_id from path
    local user_id dataset_id
    user_id=$(echo "$db_path" | sed -E 's|.*/databases/([^/]+)/.*|\1|')
    dataset_id=$(basename "$db_path" .pkl)

    # Get friendly names from PostgreSQL (fallback to UUID if unavailable)
    local dataset_name user_email
    dataset_name=$(get_dataset_name "$dataset_id")
    user_email=$(get_user_email "$user_id")

    local display_dataset="${dataset_name:-${dataset_id}}"
    local display_user="${user_email:-${user_id}}"

    # Get file size and modification time
    local info
    info=$(docker run --rm -v "${RAG_DATA_VOLUME}:/data:ro" alpine:latest \
      stat -c "%s bytes, modified %y" "$db_path" 2>/dev/null || echo "unknown")

    echo -e "  ${GREEN}[$i]${NC} ${display_dataset}"
    echo "      User: ${display_user}"
    echo "      Path: ${db_path}"
    echo "      ${info}"
    echo ""
    ((i++))
  done

  log_info "Run: ./scripts/dev-tools.sh start"
  if is_rag_running; then
    log_info "Note: RAG service is running. If viewing a database currently in use,"
    log_info "      you may see stale data until RAG commits its changes."
  fi
  echo ""
}

# ============================================================================
# Main
# ============================================================================

main() {
  case "${1:-status}" in
    -h|--help)
      cmd_help
      ;;
    start)
      cmd_start
      ;;
    stop)
      cmd_stop
      ;;
    status)
      cmd_status
      ;;
    logs)
      cmd_logs
      ;;
    list-kuzu)
      cmd_list_kuzu
      ;;
    *)
      log_error "Unknown command: $1"
      cmd_help
      exit 1
      ;;
  esac
}

main "$@"
