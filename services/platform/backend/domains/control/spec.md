# Control — what the deployment's own door lets an operator do

> **Prefix** `CTRL-`

The control door is what `tale deploy`, `tale migrate` and `tale auth reset-owner` call on a
running deployment. Nobody signs in to it: a call is let in by the deployment's control token
alone. These rules cover who can call the door and how a drain before a deploy behaves. Owner
recovery and re-seeding organizations are not covered; see Not yet.

## Who can call the control door

### CTRL-R1 · The control door exists only on a deployment that sets a control token

On a deployment without one, every call is answered as not found (`NOT_FOUND`), whatever it
presents.

- **Example**: A deployment sets no control token. The CLI asks for its drain status → not
  found, and the CLI carries on without a drain.

### CTRL-R2 · Every call to the control door must present the control token

A call with no token, with another token, or with the token outside the `Bearer` scheme is
refused (`UNAUTHORIZED`).

- **Example**: Ada runs `tale deploy` against a deployment whose control token she mistyped →
  the call is refused, and nothing drains.

## Draining before a deploy

Before a deploy replaces the backend, it starts a drain: new chat turns are refused while the
ones already running finish.

### CTRL-R3 · A drain stops new chat turns only on the copy of the backend it names

A blue-green deploy runs two copies of the backend at once, the old colour and the new one,
and its drain names the old colour. A drain that names no colour stops every copy. A copy that
has no colour of its own obeys every drain.

- **Example**: A deploy brings up green and drains blue → blue refuses new chat turns, and
  green keeps answering.

### CTRL-R4 · A drain stops on its own once its expiry passes

A deploy that dies in the middle of a drain cannot keep chats refused.

- **Example**: A deploy starts a drain and crashes before ending it. The drain's expiry passes
  → chat turns are accepted again, and nobody had to end the drain.

## Not yet

- **When a drain expires and what it waits for**: the expiry is 15 minutes after the drain
  begins, and a drain waits only for chat turns that started before it. No test holds either
  yet (`beginDrain`, `countActiveGenerations` in `service.ts`).
- **Owner recovery** (`tale auth reset-owner`): which password rules apply, that the owner is
  signed out everywhere, and what is refused (`NO_OWNER`, `EMAIL_IN_USE`,
  `PASSWORD_POLICY_VIOLATION`). No test holds these yet (`resetOwnerCredentials`).
- **Re-provisioning and the factory reseed** of every organization
  (`provisionAllOrganizations`, `reseedAllOrganizations`).
