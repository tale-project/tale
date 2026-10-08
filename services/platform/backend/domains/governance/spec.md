# Governance — which limits and policies apply to a person, and who can change them

> **Prefix** `GOV-` · **Suite** [`governance`](../../../tests/manual/suites/governance.md) · **Docs** [`admin/governance/policies-and-limits`](../../../../../docs/en/platform/admin/governance/policies-and-limits.md)

Governance is where an organization sets its spending limits, decides which models its people
can use, keeps its policies, and grants individual rights. These rules cover which limit
applies to whom, what happens at a limit, which models a person can use, who can read and
change a policy, and how a right is granted. Whose spend a piece of work is booked under is
written down in this domain's [`README.md`](README.md) and in the sandbox spec; the trash,
content moderation and the usage pages are mostly not covered; see Not yet.

## Spending limits

A limit caps tokens, cost or the number of requests over a day, a week or a month. It is set
for one person, for a team, for a role, for an API key, for a project, or as the default for
everyone.

### GOV-R1 · The most specific limit decides what one person can spend

A limit set for the person wins over their team's, the team's over their role's, and the
role's over the default. Each of the three kinds of limit is settled on its own, so a person
can have their own cost limit and still be held to the default token limit. Someone in several
teams is held to the strictest of those teams' limits.

- **Example**: The default cost limit is 50 a month, and Mia's own is 200 → Mia can spend 200.
  The default token limit still applies to her, because she has none of her own.

### GOV-R2 · A team's limit caps the team as a whole, whatever its members' own limits are

A team's limit is measured against what all its members spent together. A member whose own
limit is higher is still stopped when the team's total is reached. Each team is measured
against its own limit.

- **Example**: The Finance team is capped at 500 a month and has spent 500. Mia, in Finance,
  has a personal limit of 200 and has spent 20 → her next request is refused.

### GOV-R3 · An API key's limit is counted apart from its holder's

What a key spent is measured against the key's own limit. A key's limit never loosens or
tightens the limit of the person it belongs to, and the reverse.

- **Example**: Mia's reporting key is capped at 10 a month and has used it up → calls with
  that key are refused, and Mia can still chat in the app.

### GOV-R14 · A project's limit caps everything spent in the project, whoever spends it

