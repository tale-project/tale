# Sandbox devices — who can connect a machine, and what a connected machine can do

> **Prefix** `SBXDEV-` · **Docs** [`admin/sandbox-devices`](../../../../../docs/en/platform/admin/sandbox-devices.md)

A device is a machine an organization connects so that its sandboxes run there instead of on
the Tale server. An admin gets a connect command, runs it on the machine, and the machine
trades the command's token for a credential of its own. These rules cover who can manage
devices, what a connect command is good for, how a device proves itself, and what removing
one does. The live status shown in the device list is not covered; see Not yet.

## Who can manage devices

| | See the devices | Add or remove a device |
| --- | --- | --- |
| An owner or admin | yes | yes |
| A developer | yes | no |
| A member | no | no |

### SBXDEV-R1 · Owners, admins and developers can see their organization's devices

A member is refused.

- **Example**: Mia is a member. She opens the device list → refused.

### SBXDEV-R2 · Only owners and admins can add or remove a device

A developer can see the devices and is refused both.

- **Example**: Noah has the developer role. He selects **Add device** → refused, and no
  connect command is created.

## The connect command

### SBXDEV-R3 · A connect command's token is shown once and works once

Only a fingerprint of the token is kept. A token that was already used, has expired or was
never issued is refused (`JOIN_TOKEN_INVALID`).

- **Example**: Ada runs her connect command on a second machine after it worked on the first →
  refused. She creates a new command for the second machine.

### SBXDEV-R4 · Only the admin who created a connect command can check whether it was used

For anyone else the command is answered as not found (`JOIN_TOKEN_NOT_FOUND`): another admin
of the same organization gets the same answer as someone in another organization, and as a
command that never existed.

- **Example**: Ada creates a connect command. Another admin of her organization asks for its
  status → not found.

### SBXDEV-R5 · An organization has a ceiling on unused connect commands and on devices

A connect command past the ceiling of unused ones is refused (`JOIN_TOKEN_LIMIT`). A machine
that joins when the organization already has its full number of devices is refused
(`DEVICE_LIMIT`).

- **Example**: Ada's organization has as many devices as it can have. She connects one more →
  the machine is refused.

### SBXDEV-R6 · Repeated refused attempts to join from one network address are held back

Each refused token counts against the address it came from; past the allowance, further
attempts are refused for a while without being checked. The address is the real one of the
caller: a header set by an unknown sender does not change it.

- **Example**: A script tries one guessed token after another from the same address → after
  the allowance it is told to slow down, and its guesses are no longer checked.

## A connected device

### SBXDEV-R7 · A device proves itself with its own secret on every request

A request without the secret is refused (`DEVICE_CREDENTIAL_MISSING`), and one with the secret
of a removed or unknown device is refused (`DEVICE_REVOKED`). Asking for a connection ticket,
reading its own status and removing itself all use the same secret.

- **Example**: Ada removes a device. The machine asks for a new connection ticket with the
  secret it still holds → refused.

### SBXDEV-R8 · A device can act only as itself, for its own organization

The ticket a device gets for its connection names that device and its organization, whatever
the request says.

- **Example**: A connected machine asks for a ticket → the ticket names that machine and the
  organization that connected it, and no other.

## Removing a device

### SBXDEV-R9 · An admin can remove only a device of their own organization

A device of another organization is answered as not found (`DEVICE_NOT_FOUND`).

- **Example**: Zoe, an admin of another organization, removes Ada's device by its ID → not
  found, and the device stays connected.

### SBXDEV-R10 · A removal stands at once, and the device's connection is cut as soon as possible

Removing a device is recorded and written to the audit log immediately. When the connection
cannot be cut at that moment, the removal is not undone: cutting it is tried again until it is
confirmed.

- **Example**: Ada removes a device while the connection service is unreachable → the device
  is removed, and its connection is cut once the service answers again.

### SBXDEV-R11 · A device can remove itself

A machine that holds its secret can leave the organization without an admin.

- **Example**: Ada runs the disconnect command on a connected machine → the device is removed
  from her organization.

## Not yet

- **What the device list shows**: online, updating, outdated, failed, offline, and why
  nothing is live (`listDevices` in `service.ts`).
- **How long a connect command is good for** (an hour, as the user docs say) and the sizes of
  the ceilings in `SBXDEV-R5`: no test holds the numbers.
- **A deployment without a sandbox service** refuses a connect command
  (`SANDBOX_NOT_CONFIGURED`).
- **The addresses a device connects to**, and how its connection ticket is verified
  (`settings.ts`, `ticket.ts`).
