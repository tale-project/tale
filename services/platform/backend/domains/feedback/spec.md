# Feedback — who can rate a reply, and who can read the ratings

> **Prefix** `FDBK-` · **Docs** [`admin/governance/feedback-analytics`](../../../../../docs/en/platform/admin/governance/feedback-analytics.md)

People rate the assistant's replies in chat with a thumb up or down and an optional comment,
and judge pairs of answers in arena mode. These rules cover which replies a person can rate,
what a rating records, who can read the comments, and how the statistics count. Changing or
withdrawing a rating and the list of recent feedback are not covered; see Not yet.

## Rating a reply

### FDBK-R1 · A person can rate only a reply they can read

That is a reply in a thread of their own, or in a thread shared with a project they can read.
Any other reply is answered as not found (`MESSAGE_NOT_FOUND`) and nothing is recorded: a
reply in another member's private thread gets the same answer as one that does not exist.

- **Example**: Mia sends a rating for a reply in Noah's private thread → not found, and no
  rating is recorded.

### FDBK-R2 · A rating records the model and assistant that wrote the reply

The model, its provider and the assistant are read from the reply itself. Whatever the
browser sends about them is ignored, and so is an arena verdict sent with a thumb rating. A
reply from a plain chat is recorded with no assistant.

- **Example**: A modified browser sends a thumb up that claims another model wrote the reply →
  the rating is recorded under the model that did write it.

## Reading comments

### FDBK-R3 · Only owners and admins can open a comment someone left

A member is refused before any comment is read.

- **Example**: Mia is a member. She asks for the full text of a comment in the feedback list →
  refused.

### FDBK-R4 · A comment can be opened only in its own organization, and not from the trash

A comment of another organization, and one whose feedback was moved to the trash, are both
answered as not found.

- **Example**: Ada opens a comment whose feedback was moved to the trash → not found.

## Counting the ratings

### FDBK-R5 · Statistics over a very large period stop at a limit and say they are partial

- **Example**: Ada picks a 90-day period that holds more ratings than the limit → the figures
  count ratings up to the limit, and the answer says the results are partial.

### FDBK-R6 · An arena verdict never counts toward an assistant's or a model's ratings

The tables of assistants and models count thumb ratings only. Arena verdicts have their own
table of model pairs.

- **Example**: Mia prefers the left answer in an arena round → the pairing's row changes, and
  neither model's thumb counts move.

### FDBK-R7 · An arena verdict on two copies of one model is counted apart

It is left out of the table of model pairs and out of the verdict totals, and reported as its
own figure, so the totals equal the table.

- **Example**: Mia judges an arena round where both answers come from the same model → it is
  counted under **Same model**, not as a win for either side.

## Not yet

- **Changing and withdrawing a rating**, and reading one's own ratings in a thread
  (`service.ts`).
- **Who can read the statistics and the list of recent feedback**: owners and admins. Only the
  comment (`FDBK-R3`) has a test yet (`routes.ts`).
- **The size of the limit** in `FDBK-R5`: the user docs say 50,000 ratings; no test holds the
  number.
- **Limits on a comment's length**, and how a long comment is shortened in the list.
