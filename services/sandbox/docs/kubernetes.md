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
Pod, Secret, PVC) and runnerd on the Pod IP (`:8200`) for exec, files and env.
There is **no exec websocket** and **no `pods/exec`** (the
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

Organization BuildKit daemons, registry mirrors and their private Docker
bridges belong to the Docker backend. Kubernetes uses the session's inner
Docker builder; Kubernetes reconciliation never invokes the Docker CLI to
provision or retire those helpers.

**Horizontal scale:** the spawner Deployment is HPA-able. The in-memory session
registry is a per-replica cache: a request for a session another replica
created re-resolves it from the backend by deterministic name and adopts it,
and every sweep tick re-adopts whatever the backend lists. Session admission
consults the namespace inventory; replicas do not multiply `SANDBOX_MAX_SESSIONS`.
Concurrent creates on different replicas are not protected by a distributed
reservation, so this limit is best effort. Use Kubernetes ResourceQuota and
profile resource limits for hard namespace resource bounds.

The signed capacity endpoint reports running and pending session Pods in this
namespace, plus this spawner's configured session ceilings. Unknown Pod phases
remain occupied until termination is confirmed. CPU and memory
measurements remain unavailable: the namespace-scoped ServiceAccount cannot
read node capacity or the metrics API, and the spawner Pod's own resources
would not describe the cluster.

A create reads its Pod about once a second while it waits for an address and
for runnerd (which it asks every 100 ms). When the runner or the egress sidecar
shows a state it does not recover from within a create (`CrashLoopBackOff`,
`ErrImagePull`, `ImagePullBackOff`, `ErrImageNeverPull`, `InvalidImageName`,
`CreateContainerConfigError` or `CreateContainerError`), the create fails at
once with that reason, the container's last exit and the end of its log (the
runner reports its logs as its termination message), instead of waiting out
`SANDBOX_SESSION_CREATE_TIMEOUT_MS`. A container still being created or pulled
keeps the create waiting.

Pending Pods count against admission even before runnerd has an address. A
spawner restart therefore cannot admit another full set beside the Pods still
starting. After a crashed create, maintenance can remove a Pod that remains
Pending past its recorded `tale.dev/startup-deadline` plus 60 seconds. Legacy
Pods without that annotation receive the longer of the current startup timeout
and 24 hours, plus the same grace. Recovery checks the apiserver creation time,
creation stamp, UID and resource version, so a newer incarnation or a Pod that
became Running during the check is left alone. Its Secret is removed by UID;
the workspace PVC stays intact. Capacity is released only after the Pod is gone.

Failed creates delete only Pod and Secret UIDs acknowledged by their own API
create responses. Pod cleanup also fences the observed resource version. A
replacement or ambiguous response leaves compute for normal recovery; every
failed create preserves its workspace PVC for retry or explicit destroy.
Running and Unknown Pods are never removed by this startup recovery.

**Resource bounds:** the runner container enforces the profile's cpu/memory
limits and requests its typical working set rather than its ceiling: an agent
Pod `250m` / `512Mi` (`1Gi` under DinD), a crawler render `250m` / `512Mi`,
overridable for every Pod by `SANDBOX_K8S_CPU_REQUEST` /
`SANDBOX_K8S_MEMORY_REQUEST` and never above the limit (an idle session uses
~60 MB; the old flat `500m` / `1Gi` capped a node's sessions by CPU they
never used). The transparent-egress sidecar requests `10m` / `16Mi` / `16Mi`
of ephemeral storage (limit `250m` / `64Mi` / `128Mi`), so a namespace
ResourceQuota admits the Pod; a zero runner `ephemeral-storage` request zeroes
the sidecar's too. The workspace
PVC of an agent session is sized by `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`
(default `4Gi`); a crawler render, never resumed, gets an `emptyDir` of that
size instead of a PVC. Under DinD the inner Docker store is an `emptyDir`
sized by `SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT` (default `20Gi`): one pull of
a large build image unpacks to several GiB, and an `emptyDir` past its
`sizeLimit` evicts the whole session.
`fsGroupChangePolicy: OnRootMismatch` keeps the kubelet from re-chowning a
whole workspace on every resume.
`SANDBOX_RUNTIME` selects the RuntimeClass per tier (gVisor / sysbox / kata;
runc omits the field). DinD is an agent-profile capability:
a `default`-profile Pod (run_code, crawler renders) stays fully
hardened whatever the deployment flags say.

