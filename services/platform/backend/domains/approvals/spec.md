# Approvals — when a write waits for a person, and who can decide

> **Prefix** `APV-` · **Suite** [`approvals`](../../../tests/manual/suites/approvals.md) · **Docs** [`approvals/concepts`](../../../../../docs/en/platform/approvals/concepts.md)

An automation or an agent can reach a step that writes through a connector. Some of those
writes wait until a person approves them. These rules cover which writes wait, who can see and
decide an approval, and what a decision does. Questions an agent asks a person, and the review
of a task or a document, are not covered; see Not yet.

## Which writes wait for approval

### APV-R1 · A write to an outside system waits for approval; an internal one runs

This is the default when the organization has set no policy, and an empty policy means the
same.

- **Example**: An automation sends an email through a mail connector, and the organization has
  no approval policy → the run pauses and an approval card appears.

### APV-R2 · An organization's policy can add or lift the wait for a connector or an action

It can require approval for a connector that is internal, and it can let one action of an
outside connector run without approval.

- **Example**: Ada's organization requires approval for writes to its internal product list →
  an automation that updates a product pauses for approval.

### APV-R3 · A rule for one action beats a rule for its connector, and a later rule an earlier

When two rules of the policy apply to the same write, the one that names the action wins over
the one that names the whole connector. Between two rules that are equally specific, the one
written later wins.

- **Example**: The policy requires approval for a connector and lifts it for that connector's
  "add a note" action → adding a note runs without approval, and every other write waits.

### APV-R4 · A policy that cannot be read stops the write

When the organization's policy is missing its storage or is not valid, the write fails
instead of running unapproved. An approval that was already waiting stays as it is.

- **Example**: Someone saves an approval policy with a mistake in it → writes through
  connectors fail with a message that the policy is unavailable or invalid, until it is fixed.

### APV-R5 · One write gets one approval card, however often the run reaches it

A run that is retried or resumed at the same write finds the card it already has. Two
attempts at the same moment share one card.

- **Example**: A run pauses for approval, the server restarts, and the run picks up at the
  same step → the same card is waiting, and no second one appears.

### APV-R6 · An approval lets its write run once

Once the approved write has run, the approval is used up.

- **Example**: Ada approves a write and the run carries it out → the approval is marked
  completed and cannot carry out the write again.

## Who can see and decide an approval

| The approval belongs to | Can see the card | Can approve or reject |
| --- | --- | --- |
| a run in a project | anyone who can read the project | anyone who can change the project |
| a run of the organization, or no run | any member | any member |
| an erasure request | | owners and admins only |

### APV-R7 · An approval of a project's run follows who can read and change that project

Someone who cannot read the project gets the card answered as not found, for reading and for
deciding. Someone who can read the project and not change it sees the card and is refused the
decision (`RBAC_FORBIDDEN`). An approval that names a run which does not exist is answered as
not found.

- **Example**: Mia can read the project and cannot change it. She opens the approval card of a
  run in it and selects **Approve** → she sees the card, and the decision is refused.

### APV-R8 · Any member can decide an approval that belongs to no project

This covers a run of the organization itself and an approval that belongs to no run.

- **Example**: An organization-wide automation pauses for approval. Mia, a member, approves it
  → accepted.

### APV-R9 · Only owners and admins can decide an erasure approval

Every other role is refused, the developer role included.

- **Example**: Noah has the developer role. He approves a request to erase a person's data →
  refused.

### APV-R10 · A task review or a document review cannot be decided as an approval

Those reviews have their own way of being answered. Deciding one through the approval card is
refused (`APPROVAL_REQUIRES_DEDICATED_RESPOND`) and the review stays as it was.

- **Example**: A request tries to approve a task's review through the approval card → refused,
  and the review is still waiting.

## What a decision does

### APV-R11 · An approval is decided once, and its run is woken once

A second decision on the same approval is refused and wakes nothing. A decision that was saved
stands even when waking the run fails at that moment.

- **Example**: Mia and Noah both select **Approve** on the same card → the first decision is
  saved and the run continues once; the second is refused.

## Not yet

- **Questions an agent asks a person** (the ask card) and their answers: the automations
  domain.
- **Task reviews and document reviews** (`APV-R10`): the tasks and documents domains.
- **What a rejection does to the run**: the step and the run fail, as the user docs say. No
  test here holds it; an integration lane does (`decide-resume.integration.ts`).
- **Approvals have no REST twin**: the contract debt ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records it.
