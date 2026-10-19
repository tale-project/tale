# Sandbox on Incus (`SANDBOX_BACKEND=incus`)

The sandbox spawner runs on Docker Compose (default), on Kubernetes and on
[Incus](https://linuxcontainers.org/incus/). This document is the **contract
the in-repo Incus backends require**: what the spawner asks of the node, what
the operator creates on it, and the env the spawner reads. The Docker and
Kubernetes paths are unaffected, and **the backend is off unless
`SANDBOX_BACKEND=incus` is set**.

> **Status.** Unit tests run both backends against a fake Incus API
> (`src/backend/incus/fake-incus.ts`). An end-to-end lab
> ([e2e/incus](../e2e/incus/README.md), `.github/workflows/sandbox-incus-e2e.yml`)
> runs the spawner from the same checkout against a real Incus (Zabbly's stable
> build on a hosted Ubuntu runner, a ZFS pool on a file, the operator block below
> run verbatim) on pull requests that touch the spawner, the runtime image or the
> egress proxy (a draft is dispatched by hand), and holds the timings in its job
> summary. What a hosted runner is not is what is left:
> [Verify a node](#verify-a-node-before-trusting-it) marks each check as proven
> by that lab or left to your first real node.

## Execution model: one OCI container per session

Every sandbox run is a **session** (see [sessions.md](sessions.md)): one
long-lived Incus instance per session running `runnerd`, and one workspace
volume that outlives the instance across stop and resume. Every
spawner-to-node interaction is the Incus REST API over HTTPS with mutual TLS
(instances, volumes, files, operations), and every spawner-to-session
interaction is plain HTTP to runnerd on the instance's address (`:8200`). There
is no Unix socket, no `incus` CLI, no exec and no SSH.

- The instance is made from the **same runtime image** the other backends run
  (`ghcr.io/tale-project/tale/tale-sandbox-runtime`), imported as an OCI image
  and started as an _application container_ whose entrypoint is
  `/docker-entrypoint.sh daemon`. Incus copies the image's environment, working
  directory and user into the instance; the spawner overrides what a session
  needs differently (the proxy, the limits, the user, the labels, the token).
- It is deliberately **not ephemeral**. An ephemeral instance deletes itself
  the moment it stops, console log and all, and the console is the only place a
  start that failed says why. So an instance that ends stays stopped, with its
  console, until the spawner removes it: a stop, the next create of the same
  id, the route layer's removal of ended compute after a restart or a node
  reboot, or the five-minute sweep. The workspace is
  a **custom storage volume** (`tale-ses-ws-<hash>`) mounted at `/agent`, with
  a quota, `security.shifted` (so every new instance, each with an idmap of its
  own, mounts it without a recursive chown) and the session's owner as its
  initial owner. Stop removes the instance and keeps the volume; a create of
  the same session id mounts it again (a resume); only destroy deletes it. A
  render (`default`-profile) session gets a scratch volume of the same kind that
  goes with its instance.
- Names are deterministic: `tale-sbx-ses-<first 24 hex of sha256(sessionId)>`
  for the instance and `tale-ses-ws-<same hash>` for the volume, so a create
  that finds the name taken knows it is a duplicate. An instance claimed from
  the [warm pool](#the-warm-pool) keeps the name it was made with
  (`tale-sbx-pool-<hex>`; Incus cannot rename a running instance) and is found
  by its label.
- **The objects in Incus are the source of truth**; the spawner's registry is a
  cache. A session's identity, owner, profile, creation stamp (its
  incarnation), create-attempt id, startup deadline, egress address and pin are
  `user.tale.*` labels on its instance, and its owner is a label on its volume,
  so a restarted spawner re-adopts everything from one listing. Nothing secret
  is a label: the seed environment reaches runnerd over its own API after
  readiness, and never the instance config, which anyone who can read the
  instance can read.
- **Fencing.** Incus has no preconditioned stop or delete. A fenced operation
  (given the creation stamp it expects) reads the instance, compares its stamp
  and Incus's own immutable creation time, acts on that instance, and re-checks
  the creation time while the instance goes: a replacement that took the name
  meanwhile is reported as `SessionIncarnationChangedError` and never counted
  as freed. The pin is written with the ETag it was read with, so it cannot
  land on a replacement. The route layer serializes the operations of one
  session id; **run one spawner per Incus project** (a claimed standby is
  arbitrated by that serialization, not by a name Incus enforces).
- A create that fails removes only the instance carrying its own random
  create-attempt label (and a render session's scratch volume); a durable
  workspace volume always stays for the retry or an explicit destroy. A create
  that finds the name taken by a **live** session answers `SessionExistsError`
  (a duplicate the platform adopts) and touches nothing.
- `reapStaleSession` removes an instance that never started, past the deadline
  its creator recorded plus 60 seconds, fenced like a stop; the periodic sweep
  also removes ended session instances, a crashed warm-up's instance and a
  render scratch volume whose instance is gone. It never touches an agent
  session's workspace: the platform destroys those from its records.

Two backends share one connection:

- `IncusSessionBackend`: the session lifecycle above.
- `IncusBackend`: the host lifecycle only: the boot checks (`init`), the warm
  pool's upkeep, `/health` (an authenticated `GET /1.0`), `warmImage` and the
  sweep.

### Why an OCI application container, not a system container

A system container (an Incus image with an init system) would run Docker
inside, systemd and a DHCP client the way Incus's other workloads do, and it
starts without Incus's synchronous DHCP wait. The backend still runs the OCI
**application container** from the existing runtime image, because:

- it reuses the image the other backends already build, test and sign: no
  second Dockerfile, no export-and-publish step in the release pipeline, no
  init-system layer to maintain, and the entrypoint's tier assertions
  (`uid_map` is not host root) and egress setup run exactly as they do on
  Docker and Kubernetes;
- an application container is one process tree under `lxc-init`, like the
  Docker and Kubernetes sessions, which is what runnerd's lifecycle (graceful
  stop, OOM, exit) already assumes.

What it costs, and how that is bounded:

- **Docker inside** on an OCI container is proven by the CI lab (the inner
  engine, `docker run`, `docker build` and the containment of nested
  containers) on one kernel and storage driver only, so it stays opt-in
  (`SANDBOX_DOCKER_IN_CONTAINER=true`) and a boot warning says so. The node
  checks below decide it for yours.
- The start waits for the instance's DHCP lease (at most five seconds, and the
  lab's cold create takes three to four in all), which the
  [warm pool](#the-warm-pool) hides by handing out an instance that has
  already started: a claim takes under a second.

## Trust boundary

The Docker backend holds the host's Docker socket, which is host root. The
Incus backend holds **a restricted client certificate** instead:

- The certificate is added with `incus config trust add-certificate
client.crt --restricted --projects <project>`. A restricted certificate has
  full control only inside its projects; the trust store, the storage pools
  and the `default` project's images, profiles, volumes and networks it can
  only **view**. It cannot create a project, change a pool, add a certificate
  or reach another project, and the backend never asks for `all-projects` or
  names a project it was not given.
- **One certificate and one project per environment** (a `pr` spawner reaches
  only `sandbox-pr`, a `te` spawner only `sandbox-te`). The backend uses
  exactly one project, so this needs no code, only discipline.
- The project is **restricted** (`restricted=true`), so even a compromised
  spawner cannot ask for a privileged container, a host path, raw LXC config
  or a NIC of its own: the checks below refuse a project that is not.
- **The spawner pins the node's own server certificate** (the third PEM file)
  as its only trust anchor, with full verification on. Bun can only use a
  certificate as its own anchor when it is a CA certificate, which Incus's
  default server certificate (`CA:FALSE`) is not. The node must therefore serve
  a **self-signed certificate with `CA:TRUE`, `pathlen:0`, key usage
  `keyCertSign`, extended key usage `serverAuth`, and the API address in its
  subject alternative name** (hostkit provides it). Boot reads the file and
  refuses an unpinnable one with that explanation, a key that is not the client
  certificate's, and an expired certificate; certificate verification is never
  turned off. Renew a certificate before it expires and restart the spawner: the
  files are read once at boot, and boot warns two weeks ahead.
- The session instances themselves are unprivileged containers with an
  **isolated idmap** (`security.idmap.isolated`, so no two sessions share a host
  uid range, which Docker's default runc tier does not give), Incus's default
  seccomp and AppArmor policy, no guest API (`security.guestapi=false`), no
  autostart, and none of the low-level keys a restricted project forbids
  (`raw.*`, `limits.memory.swap`, `limits.memory.oom_priority`). Everything the
  entrypoint starts runs under **`no_new_privs`** (the entrypoint is wrapped in
  `setpriv --no-new-privs`, since a restricted project cannot set it with
  `raw.lxc`), which is what Docker's `no-new-privileges` is for the other
  backends: a setuid or file-capability binary in the image (`su`,
  `newuidmap`, `mount`) cannot lift the session user above itself. Docker
  inside is the exception, as it is on Docker: the inner engine's runtime needs
  to grow privileges.
- **The runnerd token** is an `environment.*` key of the instance, as it is a
  `-e` of the container on Docker: the spawner derives it from `SANDBOX_TOKEN`
  and the session id, it opens that one session's runnerd only, and runnerd is
  reachable from the spawner alone (the ACL). The spawner's certificate, and
  the node's administrators, are the only readers of the instance config, and
  both can derive or read it anyway; the seed environment, which can carry
  secrets, never touches the config. A standby receives its token in a file
  (mode 0600, removed on claim) instead.
- **The network containment is the profile's NIC.** An instance device of the
  profile's NIC name would replace it wholesale (ACL and port isolation with
  it), so the backend never adds a NIC to an instance. Boot refuses a profile
  whose NIC is not on `SANDBOX_INCUS_NETWORK`, or without a network ACL it can
  see: Incus shows a network's own configuration to administrators only, so the
  spawner's restricted certificate sees an ACL named on the NIC and cannot see
  one attached to the bridge alone (name it on the NIC too: Incus applies both).
  `SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK=true` is an escape hatch that warns.

## What the operator creates on the node

The spawner only looks these objects up; none is created or changed by it
except instances, workspace volumes and (when asked) the image alias, all inside
its project.

| Object      | Variable                                                  | Requirement                                                                                                                                                                              |
| ----------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project     | `SANDBOX_INCUS_PROJECT`                                   | restricted; own images, profiles and **storage volumes**; settings below                                                                                                                 |
| Profile     | `SANDBOX_INCUS_PROFILE`                                   | a `nic` device on `SANDBOX_INCUS_NETWORK` with `security.acls` (or the network carries them) and ideally `security.port_isolation=true`; a `root` disk on the pool with a `size`        |
| Network     | `SANDBOX_INCUS_NETWORK`                                   | a managed bridge whose resolver forwards nothing; the ACL below                                                                                                                          |
| Pool        | `SANDBOX_INCUS_STORAGE_POOL`                              | `zfs` (or btrfs/lvm): volume quotas; the instances are copy-on-write clones of the image                                                                                                 |
| Image       | `SANDBOX_INCUS_IMAGE`                                     | an alias in the project to the runtime image (below)                                                                                                                                     |
| Certificate | `SANDBOX_INCUS_CLIENT_CERT_FILE`, `_KEY_FILE`, `_SERVER_CERT_FILE` | the restricted client certificate and its unencrypted PEM key, and the node's pinnable server certificate, mounted read-only into the spawner                                    |

**Project settings** (`incus project set <project> ...`):

```
features.images=true
features.profiles=true
features.storage.volumes=true      # required: else volumes land in `default`, read-only for this certificate
restricted=true
restricted.containers.nesting=allow    # only with Docker inside
restricted.containers.interception=allow  # only with Docker inside
```

Leave `restricted.containers.lowlevel` at `block`: allowing it also admits
`raw.lxc`. Leave `restricted.devices.disk` at its default (`managed`, pool-backed
disks only), which is all the backend asks for: `allow` admits every host path
unless `restricted.devices.disk.paths` confines it, and Incus accepts absolute
paths there only, so no setting admits a `tmpfs` disk device without admitting
the host's directories too. That is why `/dev/shm` is not a device (below).

**Project limits** are an optional, server-side backstop to
`SANDBOX_MAX_SESSIONS`: Incus counts them over every instance of the project
and refuses a create that would pass one. Sessions define `limits.memory` and
`limits.processes` themselves and every workspace volume a `size`, so
`limits.instances`, `limits.containers`, `limits.memory` (an absolute size),
`limits.processes` and `limits.disk` work as Incus documents them (the last
needs the profile's root disk to have a `size`). **Set `limits.cpu` on the
project only together with `limits.cpu` on the profile**: a project `limits.cpu`
makes Incus refuse every instance that does not define `limits.cpu` (a count of
CPUs) itself or through its profile, and this backend limits CPU with
`limits.cpu.allowance` and sets no `limits.cpu` of its own; boot refuses the
project key alone and takes the pair (every session then holds a count, and
Incus adds the counts up). A create past a limit fails with Incus's own message
(`Reached maximum aggregate value ...`), which the platform sees as a failed
create, not a busy spawner, so size `SANDBOX_MAX_SESSIONS` to stay under them.

Boot reads the server, project, profile, network and pool and **refuses**:
a missing API extension (`instance_oci`, `instance_oci_entrypoint`,
`oci_network_config`, `instance_create_start`, `storage_shifted`,
`storage_initial_owner` and `storage_volumes_created_at`), a project without
its own storage volumes, a restricted project that does not allow, with Docker
inside, nesting and interception, a project that sets `limits.cpu` while the
profile does not, or a disk limit while the profile's root disk has no size, an
unmanaged network, a profile without a NIC on the configured network and
without an ACL on that NIC, and a `SANDBOX_AGENT_SHM_SIZE` the entrypoint
cannot mount. Everything allowed but worth knowing is a warning: an
unrestricted project, a project without its own images, disk devices allowed
from any host path, low-level keys allowed, project count, memory, process, CPU
or disk limits below what `SANDBOX_MAX_SESSIONS` can add up to (a session's CPU
count is the profile's `limits.cpu`; its disk is the profile's root disk plus
`SANDBOX_INCUS_WORKSPACE_SIZE`, and the images the project holds come on top), a
kernel that reports no idmapped mounts, a NIC without port isolation, a root
disk without a size or on another pool, a `dir` pool.

**Network.** Sessions resolve nothing themselves: the bridge's resolver forwards
no queries, so a session reaches only the egress proxy, and the spawner sets
the session's resolver (`oci.dns.nameservers`, default the egress proxy's
address, whose dnsmasq already serves nested containers; override with
`SANDBOX_INCUS_DNS`). Incus ignores the name servers DHCP hands out once that
key is set, so the bridge's own resolver is not consulted. Therefore:

- **`SANDBOX_EGRESS_PROXY` must be an IPv4 literal** (`http://10.20.0.2:3128`),
  and boot refuses a name. A moved proxy address means a changed variable and a
  restart; sessions that pinned the old address are then recycled once they are
  released.
- **Keep the infrastructure's addresses out of the DHCP pool.** Incus keeps
  DHCP from handing out the address it gave an *instance* of the network a
  static address, but not an address a host, another network or the node itself
  holds. A session that is handed the address of the gateway, the backend or the
  node is unreachable (its own address is the node's, so the spawner's calls to
  runnerd never leave the node) and its create waits out its budget; the lab
  measured it at about one create in a hundred when two such addresses lay in
  the pool, and saw none in 640 creates once the pool left them out. Give the
  pool its own range (`ipv4.dhcp.ranges`) in the part of the subnet that holds
  no service, and size it for `SANDBOX_MAX_SESSIONS` plus the pool and the
  image warm-ups. Boot cannot check this for you (a restricted certificate is
  shown no network configuration). Leases do not pile up behind removed
  instances: the lab's DHCP server held 4 to 6 leases after every round of its
  soak, 640 creates and removals in.
- **Name the ACL on the profile's NIC**, as the example does. You may attach it
  to the bridge as well (every port of the bridge, the egress proxy's and any
  other instance's, then falls under it, and needs rules of its own), but the
  spawner's certificate is shown no network configuration, so only the NIC can
  tell it an ACL applies. If the ACL is on the bridge alone, boot refuses with
  that explanation; `SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK=true` is for the one
  who knows it applies.
- The ACL on the sandbox network admits, from a session: tcp 3128 and udp/tcp 53
  to the egress proxy; tcp 8080 to the LLM gateway and tcp 3005 to the backend
  (reached directly, since the proxy refuses private destinations); and, to a
  session: tcp 8200 from the spawner. Everything else is dropped.
- **Give the sessions the platform's names.** `sandbox-llm-gateway`,
  `backend-api` and `backend-relay` (the session's `NO_PROXY` list) must
  resolve, for a session, to addresses reachable from the sandbox network. The
  egress proxy's resolver, the default, holds no records of its own, so with it
  they do not resolve. The bridge's own resolver is the one DNS server an ACL
  cannot refuse (the lab's ACL has no rule for it, and the bridge answers a
  session that asks), so list the names there and hand sessions the bridge as
  their resolver:

  ```
  incus network set sbx0 raw.dnsmasq="no-resolv
  address=/sandbox-llm-gateway/10.20.0.3
  address=/backend-api/10.20.0.4
  address=/backend-relay/10.20.0.4"
  # in the spawner's environment (restart it; new sessions are given the bridge)
  SANDBOX_INCUS_DNS=10.20.0.1
  ```

  A session then resolves exactly those names and nothing else; whatever it
  reaches outside goes through the proxy, which resolves for it. A tool that
  ignores the proxy settings finds no name to connect to (an address still goes
  through the transparent redirect to the proxy). Or run a resolver of your own
  that holds the records, name it in `SANDBOX_INCUS_DNS`, and let the ACL admit
  udp and tcp 53 to it.
- **Give the sandbox bridge no address but its own** (`ipv4.address`). An OCI
  container has no DHCP client of its own: Incus runs one beside it
  (`forknet dhcp`, its log is `forknet-dhcp.log` in the instance's log
  directory), and when it releases a lease it sends the release to the last
  address of the bridge. The lab first hosted the LLM gateway and backend
  stand-ins as extra addresses on the bridge and saw about two instances in a
  hundred start running and without an address, so that their create waited out
  its whole budget; with the stand-ins on a link of their own it has not seen
  one in three full runs. Put such services on another interface or host.
- The spawner must reach the sessions: runnerd answers on tcp 8200 at each
  instance's own address, so run the spawner where the sandbox bridge is
  routable (on the node, or on a network with a route to it), and let the ACL's
  ingress rule name the spawner's address. It also needs the node's API
  (`SANDBOX_INCUS_ENDPOINT`, tcp 8443) and nothing else of the node.

**Image.** Import the runtime image of the Tale version you run as an alias of
the project, or let the spawner pull it:

```
# as an administrator, from an OCI remote (see the Incus documentation on OCI images):
incus remote add ghcr https://ghcr.io --protocol=oci
incus image copy ghcr:tale-project/tale/tale-sandbox-runtime:<version> local: \
  --alias tale-sandbox-runtime --project sandbox-pr

# or let the spawner pull it, in its environment:
SANDBOX_INCUS_IMAGE=tale-sandbox-runtime-<version>
SANDBOX_INCUS_IMAGE_SOURCE=ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>
```

`warmImage` pulls the image under the alias only when the alias is missing, then
makes Incus unpack it into the pool with a throwaway stopped instance, which
Incus otherwise does while the first session starts. **To upgrade, give the new
version a new alias** (or move the alias) before the spawner restarts; an alias
that already exists is never re-pulled. A create that finds the image gone tells
the warm-up, which pulls it again while creates wait.

### An example, for one environment

Names and addresses are examples; the table above is the contract. This one
runs the spawner on the node itself, so the address its calls to the sessions
come from is the bridge's own (`10.20.0.1`); run it elsewhere, and the ingress
rule names that address instead. The pool (`tank`) is the node's, made by
whoever installed Incus. As an administrator:

<!-- e2e:operator-setup -->

```
# the sandbox bridge: its own resolver forwards nothing (the egress proxy
# resolves for the sessions), and it NATs so that the egress proxy, an instance
# on it, reaches the internet (the sessions' ACL lets them reach nothing else).
# Its DHCP pool is the upper part of the subnet only: the lower addresses are
# the infrastructure's (below), and DHCP must never hand one out
incus network create sbx0 ipv4.address=10.20.0.1/24 ipv4.nat=true \
  ipv4.dhcp.ranges=10.20.0.100-10.20.0.254 ipv6.address=none raw.dnsmasq=no-resolv

# the project
incus project create sandbox-pr \
  -c features.images=true -c features.profiles=true \
  -c features.storage.volumes=true -c restricted=true

# the sandbox network's ACL (10.20.0.2 is the egress proxy and its resolver,
# 10.20.0.3 the LLM gateway, 10.20.0.4 the backend, 10.20.0.1 the spawner)
incus network acl create sandbox-egress
incus network acl rule add sandbox-egress egress action=allow destination=10.20.0.2/32 protocol=tcp destination_port=3128
incus network acl rule add sandbox-egress egress action=allow destination=10.20.0.2/32 protocol=tcp destination_port=53
incus network acl rule add sandbox-egress egress action=allow destination=10.20.0.2/32 protocol=udp destination_port=53
incus network acl rule add sandbox-egress egress action=allow destination=10.20.0.3/32 protocol=tcp destination_port=8080
incus network acl rule add sandbox-egress egress action=allow destination=10.20.0.4/32 protocol=tcp destination_port=3005
incus network acl rule add sandbox-egress ingress action=allow source=10.20.0.1/32 protocol=tcp destination_port=8200

# the profile every session gets: its network device (with the ACL and port
# isolation) and its root disk
incus profile create sandbox --project sandbox-pr
incus profile device add sandbox eth0 nic network=sbx0 \
  security.acls=sandbox-egress security.port_isolation=true --project sandbox-pr
incus profile device add sandbox root disk path=/ pool=tank size=30GiB \
  --project sandbox-pr

# the spawner's certificate, restricted to that project
incus config trust add-certificate client.crt --name tale-sandbox-pr \
  --restricted --projects sandbox-pr
```

The CI end-to-end lab ([e2e/incus](../e2e/incus/README.md)) runs exactly this
block, so it cannot drift from what the backend is tested against.

The spawner then runs with `SANDBOX_INCUS_ENDPOINT=https://<node>:8443`,
`SANDBOX_INCUS_PROJECT=sandbox-pr`, `SANDBOX_INCUS_PROFILE=sandbox`,
`SANDBOX_INCUS_NETWORK=sbx0`, `SANDBOX_INCUS_STORAGE_POOL=tank`,
`SANDBOX_INCUS_IMAGE=tale-sandbox-runtime`, the three certificate files, and
`SANDBOX_EGRESS_PROXY=http://10.20.0.2:3128`. The node's own server certificate
(`/var/lib/incus/server.crt`) must be the pinnable kind described above.

## Configuration

Validated at boot (`src/backend/incus/incus-config.ts`); a bad value stops the
spawner with a message that names the variable, and all missing required
variables are named at once.

| Variable                                | Default            | Meaning                                                                                                                              |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `SANDBOX_BACKEND`                       | `docker`           | `incus` selects this backend.                                                                                                        |
| `SANDBOX_INCUS_ENDPOINT`                | required           | `https://host:8443`, the origin of the Incus API.                                                                                    |
| `SANDBOX_INCUS_PROJECT`                 | required           | The restricted project everything lives in.                                                                                          |
| `SANDBOX_INCUS_PROFILE`                 | required           | The profile applied to every session; it owns the NIC.                                                                               |
| `SANDBOX_INCUS_NETWORK`                 | required           | The managed network the profile's NIC must be on.                                                                                    |
| `SANDBOX_INCUS_STORAGE_POOL`            | required           | The pool of the workspace volumes.                                                                                                   |
| `SANDBOX_INCUS_IMAGE`                   | required           | The image alias sessions are created from.                                                                                           |
| `SANDBOX_INCUS_IMAGE_SOURCE`            | unset              | An OCI reference, registry first, pulled under the alias while it is missing.                                                        |
| `SANDBOX_INCUS_CLIENT_CERT_FILE`        | required           | Absolute path of the restricted client certificate (PEM).                                                                            |
| `SANDBOX_INCUS_CLIENT_KEY_FILE`         | required           | Absolute path of its unencrypted private key (PEM).                                                                                  |
| `SANDBOX_INCUS_SERVER_CERT_FILE`        | required           | Absolute path of the node's pinnable server certificate (PEM).                                                                       |
| `SANDBOX_INCUS_POOL_SIZE`               | `0`                | Warm standbys kept ready (0 turns the pool off); at most `SANDBOX_MAX_SESSIONS`.                                                     |
| `SANDBOX_INCUS_WORKSPACE_SIZE`          | `10GiB`            | Quota of a workspace volume (`10g`, `512m` and Incus sizes).                                                                         |
| `SANDBOX_INCUS_DNS`                     | the egress proxy   | Comma-separated IPv4 resolvers handed to a session.                                                                                  |
| `SANDBOX_INCUS_DOCKER_CONFIG`           | nesting + intercept | A JSON object of instance config added to a session with Docker inside, replacing the default (`security.nesting`, and the `mknod` and `setxattr` interceptions). Only `security.nesting` and the interceptions a restricted project can allow (`security.syscalls.intercept.` plus `bpf`, `bpf.devices`, `mknod`, `mount`, `mount.fuse`, `setxattr` or `sysinfo`), each `true` or `false`; the other low-level keys, such as `security.idmap.size`, a restricted project refuses. |
| `SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK` | `false` | Do not require an ACL on the profile's NIC (a lab, or an ACL attached to the network alone, which the certificate cannot see). |
| `SANDBOX_INCUS_NPM_REGISTRY`            | unset              | An npm cache sessions install from, an `http://` URL whose host is an IPv4 address ([below](#package-registry-caches)).              |
| `SANDBOX_INCUS_PYPI_INDEX`              | unset              | A PyPI simple index sessions install from, in the same form ([below](#package-registry-caches)).                                     |
| `SANDBOX_INCUS_API_TIMEOUT_MS`          | `15000`            | Budget of one API request (long-poll waits for operations excepted).                                                                 |

Under this backend the runtime tier is fixed at `sysbox` (an unprivileged
container in a user namespace of its own, which is what the entrypoint
asserts), `SANDBOX_DOCKER_IN_CONTAINER` defaults to **off**, and the shared
Docker build cache is off. The Docker host's paths and probes
(`SANDBOX_HOST_SESSION_ROOT`, `SANDBOX_DOCKER_DATA_*`, `SANDBOX_EGRESS_NETWORK`,
`SANDBOX_AGENT_CPU_SHARES`, `SANDBOX_AGENT_TMP_SIZE`) and the Kubernetes
settings warn at boot as having no effect. The connected-devices hub stays off.
Set `SANDBOX_MAX_SESSIONS` yourself: only a Docker host's memory is read to size
it, so unset it stays `8`, and boot says so.

### How Docker's limits and hardening map

| Docker / Kubernetes                       | Incus                                                                                                                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--cpus N`                                | `limits.cpu.allowance=<N*100>ms/100ms`, a hard CFS quota                                                                                                                                                                                                  |
| `--cpu-shares` (`SANDBOX_AGENT_CPU_SHARES`) | **not mapped**: see [CPU under contention](#cpu-under-contention). A session keeps the default scheduler weight (100) |
| `--memory`                                | `limits.memory` (a hard limit). Swap and the OOM priority are low-level keys a restricted project forbids, so they stay the node's; runnerd still raises every exec's OOM score above its own                                                              |
| `--pids-limit`                            | `limits.processes`                                                                                                                                                                                                                                        |
| ulimits `nofile`, `fsize`, `core`         | `limits.kernel.nofile`, `limits.kernel.fsize`, `limits.kernel.core`                                                                                                                                                                                       |
| `--security-opt no-new-privileges`        | the entrypoint runs under `setpriv --no-new-privs` (not with Docker inside, as on Docker)                                                                                                                                                                 |
| `--cap-drop=ALL` (plus four at boot)      | **not mapped.** Container root holds Incus's default capability set within its own user namespace; every process the entrypoint starts after its drop to the session user holds none, as on Docker. A restricted project forbids the low-level keys that would drop more |
| AppArmor `docker-default`, Docker's seccomp | Incus's own per-container AppArmor profile and default seccomp policy                                                                                                                                                                                   |
| user namespace (none on the runc tier)    | an isolated idmap per container: stronger than Docker's default                                                                                                                                                                                           |
| `--read-only`, `--tmpfs /tmp`             | **not mapped.** The root filesystem is a writable copy-on-write clone that goes at stop, capped by the profile's root disk `size`. The profile's root device accepts `readonly=true`, which Incus itself calls unlikely to work well; nothing here has tried it |
| `/dev/shm` size (`SANDBOX_AGENT_SHM_SIZE`) | the entrypoint mounts a tmpfs of that size on `/dev/shm` while it is still root (`TALE_SHM_SIZE`), because a restricted project admits no tmpfs disk device; the session therefore boots as root and drops to its user, as it does for transparent egress |
| IPv6 off                                  | `linux.sysctl.net.ipv6.conf.{all,default}.disable_ipv6=1`                                                                                                                                                                                                 |
| host-path workspace bind                  | a custom volume with a quota                                                                                                                                                                                                                              |
| per-organization package caches, BuildKit | none per organization: each session installs into its own workspace, from the public registries or, when the node's [registry caches](#package-registry-caches) are set, through them; Docker inside builds with its own inner builder                    |

### Capacity and admission

`SANDBOX_MAX_SESSIONS` is the project's ceiling. Admission counts the session
instances the project lists (a starting or stopping one still holds its slot;
an ended one does not), like a Kubernetes namespace, plus the creates under way
here. The warm pool's standbys and the sessions together **never exceed it**: a
cold start gives a standby's slot back first. The signed capacity endpoint
reports the project's running and starting sessions; CPU and memory stay
unavailable because a restricted certificate does not see the node's resources,
so admission has no memory or disk floor here: size `SANDBOX_MAX_SESSIONS` and
the per-session limits so that the sum of the limits fits the node.

### A full workspace

A workspace holds `SANDBOX_INCUS_WORKSPACE_SIZE` and no more: a write past it is
refused (`EDQUOT`). runnerd keeps its output spool on the workspace
(`/agent/.runtime/tmp`, see [sessions.md](sessions.md)), so a session at its
quota cannot journal an exec: the exec that fills it ends with a `REPLAY_` code
(`REPLAY_DISK_FULL`), and the next ones fail the same way until space is freed.
The platform frees it without an exec, through the files API (`POST
/v1/sessions/:id/files/delete`), and the session works again; the `lifecycle`
suite of the lab shows exactly that. Leave the quota room for the spool (up to
256 MiB of replay storage per session).

### CPU under contention

A session's CPU limit is a hard quota, `limits.cpu.allowance=<N*100>ms/100ms`,
and an instance with a quota keeps the default scheduler weight (100). Incus
takes `limits.cpu.allowance` either as a time quota or as a percentage, which
sets only the weight, never both, so there is no equivalent of
`SANDBOX_AGENT_CPU_SHARES`. On the Docker backend a session runs at a quarter
of the weight of the platform's containers, so that a saturated host keeps the
database and the backend responsive; here a session weighs what a default
Docker container weighs, or more.

On a node that also runs the platform's own services, keep them ahead of the
sessions by giving them the higher weight instead: for an Incus instance,
`incus config set <instance> limits.cpu.allowance=400%` (a weight of 400 and no
quota), for a Docker container a `--cpu-shares` value whose cgroup weight is
above 100. Better still, keep the sum of `SANDBOX_MAX_SESSIONS` times
`SANDBOX_AGENT_CPUS` within the node's cores plus the headroom you accept, so
that contention is the exception.

## Package registry caches

Sessions install from the public npm and PyPI registries through the egress
proxy, so a node with many sessions downloads the same packages over and over.
Two optional settings point them at caches the node runs (a Verdaccio and a
devpi on a network of their own) instead. **Both are off unless set**: with
neither, a session, its environment and the egress proxy are exactly what they
were before they existed.

```
# the spawner
SANDBOX_INCUS_NPM_REGISTRY=http://10.200.41.8:4873/
SANDBOX_INCUS_PYPI_INDEX=http://10.200.41.9:3141/root/pypi/+simple/
# the egress proxy (not the spawner)
SANDBOX_EGRESS_DENIED_HOSTS=registry.npmjs.org,registry.yarnpkg.com,pypi.org,files.pythonhosted.org
```

- **Each cache is an `http://` URL whose host is an IPv4 address**, like
  `SANDBOX_EGRESS_PROXY`: a session resolves no name before it reaches a cache,
  and a cache answers plain HTTP on the node's own network. Boot refuses a
  name, `https:`, credentials, a query, a fragment and a character that an
  `.npmrc`, an ini file, a TOML string and a shell word would not all read the
  same. The index's host and port are what pip is told to trust and uv to allow,
  so there is no third setting to keep in step.
- **The sandbox network's ACL admits tcp to each cache's address and port**, as
  it does to the gateway's: `incus network acl rule add sandbox-egress egress
  action=allow destination=10.200.41.8/32 protocol=tcp destination_port=4873`,
  and the same for the PyPI cache's port. Without a rule a session cannot reach
  the cache, and an install fails: there is no fallback to the public registry,
  which the proxy refuses.
- **The files.** With a cache set, the runtime entrypoint writes these into the
  session's home (`/agent/.runtime/home`) at every start, before runnerd, from
  `TALE_REGISTRY_CACHE_NPM` and `TALE_REGISTRY_CACHE_PYPI`, which the spawner
  puts in the instance's environment (an address is no secret):

  | Tool | File                    | Holds                                                         |
  | ---- | ----------------------- | ------------------------------------------------------------- |
  | npm  | `~/.npmrc`              | `registry=` the npm cache                                     |
  | bun  | `~/.bunfig.toml`        | `[install]` with `registry =` the npm cache                   |
  | pip  | `~/.config/pip/pip.conf`| `index-url` the PyPI cache, `trusted-host` its host and port  |
  | uv   | `~/.config/uv/uv.toml`  | `allow-insecure-host` its host and port, a default `[[index]]`|

  The first line of each file is a comment that says the sandbox wrote it. A
  file with that line is the sandbox's: rewritten when the cache moves, removed
  when its setting is gone, so a resumed workspace never keeps the address of a
  cache that was switched off. A file without it is the session's own (an
  `.npmrc` with a token for a private registry, say) and is never replaced or
  removed. A symbolic link in its place is neither followed nor written
  through. A file that cannot be written is a warning in the console and not the
  end of the boot. The files need the runtime image of the spawner's own
  release. An older image writes none: its sessions install from the public
  registries as before, unless the proxy's list is set, and then they cannot
  install at all. Roll the image and the spawner together, and set the proxy's
  list last.
- **`NO_PROXY`** gains the cache addresses (hosts, because not every tool
  understands a CIDR block), since the egress proxy refuses private
  destinations. A standby made before the settings changed no longer matches the
  pool and is replaced; a session already running keeps what it was given until
  it is stopped and resumed.
- **The egress proxy refuses the registries.** `SANDBOX_EGRESS_DENIED_HOSTS`
  lists the public hosts the caches replace (the line above, which boot prints
  for the caches that are set): the proxy answers a request or a tunnel to one,
  and to its subdomains, `403`, and its DNS forwarder answers them `NXDOMAIN`, so
  a package manager that ignores its configuration fails visibly instead of
  installing around the cache. Only registry hosts leave the path: browsing and
  every other host stay open. The proxy refuses to start on an entry that is not
  a plain host name, on a list that names no host (`,` or a space; an empty
  value means the list is off) and beside `SANDBOX_EGRESS_ALLOWLIST`.

**Locked installs.** An `npm ci` goes through the cache: npm sends the
`registry.npmjs.org` addresses a lock file records to the registry it is
configured with, and `bun install` does the same with a lock file that records
no registry. A pip requirements file locked by hash (`--require-hashes`)
installs from the index. A `uv.lock` records the address of every file and
registry it was made against, so `uv sync` goes around the configured index and
meets the proxy's refusal. Install a locked uv project through the index
instead, and leave the lock as it is:

```
uv export --frozen --no-emit-project --no-header -o requirements.txt
uv pip install --require-hashes -r requirements.txt
```

**What the caches are.** One set of caches serves every session of every
organization the node holds. They are read-only and hold public packages only,
so no session can write what another reads, and which public package another
organization installed is visible to whoever runs the caches. Every profile
gets them, the `default` profile that runs untrusted code included, and that is
safe only because a session cannot write to a cache: the Docker backend's
shared dependency volumes leave that profile out because a cache that code can
write would carry what it wrote into a more privileged session. Nothing private
goes through them: the files carry no credential, a private registry stays in
the session's own settings, and a session's own `.npmrc` or `pip.conf` is never
replaced. Docker inside a session builds with its inner builder, which has no
cache configured here, and other package managers (apt, go, gem, git) keep going
through the egress proxy.

## The warm pool

`SANDBOX_INCUS_POOL_SIZE` keeps that many **started standby instances** of the
shape an agent session has. A standby runs the runtime image with a standby
script (`/usr/local/lib/tale/standby.sh`, pushed into the instance before its
first start, under `no_new_privs` like a session) that signals it is waiting.
Handing one out is a claim: the instance is relabelled as the session and the
workspace volume is hot-plugged, both in one write guarded by the ETag the
standby was read with, and the claim file (the session's runnerd token and
incarnation, never in the instance config) is pushed, whereupon the script
drops privileges and `exec`s the entrypoint. What is left of the handout is
runnerd's own start.

When a claim cannot be made the session starts cold, and what the claim did not
make is never removed by it:

- A standby that is gone, not running, retired or changed by someone else
  since it was read (the write is refused, `412`) is passed over; the next one
  is tried, up to three.
- A claim the node itself refuses (the workspace volume is missing, say)
  leaves the standby a standby.
- Only an instance the claim had already turned into this session's, whose
  claim file then could not be delivered, is removed, and only while it still
  carries the claim's own attempt label.

**Removal and claims never race to a live session.** The pool removes a
standby (a stale one, a surplus one, one a cold start needs the slot of) by
first marking it retired (`user.tale.pool-retired`) under the ETag it read, and
only then stopping and deleting it. A claim and a mark each write under the ETag
of what they read, and Incus lets only the first through: the claim that loses
passes the standby over, and the removal that loses finds a session and leaves
it alone. A removal interrupted after its mark is finished by the next pass.

The pool refills in the background (every 30 seconds and after each claim),
makes up to four standbys at a time, replaces a standby that no longer matches
what a session would be made of today (a moved proxy, a new limit, a moved
image alias, another standby script) or that has stood six hours, and takes
over the standbys a previous spawner left. Only agent sessions with the Docker
capability the deployment defaults to are served from it.

**A draining spawner stops its pool** (`POST /v1/drain`, and shutdown): its
replacement keeps the pool, and two spawners each filling it to the target
would pass `SANDBOX_MAX_SESSIONS` between them. The standbys stay for the
replacement to take over; creates the draining spawner had already admitted
still claim from them.

## Operations

- **Boot** reads the certificates, refuses what cannot work (above), logs one
  line with what it found, and starts the pool. `/health` is an authenticated
  `GET /1.0` and fails when the node is unreachable or does not trust the
  certificate.
- **Spawner restart and rollout.** Sessions keep running (they are not
  children of the spawner) and are re-adopted from their labels; standbys that
  still match are taken over. A stopped instance counts as compute that ended
  once the create that made it has finished (it writes `user.tale.ready` when
  runnerd answers) or has long given up (its startup deadline and slack have
  passed), and not before: Incus shows an instance in the middle of its start
  as stopped, so a spawner that boots, or sweeps, while its peer is creating a
  session must not take it for ended (the lab boots a peer a hundred times
  beside a spawner creating). A rollout drains the old spawner (`POST
  /v1/drain`): it refuses new sessions, serves its own, and stops keeping the
  warm pool, which the new spawner keeps from its boot.
- **Node reboot.** Sessions do not autostart: each session instance is found
  stopped, which the route layer treats as ended compute and removes after
  adoption (the sweep takes what it misses). Workspaces survive, and the
  platform resumes sessions on them.
- **Graceful stop.** A busy session's stop asks the instance to shut down for
  the grace period before the forced stop, but the instance's init decides how
  long that is: `lxc-init` passes `SIGTERM` to every process at once (runnerd
  and the execs together, not runnerd first) and kills whatever is left a second
  after the last process exited, whatever grace was asked. An exec that must
  save something on `SIGTERM` has about that second.
- **A create that fails** is logged as `create of <id> failed while <phase>`
  (making the workspace volume, claiming a standby, creating the instance,
  waiting for the address and for runnerd), and the answer to the platform says
  why: an instance that stopped, or never answered, has the end of its console
  quoted. The failed create removes what it made and keeps a durable workspace.
- **Cleanup.** The periodic sweep (every five minutes) removes the debris
  listed above. A workspace whose session the platform destroys is deleted
  synchronously with the instance: `workspaceDeletion` answers `done` once its
  volume is gone.
- **Not supported:** connected devices (the hub), the shared Docker build cache,
  per-organization package caches (the node's
  [registry caches](#package-registry-caches) are shared by every
  organization), and an out-of-memory report on a dead session (the backend does
  not read one from Incus).

## Verify a node before trusting it

Unit tests stand in for none of these: they run against an in-memory imitation
of the API, which is only as right as the Incus source and documentation it was
written from. Each item names what to do and what it must show, and ends with
what the CI lab ([e2e/incus](../e2e/incus/README.md)) already shows on a real
Incus 7.5.1 (Zabbly's stable build, on a hosted Ubuntu 24.04 runner with a ZFS
pool on a file): **Lab** names the suite that proves it, **Not in the lab**
what is left to your first real node. Run the check yourself where the lab does
not, and wherever your node differs from the lab's: a different kernel or
storage driver, a reboot, many tenants.

1. **Mutual TLS and pinning.** With the real certificates, boot the spawner:
   the boot line names the Incus version, `/health` is ok. Replace the pinned
   server certificate with another: boot refuses (and never connects). Present
   Incus's default `CA:FALSE` server certificate: boot refuses it with the
   explanation, before any request.
   **Lab (`boot`):** the pinned certificate is the only anchor; another
   pinnable one, Incus's own `CA:FALSE` one, a client the node does not trust and
   a key that is not the certificate's are each refused in words.
2. **Restricted certificate.** `incus config trust show` lists it `restricted`
   to the one project. With the certificate, `incus project list` shows only
   that project; creating a project, editing the pool and touching another
   project fail. `GET /1.0` answers `auth: trusted` with the extensions and
   `kernel_features` the boot checks read; if the restricted view leaves
   `kernel_features` out, the idmapped-mounts warning is silent by design.
   **Lab (`boot`):** the restricted certificate is `trusted`, lists only its
   project, and cannot create a project, change a pool or the network, or read
   another project; on Incus 7.5.1 its `GET /1.0` reports no `kernel_features`
   at all (`{}`), so the idmapped-mounts warning is silent there.
3. **Cold create.** Create a session, then read it with `incus info` and
   `incus config show`: not ephemeral, the `user.tale.*` labels, the `oci.*` and
   `limits.*` keys of [the mapping](#how-dockers-limits-and-hardening-map), the
   workspace volume mounted at `/agent` and writable by uid 10001, a `/dev/shm`
   of `SANDBOX_AGENT_SHM_SIZE` (`df -m /dev/shm`), one NIC (the profile's) with
   its ACL. Time it: the DHCP wait is the long part.
   **Lab (`lifecycle`):** every property listed is asserted. A cold create
   takes 3.2 to 4.0 s (the DHCP wait included), a resume 3.1 to 3.7 s, a stop and
   a destroy under a second, an exec round trip 4 to 7 ms, and five creates at
   once each finish in 3.6 to 9.2 s.
4. **OCI entrypoint and its wrapper.** `oci.entrypoint`
   (`/usr/bin/setpriv --no-new-privs -- /docker-entrypoint.sh daemon`) is split
   into arguments the way the entrypoint expects; runnerd answers `/healthz`
   naming the incarnation; the console log shows the entrypoint's output.
   **Lab (`lifecycle`, `failures`):** the instance's `oci.*` keys are asserted,
   runnerd answers and names its incarnation, and the console of an ended
   session shows the entrypoint's output.
5. **Privileges.** In the running session, runnerd's `/proc/<pid>/status` shows
   `NoNewPrivs: 1`, `Uid` 10001 and an empty `CapEff`; `su` and `newuidmap` do
   not lift the session user; an exec that tries to remove the egress firewall
   rules fails. Nothing in the image, a browser and the coding agents' tools
   included, may fail to start: util-linux warns that a Linux security module
   such as AppArmor can make some programs fail to execute under
   `no_new_privs`, so a failure to exec that shows up only here is its first
   suspect. Report it rather than working around it: the backend has no switch
   for the bit, as Docker's `no-new-privileges` has none. With Docker inside,
   `NoNewPrivs` is 0 and `docker run hello-world` works.
   **Lab (`lifecycle`, `network`, `docker`):** runnerd and the session user
   have `NoNewPrivs: 1`, uid 10001, no capabilities and a user namespace of
   their own on a high host uid range; the session user cannot flush the
   redirect's rules; with Docker inside the engine's processes show
   `NoNewPrivs: 0` and `docker run hello-world` works. **Not in the lab:**
   starting a browser and the coding agents' tools under `no_new_privs` on your
   node's security modules.
6. **Network.** From a session: the proxy works (an HTTPS fetch through
   `HTTPS_PROXY`, and, where the proxy is the session's resolver, a plain one
   through transparent egress), the LLM gateway and backend answer by name, DNS
   resolves only through the one resolver the session is given
   (`/etc/resolv.conf` lists only it), and everything else (another session,
   the node, the Incus API on 8443, the metadata address) is unreachable. From
   the spawner: runnerd on tcp 8200.
   **Lab (`network`):** all of it, with stand-ins for the gateway and the
   backend on the ACL's two ports, reached by address and, once the bridge's
   resolver is given `address=` lines and the spawner points sessions at it
   (above), by name, with nothing else resolved. **Not in the lab:** the
   gateway and backend by name through *your* resolver.
7. **Workspace across stop and resume.** Write a file, stop the session
   (`stopSession`), confirm the instance is gone and the volume is not, resume,
   read the file. Check that a **new idmap** mounts the `security.shifted`
   volume writable (the hot-plug of a shifted volume under an isolated idmap,
   which needs idmapped mounts) and that the quota stops a write past
   `SANDBOX_INCUS_WORKSPACE_SIZE`.
   **Lab (`lifecycle`, `pool`):** a file written before a stop is read after
   the resume under a new idmap, the quota stops a write past
   `SANDBOX_INCUS_WORKSPACE_SIZE`, and a claimed standby has its workspace
   hot-plugged the same way.
8. **Graceful stop.** Start a long exec, stop with a grace period: the exec
   hears `SIGTERM` and ends before the force (within the second `lxc-init`
   allows, see Operations); with Docker inside, the inner engine shuts down.
   **Lab (`failures`):** a draining spawner's linger reap stops a busy session,
   and the exec's `TERM` trap runs and writes its marker before the instance is
   forced down. **Not in the lab:** the inner engine's own shutdown.
9. **Removal and diagnosis.** After `stopSession` the instance is gone; after
   the session's process ends by itself (kill runnerd) the instance stays
   stopped, its console log readable, until the route layer, the next create of
   the id or the sweep removes it; a create whose entrypoint cannot start fails
   with the end of the console in its message, and its instance is removed; a
   node reboot leaves only stopped instances, all removed after adoption.
   **Lab (`lifecycle`, `failures`, `adoption`):** all of it but the reboot: a
   stop leaves no instance and keeps the volume, a killed runnerd leaves a
   stopped instance whose console reads and which the next create replaces, an
   image that cannot start a session fails the create and keeps the workspace,
   and compute that ended while the spawner was away is removed after adoption
   with the workspace kept. **Not in the lab:** an actual node reboot.
10. **Warm pool.** With `SANDBOX_INCUS_POOL_SIZE=2`: the standby script is
    pushed into the _stopped_ OCI instance (root-owned, mode 0755, which only a
    real node proves), two standbys appear and wait (the ready marker exists);
    a create takes one in well under the cold time; the pool refills; killing a
    standby's script mid-claim falls back to a cold start; the script refuses to
    start a session whose workspace is not mounted. Through a rollout (`POST
    /v1/drain` on the old spawner while the new one boots) the old one makes no
    standby, the new one takes the existing ones over without recreating them,
    and a create admitted before the drain still claims.
    **Lab (`pool`):** the standby script is root-owned and mode 0755 in the
    OCI instance, two standbys fill in under 4 s and wait, a create takes one in
    under a second (against 3.2 to 4.0 s cold), the pool refills in under 5 s, a
    standby that vanished is replaced and a create still succeeds, the capacity
    bound holds with sessions and standbys together, and through a rollout the
    drained spawner makes no standby and its replacement takes the existing ones
    over. **Not in the lab:** a standby's script killed mid-claim, and the
    script refusing a session whose workspace is not mounted (the unit tests
    own both), and a create admitted before the drain still claiming.
11. **Restricted-project refusals.** The project keeps `restricted.devices.disk`
    at `managed`: a host-path disk device, a privileged container, `raw.lxc`,
    swap and a NIC of the instance's own are all refused; the spawner never
    sends any of them.
    **Lab (`boot`):** a privileged container, `raw.lxc`, swap, a host-path disk
    device and a NIC of the instance's own are each refused by the restricted
    project.
12. **Project limits.** With `limits.memory` on the project at two sessions'
    worth, the third create fails with Incus's `Reached maximum aggregate value`
    message and leaves only its workspace volume, and the image warm-up still
    passes; with `limits.cpu` on the project and none on the profile, boot
    refuses it by name, and with one on both (a count on the profile) boot
    passes, every session holds that count, and the create past the project's
    total fails the same way.
    **Lab (`limits`, `boot`):** all of it: the third create fails with Incus's
    own message and leaves only its workspace volume, the failed session's
    explicit destroy removes it, a project `limits.cpu` alone is refused at boot
    by name, and a project `limits.cpu` of four with a profile `limits.cpu` of
    two admits two sessions (each with that count and its
    `limits.cpu.allowance`) and refuses the third in Incus's words.
13. **Image.** `warmImage` pulls the OCI image through the API into the
    restricted project (the pull is the one call the unit tests cannot vouch
    for), and the unpack warm-up makes the first session start as fast as the
    second. Then upgrade: restart the spawner with the next version under a new
    alias; it pulls it, sessions that run stay on the old version and are
    adopted, the pool rotates to the new one, and new sessions run it.
    **Lab (every run, and `upgrade`):** the first boot pulls the runtime image
    from the lab's registry into the restricted project through the API and
    unpacks it (two to three minutes), and every later create is fast. The
    `upgrade` suite does the restart above with a next version that is the
    current image and one file more.
14. **Docker inside** (only if you enable it). `docker run hello-world`,
    `docker build` and `docker compose up` work in a session, and its nested
    containers still cannot reach what the session cannot; if they cannot,
    keep it off.
    **Lab (`docker`):** the project allows nesting and interception for it, the
    inner engine answers, `docker run hello-world` and `docker build` work, and
    a nested container is no freer than the session (no SSH banner from the
    internet, the node's API blocked, the proxy reachable). **Not in the lab:**
    `docker compose up`.
15. **Fencing under load.** Two creates of one session id at once: one wins and
    the other is answered a duplicate; a stop with a stale stamp is refused.
    Then load: rounds of eight creates at once with the warm pool on, each
    session answered and destroyed, none failed or hung.
    **Lab (`lifecycle`, `fencing`, `adoption`, `soak`):** two creates of one id
    at once, a stale ETag (412), a different incarnation, a peer that replaced a
    session under its name never being undone by the old holder, and eight
    creates at once, over and over: 640 creates in two long runs, none failed,
    each in 6 s at the median and 10 s at the 90th percentile (17.7 s at most)
    on a 4-vCPU runner.
16. **Capacity UI.** Settings > Sandboxes names the Incus project scope and
    leaves CPU and memory unavailable. **Not in the lab** (the platform's UI).
17. **Registry caches** (only if you set them). In a new session, `~/.npmrc`,
    `~/.bunfig.toml`, `~/.config/pip/pip.conf` and `~/.config/uv/uv.toml` hold
    the cache addresses and `NO_PROXY` names them. A locked `npm ci`, a
    `pip install --require-hashes` and a `uv pip install --require-hashes` install
    from the caches, whose logs show the requests. From the session, a tunnel
    through the proxy to each registry host in `SANDBOX_EGRESS_DENIED_HOSTS` is
    refused with `403` and the name does not resolve, while another host still
    answers. A file the session wrote itself under one of those names survives a
    stop and a resume.
    **Lab (`network`):** has a case for it, with stand-in caches, an ACL rule for
    each port and the four hosts in the proxy's list. **Not in the lab:** the real
    Verdaccio and devpi, and your own ACL.

The bounded API client, the TLS pinning shapes, every lifecycle method, the
pool's refill and capacity bound, the config validation and the boot checks are
covered by `src/backend/incus/*.test.ts`, `src/config-incus.test.ts` and the
Incus cases of `src/capacity.test.ts` and `src/session/session-routes.test.ts`.
