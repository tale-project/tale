# Raw devices: sessions directly on a machine

A **raw** device is a [connected device](devices.md) whose sessions run directly on its own
machine: no container, no virtual machine. A session is a directory and one runnerd process; its
harness turns run the harnesses installed on the machine (Claude Code, Codex, …). The platform
calls it exactly like any other session ([sessions.md](sessions.md)): the hub forwards the calls,
the device's spawner runs them on its `raw` backend (`SANDBOX_BACKEND=raw`,
`src/backend/raw/`).

```
platform ──signed API──▶ hub ◀══ tunnel ══ tale sandbox device run  (the spawner, raw backend)
                                              │  relays on 127.0.0.1:<port>
                                              ├── runnerd ─▶ execs   (session A, as slot 01)
                                              └── runnerd ─▶ execs   (session B, as slot 02)
```

## Connecting one

```bash
# Isolated: each session runs as an account of its own. The service runs as root.
sudo tale sandbox connect https://your-tale-site --token tsdj_… --runtime raw

# Shared: every session runs as you. For a machine you use alone.
tale sandbox connect https://your-tale-site --token tsdj_… --runtime raw
```

| Flag                       | Meaning                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--runtime raw`            | Sessions run on this machine.                                                                                                                                 |
| `--isolation`              | `isolated` (default as root) or `shared` (default otherwise). Isolated needs root; shared refuses root.                                                     |
| `--slot <account>`         | Isolated: an existing account to run sessions as (repeat). Without it, `connect` makes `tale-slot-01…NN` (macOS: hidden `_tale-slot-01…`), one per session. |
| `--root <dir>`             | The device's directory. Default: `/var/lib/tale-sandbox` (Linux) or `/usr/local/var/tale-sandbox` (macOS) when isolated, `~/.tale/sandbox` when shared.      |
| `--path <dir>`             | Where harnesses are installed, searched before the system's directories (repeat). Default: `/opt/tale-agents/bin` when isolated; the user's own bin directories when shared. |
| `--binary <path>`          | The `tale` binary the device runs from. Default: a copy of the one running `connect`, in `<root>/bin`.                                                        |
| `--token-file <path>`      | The join token from a file (or `TALE_SANDBOX_JOIN_TOKEN`), so it never sits on a command line.                                                               |
| `--no-service`             | Write the device's config only; whoever manages the machine runs `tale sandbox device run --config <root>/device.json` under its own service manager.         |

Without `--no-service`, `connect` installs the service that keeps the device running: a systemd
unit `tale-sandbox-device.service` (system when isolated, the user's when shared) or a launchd job
`dev.tale.sandbox-device` (a LaunchDaemon when isolated, a LaunchAgent when shared). Its command is
`<binary> sandbox device run --config <root>/device.json`. systemd stops only that process
(`KillMode=process`) and launchd leaves the process groups it started (`AbandonProcessGroup`): the
sessions outlive a restart of the device, which takes them back from their records when it starts.

`tale sandbox status`, `logs`, `update` and `disconnect` know a raw device. `disconnect` ends every
session (each slot's processes, or each runnerd's tree), removes the service, the slot accounts it
made and the device's directory (`--keep-data` keeps the workspaces).

## The runtime is the `tale` binary

The CLI carries everything a raw device runs (`tools/cli/scripts/generate-raw-runtime.ts`): this
spawner, bundled for Bun with its lazy backends in chunks of their own; runnerd; the runtime image's
helper programs (the harness wrappers, Claude Code's hooks, the git credential helper, the MCP
bridges) and its Claude Code managed settings. `tale sandbox device run` lays them out under
`<root>/lib/<release>-<digest>/` (readable by every slot, the newest three kept, since a running
runnerd loads its lazy chunks from the directory it started in) and imports the spawner bundle in
its own process. Each runnerd is the same binary started with `BUN_BE_BUN=1`, which makes a
compiled Bun program run a script; runnerd removes the variable before it starts anything, so a
harness that is itself a compiled Bun program (Claude Code's native build) still runs as itself.

A device on a release follows its hub: when the hub runs another release, the device starts
`<binary> sandbox update --to <release> --from-device`, which fetches that release's binary for the
platform, refuses it unless its SHA-256 is the one the release's `tale_checksums.txt` lists, puts
it in place, records the outcome in `update-status.json` and has the service start again from it.
`--no-auto-update` (what a managed machine uses: its manager pins the binary) turns that off.

## A session

Under the device's root:

| Path                  | What                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `sessions/ses-<id>/`  | The session's `/agent`: `workspace`, `uploads`, `output`, `.runtime/home` (`HOME`), `.runtime/tmp` (`TMPDIR`), the dependency dirs. 0700, its slot's while it runs. |
| `sessions/.trash/`    | Destroyed sessions, deleted in the background ([workspace deletion](sessions.md#stop-vs-destroy--the-data-preservation-contract)). |
| `control/<id>.json`   | Its record: owner, stamps, pin, slot, and the running runnerd (pid, start time, port, token). The spawner's alone (0600).      |
| `logs/<id>.log`       | runnerd's own output.                                                                                                         |

A create lays the directory out (Claude Code's settings in `.runtime/home/.claude/settings.json`,
rewritten on every start so a turn that edited them gets the device's back), clears what an
earlier incarnation left in `.runtime/tmp`, and starts runnerd detached in a process group of its
own, as the session's slot account on an isolated device. runnerd takes a loopback port the kernel
picks (`TALE_RUNNERD_LISTEN=127.0.0.1:0`) and names it in `.runtime/runnerd-ready.json`; the create
waits for that and for runnerd's health check, failing at once when runnerd exits. Each start gets
a token of its own, handed over on a descriptor (`TALE_RUNNERD_TOKEN_FD=3`), never in the
environment: every session of the device shares the host's loopback, so a token one incarnation
ever handed out opens no later one (`SessionBackend.runnerdToken`). The seed environment goes over
runnerd's API after it is ready, as on Docker.

The record is the truth across restarts: `listSessions` reads the records and judges each runnerd
by its pid and start time, so a restarted spawner takes the running sessions back, and after a
reboot a session whose runnerd is gone reads ended and is cleaned up like a dead container.

### The session view

The platform names a session's files under `/agent` and its own doors by the deployment's
addresses (`http://backend-api:3005`, `http://sandbox-llm-gateway:8080`); a container makes both
true with a mount and a network alias. A raw session cannot: it lives in its own directory, and
its doors are the device's relays on loopback ports. runnerd is the one boundary everything that
enters a session passes, so the raw backend hands it a **view** (`TALE_SESSION_VIEW`,
`services/sandbox-runtime/daemon/src/session-view.ts`):

