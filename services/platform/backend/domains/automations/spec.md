# Automations — who may change and run one, and what a version, a trigger and a run guarantee

> **Prefix** `AUTO-` · **Suite** [`automations`](../../../tests/manual/suites/automations.md) · **Docs** [`automations/concepts`](../../../../../docs/en/platform/automations/concepts.md)

The rules an automation is held to between the editor and a finished run: who can change one
and run it live, what a saved version and a deployment guarantee, what a check for problems
reports, what a start is refused for, what each trigger may start, what a run that ends takes
with it, and what a delete leaves behind. The workflow document itself, how a run proceeds
step by step, agent steps and their retries, approvals and questions inside a run, package
upload and managed configuration are not covered; see Not yet.

## Who can do what

An automation belongs to the organization. It can also be installed in projects, and a run
then belongs to the project it ran in.

| | Owner, admin or developer | Any other member |
| --- | --- | --- |
| Change an automation | yes | no |
| Start a live run | yes | no |
| See a run in a project | only when they can read that project | only when they can read that project |
| Have a draft checked for problems | yes | no |

Four things are not settled and are listed under Not yet: who can see a run of the
organization, who can stop a run, who can answer the question a run waits on, and who can
start a test run in a project.

### AUTO-R1 · Only owners, admins and developers can change an automation or run it live

Changing covers saving a version, deploying one, setting or removing the trigger, choosing the
projects it is installed in, uploading a package and deleting the automation. A live run acts
on connected systems, so starting one from the automation's own page or over the automation
API takes the same roles. Anyone else is refused (`ROLE_FORBIDDEN` over the API), and nothing
is saved or started. The exception is the automation a task is bound to, started on that task
from the task itself: the tasks domain decides who can do that (see Not yet).

- **Example**: Mia is an ordinary member. She deploys version 3 of an automation → refused, and
  the deployed version stays as it was.
- **Example**: Noah is a developer. He starts a live run of the deployed version → the run
  starts, recorded as started by Noah.

### AUTO-R2 · A run in a project is hidden from anyone who cannot read that project

Reading the run, listing it, reading the question it waits on, stopping it, answering it and
starting a run in that project all answer as if the run or the project did not exist, so a
refusal never confirms that it does. The project is also left out of the list of projects an
automation is installed in. A project of another organization is hidden the same way.

- **Example**: A run is waiting on a question in a project shared with one team only. Noah, a
  developer outside that team, opens the run by its link → "run not found", and nothing of the
  run's input is shown.
- **Example**: Zoe belongs to a different organization. With her own API key she asks for a run
  at this project's address → not found, as for a project that does not exist.

## Versions and deployment

Saving and deploying are separate acts. Saving records a version. Deploying chooses the one
version that live runs and triggers use. An automation can have versions and nothing deployed.

### AUTO-R3 · Saving an automation adds a new version, numbered after the latest

The first save creates version 1, and every later save becomes the next number. The exception
is a save from a draft that started on a version which is no longer the latest, because
someone else saved in between: it is refused (`AUTOMATION_VERSION_STALE`), names the version
that landed, and adds nothing. Saving the draft again without saying which version it started
from adds it as the newest version.

- **Example**: Noah and Ada both open version 5 in the editor. Ada saves first, which creates
  version 6. Noah saves his draft → refused, with a message that names version 6. He chooses to
  save anyway → his draft becomes version 7.

### AUTO-R4 · A version whose tests fail cannot be deployed

A version carries its own tests. When one of them fails, deploying that version is refused
(`AUTOMATION_TESTS_FAILING`), the failure is recorded on the version, and the version that was
deployed before stays deployed. A version without tests can be deployed.

- **Example**: Version 2 declares a test that expects the output 14, and its workflow returns
  21. Noah deploys version 2 → refused, and version 1 stays the deployed one.

### AUTO-R5 · A live run, and every trigger, runs the deployed version

