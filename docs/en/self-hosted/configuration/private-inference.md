---
title: Run private inference on a Mac
description: Prepare pinned model artifacts, admit a dedicated Apple Silicon Mac, and connect verified private model routes to Tale.
---

Use the Tale CLI to prepare and operate a dedicated Mac that serves your organization's models. The client repository owns the model declaration; deployment automation supplies the host, private network, source commit and credentials. Preparation takes no model weights and proves no hardware performance: activation and acceptance happen on the destination Mac.

## Before you begin

Use macOS 15 or later on Apple Silicon, with a dedicated non-admin interactive account and its active graphical login session. Arrange host admission, private networking, SSH and remote access separately. The CLI verifies the declared user, hostname, local address and available resources; it does not configure the operating system or weaken Apple security.

The reviewed runtime is the signed, notarized oMLX 0.6.4 application. Tale pins its download, complete artifact hash and signed ARM64 code identity, and runs its bundled Python and native kernels. A hash-bound Tale entrypoint uses the application's public FastAPI middleware hook to admit compute requests. The signed application files stay unchanged. A different runtime needs a reviewed CLI update. Use `.github/actions/setup-cli` at an exact Tale commit to build the CLI on Linux or macOS ARM64; Mac inference preparation is separate from Linux managed stack preparation.

## Step 1 — Pin models in the client repository

Commit `tale/inference/spec.json`. Its schema version is `1`, and `runtime` is `omlx-0.6.4-macos15`. Declare `name`, the exact organization slug, `models`, `nodes` and a `serviceKey` environment reference. Each node declares its key, dedicated user, hostname, private IPv4 address, assigned model keys and a separate `adminKey` reference. An address may use `{ "env": "TALE_INFERENCE_NODE_ADDRESS" }`; preparation freezes its resolved value.

Each model declares its repository, full immutable revision, API model ID, capability (`text`, `vision` or `embedding`), architecture, context limit and every required data file's path, byte count and SHA-256. Include an explicit embedding dimension. Keep model roles separate: a text model does not imply vision support. Remote Python, bytecode and hidden repository files are refused.

For a supported GLM DSA artifact that selects repository code, the only available projection is `configurationProjection.kind: "signed-omlx-glm-dsa"`. It removes the exact `model_file: "glm_moe_dsa.py"` selector after checking the declared original config hash, retains all other settings, and checks the declared derived hash. Both hashes enter model identity. The signed runtime's builtin architecture and a real target load must pass; `trust_remote_code` is never enabled.

## Step 2 — Prepare without downloading weights

Set `INFERENCE_REPOSITORY` to the canonical GitHub client URL, `INFERENCE_SOURCE_COMMIT` to its full commit and `INFERENCE_BUNDLE` to a new absolute output directory. Resolve the declaration's public address variables before running these commands.

```bash
tale --json inference prepare \
  --repository "$INFERENCE_REPOSITORY" \
  --source-ref "$INFERENCE_SOURCE_COMMIT" \
  --spec tale/inference/spec.json \
  --output "$INFERENCE_BUNDLE"
```

The JSON result includes `bundleSha256`, `source`, `modelCount`, `nodeCount` and `modelWeightsDownloaded: false`. Record the returned hash as `INFERENCE_BUNDLE_SHA`. Optional `--sources <file>` accepts the existing `repository@fullSHA` checkout map; otherwise acquisition uses the same verified GitHub boundary as managed deployments. `TALE_SOURCE_SSH_KEY` is preparation-only. Local `--spec <file>` without repository/ref is available for development, but carries no committed-source proof.

```bash
tale --json inference validate \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA"
tale --json inference plan \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA"
```

Validation checks the complete metadata inventory, source binding and `runtime-admission.py` entrypoint bytes. Planning reports capacity requirements, with `ready: false` until hardware has been observed. Neither command downloads weights or activates a service. Transfer both bundle files and use the same pinned CLI on the admitted Mac.

## Step 3 — Check actual capacity

