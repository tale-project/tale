---
title: Run Tale on Incus
description: Run a Tale workspace or managed deployment as Incus instances instead of Docker Compose containers, from the node contract and its check to moving an existing deployment and the limits you plan around.
---

A workspace that you deploy with `tale deploy`, or a managed deployment, can run on [Incus](https://linuxcontainers.org/incus/) instead of Docker Compose: every service of the stack becomes an Incus instance in one restricted project of a Linux host, and the sandbox sessions run beside it in a project of their own. The Tale CLI compiles the same Compose definitions the Docker runtime runs into those instances, so the services, images and settings are the same. This page takes you from an Incus host to a running deployment, moves an existing Docker deployment over, and names the limits to plan around.

<Warning>

The Incus runtime is **experimental** in Tale 0.5.x. Docker Compose stays the default and the supported runtime. A workspace runs on Incus with `tale deploy`, its blue-green upgrades, backups and restores. A [managed deployment](/self-hosted/install/cli-install#managed-deployments) gets its first deployment on Incus, but upgrading it there is still refused, because its recovery snapshot is not taken on Incus yet.

</Warning>

## Choose the Incus runtime {#choose-incus}

Choose Incus when a host already runs Incus for other workloads, or when you want the stack and its sessions in restricted Incus projects without a Docker daemon. The CLI talks to Incus over its REST API with a client certificate restricted to the stack's project, and never needs the host's administrator rights except for the one-time bootstrap. Keep Docker Compose when you develop locally with `tale dev`, which runs on Docker only, when you need connected sandbox devices, or when the host cannot meet the prerequisites below.

## Check the prerequisites {#prerequisites}

| Requirement | Why it matters |
| --- | --- |
| A Linux host with Incus 7.2 or later, not a cluster member | The CLI needs the API extensions `instance_oci`, `instance_oci_entrypoint`, `oci_network_config`, `storage_shifted`, `storage_initial_owner`, `file_storage_volume`, `projects_restricted_backups_and_snapshots`, `projects_restricted_image_servers` and `instance_auto_restart`, and refuses a server that lacks one or is clustered. |
| Linux 5.12 or later with idmapped mounts | Every volume of the stack is mounted shifted (`security.shifted`), which needs idmapped mounts. |
| A storage pool on `zfs`, `btrfs` or `lvm` | These drivers enforce a volume's size. A ZFS pool needs OpenZFS 2.2 or later, whose datasets support idmapped mounts. Bootstrap uses the pool you made when you installed Incus and makes none. |
| An `x86_64` host | Managed bundles need native images for their declared platform, and the bundled object store ships only a `linux/amd64` image. |
| The Incus API on an address the stack's bridge reaches | The CLI and the sandbox spawner dial it (`runtime.incus.endpoint`, by default the bridge gateway on port 8443), for example after `incus config set core.https_address <gateway>:8443`. Its server certificate must be pinnable: its own trust anchor (`CA:TRUE`) that names the endpoint's address. |
| Pull access from the host to the image registries | Incus pulls each image by digest from `ghcr.io` and Docker Hub, or from the mirrors the declaration names. |
| Root or membership of `incus-admin`, once | Only `tale incus bootstrap` uses the local administrator socket. Every later command uses the restricted certificate. |
| The CLI on Linux or macOS | The CLI keeps the Incus credentials, the plan key and the journal as files closed to other accounts, which Windows cannot hold, so it refuses `tale incus check`, `tale incus bootstrap`, deployments and the other stack commands on Incus on Windows. `tale incus contract` runs anywhere. |

No Docker is needed on the host, on the workspace's machine or on the machine that prepares a bundle. When Docker does run on the same host, see [Share a host with Docker](#docker-coexistence).

## Declare the runtime {#declare}

A workspace's `tale.json`, or a managed deployment specification, names the runtime in `runtime.engine` and describes the node in `runtime.incus`. The fields are listed in [Declare the container runtime](/self-hosted/install/cli-install#container-runtime). A workspace runs two colours side by side during an upgrade, so its address `block` is a /24. A managed deployment replaces each service in place and has no blue and green colours, so its `block` is a /25 inside the bridge subnet.

For a new workspace, `tale init` writes the block from its flags:

```bash
tale init my-project --runtime incus \
  --incus-project tale-acme --incus-pool tank \
  --incus-network tale-acme --incus-subnet 10.30.0.0/24 \
  --incus-sessions-subnet 10.31.0.0/24
```

The gateway defaults to the subnet's first host, the block to the subnet when it is a /24, and the ingress to `proxy-device`. Set `runtime.engine` to `incus` by hand only in a workspace that has not been deployed yet. A workspace that already runs on Docker declares the Incus runtime in `runtime.next` and [moves](#migrate), so that its data comes along. A managed deployment declares it in its specification, with what [Declare the Incus runtime](/self-hosted/install/cli-install#managed-incus-runtime) adds:

```json
{
  "schemaVersion": 1,
  "name": "example-incus",
  "stateDirectory": "/opt/tale-example",
  "composeProject": "tale-example",
  "runtime": {
    "revision": { "env": "TALE_RUNTIME_REF" },
    "platform": "linux/amd64",
    "engine": "incus",
    "incus": {
      "endpoint": "https://10.30.0.1:8443",
      "project": "tale-example",
      "pool": "tank",
      "network": {
        "name": "tale-example",
        "subnet": "10.30.0.0/22",
        "gateway": "10.30.0.1",
        "block": "10.30.1.0/25"
      },
      "sessions": { "subnet": "10.31.0.0/24" },
      "ingress": { "mode": "proxy-device" },
      "volumes": { "db-data": { "size": "100GiB" } }
    }
  },
  "sandbox": { "backend": "incus" },
  "environment": {
    "SANDBOX_INCUS_PROJECT": { "env": "TALE_SANDBOX_INCUS_PROJECT" },
    "SANDBOX_INCUS_PROFILE": { "env": "TALE_SANDBOX_INCUS_PROFILE" },
    "SANDBOX_INCUS_NETWORK": { "env": "TALE_SANDBOX_INCUS_NETWORK" },
    "SANDBOX_INCUS_STORAGE_POOL": { "env": "TALE_SANDBOX_INCUS_STORAGE_POOL" }
  }
}
```

The example leaves out `origin`, `tlsMode`, `identity` and `configs`, which are the same as on Docker. `sandbox` is required as `{ "backend": "incus" }`: the sandbox spawner is one of the stack's instances. The four `SANDBOX_INCUS_*` values name the sessions' project, profile, bridge and pool. Bootstrap gives them `<project>-sessions`, `sandbox`, the first 13 characters of the bridge name followed by `-s`, and the stack's pool. The spawner refuses to start without them, and nothing refuses their absence before the deploy reaches it, so declare all four. [The sandbox under each runtime](/self-hosted/install/cli-install#managed-incus-sandbox) lists what the CLI sets itself.

## Make the node ready {#node-contract}

The node contract is what the Incus server must hold before the stack can run: the project and its restrictions and limits, the stack's profile, the bridge, the network ACLs, the pool and volume sizes, the registry hosts, the certificate to trust and the stop priorities. Three commands work from it. In a workspace they read `tale.json` (`--workspace <dir>` names another one than the current directory). For a managed deployment, pass `--spec <file> --compose <file>`, where `--compose` is the bundle's `runtime/compose.yml`, so prepare the bundle first. The examples below are the managed form.

<Steps>

<Step title="Print the contract">

`tale incus contract` prints it as versioned JSON (`schemaVersion` 1, `kind` `tale.incus.node-contract`). It reads no node and needs no credentials, so your own tooling can make the objects from it. A newer CLI only adds fields to version 1.

```bash
tale incus contract --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

<Step title="Bootstrap a single host">

On a host that only you administer, `tale incus bootstrap` makes the contract over the local socket (`/var/lib/incus/unix.socket`; `--socket` names another). It prints its plan and asks before it changes anything (`--yes` skips the question). It makes the stack's project, its `tale-stack` profile, the bridge and its ACL, the sessions' project, bridge, ACL and `sandbox` profile, and two client certificates restricted to their projects: the CLI's in `<stateDirectory>/incus/` and the spawner's in `<stateDirectory>/sandbox-incus/`, each beside the pinned `server.crt`. In a workspace the two directories are `.tale/incus/` and `.tale/sandbox-incus/`, and bootstrap run as root gives them to the workspace's owner. A second run changes nothing, and `--remove` takes away what bootstrap made and nothing else. When the server's own certificate cannot be pinned, bootstrap refuses; `--replace-server-certificate` writes a pinnable one, keeps the old one as `server.crt.tale-bootstrap`, and asks you to restart Incus before you run bootstrap again.

```bash
sudo tale incus bootstrap --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

<Step title="Check the node">

`tale incus check` reads the node back with the stack's restricted certificate and refuses what differs from the contract, one sentence per finding. The bridge's settings, its ACLs and the host firewall are not visible to that certificate, so check judges them by their effect: a helper instance on the stack's bridge opens the connections the probed rules allow, and a connection that times out is refused with its remedy. The helper runs the project's `tale-proxy` image, or, before the project holds one, the image `--probe-image` names (by default this CLI's release); `--probe-public` and `--probe-name` choose the public address and name it tries. With `--no-probes`, check runs no helper and refuses. It exits `3` while a refusal stands.

```bash
tale incus check --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

</Steps>

On a host that other teams administer, make the objects from the contract with your own tooling, place the two certificate directories yourself, and run `tale incus check` as the last step. The directories hold `client.crt`, `client.key` and `server.crt`, closed to group and others (0700 for the directory, 0600 for each file).

### The restricted model {#restricted-model}

The stack's project is restricted: it admits no privileged, nested or low-level container keys (`raw.lxc` would be host root), no host disks and only the bridge and pool the contract names, no virtual machines, and pulls only from the registry hosts the contract lists, each written exactly as the remote URL carries it. The project's `limits.instances`, `limits.memory` and `limits.processes` are computed for the stack's peak. The CLI's certificate reaches that project alone and cannot make another one; the spawner's certificate reaches the sessions' project alone. A session never holds a certificate.

### The network ACLs {#network-acls}

Both bridges drop what no rule allows, in both directions, so a missing rule times out instead of looking like a closed port. Incus does not translate addresses between its own bridges, so the rules name the sessions' real subnet.

| Rule | What it allows | How check judges it |
| --- | --- | --- |
| `stack-to-stack`, `stack-from-stack` | Traffic between the stack's own instances on its bridge | Listed: it passes an Incus bridge ACL without a rule, so check expects no drop there |
| `names-to-gateway-udp`, `names-to-gateway-tcp` | The stack's resolver forwards every name it does not hold to the bridge's own DNS on port 53 | It passes without a rule too: check asks it a public name and judges the answer |
| `spawner-to-incus` | The spawner reaches the Incus API at `runtime.incus.endpoint` | Probed |
| `spawner-to-sessions` | The spawner calls each session's runner on port 8200 | Probed |
| `public-egress` | The backend, the platform, the sessions' egress proxy, the model gateway, the proxy (for ACME) and the bgutil provider reach the internet | Probed |
| `operator-reach-1`, … | Each destination the declaration names in `runtime.incus.operatorReach`, such as an inference router | Probed for TCP, listed for UDP |
| `public-to-proxy` | The public reaches the proxy, through the ingress you chose | Listed |
| `sessions-to-*`, `stack-from-sessions-*`, `sessions-from-spawner` | A session reaches the backend API through the switch, the model gateway, the egress proxy and its resolver, and nothing else; the spawner reaches the sessions | Listed: the stack's side cannot send traffic from the sessions |

## Choose the ingress {#ingress}

`runtime.incus.ingress.mode`, which the specification must name, decides how the public reaches the stack's `proxy` instance.

| Mode | What happens | When to use it |
| --- | --- | --- |
| `proxy-device` | Incus publishes ports 80 and 443 on the host through NAT proxy devices, which keep the client's address, on `listen` or on every address. | The host faces the public, or a load balancer forwards to it. |
| `routed` | Nothing is published. Your own forward or reverse proxy reaches the `proxy` instance at its address on the bridge. | Another edge already terminates traffic for the host, usually with `tlsMode: "external"`. |

TLS works as on Docker: the proxy obtains certificates in `selfsigned` and `letsencrypt` mode, and `external` leaves TLS to the edge in front of it. The [TLS and domains](/self-hosted/configuration/tls-and-domains) settings apply unchanged.

## Size the node {#sizing}

Every instance carries `limits.memory` and `limits.processes`: its compose value, otherwise the CLI's value for the service, otherwise the `tale-stack` profile's default of `2GiB` and 2048 processes.

| Service | Memory | Processes |
| --- | --- | --- |
| `backend-api`, `backend-worker` (each replica) | 12 GiB | 4096 |
| `db`, `knowledge-db` | 8 GiB | 4096 |
| `platform` (each replica) | 4 GiB | profile default |
| `proxy`, `switch` | 1 GiB | profile default |
| `bgutil-provider` | 512 MiB | 512 |
| `names`, `names-sessions` | 256 MiB | 256 |
| Every other service | profile default | profile default |

These are ceilings, not reservations. The contract adds them up for the stack's peak, plus two helpers (a one-shot job and check's probe): for a workspace, the stateful services once and the application colour twice, because both colours run during an upgrade; for a managed deployment, every instance once, because it replaces in place. After you raise a replica count, run `tale incus bootstrap` again: `tale deploy` refuses a project whose limits no longer fit before it changes anything. Each instance's root disk is `runtime.incus.rootSize` (`10GiB` by default). Declare a `size` for each data volume in `runtime.incus.volumes`: only when every volume has one does the contract also limit the project's use of the pool (`limits.disk.pool.<pool>`). Sessions are sized separately, by `SANDBOX_MAX_SESSIONS` and the session limits in the [environment reference](/self-hosted/configuration/environment-reference#sandbox-infrastructure); leave room on the host for both.

## Deploy {#deploy}

A workspace deploys with `tale deploy`, as on Docker; a managed deployment applies a prepared bundle.

### Deploy a workspace {#deploy-workspace}

In a workspace, `tale deploy` works as on Docker, after the checks Incus adds. It reads the certificates from `.tale/incus/` and checks the node against the stack's contract, as `tale incus check` does without its probes. It then converges the stack scope by scope: the volumes, the resolvers and the traffic switch, the stateful services, then the idle colour, whose replicas take traffic once the switch admits them. Review the plan of every scope first:

```bash
tale --json deploy --plan-only > plan.json
tale deploy --plan plan.json
tale status
```

`--plan` applies the reviewed plan only while the node still needs exactly it. The first deploy creates everything. Later deploys flip colours as [Upgrades](/self-hosted/operate/upgrades#incus) describes, and `tale status` shows each replica, whether the switch admits it, and an interrupted flip. Instances are named after their services, with the colour and a replica number for the application roles (`platform-blue-1`).

### Deploy a managed bundle {#deploy-managed}

Prepare, verify and apply the bundle as in [Prepare, verify, and apply the bundle](/self-hosted/install/cli-install#prepare-verify-and-apply-the-bundle). On Incus, `deploy prepare` reads every image from its registry and needs no Docker daemon. `deploy --bundle` checks the node against the contract, compiles the stack again from the deployment's own `.env` and refuses one that differs from the prepared stack, then plans, applies and reads every instance back. Review the plan before the first apply:

```bash
tale --json deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" --plan-only > plan.json

tale --json --yes deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" --plan plan.json
```

`--plan` applies the reviewed plan only while the node still needs exactly it, and `--stop` accepts the downtime a plan names. Instances are named after their services (`db`, `proxy`, `switch`), with a replica number for the application roles (`platform-1`, `backend-api-1`, `backend-worker-1`).

A role that runs one replica has a gap each time it is replaced: from the old instance's stop until the new one is admitted, the switch has no replica to send to, and the edge serves its maintenance page, as Docker Compose's recreate does. The plan names that window for each role it replaces with one replica.

## Read logs and crashes {#logs}

Incus keeps each instance's console output and hands each line out once: a read takes the lines it shows, so a later read of the running instance no longer has them. In a workspace, `tale logs <service>` reads a stopped service; for a running one it needs `--consume` and says first that the read takes the lines. For a managed deployment, read a service with the Incus client as an administrator, for example `incus console db --show-log --project tale-example`, and only when you need it. What the console still holds after many reads, or after a long run, is not measured: do not rely on it for a whole run, and ship logs elsewhere if you need them kept.

Incus restarts an instance that exits unexpectedly up to 10 times within a minute, then leaves it stopped, where Docker keeps retrying. `tale status` reports such a service as `stopped after repeated crashes`, with the last console lines Incus kept, and `incus list --project <project>` shows it as stopped. Once you have fixed the cause, start it again with `tale start` in a workspace, or with `incus start <instance> --project <project>`.

## Plan for host shutdown {#host-shutdown}

When the host shuts down, Incus stops one `boot.stop.priority` group at a time, and gives each group up to 30 seconds. Tale uses three groups:

| Priority | Services | Stopped |
| --- | --- | --- |
| 90 | `proxy`, `switch`, `platform`, `backend-api`, `backend-worker` | First |
| 50 | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway`, `bgutil-provider` | Second |
| 10 | `db`, `knowledge-db`, `object-store`, `names`, `names-sessions` | Last |

On a host that runs only Tale, the databases get their stop signal within about 60 seconds. Priorities 10 to 90 are Tale's reserved band: every other instance on the host that stops inside it adds up to 30 seconds per group, and the databases can be killed before their signal. Bootstrap warns when another project uses a priority in that band. The 30-second limit also cuts a worker's drain (`SHUTDOWN_DRAIN_MS`, 90 seconds by default) short.

On a shared host, or whenever the workers' drain must complete, stop the stack yourself before the host shuts down. In a workspace, `tale stop` does it group by group as in the table, each service within its own grace period, and `tale start` starts the groups the other way round once the host is back, each healthy before the next. For a managed deployment, stop it with the Incus client, group by group and with a timeout above the services' grace, for example `incus stop proxy switch platform-1 backend-api-1 backend-worker-1 --project tale-example --timeout 150`, then the middle group, then the data group. Incus restores each instance's last state when the host starts, so instances you stopped stay stopped until you start them: `tale start`, or by hand priority 10 first, then 50, then 90.

## Share a host with Docker {#docker-coexistence}

When Docker runs on the same host, it sets the host's `FORWARD` policy to drop, which also drops the traffic of the Incus bridges. `tale incus check` cannot read the host's firewall with its restricted certificate, so it shows the loss as probes that time out, and names two remedies:

- **`DOCKER-USER` rules** that accept the two bridges take effect at once. Bootstrap reads the policy and proposes them. It always asks before it adds them, and without a terminal it prints them for you to run. They last until the host reboots unless your firewall setup keeps them.
- **`"ip-forward-no-drop": true`** in `/etc/docker/daemon.json` stops Docker from setting the drop policy, but only after a host reboot: restarting Docker keeps the policy as it is.

Add the `DOCKER-USER` rules first, and keep them in your firewall setup or set `ip-forward-no-drop` for the next reboot.

With the `proxy-device` ingress, Docker must not publish ports 80 and 443 as well. Incus accepts the proxy devices even while a Docker container publishes the same ports, and they take the external traffic at once, so no failure warns you. `tale incus check` cannot see Docker either; [`tale runtime migrate`](#migrate) checks Docker's published ports before it adds the proxy devices.

## Move a workspace between Docker and Incus {#migrate}

`tale runtime migrate` moves a workspace's running Docker deployment to Incus, at the same version and with the same `.env`, and keeps the Docker stack stopped so you can go back. The users see downtime from the moment the Docker stack stops until the stack on Incus is deployed; most of it is spent archiving and restoring the data, the object store above all. Plan a maintenance window for it, and keep an off-host backup as [Backups and restore](/self-hosted/operate/backups-and-restore) describes.

<Steps>

<Step title="Declare the target">

Keep `runtime.engine` as it is and add the Incus runtime as `runtime.next`, with the same fields as an Incus workspace (a /24 `block`). Run the migration with the CLI of the version the workspace runs: it moves one version as it is and refuses a CLI that would deploy another.

```json
{
  "runtime": {
    "next": {
      "engine": "incus",
      "incus": {
        "project": "tale-acme",
        "pool": "tank",
        "network": { "name": "tale-acme", "subnet": "10.30.0.0/24", "gateway": "10.30.0.1", "block": "10.30.0.0/24" },
        "sessions": { "subnet": "10.31.0.0/24" },
        "ingress": { "mode": "proxy-device" }
      }
    }
  }
}
```

</Step>

<Step title="Make the node ready">

`tale incus bootstrap`, `check` and `contract` read `runtime.next` while the workspace still runs on Docker. On the same host, add the `DOCKER-USER` rules bootstrap proposes, as [Share a host with Docker](#docker-coexistence) describes, and run the check until it passes:

```bash
sudo tale incus bootstrap
tale incus check
```

</Step>

<Step title="Migrate">

```bash
tale runtime migrate --to incus
```

The migration checks the node again, with the forwarding probes, and refuses on a host where Docker's firewall still drops the bridges' traffic. Then it drains the backend and the sandbox and stops every container of the Docker stack, the proxy too. It archives the Docker volumes, exports the snapshot and imports it into the Incus stack's `backups` volume, checking every archive by SHA-256. It restores the snapshot into fresh Incus volumes and deploys the same version on Incus. Before that deploy it reads the ports of every running Docker container and refuses while one still publishes port 80 or 443. It then runs the public smoke checks against the new edge and sets `runtime.engine` to `incus`.

Each step is recorded in `.tale/migration.json`. When a run stops, fix the reported cause and run the same command again: it continues after the last finished step. While a migration is under way, `tale deploy`, `tale start` and `tale rollback` refuse.

</Step>

<Step title="Accept or roll back">

Sign in, open a known conversation and download an old file at the site's address. The Docker containers stay stopped, after a Docker restart or a reboot too: their `unless-stopped` restart policy keeps an explicitly stopped container down. Then choose:

- `tale runtime migrate --to docker` rolls back: it deletes the Incus instances (their volumes stay), sets `runtime.engine` back to `docker` and starts the stopped Docker stack on the data it had. What users changed on Incus since the migration does not go back to Docker.
- `tale runtime migrate --finish` removes the stopped Docker stack, its containers and data volumes, and keeps its `backups` volume. It asks first (`--yes` skips the question); you cannot roll back afterwards.

</Step>

</Steps>

The smoke checks reach the new edge at `SITE_URL`. NAT proxy devices take no traffic the host sends to its own loopback address, so a site under a loopback name (`http://localhost`) is checked at the Incus edge's own address. To move to **another host**, name the new host's Incus API in `runtime.next.incus.endpoint`, make that node ready as [Make the node ready](#node-contract) describes, and place the two certificate directories in the workspace's `.tale/`. Pass `--smoke-url` with an address that reaches the new host's edge before DNS moves, and change DNS after the migration. The same-host firewall and port steps do not apply there.

**Back from Incus to Docker after `--finish`.** Nothing keeps a Docker stack for you any more, so carry the data in a snapshot: on Incus, take a snapshot and export it, then import and restore it in a Docker workspace that has the same `.env` and the same version, and deploy that version there. [Move a snapshot to another host or runtime](/self-hosted/operate/backups-and-restore#export-import) describes the commands.

## Know the current limits {#limits}

- A managed deployment that changed is refused on Incus: its upgrade needs a recovery snapshot, which the managed path cannot take on Incus yet. A workspace takes its native snapshot before each upgrade.
- `observe` stops at its filesystem inventory, and `accept` has no private origin to dial on Incus.
- A managed native client is created on the first deploy, but the call reports a failure, and the next deploy refuses the client.
- `tale stop`, `tale start` and `tale logs` work in a workspace; a managed deployment has none of them on Incus.
- One stack runs on one Incus server; Incus clusters are refused.
- `tale dev` and connected sandbox devices run on Docker only.

## Verified scope {#verified-scope}

The CLI's Incus end-to-end suites run the compiled CLI, built from the change, against a real Incus 7.6 node with a ZFS pool, the `routed` ingress and `tlsMode: "external"`, with the stack's images built from the same checkout.

For a managed deployment they cover the bootstrap, a second bootstrap that changes nothing, and the check with its probes; `deploy prepare` without Docker, the first deploy's plan and the deploy itself, with the stack answering through its edge; an empty plan and a second deploy that changes nothing; the refusal of an upgrade without a recovery snapshot; logs read once, crash loops reported with their console, a clean stop of Postgres and a draining stop of the worker; a session that reaches the backend API and the model gateway and nothing else; and no secret in any output.

For a workspace with two replicas of `platform` and `backend-api` they cover 20 colour flips between two releases under steady traffic through the edge, with no failed request; open event streams that stay open through the withdrawal and reconnect to the new colour; a switch and resolvers of the older release kept running until `--stop` replaces them; a rolling `--services` replacement and a rollback; an interrupted flip that the next deploy finishes; a native snapshot, its archive, an export and import, a restore and its history; a restore interrupted at each step, refused by `tale deploy` and `tale start` until `--resume` or `--abort` finishes it; a `reset --all` that keeps the snapshots; and a replica restarted while it is withdrawn.

A migration from Docker on the same host was run on a lab host with Docker 29 beside Incus 7.6 and the `proxy-device` ingress, with its rollback, a second migration and `--finish`. The `proxy-device` ingress in the suites, Let's Encrypt certificates, `accept` and `observe`, the managed in-place window's length, a host reboot or shutdown, a Docker restart after a migration, a migration to another host, and a host shared with other projects were not part of those runs.