A live run that names another saved version is refused (`AUTOMATION_VERSION_NOT_DEPLOYED`). A
trigger never names a version: when it comes due and nothing is deployed, it starts nothing
and records `not_deployed` as the reason. A test run is the exception: it can name any saved
version, deployed or not.

- **Example**: Version 1 is deployed and version 2 is saved. Noah starts a live run of version
  2 → refused. He starts a test run of version 2 → it runs.
- **Example**: A schedule is switched on for an automation with nothing deployed. Its time
  comes → no run starts, and the trigger shows `not_deployed`.

## Checking a version for problems

Tale checks a document before it saves or deploys it, and an author can have a draft checked
without saving it. A check finds errors, which a run would fail on, and warnings, which it
might. Each problem names its code and where in the document it is.

### AUTO-R16 · A refused save names every problem and where it is, and changes nothing

A save whose document has an error is refused (`AUTOMATION_INVALID`). The refusal lists every
error and every warning with where it is, and no version is added. Deploying a saved version
that no longer passes the check is refused the same way, and the deployed version stays.

- **Example**: Noah's draft reads the output of a node that does not exist. He saves → refused,
  with the problem pointing at the field that reads it, and the latest version is still 5.

### AUTO-R17 · Warnings never block a save or a deploy

A document whose only problems are warnings is saved, and the warnings come back with the new
version. Such a version can be deployed.

- **Example**: Ada's draft keeps a node nothing reads. She saves → version 6 is added and the
  answer warns about the unread node. She deploys version 6 → it becomes the deployed one.

### AUTO-R18 · Only owners, admins and developers can have a draft checked

Checking reads the organization's other automations and triggers, so it takes the same roles as
changing an automation. Anyone else is refused before anything is read, and a check never
saves.

- **Example**: Mia is an ordinary member. She asks for a check of a draft → refused. Noah asks
  for a check of the same draft → he gets its problems, and no version is added.

## Starting a run

A person starts a run in the app, an API key starts one over the API, or a trigger starts one.
Whoever starts it, the start is checked before a run exists:

| A start is refused when | Code |
| --- | --- |
| its input does not fit the inputs the version declares | `AUTOMATION_INPUT_INVALID` |
| it comes over the API or by webhook and names no project, for an automation installed in projects | `AUTOMATION_PROJECT_SCOPE_REQUIRED` |
| it names a project the automation is not installed in, while it is installed in others | `AUTOMATION_PROJECT_FORBIDDEN` |
| it names an archived project | `PROJECT_ARCHIVED` |
| it reuses an `Idempotency-Key` for a different request | `IDEMPOTENCY_KEY_REUSED` |

### AUTO-R6 · A run whose input does not fit the declared inputs never starts

When a version declares its inputs, every start is checked against them, whoever starts it. A
start that does not fit is refused (`AUTOMATION_INPUT_INVALID`) before a run exists, and the
refusal names each problem: a missing field, a wrong type, a field the automation does not
take. A webhook delivery refused this way is not remembered, so it can be sent again once it
fits. A schedule whose input is refused records `start_refused` for that occurrence and does
not try it again.

- **Example**: An automation requires `orderId` as text. An API key starts it with
  `{ "orderId": 9 }` → refused, with the message `"orderId" must be string`, and no run is
  created.

### AUTO-R7 · An API or webhook start of an installed automation names one of its projects

Started over the API or by webhook at the organization's address, an automation that is
installed in projects is refused (`AUTOMATION_PROJECT_SCOPE_REQUIRED`). Over the API the
refusal lists the projects the caller can read, so the caller can pick one. Started in a
project it is not installed in, it is refused too (`AUTOMATION_PROJECT_FORBIDDEN`). An
automation installed in no project starts at the organization's address, and its run belongs
to no project.

- **Example**: An automation is installed in the project Billing and in a project Mia cannot
  read. Mia's API key starts a test run of it at the organization's address → refused, and the
  answer names Billing only.

### AUTO-R8 · An archived project takes no new runs from people, API keys or webhooks

