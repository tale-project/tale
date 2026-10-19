# Sandbox on Incus: end-to-end against a real node

The unit tests of the Incus backend (`src/backend/incus`) run it against an
in-memory imitation of the Incus API. This directory is what shows the
imitation right: the same spawner, started from the same checkout, driven
through its signed HTTP API the way the platform drives it, against a real
Incus node built the way [docs/incus.md](../../docs/incus.md) tells an operator
to build one.

It runs in CI (`.github/workflows/sandbox-incus-e2e.yml`) on a Linux runner, on
pull requests that touch the spawner, the runtime image or the egress proxy, and
on demand. A draft pull request is held, as the other heavy workflows hold it;
to try a draft, dispatch the workflow on its branch (see "Running it"). It
reconfigures its host (packages, a ZFS pool, the firewall, Incus itself), so it
is only ever run on a throwaway machine: CI, or a VM you can lose, with
`TALE_INCUS_E2E_THROWAWAY_HOST=1`.

## The lab

`lab.sh` builds the node, one subcommand per workflow step. Each leaves its
duration in `phases.tsv`, which the job summary reports.

| Step       | What it makes                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `install`  | Incus from Zabbly's stable channel (key fingerprint and exact build pinned), skopeo, ZFS                                                                                       |
| `storage`  | a ZFS pool on a sparse file, registered as the Incus pool `tank`                                                                                                               |
| `api`      | the server certificate Bun can pin (self-signed, `CA:TRUE`, `pathlen:0`, `keyCertSign`), the API bound to it, the spawner's client key, and two foreign certificates           |
| `registry` | a local OCI registry, which the two images are pushed to and Incus pulls from                                                                                                  |
| `operator` | the block of docs/incus.md that follows `<!-- e2e:operator-setup -->`, run verbatim: the sandbox bridge, the restricted project, the ACL, the profile, the client certificate |
| `egress`   | Tale's own `sandbox-egress` image as an instance on the sandbox bridge, and the addresses the LLM gateway and backend stand-ins listen on                                       |

The runtime and egress images are built from the checkout by the workflow
(BuildKit, as a release builds them: zstd layers, OCI media types) and pushed to
the registry. The spawner pulls the runtime image itself
(`SANDBOX_INCUS_IMAGE_SOURCE`), so the pull the unit tests cannot vouch for is
part of every run; the egress image goes in the way docs/incus.md tells an
administrator to import one (`incus remote add --protocol=oci`, `incus image
copy`).

Because the operator's block is the document's own text, the example an
operator copies is the one the backend was tested against. `operator-block.test.ts`
(an ordinary unit test) keeps `lab.sh`'s names and the document in step.

## The suites

Each suite starts its own spawner (or two, for a rollout) from this checkout and
leaves the node clean. A step that fails first prints what the node and the
spawners looked like.