**Node disk:** the runner requests `256Mi` of `ephemeral-storage`
(`SANDBOX_K8S_EPHEMERAL_STORAGE_REQUEST`) and is limited to a headroom of
`2Gi` (`SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT`) for its writable root
filesystem and logs, plus every disk-backed `emptyDir` it mounts: the kubelet
evicts a Pod whose writable layers, logs and `emptyDir` volumes together
exceed the sum of its containers' limits. An agent Pod is limited to `2Gi`
(its workspace is a PVC, which does not count), a crawler render to `6Gi`, a
DinD agent to `22Gi`; the request never exceeds the limit. A session past its
limit is evicted on its own instead of filling the node until DiskPressure
evicts the platform's Pods beside it. Under node disk pressure the kubelet
evicts Pods using more than they request first, by priority, then by how far
their use exceeds their request. The memory-backed `/tmp` and `/dev/shm` count against memory
instead. An evicted agent session's Pod stays `Failed` until its next resume
removes it and recreates the session on the intact workspace PVC.

**Placement:** `SANDBOX_K8S_NODE_SELECTOR` (a JSON object of node labels),
`SANDBOX_K8S_TOLERATIONS` (a JSON array of Pod tolerations) and
`SANDBOX_K8S_PRIORITY_CLASS` set `nodeSelector`, `tolerations` and
`priorityClassName` on every session Pod, crawler renders included. Unset,
the fields are omitted, and sessions (privileged under runc DinD) can
schedule beside the database and platform Pods and starve them. Label and
taint dedicated nodes, select and tolerate them here, and give sessions a
PriorityClass below the platform's with `preemptionPolicy: Never`: the
scheduler may then preempt a session to place a platform Pod, never the
reverse, and among Pods over their requests the kubelet evicts sessions
first. The values are
held to the apiserver's rules at boot (label keys and values, a toleration's
operator, effect and `tolerationSeconds`, a DNS-subdomain class name), so a
typo stops the spawner instead of failing every create. The spawner needs no
extra RBAC; a cluster administrator creates the PriorityClass once. A
changed selector reaches new Pods only, and with node-local storage a
stopped session resumes only on the node that holds its workspace PVC.