Run `inference plan` with `--observe` on the destination. `--hardware <file>` instead accepts an explicit planning observation; it does not bypass the fresh checks in activation. Admission includes physical RAM, free disk, macOS/ARM64, the MLX recommended working set and any positive effective wired-memory cap. Native kernel checks run after the verified runtime is available.

Physical RAM alone is insufficient. A large quantized model plus context, caches, vision and embedding weights can exceed the effective Metal limit. The CLI reserves memory, bounds concurrency and caching, and rechecks capacity after staging and during status. It never changes `sysctl`, swap, power policy or system security. If a separately managed host policy changes a limit, require its observed readback before activation.

Models remain evictable and load on demand. Planning checks the largest active role plus headroom and caches against the effective limit; disk planning still includes every declared model. It does not require all roles to stay resident. Switching roles can unload one model and reload another, with substantial delay for large weights. An unloaded model is distinct from an unavailable service.

## Step 4 — Activate and measure on the destination

Inject distinct admin and service keys from the declaration's environment references. Each must contain 32–256 URL-safe characters. Keep the admin key on the Mac; only the service key belongs on the router/native path. Private settings and recovery files use mode `0600` beneath the dedicated user's application-support directory.

These target commands download the pinned runtime and weights, verify their bytes and signatures, and run synthetic model requests. Set `INFERENCE_NODE` to the declared node key. They are operational instructions; model-free CI does not establish a real model's speed or accuracy.

```bash
tale --json --yes inference apply \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA" \
  --node "$INFERENCE_NODE"
tale --json --yes inference benchmark \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA" \
  --node "$INFERENCE_NODE"
tale --json inference status \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA" \
  --node "$INFERENCE_NODE"
```

Readiness requires exact model IDs, authenticated API behavior, the exact admission policy and native kernels. Acceptance covers streamed text, an inert tool-call response, vision, and 64 ordered embedding vectors with exact dimensions within the native caller's 60-second deadline, including queue time. It also submits a bounded mixed workload for the declared roles and samples memory pressure, swap use and cumulative swap-outs before, during and after requests. Pressure, swap growth or a missed embedding deadline refuses readiness. This is neither a sustained-load certification nor an invoice OCR accuracy test; retain separate business examples and longer target measurements.

One native compute slot covers text, vision and embeddings together. The default queue holds four waiting requests; `limits.queuedRequests` changes that bound. Validated requests enter in arrival order. `queueTimeoutSeconds` and `requestTimeoutSeconds` each default to 1800. Requests cancelled while queued never start. Accepted work keeps its slot after a client disconnects until native activity and the Metal synchronization barrier settle. Uncertain cleanup or an accepted request timeout holds the node until inspection and restart. Excess work receives `503` before entering the model application.

oMLX 0.6.4 can let sustained embedding work delay chat decoding. Serialization contains that interference; it does not change the upstream scheduler. HTTP embedding batches of up to 64 remain valid while internal forward batches stay at one. Benchmark receipts separate `loadedRoles` from readiness and report `coldRequest`, `queueWaitMs` and `coldRequestTotalMs`; the last includes waiting, loading and generation. They do not promise simultaneous residency or acceptable interactive latency. Regenerable model/cache directories carry scoped Spotlight exclusions; keep settings, keys and receipts backed up.

## Step 5 — Attach private routes to Tale

Add an `inference` section to the managed deployment specification. This fragment selects committed client content; it does not move model catalogs into deployment automation.

```json
{
  "inference": {
    "repository": "https://github.com/example-team/client-app",
    "revision": { "env": "EXAMPLE_INFERENCE_REF" },
    "specPath": "tale/inference/spec.json",
    "overlayNetwork": { "env": "TALE_INFERENCE_NETWORK" },
    "readiness": []
  }
}
```

Each admitted `readiness` entry supplies a status data file through `file: { "env": "TALE_NODE_READY_FILE" }` and its exact `sha256`. These are fresh operator-supplied observations, not remote hardware attestation. With no admitted nodes, computation returns `503`; catalog metadata remains available internally. Prepare a new managed bundle when the admitted roster changes.