What a project spent is everything done in it: its chats (their titles, the answers read aloud,
the recordings transcribed in them, even before a new chat's first message, the files indexed for
them and the assistant's tool calls and searches included), the turns of its agents and the agent
and `llm` steps of the automations run in it, with the images they make, and the calls made with
its own API keys. Its limit binds that work on top of the limits of whoever asked for it, a run a
schedule started included, and binds nothing done outside the project. A run that names no
project, of an automation installed in several projects, is each one's work: it counts toward,
and must fit, every one of their limits, as a member's spend counts toward each of their teams.

- **Example**: The Website project is capped at 100 a month and has spent 100. Mia, far from
  her own limit, writes in one of the project's chats → refused, naming the project's limit.
  She can still chat outside the project.

### GOV-R4 · Work over a limit is refused, and the refusal names the limit

The refusal says whose limit it is, which kind (`TOKEN_LIMIT`, `COST_LIMIT`, `REQUEST_LIMIT`)
and when it resets. When several limits are reached, the token limit is named first.

- **Example**: The organization's monthly cost limit is reached. Mia sends a chat message →
  refused, with a message that it is the organization's cost limit and when it resets.

### GOV-R5 · Work in progress counts against a limit before it is paid for

What running work may still cost is set aside against the person's and the organization's
limits, so several things started at the same moment cannot overrun a limit together: a chat
reply's every round as it starts, an agent's allowance, a voice chunk's estimate, and the
estimated largest cost of a call Tale makes straight to a model — an automation's `llm` step, a
chat's title, a rewrite with Improve with AI, a transcription at the recording's length, each
embedding request of knowledge indexing and search. Such a call is refused when a limit has too
little room for that cost; a chat's title is then made from the first message, without a call, and
indexing waits for the limit (`KNOW-R18`). With no limit set, work gets the deployment's default
allowance.

- **Example**: Two agents are working for Mia and hold most of what is left under her limit.
  She starts a third → it gets only what remains, or is refused.

### GOV-R15 · A connector call is counted on its own, never as a model request

Every call Tale makes through a connector is counted as a connector call, at no cost, under whoever
made it and with the API key it came with: the assistant's search and web tools, an agent's or an
automation's connector step, an email sent from the Inbox. A request limit counts model requests
alone, so connector calls never use it up.

- **Example**: Mia's rule allows 20 requests a day and she has used 19. Her next chat reply
  searches the documents five times → the reply runs, and its searches add nothing to her
  requests.

### GOV-R6 · A warning comes before a limit is reached, for each limit on its own

The organization's limit, an API key's limit and a person's limit each have their own warning
threshold, and each is measured against its own usage.

- **Example**: The organization has used 85% of its monthly limit, and the warning threshold
  is 80% → a warning is shown, although Mia's own limit is far from reached.

### GOV-R7 · A member can see the limits that apply to them, with what they have used

- **Example**: Mia opens her budget → she sees her limits, including her team's, and how much
  of each is used.

## Which models a person can use

### GOV-R8 · The most specific model rule decides which models a person can use

A rule for the person wins over their team's, the team's over their role's, and the role's
over the default. Someone in several teams can use the models any of their teams allows. With
no rule at all, every model is available.

- **Example**: The default allows two models, and Mia's team allows a third → Mia can use the
  model her team allows.

### GOV-R9 · A blocked model stays blocked, even where a list allows it

- **Example**: A rule both allows and blocks the same model → the model cannot be used.

## Policies

### GOV-R10 · A member can read only the policies meant for every member

Those are the ones the app needs to show a member what applies to them: the data
classification notice, the feature switches, the handling of personal data, the chat filter,
custom instructions, the upload rules, the default models and the idle sign-out. Owners and
admins can read every policy.

- **Example**: Mia, a member, asks for the organization's spending policy → refused. She asks
  for the upload rules → she gets them.

### GOV-R11 · A policy change is saved only together with its audit entry

The change and the entry that records it stand or fall together: when the audit entry cannot
be written, the policy stays as it was. The entry records the policy as it really was before
the change.

- **Example**: Ada tightens the upload rules while the audit log cannot be written → the save
  fails, and the upload rules are unchanged.

## Rights an admin grants

Some rights are not tied to a role: exporting notifications, publishing a skill for everyone,
calling the model API. An admin grants one to a person, with or without an end date.

### GOV-R12 · Only an admin can grant a right, and only one the platform knows

Someone who is not an admin is refused (`COMPETENCE_FORBIDDEN`) before the request is looked
at, so nobody can grant themselves a right. A name in the platform's own namespace that is
not one of its rights is refused (`COMPETENCE_CAPABILITY_UNKNOWN`), and the refusal is written
to the audit log. An organization's own competences can be named freely.

- **Example**: Mia sends a request that grants herself the right to export notifications →
  refused.

### GOV-R13 · A granted right holds until its end date, or until it is withdrawn

It counts only in the organization it was granted in.

- **Example**: Ada grants Mia the right to call the model API until the end of the month → on
  the first of next month Mia's calls are refused again.

## Not yet

- **Whose spend a piece of work is booked under**: the rules are in
  [`README.md`](README.md); the sandbox spec states them for agent turns.
- **The trash**: what can be restored, and that restoring a chat restores its branches with
  it (`trash.ts`).
- **Changes that loosen a policy**: shortening a retention period or relaxing the rules for
  erasure requests takes effect only after a waiting time, and can be cancelled meanwhile
  (`settings-tail.ts`).
- **Content moderation**, guardrails and the handling of personal data in prompts
  (`moderation.ts`).
- **API keys**: creating, listing and revoking one (`api-keys.ts`).
- **The usage pages** and their figures (`usage-metrics.ts`).
- **A project's limit warns no one** before it is reached.
- **Nothing in the database forbids a start marker in place of a person in the usage
  ledger**, and **the per-turn usage table is retired but not dropped**; the contract debt
  ledger in [`.agents/repo.md`](../../../../../.agents/repo.md) records both.
