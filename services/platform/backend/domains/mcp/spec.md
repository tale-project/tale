# MCP — what a coding agent can do through Tale's MCP endpoint

> **Prefix** `MCP-` · **Suite** [`mcp`](../../../tests/manual/suites/mcp.md) · **Docs** [`automations/assistant`](../../../../../docs/en/platform/automations/assistant.md)

The rules of the door a coding agent uses to work in Tale, `/api/v1/mcp`: whom a call acts as and
what the key holder's role lets it read and change, how an agent's save, deploy and runs meet the
editor's rules, how a settings change is checked and that no secret travels with it, how a refusal
or a bad argument reaches the agent, what a request and a batch of calls cost, what is kept of a
call, and which protocol revisions the endpoint speaks. The rest of
what a call does once it reaches an automation, the capability surface, and the tool inventory
itself are not covered; see Not yet. Resources and prompts are reads the tools already answer, and
the Tale skill is the one file an agent installs to work here.

## Who can do what

A call acts as the person who holds the API key, in the organization the key names, with that
person's role in it at the time of the request.

|                                                                              | Owner, admin or developer | Any other member                |
| ---------------------------------------------------------------------------- | ------------------------- | ------------------------------- |
| Save a version, deploy one, delete an automation, set or remove a trigger    | yes                       | no                              |
| Install an automation in projects or remove it from them                     | yes                       | no                              |
| Start or stop a live run                                                     | yes                       | no                              |
| Read, validate and test automations, run them on the mocks, start a mock run | yes                       | yes                             |
| Answer a run's question                                                      | yes                       | yes, in a project they can edit |

Reads and runs reach only the automations the app would show the person (MCP-R9).

### MCP-R17 · Only owners, admins and developers can save, deploy or set a trigger over MCP

Saving a version, deploying one, deleting an automation, installing it in projects or removing
it from them, and setting or removing a trigger take the owner, admin or developer role, and so do
starting a live run (`run_deployed`, `start_run`) and stopping one (`cancel_run`), as the
[automation rules](../automations/spec.md) (`AUTO-R1`) say. Anyone else's agent gets a refusal it
can read (`FORBIDDEN_DEVELOPER_SETTINGS`) before anything runs or is charged, and nothing is
saved, deployed, deleted, installed, bound, started or stopped. Reading, validating, testing and
running on the mocks, a mock start included (MCP-R4), stay open to every member.

- **Example**: Mia is an ordinary member. Her coding agent saves a new version of
  `billing/dunning` → refused, and no version is saved; it then lists the automations → they are
  listed.
- **Example**: Noah is a developer. His agent saves the same version → it is saved.

### MCP-R9 · A member's agent reads only the automations the app would show them

An automation installed only in projects the person cannot read is "not found" on every read over
MCP — the automation, its versions, its deployments and its trigger — exactly like one that does
not exist, so the answer never confirms it does. An organization
automation, and one installed in a project the person can read, read as before; the installations
a read names are the ones the person can see. The REST API answers the same way (`AUTO-R27`). A
save that would add a version to such an automation is refused as a name already taken
(`AUTOMATION_NAME_TAKEN`), whatever `create` says: it would change what the person cannot see,
and its answer would reveal it.

- **Example**: Mia, an ordinary member, is not in the HR team. `hr/onboarding` is installed only in
  a project shared with that team. Her agent asks for it, its versions and its trigger → "not
  found" each time; it lists the automations → `hr/onboarding` is not among them.
- **Example**: Noah, a developer outside the HR team, has his agent save `hr/onboarding` without
  `create` → refused as a taken name, and no version is added; the agent picks another name.

## A coding agent that signed in

An agent can call the endpoint with an access token instead of a key, once its person connected it
from the agent (see the [agent connections](../agent_connections/spec.md)). The call acts as that
person, in the organization the connection was made for, with their role at the time of the request,
as a key's does — and the connection adds one limit more: the access the person allowed.

### MCP-R40 · What a person allowed an agent narrows their role and never widens it

A connection holds the access its person allowed when they connected the agent: reading and
testing, editing, editing and deploying, and reading or changing settings. A call needs both the
role of its tool and the access of its tool; without either it is refused. The role is judged first,
so a person whose role cannot do something is told so, not told to ask for more. A run started on
the mocks and the plan of a replay need only reading and testing; a live start needs deploying. A
key holds no such access: its person's role alone decides.

- **Example**: Ada, a developer, connected Cursor to read and test. Cursor starts a mock run →
  it runs. It starts a live one → refused, asking for "Edit and deploy". Mia, a member, connected
  hers to read and test; her agent saves an automation → refused as her role's, with nothing to ask for.

### MCP-R41 · A request that needs missing access runs nothing and says what to ask for

When any call in a request needs access the connection lacks and its person could allow, the whole
request is refused with 403 `INSUFFICIENT_SCOPE` and none of its calls run, so a batch is never half
done. The answer carries a challenge that names the access to ask for together with all the connection
already holds, so asking again never drops what the agent had. Calls that the person's role could never
allow are not refused this way: each is refused as a tool error, since asking would change nothing. The
handshake, the lists and a notification are never refused for access.

