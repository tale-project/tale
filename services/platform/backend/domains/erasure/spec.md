# Erasure — what a request to erase a person's data does, and what stops it

> **Prefix** `ERASE-` · **Docs** [`admin/governance/data-subject-requests`](../../../../../docs/en/platform/admin/governance/data-subject-requests.md)

An admin can file a request to erase the data of one person, for example after that person
asked for it. The request leaves a receipt that shows how far it got. These rules cover what
stops an erasure, what a retry does, and what an erasure does to the work the person started.
Who can file and approve a request, and the full list of what is erased, are not covered; see
Not yet.

## Legal holds

### ERASE-R1 · Data under a legal hold is not erased

A request for a person who is under a hold, or in an organization that is, is filed as
blocked (`LEGAL_HOLD_BLOCKS_ERASURE`): the receipt exists and records the hold, and nothing is
erased. A hold that is placed after the request was filed stops it the same way when it comes
to run, and that is written to the audit log.

- **Example**: The organization is under a legal hold. Ada files a request to erase Noah's
  data → the receipt reads blocked, and Noah's data is untouched.

### ERASE-R2 · A blocked receipt says whether the hold still applies

Each time a blocked receipt is read, the holds are checked again. It names the hold that
still covers the person, or says that the hold has been released.

- **Example**: The hold on Noah is released. Ada opens the blocked receipt → it says the hold
  was released, so she can retry.

## Retrying a request

### ERASE-R3 · Retrying a request that was blocked when filed starts its approval again

It does not run at once. Where the organization requires a second admin's approval, it waits
for that approval; where it requires a waiting period, the period starts over.

- **Example**: The organization requires two admins for an erasure. Ada retries a request that
  was blocked when she filed it → it waits for another admin's approval.

### ERASE-R4 · Retrying a request that got part of the way continues at once

A request that started and did not finish, or was blocked when it came to run, is run again
without a new approval. A request that has finished in the meantime is not run again
(`NOT_RETRIABLE`).

- **Example**: An erasure removed most of Noah's data and failed on one step. Ada retries it →
  it runs again straight away.

## What an erasure does

### ERASE-R5 · An erasure removes or strips the person's name from the work they started

| What the person started | What happens to it |
| --- | --- |
| automation runs | deleted |
| runs of a project agent | kept, with the person's identity replaced by a pseudonym |
| finished requests to the model API | deleted |
| requests to the model API still in progress | kept, with the person's identity replaced by a pseudonym |
| finished model calls Tale made for them (an automation's `llm` step, a chat title, Improve with AI, a transcription, the embeddings of their uploads and searches) | deleted |
| such model calls still in progress | kept, with the person's identity replaced by a pseudonym, so their cost is booked under it |
| a website scan a usage limit stopped while it was theirs to pay for | kept, no longer naming them: it resumes as the organization's |

The receipt counts each of these steps.

- **Example**: Noah started twelve automation runs. Ada's erasure of Noah completes → the
  twelve runs are gone, and the receipt counts them.

### ERASE-R6 · A review that waited on the erased person is handed to the next reviewer

A task or document that was waiting for that person's review does not stay stuck: it goes to
whoever is next in line for it, and what still names the person is then replaced by a
pseudonym. A review that was given to someone else in the meantime stays with them. When the
hand-over fails, the person's name is still removed.

- **Example**: A task was waiting for Noah's review when his data is erased → the review goes
  to the next reviewer, and the task no longer shows Noah's name.

## Filing a request

### ERASE-R7 · A request states one of the listed reasons

A reason that is not on the list is refused.

- **Example**: A request arrives with a reason the form does not offer → refused.

### ERASE-R8 · Too many requests in a short time are refused, and the refusal is recorded

A request over the limit is written to the audit log as denied. When the limit itself cannot
be checked, the request fails with an error; it is not recorded as a denial.

- **Example**: A script files erasure requests in a loop → after the limit they are refused,
  and each refusal is in the audit log.

## Not yet

- **Who can file, approve and retry a request**, and the second admin's approval itself: see
  the approvals spec for who can decide an erasure approval.
- **Everything else an erasure removes**: chats, documents, files, preferences and the rest
  (`service.ts`). An integration lane covers the hand-over of reviews; the guard does not read
  it.
- **The waiting period** before an approved request runs, and the receipt's states.
- **A request that takes too long**: it is ended with a message and can be retried.
