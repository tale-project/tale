---
title: Run sandboxes on your own devices
description: Connect a Linux or macOS machine with Docker so your organization's agent and automation sandboxes run on it.
---

A device is a machine you connect to your organization so its sandboxes run there instead of on the Tale server: a spare workstation, a build server or a Mac with capacity to share. Owners and Admins add and remove devices under **Settings > Sandboxes**. Developers can see the list.

## Check what the machine needs

- Linux on x86_64 or arm64, or macOS on Apple silicon or Intel.
- Docker: Docker Engine 24.0 or later on Linux; Docker Desktop, OrbStack or Colima on macOS. If Docker is missing, the Tale CLI offers to install it. Tale's images have zstd-compressed layers, which older engines cannot download, so `tale sandbox connect` and `tale sandbox update` refuse an older engine before they use the connect command or download anything.
- Outbound HTTPS to your Tale site. The device connects out to Tale; nothing has to reach the machine, so it works behind a router or firewall.
- Disk space for the sandbox images, several gigabytes, and for the workspaces it will hold.

By default a device runs one sandbox for every two CPUs and every 4 GiB of memory that Docker can use, up to 16 at a time, because each agent sandbox gets 2 CPUs and 4 GiB. You can choose another number when you connect the machine.

This number is a ceiling. The device also checks available host memory and workspace disk space before admitting work, so a free slot alone does not guarantee capacity for another sandbox.

<Warning>

A device runs your organization's work. Agent workspaces, the files they process and the short-lived credentials a task uses pass through the machine, and anyone with administrator access to it can read them. Connect only machines you control and trust as much as the Tale server. In turn, the Tale site decides what runs on the device, including the updates it installs by itself, so connect a machine only to a Tale site you trust with it.

</Warning>

## Add a device

<Steps>

<Step title="Copy the command">

Open **Settings > Sandboxes** and select **Add device** in the **Devices** section. Under **Install and connect**, select **Copy command**.

The command works once, within an hour. It carries a single-use token that the machine trades for a credential of its own.

<Frame caption="Add a device: the install-and-connect command, and the shorter one for a machine that already has the CLI. The token shown here is a placeholder.">

![The Add a device dialog with the Install and connect command, which installs the Tale CLI and runs tale sandbox connect with the deployment's address and a single-use token, a Copy command button, the requirements, the note that the command works once within an hour, the shorter command for a machine that already has the CLI, and the status Waiting for the device to connect.](/images/platform/sandbox-add-device.webp)

</Frame>

</Step>

<Step title="Run it on the machine">

Paste the command into a terminal on the machine and run it. It installs the Tale CLI and connects the machine:

```text
Connecting this machine to https://your-org.tale.dev as "studio-mac"…
Starting the sandbox device (Tale 0.5.60). The first start downloads the sandbox images, which can take a few minutes…
```

If the machine already has the Tale CLI, run the shorter command under **Already have the Tale CLI? Run this instead**.

</Step>

<Step title="Confirm it is online">

As soon as the machine reaches Tale, the dialog shows **studio-mac is connected.** and the device appears in the **Devices** list as **Online**. Select **Done**.

</Step>

</Steps>

The device keeps running after the machine restarts, as long as Docker starts with it. When Tale is updated, the device updates itself to the same release.

## Understand where sandboxes run

New agent and automation workspaces start on a connected device that has room. When none has, they start on the Tale server. A workspace stays with its files on the machine where it started, so an agent that already has a workspace on the server keeps using it. Pages rendered for website crawling always stay on the server.

When several devices have room, Tale considers both free slots and observed memory headroom. If a device refuses a create because it is full, another device or the server can take it. If the response is lost or the device returns a server error, retries stay on that device: it may already have created the workspace.

Once your organization has a device, the **Workspaces** list shows where each workspace runs: **On the server** or on a device by name. While a device is offline, work that needs one of its workspaces fails with a message that the device is not connected. Start the work again once the device is back online; workspaces never move to another machine by themselves.

Sandboxes on a device reach the internet through the machine's own connection, through the same egress proxy as on the server. The proxy blocks private network addresses, so sandboxes cannot reach other machines on your local network.

Connected devices also raise the ceiling for your organization's [workload limits](/platform/admin/sandboxes#change-a-workload-limit): their total may use the deployment capacity plus the sandboxes your devices run.

## Read the device list

| Column | What it shows |
| --- | --- |
| **Device** | The name the machine connected with, and its operating system. |
| **Status** | **Online**, **Updating**, **Update needed**, **Update failed** or **Offline**. |
| **Sandboxes** | Sandboxes running now, and how many the device runs at once. |
| **Machine** | CPUs and memory that Docker can use on the machine. |
| **Version** | The Tale release the device runs. |
| **Last seen** | **Now** while connected, otherwise when the device was last in contact. |

A device on another release than the server takes no new sandboxes until it updates. **Update needed** means the device does not update itself; **Update failed** means its last automatic update did not succeed. In both cases, run `tale sandbox update` on the machine.

## Look after a device from the machine

Run these commands on the device itself:

| Command | What it does |
| --- | --- |
| `tale sandbox status` | Shows the connection, the organization, the release and the sandboxes running now. |
| `tale sandbox logs --follow` | Follows the device's log. |
| `tale sandbox update` | Moves the device to the server's release now, with the server's current addresses for its sandboxes. |
| `tale sandbox disconnect` | Removes the device from its organization, stops its sandboxes and deletes their workspaces from the machine. Add `--keep-data` to keep the workspaces. |

## Remove a device

In the **Devices** list, open the device's row menu, select **Remove** and confirm. The device stops running sandboxes for your organization right away. Its workspaces stay on the machine but can no longer be reached from Tale, so their agents start with fresh workspaces the next time they run.

To clean up the machine as well, run `tale sandbox disconnect` on it.

## Fix a device that does not connect

- **The command has expired or was already used.** Select **Add device** again to get a new command.
- **The device started but has not reached the server yet.** Run `tale sandbox logs --follow` on the machine and check that it can open HTTPS connections to your Tale site, including through any proxy between them.
- **The connection fails with a certificate error.** The machine must trust your Tale site's TLS certificate. A deployment that uses a self-signed certificate cannot take devices.
- **Add device is unavailable, and the section says the sandbox service doesn't accept devices.** The deployment runs without its device hub. On a self-hosted deployment, the operator turns it on as described under [Sandbox devices](/self-hosted/configuration/environment-reference#sandbox-devices).