- **Example**: Cursor sends a batch that reads a run and then deploys an automation, holding reading and
  editing → 403, nothing ran, and the challenge asks for reading, editing and deploying.

### MCP-R42 · What a connection's call leaves behind names the connection

A call made through a connection writes as its person through the MCP door, as a key's does, and names
the connection where a key's names the key: the audit rows it writes carry the connection and the app
(or the client name the call gave), a version it saves records the MCP door and the app, and its
counters are kept under the connection, which is where its "last used" is read from. A connection is
not a key, so the budgets and the spend of a key do not see it; its person's do.

- **Example**: Ada's Cursor saves a version of Dunning → the version says it was saved through MCP by
  Cursor, the audit row names Ada's connection, and the connection's last use moves to now.

## Saving, deploying and deleting

An agent saves, deploys and deletes through the same store the editor does, with the same rules
(`AUTO-R3`, `AUTO-R4`, `AUTO-R15`). What it adds is what an agent needs that a person at a screen
does not: to send only what it changes, and to say which version its change started from.

### MCP-R1 · An agent's save keeps the settings, task contract and presentation it leaves out

A version carries, beside its document, the settings form the task screen shows, the task contract
and the presentation on the automations list. An agent's save that leaves one of them out keeps
the latest version's, read when the save lands so no save in between is lost; `null` stores none;
a value is checked against the schema the app reads it with and stored, or the save is refused
(`INVALID_ARGUMENTS`) with every problem. The answer's `carried` names what was kept.

- **Example**: Ada's agent saves v6 of `billing/dunning` with one new node and nothing else → v6
  has v5's settings form and task contract, `carried` names them, and Ada's task screen still
  shows the form.

### MCP-R2 · A save that started from an older version is refused, naming the latest one

A save that names the version the agent's edit started from (`baseVersion`) is refused
(`AUTOMATION_VERSION_STALE`) when another version was saved since, with the latest version's
number under `data.latestVersion` and what to read and merge, and nothing is saved. A save that
names none appends as before, and its answer says the check was skipped (`baseVersionChecked:
false`).

- **Example**: Ada's agent read v5. Ben saved v6 in the editor. The agent's save names
  `baseVersion: 5` → refused with `latestVersion: 6`; it reads v6, merges and saves v7.

### MCP-R3 · A deploy that names the version it replaces is refused when another went live

A deploy may name the version the agent read as live (`expectedDeployedVersion`, `null` for none).
When another version went live meanwhile it is refused (`AUTOMATION_DEPLOYMENT_STALE`) with the
version that is live, and nothing changes. Every deploy answers the version that was live before
(`previousVersion`) and what the deploy did (`kind`: `rollback` when it put an older version
live, `unchanged` when that version was live already, `deploy` otherwise): deploying the previous
version again rolls back.

- **Example**: Ada's agent read v5 as live and deploys v7 naming v5. Ben deployed v6 a minute ago →
  refused, naming v6, and v6 stays live. Deploying v7 naming v6 succeeds and answers
  `previousVersion: 6` and `kind: "deploy"`; deploying v3 naming v7 answers `kind: "rollback"`.

## Reading and bringing back versions

A retained version's document and package data do not change after saving. Governance retention
or automation deletion can remove versions; only retained versions can be read, compared and
brought back. What an agent reads here is what the version screens show the person (`AUTO-R47`,
`AUTO-R48`), and it reaches only the automations the person may see (MCP-R9).

### MCP-R30 · An agent reads the version history a page at a time

`list_versions` answers an automation's versions, newest first: all of them without `limit`, or
`limit` of them (1 to 200) with `nextBefore` while older ones remain — passed back as `before`, it
reads the next page. Each version says who saved it (`createdBy`, and `createdByName` while that
person is still a member of the organization, never an e-mail address), through which door and
client, which version it was based on and restored from, what it changed against the version saved
before it (counts and flags, never content), how its tests went, and whether it is the live
version and when it last went live; the answer also names the live version and the newest. A limit
outside 1 to 200 is refused as invalid arguments.

- **Example**: `billing/dunning` has seven versions and v5 is live. Ada's agent asks for a page of
  three → v7, v6 and v5 with `nextBefore: 5`, `latestVersion: 7` and v5 marked live; it asks again
  with `before: 5` → v4, v3 and v2; once more → v1 and `nextBefore: null`. v7 names Ada as its
  author, saved through the MCP door by Claude Code.

### MCP-R31 · An agent reads what a version changed against another before it deploys it

`get_automation` with `against` answers the version it reads and, beside it, a `diff` of what that
version changed against another: a version number, `previous` (the version saved before it, the
default), `deployed` or `latest`. The diff lists what changed node by node, in the input schema,
the output, the description, the tests and what a version keeps beside its document;
`diffFormat: "unified"` answers a patch over the two versions' YAML instead (cut at 256 KB, and
`truncated` says so), and `"both"` answers both. The first version compares with nothing. A version
the automation never had is refused (`AUTOMATION_VERSION_UNKNOWN`), and so is `deployed` while
nothing is live (`AUTOMATION_NOT_DEPLOYED`).