| Suite       | What it proves on a real node                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boot`      | the pinned server certificate is the only trust anchor (a wrong one, and Incus's own `CA:FALSE` one, are refused before or without a request), an untrusted client, a key that does not match, no node, a foreign project, a missing profile and a project `limits.cpu` without one on the profile are each refused in words; the restricted certificate sees only its project and cannot make a project, change a pool or the network, or reach another project; the restricted project refuses a privileged container, `raw.lxc`, swap, a host path and a NIC of its own |
| `lifecycle` | create (cold, render profile), exec (output, exit codes, env, cwd, stdin, streaming, deadline, cancel), files (stage, list, read, delete, binary), env, the instance's labels, limits, devices and hardening (`no_new_privs`, no capabilities, a user namespace of its own, the cgroup limits), `/dev/shm`, the workspace quota, stop and resume with the workspace intact under a new idmap, a duplicate, a race, a pin, destroy       |
| `fencing`   | the ETag is honoured (a stale write is a 412), a session is created by the backend alone and a second create is a duplicate, a different incarnation is not the session, the right stamp pins, lists and stops, and destroy removes everything and says the bytes are gone                                                                                                                                                   |
| `network`   | a session resolves through the proxy alone, goes out through Tale's egress proxy and nowhere else (UDP and non-443 TCP stopped, the metadata address, the node's API and the spawner, another session and its runnerd), reaches the gateway and backend stand-ins on the ACL's ports only (by name too, once the bridge's resolver is given the names and the spawner points sessions at it), and the proxy refuses private destinations; given stand-in npm and PyPI caches (`SANDBOX_INCUS_NPM_REGISTRY`, `SANDBOX_INCUS_PYPI_INDEX`, an ACL rule for each port, the registries' hosts in the proxy's `SANDBOX_EGRESS_DENIED_HOSTS`), a session installs a locked npm project, a pip project locked by hash and the same requirements through uv from them, and reaches no registry host (the proxy answers a tunnel to each `403`, its resolver `NXDOMAIN`) while the rest of the web stays open |
| `pool`      | standbys fill and wait, a create is a claim (relabelled, workspace hot-plugged under an isolated idmap, token by file), the refill, the capacity bound with sessions and standbys together, a standby that vanished, and a rollout: a draining spawner stops keeping the pool and its replacement takes the standbys over                                                                                                             |
| `reaping`   | the sweep stops a session past its lifetime and an idle one (workspace kept, resumable), and leaves a pinned one alone                                                                                                                                                                                                                                                                                                              |
| `adoption`  | a crashed or restarted spawner re-adopts its sessions from the labels (pin, incarnation, env), ended compute found after a restart is removed with the workspace kept, and a peer that replaced a session under its name is never undone by a spawner still holding the old incarnation                                                                                                                                              |
| `failures`  | a session whose process ends by itself stops with its console readable and resumes on the next create, a busy session stopped by a draining spawner hears the shutdown, and an image that cannot start a session fails the create with the reason and keeps the workspace                                                                                                                                                              |
| `limits`    | `SANDBOX_MAX_SESSIONS` refuses with a place in the line; a project memory limit refuses the create that would pass it in Incus's own words and leaves the workspace volume; a project CPU limit with a count on the profile admits sessions up to the total and refuses the next in the same words                                                                                                                                                                                                                                                           |
| `docker`    | Docker inside a session (opt-in): nesting and interception allowed for it alone, the inner engine comes up, `docker run` and `docker build` work, and a nested container is no freer than the session                                                                                                                                                                                                                                 |
| `upgrade`   | the event of every Tale release: the next version of the runtime image (the current one and a file more, built by the workflow) is pulled under a new alias when the spawner restarts with it, an alias that exists is never pulled again whatever source it is given, the session that runs is adopted and stays on the version it began with, the pool rotates to the new version (old standbys out, new ones waiting), and new sessions, claimed and cold, run the new one |
| `soak`      | rounds of eight creates at once (`soak_rounds` sets how many, default 6) against a spawner whose warm pool is on, so that starts, claims, refills and removals overlap on the node; each session answers a command and is destroyed, no create may fail or hang, and the node is left clean. The create times under that load are the result                                                                     |

The job summary and the `report/*.json` artifacts hold the timings: boot and
image pull, a cold create, a create from the warm pool, a resume, a destroy, the
pool's fill and refill, an exec round trip, a request through the proxy.

## Running it

In CI it is the workflow. To try a branch (a draft pull request is held, so
this is how a draft runs it), dispatch it there:

```sh
gh workflow run sandbox-incus-e2e.yml --ref <branch>                      # every suite
gh workflow run sandbox-incus-e2e.yml --ref <branch> -f suites=pool,failures
gh workflow run sandbox-incus-e2e.yml --ref <branch> -f runner=ubuntu-latest
gh workflow run sandbox-incus-e2e.yml --ref <branch> -f suites=soak -f soak_rounds=40   # hunt for something rare
```

On a Ubicloud 4-vCPU runner the first suite starts about four minutes after the
dispatch (Incus and ZFS install in under a minute, the node's own setup in 15 s,
the two image builds in under two minutes with warm layer caches) and a run of
all twelve ends 22 to 24 minutes after the dispatch, so a run of a suite or two
is short. `runner` is the label the node is built on: a Ubicloud label by
default, GitHub's own for a pull request.
Each suite leaves its log and report as an artifact the moment it ends, so a run
in progress can be read.

By hand, on a throwaway Ubuntu 24.04 VM with passwordless `sudo`, Docker, Bun and
a checkout:

```sh
export TALE_INCUS_E2E_THROWAWAY_HOST=1 INCUS_E2E_DIR=/mnt/tale-incus-e2e
eval "$(bash services/sandbox/e2e/incus/lab.sh env | sed 's/^/export /')"
for step in install storage api registry; do bash services/sandbox/e2e/incus/lab.sh $step; done
# build the two images and push them to 127.0.0.1:5000, as the workflow does
for step in operator egress lab-file; do bash services/sandbox/e2e/incus/lab.sh $step; done
cd services/sandbox && bun test --timeout 1800000 ./e2e/incus/suites/lifecycle.e2e.ts
```

`bun test` does not pick the suites up by itself (their names end in `.e2e.ts`),
so the workspace's ordinary test run never needs a node.

## Pins

Everything third-party is pinned in `lab.sh`: Zabbly's signing key by
fingerprint, the exact Incus build (Zabbly keeps two builds per channel, so a
pin ages out in weeks and `install` then lists what the index has), and the
registry image by digest. The runner's own Ubuntu decides which of the two
Incus builds applies. A bump is a change to those lines and a green run.

## What it does not prove

The topology of the production node (the spawner and the stacks in containers of
their own, the real hostkit), a node reboot, a different kernel or storage
driver than a hosted runner's (ZFS on a file), a long soak, many concurrent
sessions, and a restricted certificate against a node with other tenants. The
manual list in docs/incus.md names what is left for a first real node.

## Making it a required check

It is a standalone workflow on purpose: it takes about half an hour and
depends on a third party's package index. To require it, do what the other
validation workflows do, in one change:

1. Give the workflow a `merge_group:` trigger and a `ci-ready` job like the one
   in `.github/workflows/checks.yml` (named `CI ready (Sandbox Incus E2E)`,
   `needs` the `incus` job, `if: always() && (github.event_name ==
   'pull_request' || github.event_name == 'merge_group')`, running
   `./.github/actions/ci-ready` with `workflow: sandbox-incus-e2e`).
2. Register the workflow in `tools/cli/scripts/ci-ready.ts`: its job ids in
   `CI_JOBS` and its context in `CI_CONTEXTS` (the tests next to it hold every id
   to the YAML). Consider listing it with the heavy suites that run only in the
   merge queue (`MERGE_QUEUE_ONLY_SCOPES`), so that a pull request does not spend a
   runner on it and the queue's run is the gate.
3. Add `CI ready (Sandbox Incus E2E)` to the repository's required checks (the
   branch protection or ruleset of `main`).

Until then it reports on the pull request once it is ready for review, runs on
demand for a draft (see "Running it"), and blocks nothing.
