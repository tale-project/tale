# Raw sandbox devices

> **Prefix** `RAW-` · **Reset** `tale sandbox disconnect` between groups · **Cost** 60 min

A machine connected as a sandbox device that runs its sandboxes directly on itself, with no
container ([the contract](../../../../../services/sandbox/docs/raw.md)): connecting it isolated
and shared, sessions running as their slot accounts, what a stop and a destroy leave behind, a
restart that keeps the sessions, and its update. A person drives it on a real Linux host (root and
an ordinary account) and a real Mac, against a Tale site the person administers.

## Preconditions

- A Tale site you are an admin of, on a release that carries raw devices, and a fresh connect
  command from Settings → Sandboxes → Add device for each group.
- A Linux host where you have root, with `claude` (Claude Code), `bash` and `jq` installed in
  `/opt/tale-agents/bin` or on the system PATH; a Mac signed in as an ordinary account, with
  Claude Code installed for that account.
- The release's `tale` binary installed (`../setup.md`), never a development checkout.

> **Agent note**: wait on `tale sandbox status` reading `connected` and on Settings → Sandboxes
> listing the device as Online, never on the connect command's last line.

## An isolated device on Linux · root

- [ ] `RAW-F1` · **Run `sudo tale sandbox connect https://<SITE> --token tsdj_… --runtime raw` on the Linux host** → it makes `tale-slot-01`… (`getent passwd tale-slot-01` names `/var/lib/tale-sandbox/slots/tale-slot-01`), ends with `is connected … directly on this machine`, and `systemctl is-active tale-sandbox-device.service` prints `active`.
- [ ] `RAW-F2` · **Run `sudo tale sandbox status`** → it reads `connected`, `Runs sandboxes` names its slot accounts, and `Service` reads `running`; Settings → Sandboxes shows the device **On the machine**, **Each sandbox as its own account**, and Claude Code with its version.
- [ ] `RAW-F3` · **Start a task on an agent that runs Claude Code, then run `ps -o user,args -u tale-slot-01` on the host** → the task's turn runs (`claude` under `tale-slot-01`), its workspace is `/var/lib/tale-sandbox/sessions/ses-<id>/workspace`, and the task's transcript names paths under `/agent/workspace`.
- [ ] `RAW-F4` · **Start a second task on another agent, and from its turn run `cat /var/lib/tale-sandbox/sessions/ses-<first id>/workspace/<a file of the first>` and `cat /var/lib/tale-sandbox/device.json`** → both answer `Permission denied`.
- [ ] `RAW-F5` · **Let the first task's session go idle until it stops (or Destroy its workspace in Settings), then run `ps -u tale-slot-01` and `find /tmp -user tale-slot-01`** → neither lists anything; `ls -ld /var/lib/tale-sandbox/sessions/ses-<first id>` reads `root` and `drwx------`.
- [ ] `RAW-F6` · **Run `sudo systemctl restart tale-sandbox-device.service` while a task's turn runs** → the turn goes on and finishes; `sudo tale sandbox status` reads `connected` again within a minute.
- [ ] `RAW-B1` · **Start a task on an agent that runs Codex while Codex is not installed on the host** → the run does not start on this device: it runs on the server, or waits for room, and never fails with `codex: command not found`.
- [ ] `RAW-B2` · **Run `tale sandbox connect https://<SITE> --token tsdj_… --runtime raw --isolation isolated` as an ordinary account** → it exits `3` with `takes root` before it uses the token (the token still connects a second time).
- [ ] `RAW-F7` · **Run `sudo tale sandbox disconnect --force`** → `systemctl status tale-sandbox-device.service` reads `could not be found`, `getent passwd tale-slot-01` prints nothing, and `/var/lib/tale-sandbox` is gone.

## A shared device on macOS · an ordinary account

- [ ] `RAW-F8` · **Run `tale sandbox connect https://<SITE> --token tsdj_… --runtime raw` on the Mac** → it ends `is connected`; `launchctl print gui/$(id -u)/dev.tale.sandbox-device` reads `state = running`; Settings shows the device **On the machine**, **Shared account**, and Claude Code with its version.
- [ ] `RAW-F9` · **Start a task on an agent that runs Claude Code** → its turn runs as your account in `~/.tale/sandbox/sessions/ses-<id>/workspace`, and the transcript names `/agent/workspace`.
- [ ] `RAW-B3` · **Run `sudo tale sandbox connect … --runtime raw --isolation shared`** → it exits `3` with `never as root`.
- [ ] `RAW-F10` · **Run `tale sandbox disconnect --keep-data --force`** → the launch agent is gone (`launchctl print gui/$(id -u)/dev.tale.sandbox-device` fails) and `~/.tale/sandbox/sessions` still holds the workspaces.

## Updates

- [ ] `RAW-F11` · **Connect a device with automatic updates on, then update the Tale site to the next release** → within the next ticket renewal the device reads the site's release in Settings, and `update-status.json` in the device's directory reads `"state":"idle"` with the new release.
- [ ] `RAW-F14` · **Connect a device with `--no-service`, then update the Tale site to the next release** → the connect says the device follows no release by itself, its `device.json` holds `"autoUpdate": false`, and the device keeps its release (the site lists it as behind) until `tale sandbox update` runs, which says to start the device again.
- [ ] `RAW-B4` · **On a device that updates itself, replace the next release's `tale_checksums.txt` line of the platform's binary with another SHA-256 (a test site's release only), then update the site** → the device stays on its release, Settings shows **Update failed**, and `update-status.json` names `is not the one … lists`.