Starting a run in an archived project is refused (`PROJECT_ARCHIVED`), and so is choosing an
archived project in an automation's project settings. A webhook sent to an archived project's
address gets the same refusal as for a project that does not exist
(`AUTOMATION_PROJECT_FORBIDDEN`), so the address tells nothing about the project. The runs the
project already has stay readable.

- **Example**: The project Billing was archived. Noah, a developer, starts a run of an
  automation installed only in Billing → refused, and no run is created.

### AUTO-R9 · A repeated webhook delivery or keyed API start starts no second run

A webhook delivery that carries an ID, in an `Idempotency-Key` header or the sender's own
delivery header, is remembered for 24 hours. One without an ID is recognised by an identical
body for two minutes. An API start that carries an `Idempotency-Key` is remembered for 24
hours as well. A repeat answers the run the first one started, marked `duplicate`. Each
project counts on its own, so one ID starts one run in each project the automation is
installed in. An API start that reuses its key for a different request is refused
(`IDEMPOTENCY_KEY_REUSED`). A start that was refused is not remembered: the same ID or key can
be sent again.

- **Example**: A sender posts a delivery with the ID `evt-1` to a project's webhook address,
  gets no answer in time and posts it again → the second post answers the first run with
  `duplicate: true`, and one run exists.

## Triggers

An automation's trigger is a schedule, a webhook or a platform event. Saving another kind
replaces the one it had. A trigger starts a live run of the deployed version (`AUTO-R5`) and
hands it a fixed input:

| Trigger | Starts a run when | The run's input |
| --- | --- | --- |
| Schedule | its cron expression comes due in its time zone | `{ trigger: "schedule", firedAt }` |
| Webhook | a request reaches its address | `{ trigger: "webhook", payload }` |
| Platform event | the named event happens in the organization | `{ trigger: "event", event, payload }` |

### AUTO-R10 · A trigger that could never start a run is refused when it is saved

Refused (`AUTOMATION_TRIGGER_INVALID`), with nothing saved, are: a schedule without a cron
expression, with one that cannot be read, or with one that names a date no calendar has, such
as 30 February; a schedule in a time zone that does not exist; an event trigger without an
event name, or with a name the platform never raises; and a field that belongs to another kind
of trigger, such as a cron expression on a webhook.

- **Example**: Noah saves a schedule with the cron expression `0 0 30 2 *` → refused, with the
  message "day-of-month 30 never occurs in month 2", and the trigger he had stays.

### AUTO-R11 · A webhook address is handed out once, when it is created or rotated

The address is the credential: whoever holds it can start a run, without an API key or a
session. Saving a webhook trigger answers the full address one time. Saving the trigger again
keeps the address and does not show it; rotating it hands out a new one. Changing the trigger
to a schedule or an event revokes the address, and the answer says so. A request to an address
that is unknown or switched off gets the same "not found", so the answer does not tell the two
apart.

- **Example**: Noah saves a webhook trigger and copies the address. A week later he opens the
  trigger and saves it unchanged → no address is shown, and the one he copied still works.

### AUTO-R12 · An event raised by an automation run starts no automation

Event triggers fire on events that come from the platform itself. An event that an
automation's own run raises fires none of them, so an automation cannot start itself, or
another one, in a loop.

- **Example**: An automation listens for "contact created", and its run creates a contact →
  that event starts no run.

### AUTO-R13 · A schedule turns itself off after five failures in a row a retry cannot fix

Only live runs the trigger started count, and only when they fail for a reason the next run
would repeat:

| A failed run | Counts toward the five |
| --- | --- |
| an error in the automation's own steps (`node_error`) | yes |
| a connector error (`connector_error`) | yes |
| a model answer that does not fit its schema (`llm_output_invalid`) | yes |
| a problem with the organization's model provider account (`auth_error`, `missing_api_key`, `credit_exhausted`, `model_not_found`) | yes |
| anything else, such as a rate limit or an unreachable provider | no, and it does not reset the count |

