# Sandbox on Kubernetes (`SANDBOX_BACKEND=kubernetes`)

The sandbox spawner runs on both Docker Compose (default) and Kubernetes. This
document is the **contract the in-repo `KubernetesBackend` requires** — the RBAC
verbs it calls, the env it reads, and the NetworkPolicy it assumes. The Helm
chart (authored separately) must satisfy it. The Compose path is unaffected.

## Execution model — exec-free, Pod-per-exec

Each `/v1/execute` runs as **one Pod** with a shared `/agent` `emptyDir` and
**three containers**. Every spawner↔Pod interaction is plain HTTP
(`createNamespacedPod`, `readNamespacedPodLog`, `deleteNamespacedPod`) plus
presigned-URL I/O performed **inside** the Pod — there is **no exec websocket**
(it proved unreliable under Bun).

| Container               | Image                                  | Role                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage` (initContainer) | spawner image (`k8s-stage.ts`)         | Downloads inputs from presigned URLs into `/agent`; writes the multi-step wrapper + prior-stage attestation. Completes before the runner — no sentinel handshake. A required-input failure exits non-zero → Pod fails → spawner returns `SPAWNER_UNAVAILABLE` with the stage container's log tail in the message (`PRE_STAGE_FAILED` is action-side only). |
| `runner`                | runtime image (`tale-sandbox-runtime`) | Runs user code via the image's real `/entrypoint.sh` (command override; child of `sh -c`, not `exec`, so the exit code is captured to a file; stderr → a file). **No credentials, no callbacks.**                                                                                                                                                          |
| `harvest`               | spawner image (`k8s-harvest.ts`)       | Holds the token + upload slots; enforces the user timeout; uploads `/agent/output` via presigned slots + EP1/EP2; prints one `__TALE_RESULT__` line the spawner reads back from its logs.                                                                                                                                                                  |

**Security boundary:** the per-exec **Secret** (presigned URLs, `SANDBOX_TOKEN`,
byte caps) is mounted **only** into `stage`/`harvest`, **never** the `runner`.
The runner has no token and no URLs (regression-tested in
`k8s-pod-spec.test.ts`).

**Horizontal scale:** the result rides the `harvest` container's logs, read by
the **owning** spawner replica — no callback to a Service VIP, no cross-replica
affinity. The spawner Deployment is HPA-able; total throughput =
replicas × `SANDBOX_MAX_SESSIONS`, bounded by cluster capacity.

**Cancel:** when the cancel request lands on the owning replica it is
abort-only — `execute()` finishes its final log reads and then deletes the Pod,
so the response is `cancelled` with the captured stdout. When it lands on any
**other** replica, the backend deletes the Pod + Secret by deterministic name;
the run stops promptly, but the owning replica then sees its Pod vanish and
resolves the run as `failed`/`HARVEST_READ_FAILED` rather than `cancelled` (it
never learns the cancel intent — a known, accepted limitation).

**Resource-limit parity with docker:** the runner Pod enforces cpu/memory
limits and a `sizeLimit` on the `/agent` emptyDir (`SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`,
default `4Gi` — exceeding it evicts the Pod). `RUNNER_WRAPPER` also injects
`ulimit -u 128 -f 204800 -t 600 -c 0` before launching the entrypoint, which
sets the same per-process limits as the Docker backend's `--pids-limit=128`,
`--ulimit fsize=104857600`, `--ulimit cpu=600`, and `--ulimit core=0:0`. The
busybox sh built-in lowers limits without requiring elevated capabilities, and
all descendant processes (python/node) inherit them. gVisor (`SANDBOX_RUNTIME=runsc`)
adds further isolation benefits (syscall filtering, separate kernel) but is no
longer required solely to obtain these resource bounds.

## RBAC (namespaced Role — no cluster scope, no `pods/exec`)

The spawner Deployment's ServiceAccount needs a Role in the sandbox namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: tale-sandbox-spawner
  namespace: tale-sandbox
rules:
  - apiGroups: ['']
    resources: ['pods']
    # `patch` records a session's "always-on" pin as a Pod annotation
    # (`tale.dev/pinned`) so a spawner restart re-adopts it instead of
    # TTL/idle-reaping the pinned session on its first sweep.
    verbs: ['create', 'get', 'list', 'delete', 'patch']
  - apiGroups: ['']
    resources: ['pods/log']
    verbs: ['get']
  - apiGroups: ['']
    resources: ['secrets']
    # per-exec ExecSpec Secret; `list` powers the orphan sweep (a crash
    # between Secret-create and Pod-create would otherwise leak a token-bearer
    # forever — the sweep lists by the tale.sandbox=1 label and reaps podless
    # Secrets past the worst-case execution lifetime).
    verbs: ['create', 'update', 'delete', 'list']
  # Only when SANDBOX_CACHE=pvc (per-org dependency caches):
  - apiGroups: ['']
    resources: ['persistentvolumeclaims']
    verbs: ['get', 'create']
```

There is **no `pods/exec`** rule — the exec-free transport never opens an exec
stream. Keep it out so a stray exec call fails closed.

## Environment

