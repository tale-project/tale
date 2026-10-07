# Agent secrets — what an organization's stored secrets guarantee

> **Prefix** `ASEC-` · **Docs** [`admin/agents`](../../../../../docs/en/platform/admin/agents.md)

An organization stores secrets by name, such as an access token, and grants them to agents. A
running agent reads a granted secret as an environment variable of that name. These rules
cover how a secret is named, saved and shown. Who can manage secrets and how a secret reaches a
running agent are not covered; see Not yet.

## Naming and saving a secret

### ASEC-R1 · A secret's name is one an environment variable can have

Letters, digits and underscores, not starting with a digit. Any other name is refused
(`invalid`).

- **Example**: Ada saves a secret named `MY-TOKEN` → refused, because of the hyphen.
  `MY_TOKEN` is accepted.

### ASEC-R2 · Saving under a name that exists replaces the value

There is one secret per name in an organization. The audit log records the first save as a
creation and each later one as an update.

- **Example**: Ada saves a new value for `OPENAI_API_KEY`, which already exists → the value is
  replaced, and the audit log records an update.

### ASEC-R3 · An organization holds at most 200 secrets

A secret under a new name is refused once 200 others exist (`AGENT_SECRET_LIMIT`), and nothing
is saved. Replacing the value of a secret the organization already holds stays possible.

- **Example**: Ada's organization holds 200 secrets. She saves one under a new name → refused.

## What is shown of a secret

### ASEC-R4 · A secret's preview shows only its first four and last three characters

The part between them is masked with the same width whatever the length of the secret, so the
preview does not reveal how long the secret is. A secret too short to show safely has no
preview at all.

- **Example**: Ada saves the token `ghp_abcdefghijklmnop` → the list shows `ghp_••••nop`.

## Not yet

- **Who can manage secrets**: saving and deleting need the admin or developer role, and
  anyone else gets an empty list. No test holds these yet (`routes.ts`).
- **A stored value is never returned**: the list carries the name, the description and the
  preview only. No test holds it yet (`listAgentSecrets` in `service.ts`).
- **How a secret reaches a running agent**, and the audit entry written each time one is
  handed over (`resolveAgentSecretsEnv` in `service.ts`).
- **Deleting a secret** that agents still name: the grant stays on the agent and has no effect.
- **Limits on length**: a value up to 8,192 characters, a description up to 300.