The CLI generates and verifies pinned Caddy and ZeroTier companions. Caddy listens on the Tale backend bridge at `inference-overlay.local:8081`, with no published host port; its namespace reaches only the declared private Mac API on port `18080`. The host network policy must restrict that path. Computation requires the service key; catalog metadata on the internal bridge has no credential requirement. Each organization has its own routes, and no hosted provider fallback is added.

Replicas are independent exact-model servers. Routing prefers the first admitted healthy replica and preserves an optional cache-affinity key; it does not infer dynamic warmth. Native admission owns the shared queue and compute slot. Routing never retries an already-started stream. Distributed model sharding is refused: provide an independently verified supported runtime path before declaring it available.

To authorize a newly installed router namespace, set `DEPLOYMENT_BUNDLE`, `TALE_CLI_COMMIT` and `DEPLOYMENT_COMMIT` to the exact managed deployment selection, then observe it on the Linux destination:

```bash
tale --json deploy inference-status --bundle "$DEPLOYMENT_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" --deployment-ref "$DEPLOYMENT_COMMIT"
```

The result binds the bundle and source to `nodeId`, `networkId`, `networkType`, `status`, `online` and `assignedAddresses`. It requires the recorded running private namespace. `ACCESS_DENIED` with no addresses means controller authorization is still needed. Have the fleet authorize that exact node, then repeat the command and compare `PRIVATE`, `OK`, online state and the exact declared address/prefix. `networkReady` does not certify models. This command neither joins networks nor calls the controller.

Backend provisioning creates explicit `omlx-<model key>` providers, verifies their credentials/catalogs, and separately pins vision and embeddings. Unknown active provider credentials, conflicting policies and unsafe existing embedding changes hold for review. The native receipt proves those bindings; it reports model-server readiness separately. Use fresh identity/project/owner declarations from [managed deployments](/self-hosted/install/cli-install#managed-deployments) when native IDs do not yet exist.

## Scale by separating model roles

If cold switches or the shared queue miss the native deadline, assign roles to separate Macs without changing model artifacts. For model keys `reasoning`, `vision` and `embedding`, replace the declaration's `nodes` with this topology fragment, supplying each address and key reference separately:

```json
{
  "nodes": [
    { "key": "reasoning-01", "user": "inference", "hostName": "reasoning-mac", "address": { "env": "TALE_REASONING_ADDRESS" }, "models": ["reasoning"], "adminKey": { "env": "TALE_REASONING_ADMIN_KEY" } },
    { "key": "vision-01", "user": "inference", "hostName": "vision-mac", "address": { "env": "TALE_VISION_ADDRESS" }, "models": ["vision"], "adminKey": { "env": "TALE_VISION_ADMIN_KEY" } },
    { "key": "embedding-01", "user": "inference", "hostName": "embedding-mac", "address": { "env": "TALE_EMBEDDING_ADDRESS" }, "models": ["embedding"], "adminKey": { "env": "TALE_EMBEDDING_ADMIN_KEY" } }
  ]
}
```

Commit the change, prepare a new bundle, and run admission and benchmarks on every declared node. Supply all three fresh status proofs when preparing the managed routes. Add replicas for a role by assigning its same model key to another admitted node. Separate machines remove cross-role contention; target measurements still decide capacity and latency.

## Recover without replacing unknown state

Keep the full state directory, pending intent and ready receipts. Exact replay verifies existing bytes and service identity; drift holds instead of overwriting files. Before replacement or rollback, Tale requires the service to have no active work. A lost response is reconciled from the recorded activation; unknown or conflicting state needs operator review.

`inference rollback` takes the same bundle, hash and node options plus `--release <retained-sha256>` and `--yes`. It verifies the retained release before activation and does not delete later evidence or retune host memory. Local locks coordinate one host; they do not provide cross-host compare-and-swap or prevent independent administrator edits.

## Continue with target acceptance

Retain the source, bundle and status hashes alongside your host admission and measured workload evidence. The CLI establishes reproducible input and explicit readiness boundaries; complete the destination's sustained workload and business-output checks before routing production tasks. [Configuration releases](/self-hosted/configuration/config-releases) keeps the automation content pinned alongside those model routes.