A success sets the count back to zero. At the fifth failure in a row the schedule is switched
off and marked `paused_after_failures`, the pause is written to the audit log, and a notice of
it is sent. A paused schedule keeps its count, whatever a run still in progress does, until
the trigger is saved; saving it starts a new count and clears the pause. Webhook and event
triggers count the same way and are never switched off.

- **Example**: A schedule's runs have failed four times in a row on a connector error. The
  fifth run fails the same way → the schedule is switched off and marked
  `paused_after_failures`.

## When a run ends

### AUTO-R14 · A run that ends takes its open approvals and questions with it

When a run is stopped or finishes, the approvals it was still waiting on are withdrawn: they
are recorded as rejected and marked as withdrawn by the run's end. The questions it had asked
are closed, and their notifications are marked read. No card stays open for a run that is
over.

- **Example**: A live run is waiting for Ada to approve sending an email. Noah stops the run →
  the approval leaves Ada's pending list, recorded as rejected because the run ended.

## Deleting an automation

### AUTO-R15 · Deleting an automation keeps its runs and removes everything else

Its versions, its deployment, its trigger and its project installs are removed in one step.
Its runs stay: they can still be listed under the automation's name, and opening the
automation answers that it was deleted and when (`AUTOMATION_DELETED`). The delete is refused
while one of its runs is still queued, running or waiting (`AUTOMATION_HAS_ACTIVE_RUNS`): stop
the run or let it finish first.

- **Example**: An automation has one run waiting on a question. Ada deletes the automation →
  refused, and nothing is removed. She stops the run and deletes again → the automation is
  gone, and the stopped run can still be opened.

## Not yet

- **The workflow document**: node types, references between steps, control flow, and limits
  such as the number of repeats and the depth of nested automations
  (`lib/engine/core/validate/`, `lib/engine/core/execute/`, `backend/core/automations/stepper.ts`).
- **How a run proceeds**: checkpoints and resuming, the sweep that revives a stalled run, agent
  steps with their automatic retries and waits for a sandbox
  (`backend/core/automations/stepper.ts`, `checkpoints.ts`, `liveness.ts`, `agent_host.ts`,
  `agent_retry.ts`, `reattach.ts`, `shim.ts`).
- **Approvals inside a run**: which step asks, and the credential check before it asks
  (`backend/core/automations/stepper.ts`, `shim.ts`). An approval cannot be decided over the
  API; the contract debt ledger in [`.agents/repo.md`](../../../../../.agents/repo.md) records
  it.
- **Questions an agent asks**: who is notified, when a question expires, and that it is
  answered once (`ask-shim.ts`, `ask-retraction.ts`, `answerAsk` in `store.ts`,
  `backend/core/automations/ask_answer_carryover.ts`). The code refuses a second answer
  (`HUMAN_ASK_NOT_PENDING`) and a late one (`HUMAN_ASK_EXPIRED`); only the integration lane
  (`backend/integration-check.ts`) proves them, and the guard does not read it.
- **Webhook limits**: the 256 KiB body limit, the two rate limits, and a delivery repeated
  across the organization's address and a project's (`triggers.ts`,
  `backend/core/automations/webhook_delivery.ts`).
- **Schedules in detail**: daylight-saving changes, two scans meeting the same occurrence, a
  cron expression that became unreadable (`triggers.ts`, `backend/core/automations/cron.ts`).
- **Triggers of an organization that no longer exists** (`triggers.ts`).
- **Switching a trigger off**: what it stops beyond the next start, such as a project agent a
  schedule had started (`triggers.ts`, `backend/core/automations/agent_host.ts`).
- **Names**: the grammar of a name, the first words the platform keeps for its own pages, and
  creating an automation under a name already in use (`store.ts`,
  `lib/engine/core/validate/name.ts`).
- **Runs started on a task**: who can start the automation a task is bound to from the task,
  and that a task has one unfinished automation run at a time
  (`backend/domains/tasks/external-ref.ts`).
