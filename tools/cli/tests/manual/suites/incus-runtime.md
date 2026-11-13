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

- [ ] `INC-F1` · **Run `tale init proj --runtime incus --incus-project tale-demo --incus-pool tank --incus-network tale-demo --incus-subnet 10.30.0.0/24 --incus-sessions-subnet 10.31.0.0/24`, then read `proj/tale.json`** → it exits `0`, prints a warning that names `.tale/incus/` and `tale incus check`, and `runtime` holds `"engine": "incus"` and an `incus` block with gateway `10.30.0.1`, block `10.30.0.0/24` and ingress `proxy-device`; `proj/.gitignore` lists `.tale/`.
- [ ] `INC-F2` · **In `proj`, before any bootstrap, run `tale deploy --dry-run` and `tale status`** → each exits `3` and names the Incus credentials missing in `proj/.tale/incus`; no container and no volume named after the project appears in `docker ps -a` or `docker volume ls`.
- [ ] `INC-F2a` · **In `proj`, run `tale doctor --offline`** → it exits `3`; the `engine` row reads `Declared runtime: Incus` with project `tale-demo`, `incus-credentials` fails naming `proj/.tale/incus`, `incus-api` reads `Skipped` with `--offline`, and no Docker row appears.
- [ ] `INC-F2b` · **In `proj`, run `tale dev`, then `tale sandbox connect https://tale.invalid --token tsdj_demo`** → each exits `3` with one sentence saying the workspace declares `runtime.engine "incus"` and the command runs on Docker only, a local developer loop, with Incus on Linux only; `docker ps -a` shows nothing new, no file in `proj` changes, and no device configuration is written.
- [ ] `INC-B1` · **In `proj`, run `TALE_RUNTIME=docker tale status`, then set `runtime.engine` to `podman` in `tale.json` and run `tale status`** → the first exits `3` naming `TALE_RUNTIME` and the declared `incus`; the second exits `3` naming `runtime.engine`, and neither reads the stack as Docker.

## Bootstrap and check a single box · a fresh Ubuntu host with Incus · 30 min

Continues in `proj` from the group above, on a fresh Ubuntu host with Incus
from Zabbly stable and a ZFS pool `tank` (`incus storage create tank zfs`).
Re-run `INC-F1` there with `--incus-pool tank` first. The boxes run in order.

- [ ] `INC-F3` · **Run `tale incus contract` in `proj`** → it prints JSON with `"schemaVersion": 1` and `"kind": "tale.incus.node-contract"`, the project `tale-demo` with `restricted` `true` and `limits.*` set, the bridge `tale-demo` at `10.30.0.1/24` with `ipv6.address` `none` and both default ACL actions `drop`, and ACL rules whose sessions side names `10.31.0.0/24`, never a gateway address.
- [ ] `INC-F4` · **As root, run `tale incus bootstrap` in `proj` and answer yes** → the plan prints before the question, one `create` line each for the two ACLs, the two bridges, the two projects, the profiles `tale-stack` and `sandbox`, the two trust entries and `.tale/incus` and `.tale/sandbox-incus`; afterwards `incus project list`, `incus network list` and `incus config trust list` show them, and `.tale/incus/client.key` is mode `0600` and owned by the workspace owner, not root.
- [ ] `INC-F5` · **Run `tale incus bootstrap` again** → every line reads `keep`, it ends with `The node already holds what the contract needs.` and nothing changes in the `incus` listings.
- [ ] `INC-F6` · **As the workspace owner, run `tale incus check`** → four probe lines (`names-to-gateway-udp`, `spawner-to-incus`, `spawner-to-sessions`, `public-egress`), none `timeout`; it ends with `The node holds what the contract needs.` and exits `0`, and `incus list --project tale-demo` shows no `job-check-*` instance afterwards.
- [ ] `INC-F6a` · **As the workspace owner, run `tale doctor`** → it exits `0`; `incus-credentials` names the certificate's end date, `incus-api` reads `Incus <version> on <architecture>` with project `tale-demo` and pool `tank (zfs)`, and `incus-instances` says the stack has no instances yet.
- [ ] `INC-F6b` · **As root, run `incus create --empty crash-demo --project tale-demo -p tale-stack -c security.idmap.isolated=true -c user.tale.stack=<id from proj/tale.json> -c user.tale.want=running`, then `tale doctor` as the owner, then `incus delete crash-demo --project tale-demo`** → `tale doctor` exits `3` with `crash-demo stopped after repeated crashes`, the lines under `the last console lines Incus kept:`, and the fix `incus start crash-demo --project tale-demo`; the instance is still `STOPPED` afterwards.
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

## Snapshots and restore · a workspace deployed on Incus as `tale-demo`, a second bootstrapped host · 40 min

Runs in a workspace whose stack `tale deploy` brought up on Incus (project
`tale-demo`, pool `tank`), with an organization and an uploaded file in it.
The boxes run in order; the export box needs a second host bootstrapped the
same way.

