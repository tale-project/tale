# Incus runtime

> **Prefix** `INC-` · **Reset** a fresh host, where a group says so · **Cost** per group, in its heading

A Tale deployment that runs as Incus instances instead of Docker Compose
containers, driven with the compiled `tale` on real hosts: the bootstrap of a
fresh Ubuntu host, certificates from Let's Encrypt through the instances' proxy
devices, a host reboot under a running deployment, a migration between two
hosts, whether an operator can read what `tale status` and `tale logs` print,
and `tale stop` before host maintenance. A change that ships one of these
behaviours adds its boxes here, in its own group, in the same commit
([readme](../readme.md#changing-the-suites)).

**Groups follow the life of a host — bootstrap, deploy, operate, recover,
migrate — and each one names the state it starts from**: a fresh host, or what
an earlier group left. A group that consumes an earlier group's state says so
in its heading, and its boxes run in order.

## Preconditions

The binary under test and the hosts per [`../setup.md`](../setup.md). Docker
Compose stays a host's default runtime; a box that needs Incus says how its host
gets it.

> **Agent note**: judge a host by what the runtime and `tale status` report
> after a command returns, never by the command's own success line — an
> instance that was created and an instance that serves are different states.

## Declare the runtime · a scratch directory on any host · 5 min

Nothing here needs Incus: the declaration is read before any runtime is
touched. Run the compiled `tale` from an empty scratch directory.

- [ ] `INC-F1` · **Run `tale init proj --runtime incus --incus-project tale-demo --incus-pool tank --incus-network tale-demo --incus-subnet 10.30.0.0/24 --incus-sessions-subnet 10.31.0.0/24`, then read `proj/tale.json`** → it exits `0`, prints a warning that a workspace on Incus is not available yet, and `runtime` holds `"engine": "incus"` and an `incus` block with gateway `10.30.0.1`, block `10.30.0.0/24` and ingress `proxy-device`; `proj/.gitignore` lists `.tale/`.
- [ ] `INC-F2` · **In `proj`, run `tale deploy --dry-run` and `tale status`** → each exits `3` and prints `running a workspace on Incus is not available yet in this CLI`; no container and no volume named after the project appears in `docker ps -a` or `docker volume ls`.
- [ ] `INC-B1` · **In `proj`, run `TALE_RUNTIME=docker tale status`, then set `runtime.engine` to `podman` in `tale.json` and run `tale status`** → the first exits `3` naming `TALE_RUNTIME` and the declared `incus`; the second exits `3` naming `runtime.engine`, and neither reads the stack as Docker.

## Bootstrap and check a single box · a fresh Ubuntu host with Incus · 30 min

Continues in `proj` from the group above, on a fresh Ubuntu host with Incus
from Zabbly stable and a ZFS pool `tank` (`incus storage create tank zfs`).
Re-run `INC-F1` there with `--incus-pool tank` first. The boxes run in order.

- [ ] `INC-F3` · **Run `tale incus contract` in `proj`** → it prints JSON with `"schemaVersion": 1` and `"kind": "tale.incus.node-contract"`, the project `tale-demo` with `restricted` `true` and `limits.*` set, the bridge `tale-demo` at `10.30.0.1/24` with `ipv6.address` `none` and both default ACL actions `drop`, and ACL rules whose sessions side names `10.31.0.0/24`, never a gateway address.
- [ ] `INC-F4` · **As root, run `tale incus bootstrap` in `proj` and answer yes** → the plan prints before the question, one `create` line each for the two ACLs, the two bridges, the two projects, the profiles `tale-stack` and `sandbox`, the two trust entries and `.tale/incus` and `.tale/sandbox-incus`; afterwards `incus project list`, `incus network list` and `incus config trust list` show them, and `.tale/incus/client.key` is mode `0600` and owned by the workspace owner, not root.
- [ ] `INC-F5` · **Run `tale incus bootstrap` again** → every line reads `keep`, it ends with `The node already holds what the contract needs.` and nothing changes in the `incus` listings.
- [ ] `INC-F6` · **As the workspace owner, run `tale incus check`** → four probe lines (`names-to-gateway-udp`, `spawner-to-incus`, `spawner-to-sessions`, `public-egress`), none `timeout`; it ends with `The node holds what the contract needs.` and exits `0`, and `incus list --project tale-demo` shows no `job-check-*` instance afterwards.
- [ ] `INC-B2` · **As root, run `incus network acl rule remove tale-tale-demo egress description=public-egress`, then `tale incus check`** → it exits `3`, the `public-egress` probe reads `timeout`, and the refusal lists the `DOCKER-USER` commands before `ip-forward-no-drop`; `tale incus bootstrap` then prints `update network acl tale-tale-demo`, and `tale incus check` passes again.
- [ ] `INC-B3` · **On a host where Docker runs (`iptables -S FORWARD` shows `-P FORWARD DROP`), run `tale incus bootstrap` and answer no at the firewall question** → it prints the four `DOCKER-USER` rules and asks for them apart from the plan; `iptables -S DOCKER-USER` is unchanged afterwards, and `tale incus check` refuses the `public-egress` probe as `timeout`.
- [ ] `INC-B4` · **As root, run `tale incus bootstrap --remove` and answer yes, then run it again** → the first run deletes the two trust entries, the zone's profile, project, bridge and ACL, then the stack's, and the credential files, in that order; the second lists nothing to delete. With any instance left in `tale-demo`, it refuses and names the count instead.

## Deploy a managed bundle · the bootstrapped host from the group above · 45 min

Continues on the host the bootstrap group left, with a deployment
specification `spec.json` whose `runtime` declares `"engine": "incus"` and the
`runtime.incus` block of `tale-demo` (a `/25` block), `sandbox`
`{ "backend": "incus" }`, and `<stateDirectory>/incus/` and
`<stateDirectory>/sandbox-incus/` holding the bootstrap's certificates. The
boxes run in order.

- [ ] `INC-F7` · **On a host without Docker on `PATH`, run `tale deploy prepare --spec spec.json --output bundle`** → it exits `0` without calling Docker; `bundle/runtime/runtime.json` records `"runtime": "incus"` and a `sandbox` whose `address` is the block's `.5` and whose `egressProxy` is `http://<block .10>:3128`, and `bundle/runtime/incus-stack.json` names every instance with an empty value for each `environment.*` key.
- [ ] `INC-F8` · **Run `tale deploy --bundle bundle --plan-only`** → it exits `0` and prints one `create` line per image, volume, file and instance, the switch after the instances it fronts; `incus list --project tale-demo` still shows nothing.
- [ ] `INC-F9` · **Run `tale deploy --bundle bundle --yes`, then `incus list --project tale-demo`** → it exits `0`; every instance of the plan is `RUNNING`, `<stateDirectory>/.tale/runtime.json` reads `"phase": "ready"`, and the origin answers through the proxy.
- [ ] `INC-F10` · **Run `tale deploy accept --bundle bundle --cli-ref <sha> --deployment-ref <sha> --expected-version <version>`, then `tale deploy observe` with the same pins** → both exit `0`, and neither prints a value of `<stateDirectory>/secrets.env` or a `DATABASE_URL`.
- [ ] `INC-B5` · **Run `incus config set db limits.memory=1GiB --project tale-demo`, then `tale deploy --bundle bundle --yes`** → it exits `3` with `An existing instance was changed outside the CLI since it was applied`, and `incus list` shows the instances unchanged.
- [ ] `INC-B6` · **Prepare a second bundle from a newer release and run `tale deploy --bundle bundle-2 --plan-only`** → the plan names `replace instance/sandbox [drain-sandbox]` and prints the notice that backend-api and platform are replaced in place and the edge serves its maintenance page meanwhile.