- **Deleting a run, run retention, run lists and metrics** (`store.ts`, `metrics.ts`,
  `backend/rest/v1-automations.ts`).
- **Package upload with its carried skills, managed configuration, and the builder and MCP
  doors** (`upload.ts`, `backend/core/automations/upload_impl.ts`, `managed-configuration.ts`,
  `dispatch-store.ts`, `backend/core/automations_builder/`).
- **Undecided: who can stop a run?** The app's own run endpoints let any member stop a run of
  the organization, and an editor of the project stop a run in a project, an archived one
  included (`routes.ts`, `project-visibility.ts`). The API and MCP let only an owner, admin or
  developer stop one, who must also be an editor of an active project for a project run
  (`backend/rest/v1-automations.ts`, `dispatch-store.ts`, `docs/en/develop/api-reference.md`). The task
  panel lets an editor, or the member whose task it is, stop the task's run (`TASK-R2`). The
  app shows run pages to owners, admins and developers only (`AUTO-F53`).
- **Undecided: who can answer the question a run is waiting on?** The code, its tests and the
  manual suite (`AUTO-B11`) say: any member for a run of the organization, and only an editor of
  the project for a run in a project, where a reader is refused (`RBAC_FORBIDDEN`). The user
  docs say that on a task "anyone who can open the task answers it"
  (`docs/en/platform/automations/approvals-in-workflows.md`).
- **Undecided: can a member outside the three roles read a run of the organization?** The
  app's endpoints and the API answer yes for any member (`project-visibility.ts`). The app's
  pages answer "access denied" to them (`AUTO-F53`), and the user docs say owners, admins and
  developers see the organization's runs
  (`docs/en/platform/automations/execution-logs.md`).
- **Undecided: can a member who can only read a project start a test run in it?** The app's
  start endpoint checks read access alone for a test run (`routes.ts`). The API and MCP refuse
  it: a project run takes edit access, test runs included (`backend/rest/v1-automations.ts`,
  `dispatch-store.ts`, `docs/en/develop/api-reference.md`).
- **Undecided: does deploying run a version's tests again?** The code runs them at every
  deploy, and a version whose tests failed when it was saved can be deployed once they pass
  (`deploy_automation` in `lib/engine/api/dispatch.ts`, `deploy` in `store.ts`). The user docs
  say the result is recorded at the save and deploying reads it without running the tests
  again (`docs/en/platform/automations/concepts.md`), and that a version whose saved tests
  failed needs a new version (`docs/en/platform/automations/editor.md`). `AUTO-R4` holds under
  both.
- **Undecided: should a schedule or a platform event start a run in an archived project?**
  `AUTO-R8` refuses people, API keys and webhooks. A schedule or an event still starts a run of
  an automation installed in exactly one project when that project is archived, and a test
  holds that (`resolveRunProject` in `store.ts`). `TASK-R7` says nothing in an archived project
  can be changed.
- **Undecided: where does a schedule or an event run an automation installed in several
  projects?** `AUTO-R7` refuses that start over the API and by webhook. A schedule or an event
  starts it as a run of the organization, in no project (`resolveRunProject` in `store.ts`). No
  test and no page of the docs says which is meant.
- **Undecided: does a schedule make up for an occurrence it missed?** The user docs say a
  missed occurrence is not replayed (`docs/en/platform/automations/triggers.md`). The code
  starts the latest occurrence missed within the last hour, once, and nothing older
  (`dueOccurrence` in `backend/core/automations/cron.ts`), and a test holds that.
- **Undecided: can a new automation be created inside an archived project, or one its author
  cannot read?** Creating an automation with a project, and uploading a package into one,
  check only that the project belongs to the organization (`saveVersion` and `bindProject` in
  `store.ts`). The project settings of an existing automation refuse an archived project
  (`AUTO-R8`) and answer a project the author cannot read like a missing one.
- **`AUTO-R6` gives a webhook no warning when it is saved.** A webhook trigger can be saved for
  a version whose inputs no delivery fits, and every delivery is then refused; the same ledger
  records it.