| Env                                                               | Required   | Notes                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SANDBOX_BACKEND=kubernetes`                                      | yes        | Selects this backend.                                                                                                                                                                       |
| `SANDBOX_SPAWNER_IMAGE`                                           | yes        | The spawner's **own** image ref, used for the `stage`/`harvest` containers. Must match the deployed spawner version.                                                                        |
| `SANDBOX_RUNTIME_IMAGE`                                           | yes        | The `runner` image (`tale-sandbox-runtime:<tag>`).                                                                                                                                          |
| `SANDBOX_K8S_NAMESPACE`                                           | yes        | Namespace the per-exec Pods/Secrets are created in (default `tale-sandbox`).                                                                                                                |
| `NODE_EXTRA_CA_CERTS`                                             | in-cluster | Point at the SA `ca.crt` (`/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`). **This is the only working CA-trust mechanism under Bun** — see [Bun TLS note](#bun-tls-contract) below. |
| `SANDBOX_RUNTIME=runsc`                                           | optional   | Sets the Pod `runtimeClassName` (gVisor) via `SANDBOX_RUNTIME_CLASS` (default `gvisor`).                                                                                                    |
| `SANDBOX_CACHE=pvc`                                               | optional   | Mounts per-org RWX cache PVCs on the runner; needs the PVC RBAC above + an RWX StorageClass. Default `none` (installs fresh each run via the egress proxy).                                 |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`                                | optional   | `sizeLimit` on the per-exec `/agent` emptyDir (default `4Gi`). Bounds deps + temp + outputs; exceeding it evicts the Pod.                                                                   |
| `SANDBOX_EGRESS_PROXY`                                            | optional   | The runner's `HTTPS_PROXY`/`HTTP_PROXY` for `pip`/`npm` (default `http://sandbox-egress:3128`).                                                                                             |
| `SANDBOX_K8S_SERVER` / `SANDBOX_K8S_TOKEN` / `SANDBOX_K8S_CAFILE` | dev only   | Explicit bearer-token kubeconfig for local Bun dev (kind's client-cert kubeconfig auths as `system:anonymous` under Bun). In-cluster uses the projected SA token automatically.             |

The Pod sets `automountServiceAccountToken: false` — the runtime never gets an
SA token.

## Bun TLS contract

`@kubernetes/client-node@1.4.0` sends requests via `node-fetch@2`, which calls
`node:https.request` with an `https.Agent` carrying the kubeconfig TLS options.
Empirical testing under **Bun 1.3.x** shows that Bun's `node:https` shim stores
the options on the Agent object but **silently ignores them** at the TLS layer:

| Kubeconfig knob        | `https.Agent` option        | Bun 1.3.x behavior                  |
| ---------------------- | --------------------------- | ----------------------------------- |
| `caFile` / `caData`    | `ca: <cert bytes>`          | **INERT** — CA is not loaded        |
| `skipTLSVerify`        | `rejectUnauthorized: false` | **INERT** — TLS is still verified   |
| `certFile` / `keyFile` | `cert` / `key`              | **INERT** — client cert is not sent |

**`NODE_EXTRA_CA_CERTS` is the only working CA-trust mechanism under Bun.** Set
it to the cluster CA file (in-cluster: the projected SA `ca.crt`; dev: the file
referenced by `SANDBOX_K8S_CAFILE`). Without it, apiserver TLS verification
fails with an opaque `self signed certificate` error even when `caFile` or
`skipTLSVerify` are set in the kubeconfig.

`skipTLSVerify` is therefore intentionally absent from the kubeconfig built by
`makeK8sClient`: it provides no security bypass under Bun and would only
mislead operators into thinking TLS verification is disabled.

## NetworkPolicy (spawner-applied)

The `KubernetesBackend.init` applies a default-deny egress NetworkPolicy
(`tale-sandbox-session-egress`, built by `k8s-network-policy.ts`) selecting
`tale.sandbox/role: session` Pods. It allows egress **only** to DNS (UDP/TCP 53)
and the sandbox namespace itself — where the egress proxy + LLM gateway live, so
the runner reaches the outside world only through that proxy. Everything else is
denied by omission: cloud IMDS (`169.254.169.254`), the node, and other
namespaces. The Pod's containers share one network namespace, so a per-Pod
selector governs the whole Pod.

The spawner now SHIPS and APPLIES this fence rather than leaving it to an
operator to remember. Two residual operator responsibilities remain:

- **RBAC:** the spawner ServiceAccount needs `create`/`patch` on
  `networking.k8s.io/networkpolicies`. Without it, `init` logs a loud error
  (reaching GlitchTip) and continues — apply an equivalent policy externally, or
  grant the RBAC. It does not hard-fail (an operator may enforce egress by other
  means, and a fatal here would wedge the spawner on upgrade).
- **CNI enforcement:** the apiserver accepts the NetworkPolicy object even where
  the CNI does not enforce it. A NetworkPolicy-capable CNI (Calico, Cilium, …)
  is required for the fence to actually bite — this code cannot detect that.

Asymmetry with the compose stack: on Docker, `tale-sandbox-net` is an
`--internal` bridge and the egress proxy's entrypoint installs IMDS/RFC1918
iptables rules, so the proxy is the runtime's only outbound path with no
operator action. On k8s the equivalent fence is this NetworkPolicy plus the
transparent-egress sidecar; the `HTTP_PROXY`/`HTTPS_PROXY` env alone is advisory
(a process can ignore it), which is why the NetworkPolicy is the load-bearing
layer. The proxy itself is open at the hostname layer by default
(`SANDBOX_EGRESS_ALLOWLIST` opt-in).

## Verification status

Unit-tested (no cluster): the Pod shape + the security invariant (Secret never
on the runner), the ExecSpec Secret payload + round-trip, and the
`__TALE_RESULT__` result-line protocol. The on-cluster reliability bar (50+
consecutive real executions ~100% pass, 2-replica scale, cancel-across-replicas)
is **pending a healthy cluster** and must be run before enabling this backend in
production.