- **Example**: Ada's agent is about to deploy v7 of `billing/dunning`, and v5 is live. It reads v7
  against `deployed` → the diff names the nodes v6 and v7 changed; it tells Ada what would go
  live, and deploys only when she agrees.

### MCP-R32 · An agent brings an older version back as the newest; the live one stays live

`save_automation` with `name` and `restoreVersion`, instead of a document, saves an older
version's content as the newest version: its document with the settings, task contract and
presentation it kept, through a save's own checks and tests, recorded as based on and restored from
that version. It takes `message` ("Restore v3" when left out) and `baseVersion`, refused
(`AUTOMATION_VERSION_STALE`) when another version was saved since, as any save is; nothing else
may be sent with it. Nothing is saved, and the answer says `unchanged`, when the latest version
already holds that content, and a version that no longer validates is refused
(`AUTOMATION_INVALID`). Restoring never deploys: the live version stays live.

- **Example**: `billing/dunning` has seven versions, and Ben's v6 is live and worse than v3. Ada's
  agent restores v3 naming `baseVersion: 7` → v8 is saved, restored from v3, and v6 stays live; Ada
  reads v8 against v6, agrees, and the agent deploys v8.

## Testing a draft or a version

A draft is tried before it is saved, and a saved version is tested before it goes live. What an
agent tries here runs in Tale, on the mocks: nothing leaves Tale, and nothing it runs is stored.

### MCP-R33 · An agent runs the tests it names, and sees what each run did when it asks

`test_automation` runs the tests of a draft (`automation`) or of a saved version (`name`,
`version`). With `tests` it runs only the tests named, by the name the document gives each; a name
no test bears is refused (`INVALID_PARAMS`) with the names there are, and so is a name that several
tests bear, with the places they stand at. Each result says whether its test passed and, for one
that did not, what differed and where. With `detail` (`output`, `effects`, `trace`) each result
also carries what its run returned, did and went through; a run too large for the answer (256 KB
for one, 384 KB together) is left out and marked `detailOmitted`, and its test is run alone. The
whole suite of a saved version, run to its end, is recorded on the version as its verdict, as made
by hand, and the answer says so (`recorded`); a part of the suite, a draft, and a suite the time
ran out on record nothing. The runs happen in Tale and draw from the organization's budget for
runs that are never stored, one execution per test — the budget the app's own tries and test runs
draw from, beside the key holder's run-start budget (MCP-R5): when it is spent, or the server is
running as many as it can, the call is refused (`RATE_LIMITED`, `data.retryAfterMs`) before
anything runs.

- **Example**: `billing/dunning` has three tests. Ada's agent changed one, so it runs that test
  by name with `detail: ["trace"]` → one result with the steps of that run, and the version's
  verdict is as it was. It then runs all three on v8 → all pass, and the answer says the verdict is
  recorded on v8 as made by hand; the version history shows it. The same call with a budget spent
  by a test script is refused with the wait, and no test runs.

### MCP-R34 · An agent runs an automation on stand-ins, one step at a time