- `root` → `real`: `/agent` and the session's directory;
- `origins`: each relay's deployment origin and its loopback origin on this device;
- `paths`: the image's helper paths the platform names (`/usr/local/bin/tale-git-credential`,
  which it arms git's credential helper with) and the device's copies.

runnerd replaces those names in everything the platform sends in (an exec's argv, environment,
working directory and stdin, a steer line, the session environment, the paths of file
operations) and the real names back in what an exec prints, before it is journaled. A name is
replaced only as a whole (`/agents` and `https://example.com/agent` stay as they are), and a stream
holds back only a suffix that may begin a name, so a line ending in a newline is never delayed.
The contents of staged files are not translated: an inline item carries the platform's SHA-256 of
its bytes. Text the platform hands the agent outside the exec interface (a connector's
description) still names `/agent`.

The device's root is resolved to its real path first: macOS's `/tmp` and `/var` are links into
`/private`, and runnerd holds every path to the realpath of its root.

## Isolation and cleanup

**Isolated** (the default as root): each running session runs as one slot account; a device runs
at most as many sessions as it has slots. A session cannot read another's files (each directory is
0700 and its slot's), signal its processes, or read the device's config, records or logins. A stop
or destroy ends **every process of the slot** (SIGTERM with the stop's grace, then SIGKILL until
none is left; a zombie is left to init), then takes back what the slot left outside the session:
its files in `/tmp`, `/var/tmp` and `/dev/shm` (macOS: `/private/tmp`, `/private/var/tmp`, its
`/private/var/folders` entries), its crontab, its launchd domain on macOS, and its home, which is
emptied. The session's directory is then closed (root's, 0700), so whichever session runs as that
slot next cannot enter it; a resume gives the files to the slot it runs as (the one they belong to
first, so a resume rarely changes their owner, which is a `chown -R -h` that never follows a link).
A slot that runs a process while no session holds it (a crash between a start and its record) is
ended by the periodic sweep.

**Shared**: every session runs as the device's account, with its own `HOME` and `TMPDIR`. A stop
ends runnerd, everything below it and the process groups its execs led; runnerd ends what an exec
left behind when the exec ends. Sessions can read one another's files, and anything the account
can: connect a machine shared only when it is yours alone.

On both, a session has the machine's network (Docker devices route their sessions through an
egress proxy that blocks private addresses). A machine its manager hardens can fence the slot
accounts' traffic itself; hostkit's `raw` runtime does (the ops repository).

## Harnesses

A raw device runs the harnesses its machine has: it looks for each harness's program and what its
Tale wrapper needs on the sessions' PATH (`src/backend/raw/raw-harnesses.ts`: Claude Code needs
`claude`, `bash` and `jq`; the Python wrappers need `python3`), asks each for `--version`, and
reports the list in its HELLO, again in a STATUS when it changed (it looks again every ten
minutes). A create with `placement: 'device'` names the harness its turns run
(`requires: { harness }`, the platform's `installedHarness` of the agent's); the hub passes over a
raw device that did not report it, and a Docker device runs every harness its image carries. The
platform counts only such devices as room for a run a host refused.
