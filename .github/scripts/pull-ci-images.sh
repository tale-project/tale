#!/usr/bin/env bash
# Shared by Build's smoke/image gates and Release's container gate. Each worker
# pulls independent services; all workers finish before any test can start.
set -euo pipefail

if [[ ! "${REGISTRY_PATH:-}" =~ ^ghcr\.io/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] ||
   [[ ! "${SOURCE_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || [ "$#" -eq 0 ]; then
  echo '::error::Image pulls require a registry path, full source SHA and services'; exit 1
fi
if { [ -n "${RECEIPTS:-}" ] && [ -n "${IMAGE_TAG:-}" ]; } ||
   { [ -z "${RECEIPTS:-}" ] && [ -z "${IMAGE_TAG:-}" ]; }; then
  echo '::error::Image pulls require either receipts or a release image tag'; exit 1
fi
if [ -n "${IMAGE_TAG:-}" ] && [[ ! "$IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]]; then
  echo '::error::Invalid release image tag'; exit 1
fi

SERVICES=("$@")
IMAGES=()
# Validate the complete receipt set before making even the first Docker call.
# A missing later receipt must not leave a partially accepted stack.
for SERVICE in "${SERVICES[@]}"; do
  if [[ ! "$SERVICE" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo '::error::Invalid image service'; exit 1
  fi
  MATCHES=0
  for SELECTED in "${SERVICES[@]}"; do
    if [ "$SELECTED" = "$SERVICE" ]; then
      MATCHES=$((MATCHES + 1))
    fi
  done
  if [ "$MATCHES" -ne 1 ]; then
    echo "::error::Duplicate image service: ${SERVICE}"; exit 1
  fi
  IMAGE="${REGISTRY_PATH}/tale-${SERVICE}"
  if [ -n "${RECEIPTS:-}" ]; then
    DIGEST=$(jq -er '.digest // empty' "${RECEIPTS}/${SERVICE}.json" 2>/dev/null || true)
    if [[ ! "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
      echo "::error::No image receipt with a digest for tale-${SERVICE}"; exit 1
    fi
    if ! jq -e --arg service "$SERVICE" --arg image "$IMAGE" --arg revision "$SOURCE_SHA" \
      '.service == $service and .image == $image and .revision == $revision and (.tag | type == "string" and test("^[A-Za-z0-9_][A-Za-z0-9_.-]*$"))' \
      "${RECEIPTS}/${SERVICE}.json" > /dev/null 2>&1; then
      echo "::error::Invalid image receipt provenance for tale-${SERVICE}"; exit 1
    fi
    IMAGE="${IMAGE}@${DIGEST}"
  else
    IMAGE="${IMAGE}:${IMAGE_TAG}"
  fi
  IMAGES+=("$IMAGE")
done

pull_image() {
  local service="$1" image="$2" revision
  echo "Pulling ${image}..."
  if ! docker pull "$image"; then
    echo "::error::Could not pull tale-${service}"; return 1
  fi
  if ! revision=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image"); then
    echo "::error::Could not inspect tale-${service}"; return 1
  fi
  if [ "$revision" != "$SOURCE_SHA" ]; then
    echo "::error::tale-${service} was built from ${revision}, not ${SOURCE_SHA}"; return 1
  fi
  if ! docker tag "$image" "ghcr.io/tale-project/tale/tale-${service}:latest"; then
    echo "::error::Could not tag tale-${service}"; return 1
  fi
}

# Three persistent workers avoid unbounded downloads and work on Bash 3.2 too.
# Start the largest images first so smaller pulls overlap their downloads.
ORDER=()
for HEAVY in sandbox-runtime platform; do
  for ((INDEX = 0; INDEX < ${#SERVICES[@]}; INDEX++)); do
    if [ "${SERVICES[$INDEX]}" = "$HEAVY" ]; then ORDER+=("$INDEX"); fi
  done
done
for ((INDEX = 0; INDEX < ${#SERVICES[@]}; INDEX++)); do
  case "${SERVICES[$INDEX]}" in sandbox-runtime|platform) continue ;; esac
  ORDER+=("$INDEX")
done

PIDS=()
for ((WORKER = 0; WORKER < 3 && WORKER < ${#ORDER[@]}; WORKER++)); do
  (
    for ((POSITION = WORKER; POSITION < ${#ORDER[@]}; POSITION += 3)); do
      INDEX="${ORDER[$POSITION]}"
      pull_image "${SERVICES[$INDEX]}" "${IMAGES[$INDEX]}" || exit 1
    done
  ) &
  PIDS+=("$!")
done
FAILED=0
for PID in "${PIDS[@]}"; do
  if ! wait "$PID"; then FAILED=1; fi
done
# Do not publish child-image aliases after a partial failure. Every launched
# worker has finished, so these aliases describe the complete accepted stack.
[ "$FAILED" -eq 0 ] || exit 1
for ((INDEX = 0; INDEX < ${#SERVICES[@]}; INDEX++)); do
  case "${SERVICES[$INDEX]}" in
    sandbox-runtime|sandbox-buildkitd)
      if ! docker tag "${IMAGES[$INDEX]}" "tale-${SERVICES[$INDEX]}:latest"; then
        echo "::error::Could not alias tale-${SERVICES[$INDEX]}"; exit 1
      fi
      ;;
  esac
done
