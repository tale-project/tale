---
title: Build and maintain Tale images
description: Choose the correct Dockerfile, build a local image, verify its behavior and publish a reviewed image set to your registry.
---

Build an image when a change affects container dependencies, startup behavior or packaged application code. Start from a source checkout with the prerequisites in [Contributor setup](/develop/contributor-setup), a running Docker daemon and access to the base-image and package registries used by the Dockerfile.

A successful build proves that an image can be assembled. Run it in a separate development stack and exercise the changed behavior before using it in a deployment.

## What the images are

Dockerfiles use the repository root as their build context. Open the relevant Dockerfile for exact base-image versions and build arguments; the table describes each image’s purpose.

| Image | Dockerfile directory | Contents and role |
| --- | --- | --- |
| `tale-platform` | `services/platform/` | Debian-based application image with the built web app and native backend. Build stages use Bun and Node; API and worker roles reuse this image. |
| `tale-db` | `services/db/` | PostgreSQL with the supplied search/vector extensions, based on ParadeDB. Both application and knowledge database services use it. |
| `tale-proxy` | `services/proxy/` | Caddy configuration and proxy startup. |
| `tale-sandbox` | `services/sandbox/` | Sandbox orchestration, including Bun and the Docker CLI. |
| `tale-sandbox-runtime` | `services/sandbox-runtime/` | Python-based execution environment with coding harnesses, Node, Bun, browsers and document tools. |
| `tale-sandbox-egress` | `services/sandbox-egress/` | Alpine-based outbound proxy and DNS support. |
| `tale-sandbox-buildkitd` | `services/sandbox-buildkitd/` | BuildKit with the sandbox’s networking and startup configuration. |
| `tale-sandbox-llm-gateway` | `services/sandbox-llm-gateway/` | Model gateway built from Bifrost. |

Object storage and the video-ingestion sidecar use upstream images directly. They are not built from a Tale Dockerfile. Sandbox runtime and BuildKit images are launched on demand; do not assume that building only the services in a Compose file also builds them.

## Building locally

For an isolated proxy-image build, run this from the repository root:

```bash
docker build -f services/proxy/Dockerfile -t tale-proxy:docs-review .
```

The local `docs-review` tag makes the result distinguishable from a published release. The build must finish successfully before you test or tag it for distribution.

For services declared with `build:` in the repository Compose file, use:

```bash
docker compose build platform
```

`docker compose build` without a service selects all services that have a build definition. Build time depends on cached layers, network access, platform and the image; a browser or application image has different requirements from the proxy.

The repository Compose file defaults `PULL_POLICY` to `build`. Generated production Compose normally pulls release images. Use [Compose files](/develop/compose-files) for the supported development launcher, which also prepares services and images that a bare build does not start.

## The customisation seams

Choose the narrowest change that satisfies the requirement:

| Requirement | Where to start |
| --- | --- |
| Routing, TLS or public headers | `services/proxy/Caddyfile` and proxy configuration. Test callbacks and streaming after changes. |
| Application UI, backend or extraction behavior | Application source under `services/platform/`, followed by an application-image build and relevant tests. |
| A package or browser in agent sessions | `services/sandbox-runtime/Dockerfile`. Test in a newly created session using the changed image. |
| Sandbox outbound policy | Existing environment configuration first; proxy templates and startup code only when the configuration cannot express the change. |
| BuildKit behavior | `services/sandbox-buildkitd/`, including its network assumptions. |

Entrypoints, health checks and internal paths are implementation contracts. A fork must maintain and test changes to them across upgrades. A configuration-only change may not need a new image; see [Run Compose yourself](/self-hosted/install/own-compose).

## Tagging and pushing your own registry

After testing the image, set your registry namespace and an immutable tag. This example publishes only the proxy image built above; it is not a complete deployment image set. Registry authentication and permission to push are prerequisites.

```bash
export REGISTRY=registry.internal.example.com/tale
export IMAGE_TAG=reviewed-build-1
docker tag tale-proxy:docs-review "$REGISTRY/tale-proxy:$IMAGE_TAG"
docker push "$REGISTRY/tale-proxy:$IMAGE_TAG"
```

Record the resulting digest, source commit and build platform. Distribute all images required by the destination, including sandbox images and upstream dependencies. An offline environment also needs a plan for packages, browser downloads and model access; moving a single image does not make the system self-contained.

The CLI reads `GHCR_REGISTRY` for the Tale image namespace. Its selected version still determines the image tag, so publish the names and version tags the deployment expects. For independently pinned images and source commits, follow the [managed deployment reference](/self-hosted/install/cli-install#managed-deployments).

## Staying in sync with upstream

Keep the fork’s source changes under version control and review upstream changes before rebuilding. Record base-image versions or digests with the build. Review updates to those pins deliberately; rebuilding against an unchanged pin does not incorporate a newer upstream image automatically.

Before rollout, verify the startup role, health checks, public routes and the feature you changed. For sandbox changes, include a new session and its required network calls. Contribute generally useful fixes upstream when possible to reduce the code your fork must maintain.

## Diagnose a failed build or startup

| Symptom | Next check |
| --- | --- |
| A `COPY` source is missing | Run from the repository root with the expected build context; check `.dockerignore` and the source path. |
| Package or base-image download fails | Check registry access, authentication and the first failed build step. |
| The image builds but exits | Read that container’s startup logs and confirm its environment, mounts and role. |
| A sandbox still uses old packages | Confirm the configured runtime image and create a new session. An existing container is not replaced by retagging an image. |

Use [Container architecture](/self-hosted/operate/container-architecture) to trace service dependencies and [Upgrades](/self-hosted/operate/upgrades) for rollout and recovery.
