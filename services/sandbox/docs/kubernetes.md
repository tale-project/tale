# Sandbox on Kubernetes (`SANDBOX_BACKEND=kubernetes`)

The sandbox spawner runs on both Docker Compose (default) and Kubernetes. This
document is the **contract the in-repo `KubernetesBackend` requires** — the RBAC
verbs it calls, the env it reads, and the NetworkPolicy it assumes. The Helm
chart (authored separately) must satisfy it. The Compose path is unaffected.

## Execution model — exec-free, Pod-per-exec

Each `/v1/execute` runs as **one Pod** with a shared `/workspace` `emptyDir` and
**three containers**. Every spawner↔Pod interaction is plain HTTP
(`createNamespacedPod`, `readNamespacedPodLog`, `deleteNamespacedPod`) plus
presigned-URL I/O performed **inside** the Pod — there is **no exec websocket**
(it proved unreliable under Bun).

| Container               | Image                                  | Role                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage` (initContainer) | spawner image (`k8s-stage.ts`)         | Downloads inputs from presigned URLs into `/workspace`; writes the multi-step wrapper + prior-stage attestation. Completes before the runner — no sentinel handshake. A required-input failure exits non-zero → Pod fails → spawner returns `SPAWNER_UNAVAILABLE` with the stage container's log tail in the message (`PRE_STAGE_FAILED` is action-side only). |
| `runner`                | runtime image (`tale-sandbox-runtime`) | Runs user code via the image's real `/entrypoint.sh` (command override; child of `sh -c`, not `exec`, so the exit code is captured to a file; stderr → a file). **No credentials, no callbacks.**                                                                                                                                                              |
| `harvest`               | spawner image (`k8s-harvest.ts`)       | Holds the token + upload slots; enforces the user timeout; uploads `/workspace/output` via presigned slots + EP1/EP2; prints one `__TALE_RESULT__` line the spawner reads back from its logs.                                                                                                                                                                  |

**Security boundary:** the per-exec **Secret** (presigned URLs, `SANDBOX_TOKEN`,
byte caps) is mounted **only** into `stage`/`harvest`, **never** the `runner`.
The runner has no token and no URLs (regression-tested in
`k8s-pod-spec.test.ts`).

**Horizontal scale:** the result rides the `harvest` container's logs, read by
the **owning** spawner replica — no callback to a Service VIP, no cross-replica
affinity. The spawner Deployment is HPA-able; total throughput =
replicas × `SANDBOX_MAX_CONCURRENT`, bounded by cluster capacity.

**Cancel:** when the cancel request lands on the owning replica it is
abort-only — `execute()` finishes its final log reads and then deletes the Pod,
so the response is `cancelled` with the captured stdout. When it lands on any
**other** replica, the backend deletes the Pod + Secret by deterministic name;
the run stops promptly, but the owning replica then sees its Pod vanish and
resolves the run as `failed`/`HARVEST_READ_FAILED` rather than `cancelled` (it
never learns the cancel intent — a known, accepted limitation).

**Resource-limit parity (known delta vs docker):** the runner Pod enforces
cpu/memory limits and a `sizeLimit` on the `/workspace` emptyDir
(`SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`, default `4Gi` — exceeding it evicts the
Pod). There is **no Kubernetes equivalent** of the docker path's per-process
ulimits (`pids-limit=128`, `fsize=100MB`, `cpu-time=600s`): a fork-heavy or
single-giant-file workload behaves differently on the two backends. Operators
needing those bounds should use gVisor (`SANDBOX_RUNTIME=runsc`) and
namespace-level quotas.

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
    verbs: ['create', 'get', 'list', 'delete']
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

| Env                                                               | Required   | Notes                                                                                                                                                                           |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SANDBOX_BACKEND=kubernetes`                                      | yes        | Selects this backend.                                                                                                                                                           |
| `SANDBOX_SPAWNER_IMAGE`                                           | yes        | The spawner's **own** image ref, used for the `stage`/`harvest` containers. Must match the deployed spawner version.                                                            |
| `SANDBOX_RUNTIME_IMAGE`                                           | yes        | The `runner` image (`tale-sandbox-runtime:<tag>`).                                                                                                                              |
| `SANDBOX_K8S_NAMESPACE`                                           | yes        | Namespace the per-exec Pods/Secrets are created in (default `tale-sandbox`).                                                                                                    |
| `NODE_EXTRA_CA_CERTS`                                             | in-cluster | Point at the SA `ca.crt` (`/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`). **Bun's fetch ignores the kubeconfig CA**, so without this the apiserver TLS isn't trusted.  |
| `SANDBOX_RUNTIME=runsc`                                           | optional   | Sets the Pod `runtimeClassName` (gVisor) via `SANDBOX_RUNTIME_CLASS` (default `gvisor`).                                                                                        |
| `SANDBOX_CACHE=pvc`                                               | optional   | Mounts per-org RWX cache PVCs on the runner; needs the PVC RBAC above + an RWX StorageClass. Default `none` (installs fresh each run via the egress proxy).                     |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`                                | optional   | `sizeLimit` on the per-exec `/workspace` emptyDir (default `4Gi`). Bounds deps + temp + outputs; exceeding it evicts the Pod.                                                   |
| `SANDBOX_EGRESS_PROXY`                                            | optional   | The runner's `HTTPS_PROXY`/`HTTP_PROXY` for `pip`/`npm` (default `http://sandbox-egress:3128`).                                                                                 |
| `SANDBOX_K8S_SERVER` / `SANDBOX_K8S_TOKEN` / `SANDBOX_K8S_CAFILE` | dev only   | Explicit bearer-token kubeconfig for local Bun dev (kind's client-cert kubeconfig auths as `system:anonymous` under Bun). In-cluster uses the projected SA token automatically. |

The Pod sets `automountServiceAccountToken: false` — the runtime never gets an
SA token.

## NetworkPolicy (operator-applied, opt-in)

The Pod's containers share one network namespace, so the policy is per-Pod. The
runner needs egress to the **egress proxy** (pypi/npm) and `stage`/`harvest`
need egress to the **platform storage host** (presigned URLs) + DNS. Recommended
default-deny egress on `tale.sandbox/role: runtime` that allows **only** those,
and blocks RFC1918 / link-local (IMDS `169.254.169.254`). This is a deliberate
trade-off: the runner gains TCP _reachability_ to the storage host, but cannot
read/write it without the (absent) presigned URLs.

Ship this as the deployment's recommended manifest; the backend code stays
compatible whether or not it is applied (it does not enforce egress itself).

## Verification status

Unit-tested (no cluster): the Pod shape + the security invariant (Secret never
on the runner), the ExecSpec Secret payload + round-trip, and the
`__TALE_RESULT__` result-line protocol. The on-cluster reliability bar (50+
consecutive real executions ~100% pass, 2-replica scale, cancel-across-replicas)
is **pending a healthy cluster** and must be run before enabling this backend in
production.