**Image pre-pull:** `warmImage` is a no-op on this backend; the kubelet
pulls the runtime image per Pod. The first session on a node pulls it
(about 2 GB compressed) inside its create budget, and kubelet image garbage
collection can remove it again once no Pod uses it. The
[Kubernetes install guide](../../../docs/en/self-hosted/install/kubernetes.md)
ships an optional DaemonSet, `45-sandbox-prepull.yaml`: no-op init
containers of the runtime, egress and gateway images behind a pause
container (`1m` / `4Mi` requests), on the same `${VERSION}` tags as the
rest of the manifests and with the session placement as a commented-out
selector and toleration.

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
    # create/resume, deleted ONLY by a destroy (the explicit Destroy, or the
    # platform's workspace cleanup). Without `delete` every destroy leaks a
    # PVC (the failure is surfaced as 502 and retried). `list` backs the
    # workspace inventory the cleanup reconciles against; without it the
    # inventory answers 503 and orphaned PVCs stay.
    verbs: ['get', 'list', 'create', 'delete']
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
| `SANDBOX_DIND_INNER_POOL` | optional | Canonical RFC1918 IPv4 `/16` for the agent's inner Docker daemon. Unset selects automatically; configure a range outside the cluster's Pod, Service and VPC CIDRs. Known overlap remains an error. See [Inner Docker networking](#inner-docker-networking). |
| `SANDBOX_K8S_CPU_REQUEST` / `SANDBOX_K8S_MEMORY_REQUEST`          | optional   | What every session Pod requests (K8s quantities), overriding the per-profile defaults; clamped to the Pod's limit. A malformed value fails the spawner at boot. |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT`                                | optional   | Size of the per-session `/agent` workspace PVC (default `4Gi`) and of a crawler render's workspace `emptyDir`. Bounds deps + temp + outputs. A malformed or zero value fails the spawner at boot. |
| `SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT`                           | optional   | `sizeLimit` of a DinD agent's inner Docker store `emptyDir` (default `20Gi`); also added to that Pod's ephemeral-storage limit. A malformed or zero value fails the spawner at boot. |
| `SANDBOX_K8S_EPHEMERAL_STORAGE_REQUEST` / `SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT` | optional | The runner's `ephemeral-storage` request (default `256Mi`, clamped to the limit) and its headroom for the writable root filesystem and logs (default `2Gi`); the Pod's limit is the headroom plus its disk-backed `emptyDir` sizes. A malformed value, or a zero limit, fails the spawner at boot. Set the request to `0` on nodes that report no `ephemeral-storage` capacity (a kubelet with `localStorageCapacityIsolation: false`, as on some rootless clusters), where any request leaves the Pod unschedulable. |
| `SANDBOX_K8S_NODE_SELECTOR` / `SANDBOX_K8S_TOLERATIONS`           | optional   | JSON: an object of node labels every session Pod must match (`{"tale.dev/sandbox":"true"}`) and an array of Pod tolerations (`[{"key":"tale.dev/sandbox","operator":"Exists","effect":"NoSchedule"}]`). Unset ⇒ omitted. Malformed JSON, label or toleration fails the spawner at boot. See **Placement** above. |
| `SANDBOX_K8S_PRIORITY_CLASS`                                      | optional   | `priorityClassName` of every session Pod. Unset ⇒ omitted (the namespace default priority). An invalid name fails the spawner at boot. |
| `SANDBOX_K8S_CACHE_STORAGECLASS`                                  | optional   | StorageClass for the workspace PVCs (`ReadWriteOnce`). Unset ⇒ the cluster default. On a multi-node cluster use a class whose volumes can re-bind where a resume Pod schedules.               |
| `SANDBOX_EGRESS_PROXY`                                            | optional   | The runner's `HTTPS_PROXY`/`HTTP_PROXY` (default `http://sandbox-egress:3128`); also what the transparent-egress sidecar tunnels to.                                                         |
| `SANDBOX_K8S_SERVER` / `SANDBOX_K8S_TOKEN` / `SANDBOX_K8S_CAFILE` | dev only   | Explicit bearer-token kubeconfig for local Bun dev (kind's client-cert kubeconfig auths as `system:anonymous` under Bun). In-cluster uses the projected SA token automatically.             |

The Pod sets `automountServiceAccountToken: false` — the runtime never gets an
SA token.

## Inner Docker networking

Before starting a DinD agent's inner daemon, the runtime checks all-table IPv4
routes and gateway IPs, interface addresses and prefixes, DNS servers, and the
resolved addresses of proxy and gateway hosts configured at container startup.
Hosts supplied only during a later agent turn are not observed at boot.
Automatic selection prefers an available `172.31.0.0/16`, then tries other private `/16` ranges.
`docker0` uses the first `/24`; nested Compose networks draw `/24` blocks from
the same pool. Failed discovery or exhausted private space stops automatic
startup with a specific error.

A Pod's network namespace does not reveal the full cluster Pod, Service or VPC
CIDRs. For Kubernetes DinD, configure `SANDBOX_DIND_INNER_POOL` in the spawner
Deployment with a canonical RFC1918 `/16` that you have checked against all
those networks. The spawner passes it only to DinD agent Pods. The override
still rejects every known overlap and malformed value. If some observations
are unavailable, the runtime warns with their names and can use the explicit
pool; operators remain responsible for the address space the Pod cannot see.
After changing the pool, restart the spawner and recreate existing session Pods.
A runner-container restart within the same Pod retains its environment and
inner Docker `emptyDir`. See [Storage & lifecycle](docker-in-container.md#storage--lifecycle)
for retained inner-network detection and its boundary for custom bridge names.
See the [operator environment reference](../../../docs/en/self-hosted/configuration/environment-reference.md#sandbox-infrastructure).

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

- **RBAC:** the spawner ServiceAccount needs `create`/`update` on
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

The proxy permits upstream DNS queries to the validated literal nameserver
addresses in its own `/etc/resolv.conf`, including a private cluster DNS
Service. Each exception is limited to that exact IP and UDP/TCP destination
port 53; it does not allow the resolver's subnet or other private ports.
Forwarding between attached networks remains blocked.

### Egress IPv6 prerequisite

The egress proxy must either install its IPv6 firewall or have IPv6 disabled
in its own network namespace. When the firewall is unavailable, its entrypoint
attempts to disable IPv6 locally, then verifies the default and every existing
interface. A read-only `/proc/sys` or denied write can prevent that recovery;
enabled IPv6 without protection still fails startup with an actionable error.
Provide working IPv6 netfilter support or namespace settings allowed by the
cluster. Generated session Pods do not add unsafe sysctls or extra
capabilities to bypass cluster policy.

## Verification status

Unit-tested (no cluster): the session Pod shape and its per-profile hardening
(DinD is agent-only), the Secret-via-`envFrom` invariant, the
create-conflict and failed-create cleanup rules, the workspace-PVC lifecycle,
and the NetworkPolicy shape. Before production, run the on-cluster reliability
suite (create → exec → kill-container-restart → idle-stop → resume → destroy,
cross-replica exec / destroy, 2-replica scale) under the deployment's actual
CNI and RuntimeClass. Include Pod and Service reachability from nested Docker
networks, cluster DNS through the egress proxy, and the egress IPv6 prerequisite.
Passing networking checks in an isolated cluster does not replace this full
deployment-specific suite.