- [ ] `INC-F11` · **Run `tale backup`, then `incus storage volume snapshot list tank db-data --project tale-demo`** → it prints one line `N snapshot(s) in <ms> ms` under one second; every data volume lists `tale-<id>`, `sandbox-credentials`, `switch-config`, `names-config` and `backups` list none, and `tale restore` lists `<id>` marked `native`.
- [ ] `INC-F12` · **Run `tale backup export <id> --to set.tar`, copy it to the second host and run `tale backup import set.tar` there** → the first writes `set.tar` and `tale restore` now marks `<id>` `native + archive`; the import prints each archive and `Imported snapshot <id>`, and `tale restore` on the second host lists `<id>`.
- [ ] `INC-F13` · **Change the uploaded file, then run `tale restore <id> --stop --yes`** → it ends `Snapshot <id> restored; its users run again.`; `incus storage volume list tank --project tale-demo` shows `db-data.pre-restore-<time>` beside a fresh `db-data`, the organization and the file are as they were at `<id>`, and `tale backup prune --dry-run` lists each holder as kept with `<id>`.
- [ ] `INC-B7` · **Run `tale restore <id> --stop --yes` and press Ctrl-C once it prints `Setting db-data aside`; run `tale deploy` and `tale start`, then `tale restore --resume`** → the two refuse with `A restore of snapshot <id> is not finished` and name `--resume` and `--abort`; no empty `db-data` appears in between, and the resume ends `The restore is finished.` with the stack serving. Repeated with `tale restore --abort` instead, every volume is back as it was before the restore.
- [ ] `INC-B8` · **As root, run `incus project set tale-demo limits.disk.pool.tank=<the project's disk usage + 1GiB>`, then `tale restore <id> --stop --yes`** → it exits non-zero naming `limits.disk.pool.tank` and the bytes the copies count, and `incus list` and `incus storage volume list` are unchanged; unset the limit afterwards.
- [ ] `INC-B9` · **Run `tale reset --all --force`, then `tale restore`; then `tale deploy` and `tale restore <id> --stop --yes`** → before the reset deletes anything it prints `Archiving snapshot <id> into backups`; the data volumes are gone, `backups` stays, and the list still offers `<id>` marked `native + archive`; after the deploy the restore says each native snapshot is gone, prints `Extracting <volume>.tar.gz`, and the organization and the file are back. With the `tale-proxy` image alias deleted first, the reset refuses with `nothing was deleted` and names `--discard-snapshots`.

## Deploy a workspace and flip colours · the bootstrapped host, releases N and N+1 · 60 min

Continues in `proj` on the host the bootstrap group left, with `.env` naming
a public `HOST`, `TALE_PLATFORM_REPLICAS=2`, and two releases N and N+1 whose images
carry the switch role. The boxes run in order. The load box runs `oha`
(HTTP), an SSE and a WebSocket client and a 1 Hz `curl` of `/api/health`, all
through the edge, from a second machine.

- [ ] `INC-F14` · **At release N, run `tale deploy --plan-only`** → it exits `0` and prints `volumes:`, `infrastructure:`, `stateful:` and `colour-blue:` lines, `create instance/switch [switch]` among the infrastructure and one `create` line per blue replica; `incus list --project tale-demo` still shows nothing.
- [ ] `INC-F15` · **Run `tale deploy --yes`, then `tale status`** → it exits `0` with `Deployment complete!`; status names `names`, `names-sessions` and `switch` among the stateful services, and under `Blue (active)` each `platform` and `backend-api` replica reads `healthy (N), admitted`; the origin answers through the edge.
- [ ] `INC-F16` · **With the load running, move the workspace to N+1 and run `tale deploy --yes`** → green comes up and blue is withdrawn, drained, stopped and deleted, in that order in the output; the load reports zero 5xx, the edge never answers 502, 503 or 504 or its maintenance page, the poller sees only 200, and SSE and WebSocket streams drop only when blue stops; `incus config show switch --project tale-demo` shows the same `volatile.uuid` as before the flip.
- [ ] `INC-F17` · **Run `tale rollback --yes`, then `tale status`** → it ends `Rollback complete! Version N is now live on blue`; status shows blue `healthy (N)` and `Previous version: N+1`, and `incus list` shows no green instance.
- [ ] `INC-F18` · **Run `tale deploy --services platform --yes` at N+1 with the load running** → `platform-blue-1` is replaced while `platform-blue-2` serves, then `platform-blue-2`; status shows both `healthy (N+1), admitted`, `backend-api` keeps N, and the load reports zero 5xx.
- [ ] `INC-F19` · **Run `tale stop`, then `incus list --project tale-demo`, then `tale start` and `tale status`** → `tale stop` prints three steps, the edge, the switch and the colours first, then the sandbox tier, then `db`, `object-store` and the resolvers, and every instance is `STOPPED`; `tale start` starts them the other way round, each step healthy before the next, and status reads healthy throughout.
- [ ] `INC-F20` · **Run `tale logs platform`, then `tale logs platform --consume`** → the first refuses and names `--consume`; the second prints one line warning that the read takes the lines it shows, then the log, and no secret of `.env`.
- [ ] `INC-B10` · **Run `tale deploy --yes` at a new release and press Ctrl-C at `Starting the green colour...`; run `tale status`, then `tale deploy --yes` again** → the first exits `130`; status warns `A colour flip onto green (…) stopped in its starting phase; tale deploy resumes it.`; the second prints `Resuming the interrupted flip onto green from its starting phase`, keeps every green replica that was up, and ends with blue gone.
- [ ] `INC-B11` · **Note `incus config get sandbox oci.entrypoint --project tale-demo`, set it to `/bin/false`, wait until `incus list` shows `sandbox` `STOPPED`, set it back, then run `tale status` and `tale start`** → status reads `sandbox` `stopped after repeated crashes` followed by `the last console lines Incus kept:` and the sandbox's last lines; `tale start` starts it, and status reads it healthy.
- [ ] `INC-B12` · **Run `tale deploy --plan-only --json > plan.json`, then `tale deploy --services platform --yes` at another release, then `tale deploy --plan plan.json --yes`** → the last exits `3` with `The reviewed plan differs from what the node needs now`, and `incus list` is as the second command left it.
- [ ] `INC-B13` · **With a restore pending (`INC-B7`'s Ctrl-C), run `tale deploy --services platform`, `tale rollback --yes` and `tale migrate`** → each exits `3` with `A restore of snapshot <id> is not finished` and names `--resume` and `--abort`; nothing in `incus list` changes.
