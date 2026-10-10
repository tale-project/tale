# Provisioning — what a new organization starts with, and what a deploy never undoes

> **Prefix** `PROVN-`

A new organization is given the automations that ship with the product and a starter project
with a few example tasks. The same step runs again at every deploy, so that new shipped
automations reach existing organizations. These rules say what provisioning adds and what it
leaves alone. The configuration files an organization is seeded with are not covered; see Not
yet.

## Shipped automations

### PROVN-R1 · An organization gets every shipped automation it does not have

Each is saved as its first version, in the name of the system.

- **Example**: A new release ships an automation that did not exist before. An existing
  organization is provisioned again at the deploy → it gets that automation.

### PROVN-R2 · Provisioning adds no version to an automation the organization already has

The organization's own versions decide how the automation behaves. Running provisioning any
number of times changes nothing a run could observe.

- **Example**: Ada's organization edited a shipped automation and saved version 2. A deploy
  provisions the organization again → version 2 is still the newest, and nothing was added.

### PROVN-R3 · An automation the organization deleted is never brought back

- **Example**: Ada deletes a shipped automation her organization does not use. The next deploy
  provisions the organization again → the automation stays deleted.

### PROVN-R4 · A catalog that cannot be read is reported, not taken for an empty one

Provisioning that cannot read the shipped automations says so. It does not conclude that
there is nothing to add.

- **Example**: The folder of shipped automations is unreadable on a server → provisioning
  reports the catalog as unreadable.

### PROVN-R7 · A shipped automation's trigger is added switched off, and only once

The trigger a shipped automation comes with is added when the organization has none for it,
switched off unless the automation says it starts on. Nothing is deployed yet, so it could
start no run; deploying a version offers to turn it on. A trigger the organization already
has, its own or an earlier one, is left as it is.

- **Example**: A new organization gets the Gmail sync automation → its five-minute schedule is
  there and off. Ada deploys a version → the editor offers to turn the schedule on.

## Starter content

### PROVN-R5 · Starter content is added only to an organization that has no project

A starter project with example tasks is created the first time. An organization that has any
project gets nothing more, however often provisioning runs.

- **Example**: Ada deletes the starter project and creates her own. A deploy provisions the
  organization again → no starter project comes back.

### PROVN-R6 · The example tasks are assigned to nobody and mention nobody

Creating them notifies no one and starts no agent.

- **Example**: A new organization is created → its example tasks sit unassigned, and nobody
  gets a notification about them.

## Not yet

- **The configuration files an organization starts with**: agents, skills, models and
  policies copied from the shipped catalog (`domains/organizations/scaffold.ts`).
- **Refreshing how a shipped automation is presented** (its name and description as shown)
  without touching its behaviour.
- **Re-provisioning every organization, and the factory reset**: see the control spec.
