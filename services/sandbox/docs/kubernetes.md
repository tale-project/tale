# Sandbox on Kubernetes (`SANDBOX_BACKEND=kubernetes`)

The sandbox spawner runs on both Docker Compose (default) and Kubernetes. This
document is the **contract the in-repo `KubernetesBackend` requires** — the RBAC
verbs it calls, the env it reads, and the NetworkPolicy it assumes. The Helm
chart (authored separately) must satisfy it. The Compose path is unaffected.

## Execution model — exec-free, Pod-per-exec

Each `/v1/execute` runs as **one Pod** with a shared `/user` `emptyDir` and
**three containers**. Every spawner↔Pod interaction is plain HTTP
(`createNamespacedPod`, `readNamespacedPodLog`, `deleteNamespacedPod`) plus
presigned-URL I/O performed **inside** the Pod — there is **no exec websocket**
(it proved unreliable under Bun).

| Container               | Image                                  | Role                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage` (initContainer) | spawner image (`k8s-stage.ts`)         | Downloads inputs from presigned URLs into `/user`; writes the multi-step wrapper + prior-stage attestation. Completes before the runner — no sentinel handshake. A required-input failure exits non-zero → Pod fails → spawner returns `SPAWNER_UNAVAILABLE` with the stage container's log tail in the message (`PRE_STAGE_FAILED` is action-side only). |
| `runner`                | runtime image (`tale-sandbox-runtime`) | Runs user code via the image's real `/entrypoint.sh` (command override; child of `sh -c`, not `exec`, so the exit code is captured to a file; stderr → a file). **No credentials, no callbacks.**                                                                                                                                                         |
| `harvest`               | spawner image (`k8s-harvest.ts`)       | Holds the token + upload slots; enforces the user timeout; uploads `/user/output` via presigned slots + EP1/EP2; prints one `__TALE_RESULT__` line the spawner reads back from its logs.                                                                                                                                                                  |

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

**Resource-limit parity with docker:** the runner Pod enforces cpu/memory
limits and a `sizeLimit` on the `/user` emptyDir (`SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`,
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

| Env                                                               | Required   | Notes                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SANDBOX_BACKEND=kubernetes`                                      | yes        | Selects this backend.                                                                                                                                                                                                                                                                                |
| `SANDBOX_SPAWNER_IMAGE`                                           | yes        | The spawner's **own** image ref, used for the `stage`/`harvest` containers. Must match the deployed spawner version.                                                                                                                                                                                 |
| `SANDBOX_RUNTIME_IMAGE`                                           | yes        | The `runner` image (`tale-sandbox-runtime:<tag>`).                                                                                                                                                                                                                                                   |
| `SANDBOX_K8S_NAMESPACE`                                           | yes        | Namespace the per-exec Pods/Secrets are created in (default `tale-sandbox`).                                                                                                                                                                                                                         |
| `NODE_EXTRA_CA_CERTS`                                             | in-cluster | Point at the SA `ca.crt` (`/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`). Kubernetes API calls are trusted via `caFile` → Agent (see TLS note below), but native `fetch()` calls (e.g. harvest presigned-URL uploads) bypass the Agent and require this variable to trust the apiserver CA. |
| `SANDBOX_RUNTIME=runsc`                                           | optional   | Sets the Pod `runtimeClassName` (gVisor) via `SANDBOX_RUNTIME_CLASS` (default `gvisor`).                                                                                                                                                                                                             |
| `SANDBOX_CACHE=pvc`                                               | optional   | Mounts per-org RWX cache PVCs on the runner; needs the PVC RBAC above + an RWX StorageClass. Default `none` (installs fresh each run via the egress proxy).                                                                                                                                          |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`                                | optional   | `sizeLimit` on the per-exec `/user` emptyDir (default `4Gi`). Bounds deps + temp + outputs; exceeding it evicts the Pod.                                                                                                                                                                             |
| `SANDBOX_EGRESS_PROXY`                                            | optional   | The runner's `HTTPS_PROXY`/`HTTP_PROXY` for `pip`/`npm` (default `http://sandbox-egress:3128`).                                                                                                                                                                                                      |
| `SANDBOX_K8S_SERVER` / `SANDBOX_K8S_TOKEN` / `SANDBOX_K8S_CAFILE` | dev only   | Explicit bearer-token kubeconfig for local Bun dev (kind's client-cert kubeconfig auths as `system:anonymous` under Bun — see TLS note below). In-cluster uses the projected SA token automatically.                                                                                                 |

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

Note the asymmetry with the compose stack: on Docker, `tale-sandbox-net` is an
`--internal` bridge and the egress proxy's entrypoint installs IMDS/RFC1918
iptables rules, so the proxy is the runtime's only outbound path even with no
operator action. On k8s there is **no built-in network-layer enforcement at
all** — the spawner only sets `HTTP_PROXY`/`HTTPS_PROXY` env vars, which a
process is free to ignore. The proxy itself is open at the hostname layer by
default (`SANDBOX_EGRESS_ALLOWLIST` opt-in), so this NetworkPolicy is the
_only_ egress fence on k8s; do not run untrusted workloads without it.

## TLS contract under Bun

`@kubernetes/client-node@1.4.0` routes every API call through **node-fetch v2**
(`gen/http/isomorphic-fetch.js`), which calls `https.request()` with an
`https.Agent` — **not** Bun's native `fetch()`. Through `node:https`, Bun
**does** honour TLS options set on the Agent:

| Kubeconfig knob                      | Effect                                        | Honoured by Bun?                                                                           |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `skipTLSVerify: true`                | sets `rejectUnauthorized: false` on the Agent | **Yes** — real security relaxation, not dead code                                          |
| `caFile` / `caData`                  | reads CA bytes into `agent.options.ca`        | **Yes** — CA is used for server-cert verification                                          |
| `certFile` / `keyFile` (client cert) | sets `cert` / `key` on the Agent              | **No** — Bun's TLS stack does not support mTLS client certs; use bearer-token auth instead |

**Practical consequences:**

- `SANDBOX_K8S_SERVER` + `SANDBOX_K8S_TOKEN` without `SANDBOX_K8S_CAFILE` falls
  back to `skipTLSVerify: true`. This **disables TLS certificate verification**
  for the apiserver — intentional for local dev against self-signed clusters, but
  must never be used in production.
- `SANDBOX_K8S_CAFILE` enables proper CA verification through the Agent. Set it
  to the cluster's CA bundle when the apiserver's cert is issued by a private CA.
- `NODE_EXTRA_CA_CERTS` should **also** be set in-cluster to the SA `ca.crt`
  path (`/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`) as a
  belt-and-suspenders measure: any native `fetch()` calls (e.g. harvest
  presigned-URL uploads) go through Bun's native TLS stack, which reads this env
  var but ignores `agent.options.ca`.

## Verification status

Unit-tested (no cluster): the Pod shape + the security invariant (Secret never
on the runner), the ExecSpec Secret payload + round-trip, the
`__TALE_RESULT__` result-line protocol, and the `skipTLSVerify`/`caFile` TLS
knob propagation through the Agent (see `k8s-client.test.ts`). The on-cluster
reliability bar (50+ consecutive real executions ~100% pass, 2-replica scale,
cancel-across-replicas) is **pending a healthy cluster** and must be run before
enabling this backend in production.
