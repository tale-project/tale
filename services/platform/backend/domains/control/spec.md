# Control — what the deployment's own endpoint lets an operator do

> **Prefix** `CTRL-`

The control endpoint is what `tale deploy`, `tale migrate` and `tale auth reset-owner` call on a
running deployment. Nobody signs in to it: a call is let in by the deployment's control token
alone. These rules cover who can call it, how a drain before a deploy behaves, and what a
deploy reads before it retires the model gateway an earlier release ran. Owner recovery and
re-seeding organizations are not covered; see Not yet.

## Who can call the control endpoint

### CTRL-R1 · The control endpoint exists only on a deployment that sets a control token

On a deployment without one, every call is answered as not found (`NOT_FOUND`), whatever it
presents.

- **Example**: A deployment sets no control token. The CLI asks for its drain status → not
  found, and the CLI carries on without a drain.

### CTRL-R2 · Every call to the control endpoint must present the control token

A call with no token, with another token, or with the token outside the `Bearer` scheme is
refused (`UNAUTHORIZED`).

- **Example**: Ada runs `tale deploy` against a deployment whose control token she mistyped →
  the call is refused, and nothing drains.

## Draining before a deploy

Before a deploy replaces the backend, it starts a drain: new chat turns are refused while the
ones already running finish, and the drained workers hand their automation runs on.

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

### CTRL-R5 · A drain also waits for the automation steps the drained copy is running

While a drain is active, what it waits for counts the automation runs that a worker of the
drained colour is stepping, and the agent turns whose drive window began before the drain. A
worker of the drained colour hands each run on to the other colour at its next step. With no
drain active, nothing of either is counted.

- **Example**: A deploy drains blue while Noah's nightly import is on its third step on a blue
  worker → the drain counts the run until blue hands it on after that step, and green continues
  it with the fourth.

## Retiring the model gateway

The model relay in the backend serves every agent turn and every call of an API key. Before it,
an earlier release ran a model gateway of its own, and the keys that gateway minted still settle
there: a key's spend is read at the gateway, then the key is revoked there. A deploy removes the
gateway once none of its keys is open, and keeps its data either way. A key stays open while
something will still read or revoke it at the gateway:

| What holds the key open                                       | Why it counts                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A turn whose spend is not booked, or whose key is not revoked | its own settle, its retry and the sandbox's sweep read the spend at the gateway, then revoke the key there         |
| A key a session still holds while the session is live         | the session's end (it expires, stops, is destroyed or deleted) revokes every key it holds                          |
| A key a deleted organization's teardown still has to revoke   | the organization's records are gone, and its teardown revokes the key at the gateway until it succeeds or gives up |

### CTRL-R6 · A deploy can ask how many keys the model gateway still has open

The answer counts each key once, whatever holds it. A key the model relay minted never counts,
and neither does a key a session left behind once it ended: only its turn, counted on its own,
still tries to revoke it.

- **Example**: Ada deploys while Noah's agent turn, started on a gateway key before the
  upgrade, still runs → the answer is 1, and the gateway stays. Once the turn's spend is booked
  and its key revoked, Ada's next deploy reads 0 and removes the gateway.

## Not yet

- **When a drain expires and which chat turns it waits for**: the expiry is 15 minutes after the
  drain begins, and a drain waits only for chat turns that started before it. No test holds either
  yet (`beginDrain`, `countActiveGenerations` in `service.ts`).
- **Owner recovery** (`tale auth reset-owner`): which password rules apply, that the owner is
  signed out everywhere, and what is refused (`NO_OWNER`, `EMAIL_IN_USE`,
  `PASSWORD_POLICY_VIOLATION`). No test holds these yet (`resetOwnerCredentials`).
- **Re-provisioning and the factory reseed** of every organization
  (`provisionAllOrganizations`, `reseedAllOrganizations`).
