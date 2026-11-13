#!/usr/bin/env bash
# tools/cli/e2e/incus/images.sh <registry> <revision> <version>
#
# Builds the Tale images of a managed stack from this checkout and pushes them
# to the lab's registry under the repositories a release publishes them in,
# `<registry>/tale-project/tale/tale-<service>:sha-<revision>`, with the labels
# the managed path verifies (revision, version, source and, for the platform,
# the automation writer protocol). The lab declares
# `runtime.incus.registryMirrors: {"ghcr.io": "<registry>"}`, so the CLI and
# Incus read these images as `ghcr.io/tale-project/tale/...`, pinned by the
# digests the registry proved. The stack's one image from another ghcr.io
# repository (the object store) is copied there as it is.
#
# Run it twice with two revisions for the upgrade: the second build reuses
# every layer, and only the labels (and so the digests) differ.
#
#   BUILDER     the buildx builder (default: the current one)
#   OUTPUT      extra image output options for a docker-container builder,
#               such as compression=zstd,oci-mediatypes=true,registry.insecure=true
#   CACHE_FROM  a registry prefix holding <prefix>/tale-<service>-buildcache:amd64
#   SERVICES    the services to build (default: all eight)
#   TAG         the tag to push (default: sha-<revision>); a workspace deploys
#               a release by its version, so its releases are tagged <version>

set -euo pipefail

registry="${1:?usage: images.sh <registry> <revision> <version>}"
revision="${2:?usage: images.sh <registry> <revision> <version>}"
version="${3:?usage: images.sh <registry> <revision> <version>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || {
  echo "images.sh: the revision must be a full commit SHA, not $revision" >&2
  exit 2
}
[[ "${TAG:-sha-$revision}" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || {
  echo "images.sh: $TAG is no image tag" >&2
  exit 2
}
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  echo "images.sh: the version must be X.Y.Z, not $version" >&2
  exit 2
}

read -ra services <<<"${SERVICES:-db platform proxy sandbox sandbox-egress sandbox-llm-gateway sandbox-runtime sandbox-buildkitd}"
protocol="$(sed -n 's/^export const ENGINE_PROTOCOL = \([1-9][0-9]*\);$/\1/p' "$root/services/platform/lib/engine/core/protocol.ts")"
case "$protocol" in 1 | 2) ;; *)
  echo 'images.sh: unsupported automation writer protocol' >&2
  exit 1
  ;;
esac

for service in "${services[@]}"; do
  tag="$registry/tale-project/tale/tale-$service:${TAG:-sha-$revision}"
  args=(
    --platform linux/amd64
    --file "$root/services/$service/Dockerfile"
    --build-arg "VERSION=$version"
    --label "org.opencontainers.image.revision=$revision"
    --label "org.opencontainers.image.version=$version"
    --label "org.opencontainers.image.source=https://github.com/tale-project/tale"
    --provenance=false
  )
  if [ "$service" = platform ]; then
    args+=(
      --build-arg "AUTOMATION_WRITER_PROTOCOL=$protocol"
      --label "io.tale.automation-writer-protocol=$protocol"
    )
  fi
  [ -z "${BUILDER:-}" ] || args+=(--builder "$BUILDER")
  [ -z "${CACHE_FROM:-}" ] || args+=(--cache-from "type=registry,ref=$CACHE_FROM/tale-$service-buildcache:amd64")
  if [ -n "${OUTPUT:-}" ]; then
    args+=(--output "type=image,name=$tag,push=true,$OUTPUT")
  else
    args+=(--tag "$tag" --push)
  fi
  echo "images.sh: building tale-$service for $revision"
  started=$SECONDS
  docker buildx build "${args[@]}" "$root"
  echo "images.sh: tale-$service pushed in $((SECONDS - started)) s"
done

# The object store: its own ghcr.io repository, pinned by tag in compose.yml.
minio="$(sed -n 's/^ *image: \(ghcr\.io\/tale-project\/ops\/minio:[A-Za-z0-9_.-]*\)$/\1/p' "$root/compose.yml")"
[ -n "$minio" ] || {
  echo 'images.sh: compose.yml names no ghcr.io/tale-project/ops/minio image' >&2
  exit 1
}
echo "images.sh: copying $minio"
skopeo copy --retry-times 3 --dest-tls-verify=false \
  "docker://$minio" "docker://$registry/${minio#ghcr.io/}"