`run_automation` takes, beside the document and its input, the stand-ins and the scope a test and
the app's step test give a run: `mocks` (the node does not make its call, and the value given is
its output), `failures` (the node fails with the message given), `upTo` (a node and what it needs),
`only` (one node, on the data pinned in `mocks` for what it reads) and `item` (with `only`, one
item of a forEach). A stand-in replaces a node's call, never the node: its input is still resolved
and its effect recorded. The answer says where the run stood in (`focus`) and which stand-ins it
never used (`unusedMocks`). A bench the document cannot take — a node it does not have, with the
nearest it does, or scopes that cannot combine — is refused as the request's fault
(`BENCH_INVALID`, `data.issue` the engine's own), and stand-ins past 64 KB each or 512 KB together
are refused as invalid arguments. A run on the mocks stops at its next step after 20 seconds
(`stoppedBy: "time_limit"`), and draws one execution from the budget MCP-R33 names.

- **Example**: Ada's agent wants to know what `billing/dunning` does when the mail server is down.
  It runs the draft with `failures: {send_reminder: "the mail server is down"}` → the run ends in
  error at `send_reminder`, the way the document says; it then runs `only: "format_amount"` with
  the data that step reads pinned in `mocks` → the answer is that step's output alone, `focus` says
  so, and nothing else ran.

## Running

### MCP-R4 · A mock start runs any saved version for any member; a live one needs a developer

`start_run` starts live by default — the deployed version, with real effects — which takes the
owner, admin or developer role. With `mode: "mock"` it runs any saved version, the latest when none
is named, against the deterministic mocks, for any member; the run is recorded and shows in the run
history as a mock run like one started in the app. Both draw from the run-start budget (MCP-R5).

- **Example**: Mia, an ordinary member, starts v7 of `billing/dunning`, which is not deployed, with
  `mode: "mock"` → the run starts and appears in the run history as a mock run; the same start with
  `mode: "live"` → refused, and no run starts.

### MCP-R27 · An agent reads the question a waiting run asked, and answers it for the person

A run whose step asked a person a question waits on the answer (`waitingFor: "ask"`). `get_run`,
and the run resource, name that question while the run waits on it — its id, the words asked, the
step that asked and when the run goes on without an answer — so the agent can tell the person and,
once they have answered, pass the answer on with `answer_run_ask`. A run that waits on nothing, or
on something else, names no question.

- **Example**: Ada's run of `ops/confirm-send` waits on "Send it?" → `get_run` names the question
  and its id; Ada tells her agent "Yes, send it" → the agent answers it, and the run goes on with
  her answer.

### MCP-R6 · No tool decides an approval; a gated step waits for a person in Tale

A step the organization gates for approval parks its run whichever door started it. An agent that
invokes a capability or starts an automation live gets the run, never a decision —
`invoke_capability` and `run_deployed` answer it still waiting once their wait is over — and
`get_run` names what it waits for (`waitingFor: "approval"`). No tool, resource or prompt approves
or rejects it: `answer_run_ask` answers only a question the run asked, and the endpoint never loads
the code that decides an approval. A person decides in Tale, and the run goes on or stops. Stopping
the run (`cancel_run`) withdraws the approval it waited for, so nothing it asked for runs.

- **Example**: Ada's agent invokes `automation.billing/refund`, whose refund to the customer the
  organization gates for approval → the answer is the run, waiting, and `get_run` shows
  `waitingFor: "approval"`; the agent tells Ada instead of retrying, Ben approves the refund in
  Tale, and the run finishes.

## Checking a document

### MCP-R15 · Validation warns about what a document names that the organization lacks

When an agent step names a skill no run of the automation can reach, a connector the organization
has not connected or the deployment does not have, a secret nobody stored, or an agent runtime the
deployment cannot run — or a capability step acts through a connector nobody connected, or the
automation's event trigger waits for an event Tale does not raise — validation answers a warning
(`SKILL_UNKNOWN`, `CONNECTOR_NOT_CONNECTED`, `SECRET_UNKNOWN`, `HARNESS_UNKNOWN`,
`EVENT_UNKNOWN`) with where it is and the closest name the organization has. A save and a deploy
still go through: the organization can change before the run. What the server cannot tell in time
warns about nothing, and the names of secrets are told only to an owner, admin or developer, so a
member's agent cannot find out which secrets exist. The editor's Problems panel shows the same
warnings.

- **Example**: Ada's agent saves `support/reply`, whose agent step asks for the skill `tone-guide`,
  which nobody added, and for Gmail, which nobody connected → the version is saved, and the
  answer warns about both; Mia, an ordinary member, validates a step that names the secret
  `CRM_TOKEN` → she is told nothing about it.

## Looking up what exists

### MCP-R23 · Discovery answers only what the person may see, and never a secret's value

The discovery tools list what an automation may name — models, agent runtimes, skills,
connectors, the names of agent secrets, projects and events — from the readers the editor's
pickers use, for the person and in their organization only: the models their model access allows,
the skills of the organization and of a project they can read (any other project, or another
organization's, is "not found"), whether each connector is connected, the projects they can read
with only the automations they may see in each. The names of agent secrets go only to an owner,
admin or developer, with a masked preview; anyone else gets an empty list that says why. No
answer carries a secret's value.

- **Example**: Mia, an ordinary member, asks for the agent secrets → an empty list saying only
  owners, admins and developers see them; Ada, an admin, gets `CRM_TOKEN` with its masked preview
  and never its value. Mia lists the projects → Sales is listed with `sales/follow-up`, and
  nothing of the HR project she is not in.

## Changing settings

An agent reads the organization's settings, plans a change and applies it through three tools.
Each kind of setting is read and written by the same code the Settings page uses, so the
person's role allows the same changes over MCP as in the app.

### MCP-R10 · An agent changes a setting only where its person's role can change it in the app

Each kind of setting is read and changed through the code its Settings page uses, with the same
checks of the person's role, so a person's agent can read and change every setting their role
lets them read and change in the app, and nothing more. A change the role does not allow is
refused with the reason the app's check gives, and nothing in the call is applied. Without
`kinds`, `get_settings` says for each kind whether the person's role may read and change it.

- **Example**: Ada, an admin, has her agent turn the organization's feature flags off → they are
  off. Mia, an ordinary member, has her agent send the same change → refused, saying only owners
  and admins can change organization policies, and the flags stay on; her agent asks for the
  password policy, which only owners and admins read → refused as well.

### MCP-R11 · A settings call applies only when each setting is still what the agent read

Every change names the hash of the setting the agent read, or none for a setting it creates;
a call that names a hash for a setting no change in it changes, or leaves one out, is refused
(`INVALID_ARGUMENTS`) listing the first fifty such problems and counting the rest. Before
anything is written, each change is planned again against what is stored now: when one
setting has moved since it was read, or one change is refused, nothing in the call is applied,
and the agent learns the hash stored now (`SETTINGS_STALE`). The changes then run one setting at
a time, each checking its hash again; a failure stops the rest, and the agent is told what was
applied, what failed and what was skipped.

- **Example**: Ada's agent reads the password policy and plans a longer minimum length; Ben
  changes the policy in the app before the agent applies → refused with the policy's current
  hash, and the branding change in the same call is not applied either.

### MCP-R12 · No secret goes into or comes out of a settings call

A stored secret reads as masked, with a short excerpt at most, and so does anything else in a
stored setting that a run's record never shows — a key someone pasted into an instruction, a key
typed into a header whose name says it holds one, a password in an address. A header that only
names the stored secret (`Bearer {{secret}}`) reads as written. A change may send a masked value
back to keep what is stored there, and nothing else in its place; a credential anywhere else in a
change — a key pasted into a description — refuses the change, naming where it was found and
never the value (`SECRET_ARGUMENT_REFUSED`). A person enters a new secret in Tale.

- **Example**: Ben typed a key into the moderation provider's `x-api-key` header in Tale. Ada's
  agent reads the policy → the header reads as masked, and `Authorization: Bearer {{secret}}`
  reads as written; it sends the read back → the key is kept; it types a key into another header
  instead → refused, and the answer names the header, not the key.
- **Example**: Ben once pasted an API key into the organization's system prompt in Tale. Ada's
  agent reads the policy → the prompt reads as masked; the agent changes another field and sends
  the masked prompt back → the prompt is kept as Ben wrote it.

### MCP-R28 · An agent changes the embedding model only while the knowledge base is empty

Vectors of two embedding models must never meet in one search, so an agent's change to the model
itself — its provider, credential, model, vector width or endpoint — is taken only while the
organization holds no document and no website, as a declaration applied with the CLI is. With
anything indexed it is refused, naming how many documents and websites there are
(`EMBEDDING_CORPUS_NOT_EMPTY`), and the person changes the model in Tale, where what is indexed
is queued again. The similarity floor and the serving limits change at any time.

- **Example**: Ada's agent proposes a larger embedding model while 40 documents are indexed →
  refused, naming the 40 documents; her agent lowers the similarity floor instead → it is
  changed, and nothing is indexed again.

### MCP-R29 · Only a person's own key reaches the deployment's settings

The deployment's settings are every organization's, and who may read and change them is decided
by a person's standing in every organization they belong to. A key made for a member, a team, a
project or the organization, and the connection of a coding agent that signed in, work in their own
organization alone, so they read and change none of them, and `get_settings` says so for the kind
(`FORBIDDEN_INSTANCE_ADMIN`). A person's own key reads and changes them as the person may in the
app.

- **Example**: Mia is a developer at Acme and an admin of Beta, and her address is on the
  deployment's editor allowlist. Ada, an admin at Acme, makes the key "Billing sync" for Mia;
  Ada's agent reads the deployment's settings with it → refused, and a change of the sandbox
  runtime is refused too. Mia's own key reads and changes them, and an agent Mia connected by signing
  in reads none of them.

### MCP-R35 · Settings are read a page at a time, by kind, and a page fits the answer

`get_settings` reads a kind's resources a page at a time. Each kind that has another page answers
its cursor under `cursors`, by kind, and after a read of one kind also as `nextCursor`; a read of
several kinds answers no `nextCursor`, so no page is taken for another kind's. A cursor reads only
the kind that issued it: another kind's, or one no listing answered, is refused (`INVALID_CURSOR`)
beside what the other kinds read. A page of the listings of free text — a project's instructions,
an agent's instructions, tools and model — ends once what it read would crowd the answer (about
200,000 characters), and agents are paged over their (project, agent) pairs, so reading them all
takes as many pages as it takes, never repeating or skipping one.

- **Example**: Ada's agent reads the instructions of her 25 projects, each as long as one may be.
  The first page holds ten of them and the cursor under `cursors["project-instructions"]`; it
  passes that back with `kinds: ["project-instructions"]` and reads ten more, then five. Asked for
  project and agent instructions together it gets a cursor for each, by kind; it hands the project
  cursor with the agent kind → refused as a cursor no agent listing answered, and nothing is read.

### MCP-R36 · A subscription is connected through Tale's own flow, never by a change

A change that creates a provider credential which is a subscription, or changes one that is, is
refused (`USE_SUBSCRIPTION_FLOW`) with where a person connects it — not as a key entered in Tale
(`SETTINGS_TALE_ONLY`), which is what a credential with a key is. Removing one works, as for any
credential, unless something still uses it (`CREDENTIAL_IN_USE`).

- **Example**: Ada's agent asks to add a ChatGPT subscription as a credential → refused, and the
  hint says to connect it under **Settings > AI providers**; asked to add an API key it is refused
  as a secret entered in Tale; asked to remove the subscription nobody uses → it is removed.

### MCP-R37 · A provider Tale ships is no setting; the keys that serve it are

Reading, refreshing the catalog of or removing a provider Tale ships (such as `openai`) is
refused as no setting of the organization (`SETTINGS_NOT_FOUND`), its hint naming where the
organization's keys for it are: the `provider-credential` kind. A change that would define a
provider of the organization under a shipped name is still refused as a name no provider of the
organization may take (`PROVIDER_NAME_RESERVED`).

- **Example**: Ada's agent asks to refresh the model catalog of `openai` → refused as no setting
  with a hint to the credential kind; asked to define its own provider named `openai` → refused as
  a name it may not take; asked to refresh its own `local-chat` → it is refreshed.

### MCP-R38 · An agent reads what an automation may write unapproved; admins change it

The kind `automation-approval` holds, for each automation (its id is the automation's name), the
writes to outside systems it may make without a person approving each run: what the **Runs
without approval** switches of its General tab list. Owners, admins and developers read it —
`allowed`, `used` (the writes the latest version makes), `requiredByPolicy` (the ones a rule of
the approval policy still requires a person for) and `grants` (who allowed what and when, by
name, never by address) — and any other member's read is refused (`FORBIDDEN`). Only owners and
admins change it, by the acts `grant` and `revoke` with the step types as `args.types`, through
the writer the tab saves with, so each change leaves the tab's own audit row
(`automation.approval_allowance.granted` or `.revoked`), made over MCP. An automation the person
cannot see reads as one that does not exist. A read lists the automations that hold an allowance;
one that holds none is read by naming it.

- **Example**: Ada, an admin, asks her agent to let `ops/morning-digest` post to Slack without
  approval → it reads the automation's allowances (none), plans a `grant` of `slack.send_message`
  and applies it, and the audit log shows the write allowed, made over MCP. Dev, a developer,
  reads the same allowances; his agent's `grant` is refused (`FORBIDDEN`) when it is planned, and
  nothing is written.

### MCP-R39 · Allowing a write says what it removes; a set that moved is never changed

Allowing a write takes a person out of that automation's live runs, so the plan of a `grant`
names the effect `removes-human-approval`, at critical risk, unless a rule of the approval policy
already decides the write; a `revoke` names none. Only a write to an outside system of the
connector catalog can be allowed (`APPROVAL_ALLOWANCE_INVALID`); one still on file whose action
the catalog has lost can still be withdrawn. A change that changes nothing plans and applies as
`unchanged`. The hash a read answers covers the automation and the writes allowed alone, so a
new version of the automation or an edit of the policy never makes a plan stale, and another
person's change to the allowances does (`SETTINGS_STALE`): the writer checks it under the
automation's name lock, and the other allowances stay as they are.

- **Example**: Ada's agent plans allowing `github.create_issue` → critical risk,
  `removes-human-approval`. Before she decides, Ben allows `http.send` for the same automation;
  applying with the hash Ada's agent read is refused as stale and nothing changes. The agent
  reads again, plans again and applies, and both allowances stand.

## Answers and refusals

### MCP-R18 · A refusal comes back as an answer the agent can read, not a protocol error

When the engine or the capability surface refuses a call (an automation that does not exist, a
capability that is refused, a knowledge base that cannot be searched), or a run tool's run ends in
an error, the exchange still succeeds: the tool result carries the refusal's words and code and is
marked as an error, so the agent can correct itself. A read that finds a failed run is an answer,
not an error.

- **Example**: Ada's agent asks for the automation `evaluation/never-created` → a tool result
  marked as an error says no saved automation has that name, and the agent picks an existing one.

### MCP-R7 · A call with invalid arguments returns every problem at once, as a tool error

A tool's arguments are checked against the schema the tool advertises before anything runs. When
they miss it, the call is answered with one tool error (`INVALID_ARGUMENTS`) that lists every
problem — where it is, what kind of problem, and the reason — sorted by where it is, never only the
first one, and never as a protocol error. An unknown argument is named; a value the agent sent is
never repeated back. Nothing runs.

- **Example**: Ada's agent calls `get_automation` with `version: "x"`, an unknown `foo` and no
  `name` → one answer lists `foo` (not an argument this tool takes), `name` (required) and `version`
  (a saved version number or "deployed"), and nothing is read.

### MCP-R8 · A refusal keeps its code even when thrown; a fault names only a request id

A refusal the engine or a store throws instead of answering is still a tool error with its own code
and sentence; a structured refusal is answered in its own words, never as its serialized payload.
Anything else that goes wrong, but a database that is not answering (MCP-R43), is answered as
`INTERNAL_ERROR` with the request id the agent can quote, and the error itself is logged and
reported on the server, never sent to the agent.

- **Example**: Ada's agent cancels a run and the run store fails on a bug → the answer is
  `INTERNAL_ERROR` with `data.requestId`, and nothing about the bug; the operator finds the error
  under that request id.

### MCP-R43 · A call the database could not serve answers a wait and is never reported

While the platform's database restarts, fails over or cannot be reached, a call that needed it is
answered `DATABASE_UNAVAILABLE` with how long to wait (`data.retryAfterMs`: the five seconds the
REST API's `Retry-After` names for the same outage), never `INTERNAL_ERROR`, so the agent waits and
calls again without asking a person. A settings change stops there and says what landed before it
(MCP-R11). A resource or a prompt read meanwhile is refused with the same code, as `-32603`, never
as "resource not found". The server logs one warning line and reports nothing to the error tracker,
as the REST API does for its `503`; any other failure stays a fault (MCP-R8).

- **Example**: Ada's agent reads a run while Tale's database restarts for an upgrade → the answer is
  `DATABASE_UNAVAILABLE` with a five-second wait; the agent waits, reads the run, and the
  operator's error tracker shows nothing for it.

## Requests and batches

### MCP-R5 · Every execution over MCP draws from the run-start budget, like the REST API

A tool that executes an automation — a run on the mocks (`run_automation`), its tests
(`test_automation`), a deploy (whose gate runs the tests), a live run (`run_deployed`,
`start_run`), the answer a waiting run resumes on (`answer_run_ask`) or a capability
(`invoke_capability`) — draws one execution from the key holder's run-start budget, the one the
REST API's run starts and run answers draw from, once its role check has passed.
When the budget is spent, the call is refused (`RATE_LIMITED`) with how long to wait
(`data.retryAfterMs`) and nothing runs. Reads, validation and saving never draw from it, and
neither does a call refused for its arguments or its role. A run on the mocks and a suite of tests
also draw from the organization's budget for runs that are never stored (MCP-R33).

- **Example**: Ada's agent starts its 41st run inside a minute → refused with the wait, and no run
  starts; it reads the runs it started meanwhile → they are listed.

### MCP-R19 · A batch of calls costs as many requests as the calls it carries

One request may carry up to 20 messages; a larger batch is refused whole. The request is charged
to the key holder's request budget, and every call after the first that reads or acts — a tool
call, a resource read or listing, a prompt — is charged again. Once the budget is spent, each
remaining call is answered with the wait (`retryAfterMs`) and nothing runs for it, while the calls
before it stand.

- **Example**: Ada's budget has room for two more requests. Her script sends one request carrying
  three tool calls → the first two run, and the third is answered with the time to wait.

### MCP-R22 · A request from a foreign browser origin is logged, and refused when enforced

A coding agent on a terminal or a server sends no `Origin` and is never judged. A request that
carries one must come from the deployment's own addresses or an origin the operator lists
(`TALE_MCP_ALLOWED_ORIGINS`); from anywhere else it is logged with the origin, the organization and
the person, and — where the operator turned enforcement on (`TALE_MCP_ORIGIN_ENFORCE=true`) —
refused (`ORIGIN_FORBIDDEN`) before anything runs. The log line never prints a value that is not an
origin.

- **Example**: A web page on `evil.example` holds Ada's key and calls the endpoint → the call is
  answered and the log names `https://evil.example`; once the operator enforces the rule, the same
  call is refused and nothing runs. Ada's Claude Code in her terminal is answered either way.

### MCP-R20 · An Idempotency-Key header is refused; a start names its key as an argument

One request can carry many calls, so one header cannot name a start. A request with an
`Idempotency-Key` header is refused (`INVALID_HEADER`) and nothing runs; `start_run`,
`run_deployed` and `invoke_capability` take `idempotencyKey` among their arguments instead.

- **Example**: Ada's script sends `start_run` with an `Idempotency-Key` header → refused, naming
  the header, and no run starts.

## What is kept of a call

### MCP-R21 · A call is counted per organization, person and key, never what it carried

Every answered call adds one to a counter of its organization, its person, the API key, the method
and the tool, for its day (UTC), with whether it was refused or failed, and the name the client gave
itself — when it connected on the 2025 revisions, on every call on 2026-07-28. No argument, result or address is kept, so nothing an agent pasted into a
call ends up in the counters or in the log line the call writes. The same key in two organizations
counts twice, once in each. Counters are kept 90 days, and an erasure of the person removes theirs.

- **Example**: Ada's agent calls `get_run` three times in Acme and once in Beta → Acme counts three
  `get_run` calls of Ada's key that day, Beta one, and neither holds the run id she asked for.

### MCP-R14 · Every write over MCP leaves an audit row naming the coding agent

A write a tool call makes — a version saved, a deploy, a delete, a trigger set or removed, an
installation added or removed, a run stopped, a question answered, a setting changed — leaves its
audit row (`AUTO-R28`; for a setting, the row the same change leaves when it is made on its
Settings page), and every row written during the call says it came through MCP, with the tool, the
API key and the client's name when the client named itself on that call (every call on 2026-07-28;
see Not yet).

- **Example**: Ada's agent deploys v7 with her key "laptop" → the audit log shows "Automation
  deployed" by Ada, through MCP (`deploy_automation`, her laptop key).

## Protocol versions

### MCP-R16 · A protocol revision it does not speak is answered with the revisions it does

The endpoint speaks the MCP revisions 2026-07-28, 2025-11-25, 2025-06-18 and 2025-03-26. A client
whose `initialize` proposes another revision — 2026-07-28 included, which never initializes — is
answered with the newest one `initialize` opens, 2025-11-25; a request whose `MCP-Protocol-Version`
header or `_meta` names another revision is refused (`-32022`) with the revisions it speaks under
`data.supported`, so a client that speaks several can pick one and retry.

- **Example**: Ada's client sends `MCP-Protocol-Version: 2024-11-05` → refused, naming 2026-07-28,
  2025-11-25, 2025-06-18 and 2025-03-26; its `initialize` proposing 2024-11-05 is answered with
  2025-11-25.

### MCP-R26 · One endpoint serves both protocol eras, each request by its own rules

A request whose `_meta` names its revision (2026-07-28) is served on its own, with nothing kept
from an earlier one: it needs no `initialize`, `server/discover` says what the server speaks, and
its `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers must say what its body says, or it
is refused (`-32020`) before anything runs. It carries one message — a batch naming 2026-07-28 is
refused whole —, a method that revision does not have (`initialize`, `ping`) is answered 404, an
address that reads nothing is `-32602`, and every answer says it is complete and names the server,
with how long a client may keep what can be cached, for this key alone. A request without that
envelope is served as before (`initialize`, batches, `-32002`). Both reach the same tools with the
same rules, and a 2026-07-28 client names itself on every call, so what it writes names it.

- **Example**: Ada's Claude Code asks `server/discover` and lists the automations on 2026-07-28,
  while her deployment script, on the same key, sends `initialize` and a batch on 2025-11-25 → both
  are answered; the version Claude Code saves records "claude-code" as its client.
- **Example**: A proxy rewrites Ada's `Mcp-Name: get_run` to `cancel_run` without touching the body
  → refused with `-32020`, and no run is read or stopped.

## Resources and prompts

An agent can read some things by address instead of by tool call — Claude Code offers them as
`@tale:` mentions — and a person can start common work from a prompt (`/tale:edit_automation`).
Both are reads a tool already answers.

### MCP-R24 · A resource or a prompt reads only what the same tool call would

Reading a resource is the tool call it stands for — `tale://automations/{name}` is
`get_automation`, `tale://runs/{runId}` is `get_run`, `tale://docs/{topic}` is `get_docs` — for the
same person, in the same organization, through the same checks; the list of resources names only
the automations `list_automations` would. An address that reads nothing answers "resource not
found" (`-32002`, or `-32602` on 2026-07-28) with the tool's own refusal code, whether the thing
does not exist or the person cannot see it. A prompt attaches the automation, run or reference it is about by reading it the
same way, and a prompt whose run or automation cannot be read is refused with that code.

- **Example**: Mia, an ordinary member, is not in the HR team. Her agent reads
  `tale://automations/hr%2Fonboarding`, installed only in an HR project → "resource not found" with
  `AUTOMATION_NOT_FOUND`, exactly as `get_automation` answers; `hr/onboarding` is not in her list
  of resources, and `/tale:add_trigger hr/onboarding` is refused with the same code.

### MCP-R25 · The Tale skill is one file for every deployment and holds no secret

The Tale skill (`SKILL.md`) teaches a coding agent how to work here: the editing loop, testing,
triggers, debugging a run, reading a refusal, and the rules (ask before going live, never handle a
secret). It is built from the tools the server has, names only those and the addresses it serves,
and names no address of a deployment, no organization and no key, so one file serves every
deployment of a release. A signed-in person downloads it in the app; an agent reads it as
`tale://docs/skill`.

- **Example**: Ada downloads `SKILL.md` from her Tale, and Ben from his, both on the same release →
  the two files are the same, and neither names a host, an organization or a key.

## Not yet

- What a call does once it reaches an automation beyond the rules above (deployment, runs and
  triggers) is held by the [automations spec](../automations/spec.md); the capability
  surface's own rules (searching and invoking capabilities, retrieving knowledge) are not covered
  beyond what an approval leaves to a person (MCP-R6).
- A client of the 2025 protocol revisions names itself only when it connects, not on each call, so
  a version its agent saves records the door and the key but no client name; a 2026-07-28 client
  names itself on every call (MCP-R26).
- The tool inventory and each tool's arguments (`lib/mcp/tools.ts`, `lib/mcp/args.ts`).
- Settings pages no kind covers yet — members, teams, connectors, skills, competences, legal
  holds, data subject requests, the audit log, metrics and a person's own settings among them —
  are listed with what an agent cannot do there (`settings/coverage.ts`); those changes are made
  in Tale. A secret is always entered in Tale: no change request carries an agent's change there
  for the person to finish yet.
- A client cannot subscribe to a resource or be told that a list changed (`subscriptions/listen`
  answers 404 on 2026-07-28): the lists are read again when a client reconnects, or on 2026-07-28
  once the time the answer named has passed.
- The 2026-07-28 revision's questions back to the client (an answer that asks for input) and its
  per-request log level are not used: every answer is complete.
