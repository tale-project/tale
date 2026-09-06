# Sandbox on Kubernetes (`SANDBOX_BACKEND=kubernetes`)

The sandbox spawner runs on both Docker Compose (default) and Kubernetes. This
document is the **contract the in-repo Kubernetes backends require** — the RBAC
verbs they call, the env they read, and the NetworkPolicy they assume. The Helm
chart (authored separately) must satisfy it. The Compose path is unaffected.

## Execution model — exec-free, one Pod per session

Every sandbox run is a **session** (see [sessions.md](sessions.md)): one
long-lived Pod per session running `runnerd`, a per-session Secret carrying the
runnerd token + seed env (`envFrom`), and a per-session workspace PVC that
outlives the Pod across stop → resume. Every spawner↔Pod interaction is plain
HTTP — the Kubernetes API for the object lifecycle (`create`/`read`/`delete`
Pod, Secret, PVC) and runnerd on the Pod IP (`:8200`) for exec, files, env and
the browser view. There is **no exec websocket** and **no `pods/exec`** (the
exec transport proved unreliable under Bun, and keeping the verb out lets a
stray exec call fail closed).

Two backends share the client:

- `KubernetesSessionBackend` — the session lifecycle above. Pod/Secret/PVC
  names are deterministic (`tale-sbx-ses-<hash>`, `-spec`, `-ws`), so any
  spawner replica can address, adopt, or destroy any session statelessly.
- `KubernetesBackend` — the host lifecycle only: API/RBAC connectivity and the
  NetworkPolicy at boot (`init`), the `/health` probe (a namespaced Pod list),
  and the periodic sweep that reaps leaked legacy one-shot objects
  (`tale.sandbox=1` Pods/Secrets, of which none are created anymore).

**Horizontal scale:** the spawner Deployment is HPA-able. The in-memory session
registry is a per-replica cache: a request for a session another replica
created re-resolves it from the backend by deterministic name and adopts it,
and every sweep tick re-adopts whatever the backend lists. Total throughput =
replicas × `SANDBOX_MAX_SESSIONS`, bounded by cluster capacity.

**Resource bounds:** the runner container enforces the profile's cpu/memory
limits; the workspace PVC is sized by `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`
(default `4Gi`), which under DinD also bounds the inner-docker `emptyDir`.
`SANDBOX_RUNTIME` selects the RuntimeClass per tier (gVisor / sysbox / kata;
runc omits the field). DinD and the live browser view are agent-profile
capabilities: a `default`-profile Pod (run_code, crawler renders) stays fully
hardened whatever the deployment flags say.

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
    # TTL/idle-reaping the pinned session on its first sweep. `list` backs
    # boot + periodic adoption, the registry-miss re-resolve, /health, and
    # the legacy-orphan sweep.
    verbs: ['create', 'get', 'list', 'delete', 'patch']
  - apiGroups: ['']
    resources: ['secrets']
    # The per-session Secret (`<pod>-spec`: runnerd token + seed env) is
    # created with the Pod and deleted on stop/destroy; `list` powers the
    # legacy-orphan sweep (podless `tale.sandbox=1` Secrets).
    verbs: ['create', 'delete', 'list']
  - apiGroups: ['']
    resources: ['persistentvolumeclaims']
    # The per-session workspace PVC (`<pod>-ws`): read-before-create on every
    # create/resume, deleted ONLY by an explicit destroy. Without `delete`
    # every destroy leaks a PVC (the failure is surfaced as 502 and retried).
    verbs: ['get', 'create', 'delete']
  - apiGroups: ['networking.k8s.io']
    resources: ['networkpolicies']
    # The session egress fence, applied at boot (create, or update an
    # existing one so a policy change lands on redeploy).
    verbs: ['create', 'update']
```

There is **no `pods/exec`** rule — the exec-free transport never opens an exec
stream. Keep it out so a stray exec call fails closed.

## Environment

| Env                                                               | Required   | Notes                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SANDBOX_BACKEND=kubernetes`                                      | yes        | Selects this backend.                                                                                                                                                                       |
| `SANDBOX_RUNTIME_IMAGE`                                           | yes        | The `runner` image (`tale-sandbox-runtime:<tag>`), also used for the transparent-egress sidecar.                                                                                            |
| `SANDBOX_K8S_NAMESPACE`                                           | yes        | Namespace the session Pods/Secrets/PVCs are created in (default `tale-sandbox`).                                                                                                            |
| `NODE_EXTRA_CA_CERTS`                                             | in-cluster | Point at the SA `ca.crt` (`/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`). **This is the only working CA-trust mechanism under Bun** — see [Bun TLS note](#bun-tls-contract) below. |
| `SANDBOX_RUNTIME`                                                 | optional   | Runtime tier (`runc` default, `gvisor`/`runsc`, `sysbox`, `kata`); sets the Pod `runtimeClassName`, overridable via `SANDBOX_RUNTIME_CLASS` for a non-runc tier.                            |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`                                | optional   | Size of the per-session `/agent` workspace PVC (default `4Gi`) and, under DinD, the `sizeLimit` of the inner-docker `emptyDir`. Bounds deps + temp + outputs.                                |
| `SANDBOX_K8S_CACHE_STORAGECLASS`                                  | optional   | StorageClass for the workspace PVCs (`ReadWriteOnce`). Unset ⇒ the cluster default. On a multi-node cluster use a class whose volumes can re-bind where a resume Pod schedules.               |
| `SANDBOX_EGRESS_PROXY`                                            | optional   | The runner's `HTTPS_PROXY`/`HTTP_PROXY` (default `http://sandbox-egress:3128`); also what the transparent-egress sidecar tunnels to.                                                         |
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

Unit-tested (no cluster): the session Pod shape and its per-profile hardening
(DinD / browser view are agent-only), the Secret-via-`envFrom` invariant, the
create-conflict and failed-create cleanup rules, the workspace-PVC lifecycle,
and the NetworkPolicy shape. The on-cluster reliability bar (create → exec →
kill-container-restart → idle-stop → resume → destroy, cross-replica exec /
destroy, 2-replica scale) is **pending a healthy cluster** and must be run
before enabling this backend in production.
