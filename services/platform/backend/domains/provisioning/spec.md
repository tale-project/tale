# Provisioning — what a new organization starts with, and what a deploy never undoes

> **Prefix** `PROVN-`

A new organization is given a starter project with a few example tasks, and no automation:
the automations that ship with the product are templates a person picks from the template
catalog. The same step runs again for every organization when an operator runs `tale migrate`:
it adds the shipped configuration files an organization is missing, and the starter project to
an organization that has no project. A deploy alone does not run it. These rules say what
provisioning adds and what it leaves alone. The configuration files an organization is seeded
with are not covered; see Not yet.

## Automations

Provisioning adds no automation, and leaves every automation an organization has as it is.

### PROVN-R9 · A new organization starts with no automation

Creating an organization adds none of the automations that ship with the product. A person adds
one from the template catalog.

- **Example**: Ada creates an organization → its Automations list is empty; the starter project
  and its tasks are there.

### PROVN-R10 · Provisioning never adds, changes or removes an automation

An automation an organization already has keeps its versions, its trigger and its name, however
often provisioning runs again, and the templates a new release ships reach no organization on
their own.

- **Example**: Ada's organization has the Gmail sync it got from an earlier release. An operator
  runs `tale migrate` → its versions, trigger and how it is named are as they were, and a new
  release's templates do not appear in her automations.

## Starter content

### PROVN-R5 · Starter content is added only to an organization that has no project

A starter project with example tasks is created the first time. An organization that has any
project gets nothing more, however often provisioning runs.

- **Example**: Ada deletes the starter project and creates her own. An operator runs
  `tale migrate` → no starter project comes back.

### PROVN-R6 · The example tasks are assigned to nobody and mention nobody

Creating them notifies no one and starts no agent.

- **Example**: A new organization is created → its example tasks sit unassigned, and nobody
  gets a notification about them.

## Not yet

- **The configuration files an organization starts with**: agents, skills, models and
  policies copied from the shipped catalog (`domains/organizations/scaffold.ts`).
- **Re-provisioning every organization, and the factory reset**: see the control spec.
