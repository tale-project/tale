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
