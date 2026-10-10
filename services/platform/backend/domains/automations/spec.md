# Automations — who may change and run one, and what a version, a trigger and a run guarantee

> **Prefix** `AUTO-` · **Suite** [`automations`](../../../tests/manual/suites/automations.md) · **Docs** [`automations/concepts`](../../../../../docs/en/platform/automations/concepts.md)

The rules an automation is held to between the editor and a finished run: who can change one
and run it live, what a saved version and a deployment guarantee, what a check for problems
reports, what a test replaces and when it fails, what a start is refused for, what each trigger may start, what a run that ends takes
with it, which server steps a run, how a restart hands a run on, what a run says once it moved
to another and what a resumed run never repeats, what a run records of each step, whose
approval policy a run's steps ask, and what a delete leaves behind. The workflow document itself, how a run proceeds step by step,
agent steps and their retries, the rest of approvals and questions inside a run, package upload
and managed configuration are not covered; see Not yet.

## Who can do what

An automation belongs to the organization. It can also be installed in projects, and a run
then belongs to the project it ran in.

| | Owner, admin or developer | Any other member |
| --- | --- | --- |
| Change an automation | yes | no |
| Start a live run | yes | no |
| See a run in a project | only when they can read that project | only when they can read that project |
| See an automation installed only in projects | when they can read one of them | when they can read one of them |
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

### AUTO-R27 · An automation installed only in projects you cannot read is hidden from you

An automation installed nowhere belongs to the organization and every member sees it. One
installed in projects is seen by whoever can read one of them. For anyone else it is left out
of the automation list and of the list over the API and MCP, and reading it, its versions or
its trigger over the API or MCP answers "not found", as for one that does not exist. Its runs by
name answer "not found" too, unless runs of it are in a scope the person can read. Listed with
no installations, it would read as an organization automation, where it cannot run.

- **Example**: `hr/onboarding` is installed only in a project shared with the HR team. Mia, an
  ordinary member outside that team, lists the automations with her API key → it is not there;
  she asks for its versions → "not found"; she asks for its runs → "not found", as for a name
  nobody saved. Ada, in the HR team, sees it and its versions.

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

### AUTO-R28 · Every change to an automation's definition leaves an audit row

Saving a version, deploying one, setting or removing the trigger, installing the automation in
a project or removing it from one, and deleting the automation each write a row to the audit
log in the same step, whoever made the change and through whichever door: the app, a package
upload, the API, a coding agent, managed configuration. The row names the automation, the
versions or the project involved and who made the change, never the document or a webhook
token. A change that changed nothing, such as an install that was already there, writes none.
A change made with an API key, through the REST API or a coding agent, is recorded as the key's
(actor type API), naming the key and the request, never as a change made in the app.

- **Example**: Ben deploys version 7 over version 6 → the audit log shows "Automation deployed"
  by Ben, from version 6 to version 7. He installs it again in a project it is already in → no
  new row.
- **Example**: Ada's key "ci" deletes `billing/dunning` through the REST API → the row reads
  "Automation deleted" by Ada, actor type API, with the key's id and the request id, so an
  admin knows which key to revoke.

## Checking a version for problems

Tale checks a document before it saves or deploys it, and an author can have a draft checked
without saving it. A check finds errors, which a run would fail on, and warnings, which it
might. Each problem names its code and where in the document it is.

### AUTO-R23 · A refused save names every problem and where it is, and changes nothing

A save whose document has an error is refused (`AUTOMATION_INVALID`). The refusal lists every
error and every warning with where it is, and no version is added. Deploying a saved version
that no longer passes the check is refused the same way, and the deployed version stays.

- **Example**: Noah's draft reads the output of a node that does not exist. He saves → refused,
  with the problem pointing at the field that reads it, and the latest version is still 5.

### AUTO-R24 · Warnings never block a save or a deploy

A document whose only problems are warnings is saved, and the warnings come back with the new
version. Such a version can be deployed.

- **Example**: Ada's draft keeps a node nothing reads. She saves → version 6 is added and the
  answer warns about the unread node. She deploys version 6 → it becomes the deployed one.

### AUTO-R25 · Only owners, admins and developers can have a draft checked

Checking reads the organization's other automations and triggers, so it takes the same roles as
changing an automation. Anyone else is refused before anything is read, and a check never
saves.

- **Example**: Mia is an ordinary member. She asks for a check of a draft → refused. Noah asks
  for a check of the same draft → he gets its problems, and no version is added.

## Testing an automation

A version carries its own tests. A test runs the automation against the deterministic mocks
with an input, and can stand in for what some of its nodes answer: an output a node returns
instead of calling, or an error it fails with. Then it checks what the run did against what the
test expects.

### AUTO-R42 · A test replaces only the calls it names; everything else runs as written

A stand-in replaces a node's call, never the node. The node's condition and alternative still
decide whether it runs, its input is still worked out and checked against what its action
takes, and what it would send is still recorded; only the answer is made up. Every other node
runs as written, on the simulated values. A simulated failure fails the node with the test's
message, and the node's error handling decides what the run does next. Stand-ins apply to
mock runs only: a live run with one is refused (`BENCH_MOCK_ONLY`).

- **Example**: Mia's test simulates the output of *Fetch issues* and nothing else. She runs it
  → the *Score* node still runs its code on that output, and *Report*'s condition still decides
  whether it runs.

### AUTO-R43 · A test that cannot run fails; it is never skipped

A test that stands in for a node the automation does not have, simulates both an output and a
failure for one node, or gives an input the inputs schema refuses cannot run: it fails, with
the reason (`BENCH_UNKNOWN_NODE`, `BENCH_CONFLICT`, `TESTS_INPUT_INVALID`). So does a test that
runs longer than its 10 seconds; the tests a suite's 60 seconds do not reach are named as not
run and count as failed.

- **Example**: Noah renames the node `fetch` to `list`. His test still simulates `fetch` → the
  test fails, saying it simulates "fetch", which is not a node of the automation.

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

### AUTO-R8 · An archived project takes no new runs from people, API keys, webhooks or events

Starting a run in an archived project is refused (`PROJECT_ARCHIVED`), and so is choosing an
archived project in an automation's project settings. A webhook sent to an archived project's
address gets the same refusal as for a project that does not exist
(`AUTOMATION_PROJECT_FORBIDDEN`), so the address tells nothing about the project. An event
that would start a run in an archived project, its own or the only one the automation is
installed in, starts none, and the trigger records the refusal (`start_refused`, with
`PROJECT_ARCHIVED`). The runs the project already has stay readable.

- **Example**: The project Billing was archived. Noah, a developer, starts a run of an
  automation installed only in Billing → refused, and no run is created.
- **Example**: An automation installed only in the archived Billing listens for "contact
  created". Mia adds a contact → no run starts, and the trigger says its project is archived.

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
hands it an input of its own fields. A trigger may also carry a fixed input, values every run
it starts receives; the trigger's own fields are set over it:

| Trigger | Starts a run when | The run's input |
| --- | --- | --- |
| Schedule | its repeat rule or cron expression comes due in its time zone | `{ …input, trigger: "schedule", firedAt }` |
| Webhook | a request reaches its address | `{ …input, trigger: "webhook", payload }` |
| Platform event | the named event happens in the organization, in a project it is installed in when it has one (`AUTO-R35`) | `{ …input, trigger: "event", event, payload }` |

### AUTO-R10 · A trigger that could never start a run is refused when it is saved

Refused (`AUTOMATION_TRIGGER_INVALID`), with nothing saved and each problem named by a code,
are: a schedule with neither a repeat rule nor a cron expression, or with both; a cron
expression that cannot be read, or one that names a date no calendar has, such as 30 February;
a repeat rule with no time of day, a time not written HH:MM, more than twelve times a day, an
interval the rule does not offer, a day the named month never has, a window whose start is its
end or in which no start ever falls, or a start date that is not a calendar day; a repeat rule
without a time zone; a time zone that is blank or does not exist; an event trigger without an
event name, or with a name the platform never raises; a fixed input that is not a JSON object,
names a field the trigger sets itself, or is larger than 16 KiB; and a field that belongs to
another kind of trigger, such as a cron expression on a webhook. A window may run overnight,
from 22:00 to 06:00.

- **Example**: Noah saves a schedule with the cron expression `0 0 30 2 *` → refused, with the
  message "day-of-month 30 never occurs in month 2", and the trigger he had stays.
- **Example**: Noah saves a repeat rule "every day" with no time of day → refused with the code
  `schedule.times_required`, and the trigger he had stays.

### AUTO-R11 · A webhook address is handed out once, when it is created or rotated

The address is the credential: whoever holds it can start a run, without an API key or a
session. Saving a webhook trigger answers the full address one time. Saving the trigger again
keeps the address and does not show it; rotating it hands out a new one. Changing the trigger
to a schedule or an event revokes the address, and the answer says so. A request to an address
that is unknown or switched off gets the same "not found", so the answer does not tell the two
apart.

- **Example**: Noah saves a webhook trigger and copies the address. A week later he opens the
  trigger and saves it unchanged → no address is shown, and the one he copied still works.

### AUTO-R12 · An event a run raises never starts that run's own automation again

An event that an automation's run raises, through a connector step or its agent's tools,
starts the other automations listening for it, but never the automation whose run raised it.
When that run was itself started by an event, its events start nothing at all. A chain of
event starts is therefore one start long, and no automation starts itself, or another one, in
a loop. Events a person, an import or the platform raise start every listening automation.
Work a run hands to a project agent is that agent's own: an event the project agent raises is
not attributed to the run, so it starts the automations listening for it, the run's own
included.

- **Example**: The mailbox sync runs on a schedule and files an incoming email. The triage
  automation listening for "message received" starts. The reply the triage run drafts raises
  events too → they start no automation.
- **Example**: An automation listens for "task created", and its run creates a task → that
  event starts no run of it.

### AUTO-R35 · An event of a project starts only automations installed there or nowhere

Task, comment and project events belong to a project; contact and conversation events belong
to none. An event of a project starts the automations installed in that project and those
installed in no project, and their runs start in that project; an automation installed only
in other projects does not hear it. An event of no project starts an automation installed in
exactly one project in that project. Each automation starts on its own: one whose start is
refused, because its inputs refuse the event or its project cannot take a run, records why on
its trigger (`start_refused`), and the runs of the others start as if it had not been
listening.

- **Example**: An automation installed in the project Billing listens for "task created". Mia
  creates a task in Sales → it starts nothing. She creates one in Billing → a run starts in
  Billing.
- **Example**: Two automations listen for "contact created", and the inputs of one require a
  field the event does not carry. Mia adds a contact → the other one's run starts, and the
  first one's trigger says its input was refused.

### AUTO-R13 · A schedule turns itself off after five failures in a row a retry cannot fix

Only live runs the trigger started count, and only when they fail for a reason the next run
would repeat:

| A failed run | Counts toward the five |
| --- | --- |
| an error in the automation's own steps (`node_error`) | yes |
| a connector error (`connector_error`) | yes |
| a connected service that did not answer, answered too slowly, was busy, or failed on its own side (`connector_unavailable`) | no, and it does not reset the count |
| a model answer that does not fit its schema (`llm_output_invalid`) | yes |
| a problem with the organization's model provider account (`auth_error`, `missing_api_key`, `credit_exhausted`, `model_not_found`) | yes |
| anything else, such as a rate limit or an unreachable provider | no, and it does not reset the count |

A success sets the count back to zero. At the fifth failure in a row the schedule is switched
off and marked `paused_after_failures`, the pause is written to the audit log, and a notice of
it is sent. A paused schedule keeps its count, whatever a run still in progress does, until
the trigger is saved; saving it starts a new count and clears the pause, and its next run is
the first occurrence after the save: the occurrences it was off for are not made up. Webhook
and event triggers count the same way and are never switched off.

- **Example**: A schedule's runs have failed four times in a row on a connector error. The
  fifth run fails the same way → the schedule is switched off and marked
  `paused_after_failures`.

### AUTO-R34 · A schedule starts each occurrence once, at the local time it names

A schedule keeps the time of day it names in its time zone through daylight-saving changes. A
time the clock skips that day starts once, moved forward by the gap; a time the clock repeats
starts once, at its first instant. "Every N minutes" and "every N hours" keep their pace in
real time instead, so an hour the clock repeats runs twice and one it skips not at all. A cron
expression follows the same rule: one whose minute and hour are spelled out names times of
day, one whose minute or hour starts with `*` keeps its pace.

- **Example**: Ada's schedule runs "every day at 02:30" in Europe/Zurich → it starts at 03:30
  on 29 March 2026, when the clock skips 02:30, and once, at the first 02:30, on 25 October
  2026, when the clock shows 02:30 twice.

### AUTO-R37 · A schedule that missed occurrences starts one at most, and counts the rest

When the platform was not running at an occurrence, the schedule decides what to start when it
is back. "Latest", the default, starts the most recent missed occurrence once, however late.
"Skip" starts it only when it is at most ten minutes late. The other missed occurrences are
counted, up to 1,000, and none of them runs; the trigger shows how many and when
(`missed_occurrences`). The time a schedule was switched off or paused, and the time before it
was saved, are not missed.

- **Example**: Ada's schedule runs every day at 09:00, and the platform is down from 08:30 to
  10:15 → with Latest, a run starts at 10:15 for the 09:00 occurrence; with Skip, no run
  starts, and the trigger shows one missed occurrence.

### AUTO-R36 · A trigger whose input the deployed version refuses is saved with a warning

Saving a trigger, and deploying a version, checks what the trigger will hand each run against
the inputs of the version that runs: its own fields and its fixed input, an event's payload
too, but never a webhook's body, which is unknown until a request comes. A refusal there would
refuse every run the trigger starts, so the save names it (`TRIGGER_INPUT_MISMATCH`), and a
template in the fixed input, which arrives as text and is never filled in, too
(`TRIGGER_INPUT_NOT_TEMPLATED`). The trigger is saved either way, and the deploy answers
whether the trigger is on.

- **Example**: Ada turns on the GitHub triage schedule, whose inputs require `owner` and
  `repo`, without a fixed input → it is saved, with a warning naming both; she adds both as
  its fixed input and saves again → no warning.


## Waking a standing role

A schedule that runs a project's standing role (the agent that hands out work) can opt in to
`wakeOnSlotFreed` through managed configuration. When an agent of its project then finishes
its run in one of its standing workers and that worker is free, the release is recorded on the
project's wake, and the schedule fires once more before its next cron minute, as an ordinary
occurrence under its own authority. Releases that arrive while one is pending add up to one
wake.

### AUTO-R29 · Only an enabled schedule wakes a project, and only one at a time

The opt-in belongs to schedules: on a webhook or an event trigger it is refused, and changing
a schedule to another kind clears it. A save that leaves it out keeps it. Saving a second
enabled schedule that opts in for a project another enabled schedule already wakes is refused
(`AUTOMATION_TRIGGER_INVALID`, 409), and nothing is saved. So is installing an automation whose
schedule wakes its projects in a project another schedule already wakes, and so is the later of
two saves or installs that race for one project; a refused install binds no project at all.
This holds whoever writes the schedule or the installation — the previous version too, while a
deployment rolls — and for an install that began before the schedule changed; two changes that
would trade projects are refused whole, never left half-done. Installing and moving automations
whose schedules wake no project adds no wait on another project’s wake claim; the definition
audit still serializes changes in the organization. A schedule paused by its failures (`AUTO-R13`) keeps its projects until a person saves
it; one a person switches off gives them up.

- **Example**: Mia's "Dispatch" schedule wakes the Fleet project. She opts in "Nightly sweep",
  bound to the same project, and saves it enabled → refused, naming "Dispatch".

### AUTO-R30 · A slot release is recorded with its run's end, or not at all

The release is written in the same transaction as the run's end. If it cannot be written, the
run does not end either, and whatever ends it later records the release then; a release is
never dropped while the run's end stays.

- **Example**: Leo's agent finishes while the project's wake cannot be written → the run
  stays running, and when it ends after all, exactly one release is recorded.

### AUTO-R31 · Only a manager turn that launched and settled covers a release

A wake occurrence's start remembers which releases it saw. Only when that manager turn
launches and settles are those releases covered. A cancel, queued or running, a failure no
retry follows, or a start alone covers nothing, and the wake stays pending.

- **Example**: Ana cancels the manager's queued turn that a wake started → the release stays
  pending, and the wake fires again after its first backoff step.

### AUTO-R32 · A role's own runs never wake it

A run the waking schedule started, its automatic retries, and any other run on the manager's
own card never record a release, so the role cannot start itself in a loop.

- **Example**: Mia's manager agent settles the turn its schedule started → no release is
  recorded for it.

### AUTO-R33 · A wake that cannot fire waits for a named reason, and never gives up

A pending wake waits while the manager’s own card has a live run or an armed retry, while its
card would refuse the start or is no longer assigned to it,
until the task's automated-start limit allows exactly the next start (`retryAfter`), or for a
backoff after an occurrence that did not serve: one minute, doubling, at most an hour, with no
limit on attempts. A schedule paused by its failures (`AUTO-R13`), switched off or opted out
is mirrored with its reason, and the pending wake fires once it is saved again. Other tasks of
the same agent do not hold the wake; the new manager run claims its own worker or waits for
capacity through ordinary worker admission.

- **Example**: Leo's dispatch schedule fails three wake occurrences in a row → the wake waits
  one, two, then four minutes, and fires the same pending release again after that.

## When a run ends

### AUTO-R14 · A run that ends takes its open approvals and questions with it

When a run is stopped or finishes, the approvals it was still waiting on are withdrawn: they
are recorded as rejected and marked as withdrawn by the run's end. The questions it had asked
are closed, and their notifications are marked read. No card stays open for a run that is
over.

- **Example**: A live run is waiting for Ada to approve sending an email. Noah stops the run →
  the approval leaves Ada's pending list, recorded as rejected because the run ended.

### AUTO-R17 · A stop and a finishing step never both land; the first recorded wins

A person can stop a run in the same moment its last step finishes. The first of the two to be
recorded decides how the run ends, and the second changes nothing: the run ends once, with one
entry for it in the audit log. A stop recorded first wins even though the step did its work;
what the step did is not undone.

- **Example**: Ada presses Stop in the second the run's last step finishes, and her stop is
  recorded first → the run reads Stopped, and the audit log has one stop entry and no success
  entry.

## When a server stops

A deployment can run several servers that step automation runs, and a server can stop at any
moment: an update, a restart, a crash. These rules say what holds for the runs they step.

### AUTO-R16 · One server at a time steps a run

While a server steps a run, a second request to step it does nothing, whether it is a repeated
job or a check that took the run for stalled. Only when that server stops answering does
another one take the run over, and the run records that it was taken over.

- **Example**: Noah's nightly import is on step 3 when a second copy of its step job arrives →
  the second one does nothing, and step 3 runs once.

### AUTO-R18 · A run that was handed to another server says when and why

When a server that is being updated or restarted hands a run on, or another server takes a
run over because the one stepping it stopped answering, the run counts the move and keeps the
time and the reason of the last one. Its page says so beside its status, and a read of the run
carries the same count and reason (`resumeCount`, `lastResume`). Until another server has
taken it over, the run reads Interrupted instead of Running (`stalled`). No read names the
server.

- **Example**: Zoe's weekly report is running when its server is restarted for an update, and
  another server finishes it → the run page reads "Resumed after a restart", with the time and
  "the server running it was being updated or restarted and handed it on".

### AUTO-R19 · A write that may already have happened waits for a person

When a run is interrupted while a step is writing to another service, Tale cannot tell whether
the write reached that service. The resumed run never sends it again on its own: it waits
(`waitingFor: in_doubt`) until a person chooses to run the step again, to skip it (the step then
returns nothing), or to fail the run (`effect_in_doubt`). A choice is about one attempt of the
write: once the step was run again and interrupted again, a choice made about the earlier attempt
is refused and decides nothing, so the person decides about the new interruption. A write that
finished before the interruption is not sent again, and neither is an item of a list that was
already sent. A model call is made again instead, and so is an action its connector declares safe
to repeat.

- **Example**: Mia's run is sending an invoice to the accounting system when its server stops →
  the run waits with "This step may already have run", and nothing is sent again until Mia
  chooses.

### AUTO-R20 · A run whose saved progress cannot be read fails instead of starting over

A server that cannot read a run's saved progress fails the run (`engine_incompatible`) and says
so. It does not start the run again from its first step, which would repeat every step the run
had already finished.

- **Example**: Noah's import has finished two of its steps when its saved progress becomes
  unreadable → the run fails, saying its progress could not be read by this version of Tale, and
  neither step runs again.

### AUTO-R22 · A restart hands a run on; steps it finished never run again

After both servers use the run-lease protocol, a run is handed on at its next step: the step
under way finishes, and another server continues the run from the step after it, or from
the next item of a list. A step still working 20 seconds into the shutdown is cut and runs again
on the next server; it is not recorded as failed, and a write it may already have sent waits for
a person instead (`AUTO-R19`). A step or an item the run had finished never runs again.

- **Example**: Noah's nightly import is on step 3 of 5 when its server is restarted for an
  update → step 3 finishes, another server runs steps 4 and 5, and no step shows twice in the
  run's log.

### AUTO-R26 · The first protocol upgrade preserves uncertain legacy work on hold

The first upgrade from the legacy executor holds its queued, running and waiting runs with
their original checkpoints. The run says **On hold — outcome unknown**. A write already sent
by the old server may still finish; the hold does not claim that it failed, completed or was
undone. The new server never takes over or replays this work automatically. A task attached
to a held run cannot start another agent or automation run, and its task and run cannot be
deleted while that uncertainty remains.

An authorized person can request a stop after acknowledging the unknown external effects.
The request identifies the exact hold they saw; a stale confirmation is refused. **Stop
requested** records the decision and asks the owned session to stop. The run stays on hold,
its evidence and task exclusion remain, and no successful cancellation or retirement is
inferred. There is no resume, retry or skip action for this hold.

- **Example**: Ada upgrades while an old automation waits for a reply after sending a write
  → the run appears on hold. She requests a stop → the decision is recorded, but the run
  remains on hold and its task cannot start a replacement run.

## What a run records

A run keeps a record of each unit of work it did: its input, each step, each item of a step
that runs per item, each pass of a step that repeats, and its output. Whoever may read the run
may read its record.

### AUTO-R38 · A run's record shows what each step read and returned, secrets withheld

Each unit is recorded with when it started and ended, what it received and returned, the
condition that decided whether it ran (with the values that condition read), and why it was
skipped or failed. A value under a name that marks a secret, and text that looks like a
credential, is withheld from the record: it reads empty and the record says where. The run's
own input and output stay whole, for whoever may read the run. Each value is cut to a bound,
and a run stores at most 2 MiB of values; past that a step keeps its summary, shape and size,
never its value.

- **Example**: Leo's run fetches an issue; the `fetch` step returns
  `{ title: "Fix login", apiKey: "sk-…" }` → the run's record shows `fetch` with what it
  received, `title: "Fix login"`, and `apiKey` withheld.

### AUTO-R39 · A resumed run records each step once and counts its attempts

A run that moved to another server, waited for a person or was handed on keeps one record per
unit: the next turn updates it instead of adding another, and a wait ends when the run comes
back. A step a stopped server was running counts as an interrupted attempt, and the record
says how each attempt ended; a loop handed on between two items is not a new attempt. A server
that lost the run records nothing, and a late write of an earlier server never replaces a
later one's.

- **Example**: Mia's run stops in the middle of its `list` step when its server restarts →
  the next server runs `list` again, and the record shows one `list` at attempt 2, the first
  attempt interrupted.

### AUTO-R40 · A run's record is read like the run, and two runs compare only side by side

Whoever may read a run may read its record, one step of it, a page of a step's items, and its
comparison with another run of the same automation; a run hidden from them answers exactly like
one that does not exist, and so does a comparison with a run hidden from them. Two runs of
different automations are not compared. What a reader sees of the run's events names where and
why something happened, never the server that saw it.

- **Example**: Noor can read the runs of the Billing project but not of Payroll → reading the
  record of a Payroll run answers "not found", the same as a run that never existed, and
  comparing a Billing run with a Payroll run answers "not found" too.

### AUTO-R41 · A run runs again in its own project, as a start would, a fork never more real

Whoever may read a run may see what running it again would do. Running it again takes what
starting a run takes: an author and the deployed version for a live run, the project's write
access where a start needs it. The replay keeps the run's project and starts anew with the
run's input, an edited input, or from one step — reusing the results and record of the steps
the run finished outside that step and what it feeds, never their effects. A fork of a mock
run stays mock, and a live replay is audited.

- **Example**: Leo's live import failed at `send`. He runs it again from `send` → `fetch` and
  `score` are reused, `send` runs again live and writes again, and the new run says it
  replays Leo's run.

## Approvals inside a run

### AUTO-R21 · Each run asks its own organization's approval policy

One server steps the runs of several organizations at the same time. A step that needs an
approval is decided by the policy of the organization its run belongs to, never by one another
run brought along: a run is not held up or refused because of another organization's run.

- **Example**: Ada's and Noah's organizations each start a live run that writes a file, at the
  same moment on the same server → each run is decided by its own organization's policy, and
  neither fails with "a different organization".

## Deleting an automation

### AUTO-R15 · Deleting an automation keeps its runs and removes everything else

Its versions, its deployment, its trigger and its project installs are removed in one step.
Its runs stay: they can still be listed under the automation's name, and opening the
automation answers that it was deleted and when (`AUTOMATION_DELETED`). The delete is refused
while one of its runs is still queued, running or waiting (`AUTOMATION_HAS_ACTIVE_RUNS`): stop
the run or let it finish first. A legacy hold also refuses deletion (`RUN_QUARANTINED`);
requesting a stop leaves that hold intact (`AUTO-R26`).

- **Example**: An automation has one run waiting on a question. Ada deletes the automation →
  refused, and nothing is removed. She stops the run and deletes again → the automation is
  gone, and the stopped run can still be opened.

## Not yet

- **The workflow document**: node types, references between steps, control flow, and limits
  such as the number of repeats and the depth of nested automations
  (`lib/engine/core/validate/`, `lib/engine/core/execute/`, `backend/core/automations/stepper.ts`).
- **How a run proceeds**: checkpoints and resuming, how soon the sweep revives a run whose
  server stopped answering, what becomes of a step its server was running when it crashed, agent
  steps with their automatic retries and waits for a sandbox
  (`backend/core/automations/stepper.ts`, `checkpoints.ts`, `liveness.ts`, `agent_host.ts`,
  `agent_retry.ts`, `reattach.ts`, `shim.ts`, `node-attempts.ts`). `AUTO-R16` covers which
  server steps a run, `AUTO-R22` how a restart hands it on, `AUTO-R18` what a run says once it
  moved to another, `AUTO-R19` and `AUTO-R20` what a resumed run never repeats, and
  `AUTO-R38` and `AUTO-R39` what its record keeps, `AUTO-R40` who may read it, `AUTO-R41` how
  it runs again.
- **Approvals inside a run**: which step asks, and the credential check before it asks
  (`backend/core/automations/stepper.ts`, `shim.ts`); `AUTO-R21` covers whose policy decides.
  An approval cannot be decided over the API; the contract debt ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records it. Neither can a write a run
  waits on a person about (`AUTO-R19`): it is decided in the app only.
- **Questions an agent asks**: who is notified, when a question expires, and that it is
  answered once (`ask-shim.ts`, `ask-retraction.ts`, `answerAsk` in `store.ts`,
  `backend/core/automations/ask_answer_carryover.ts`). The code refuses a second answer
  (`HUMAN_ASK_NOT_PENDING`) and a late one (`HUMAN_ASK_EXPIRED`); only the integration lane
  (`backend/integration-check.ts`) proves them, and the guard does not read it.
- **Webhook limits**: the 256 KiB body limit, the two rate limits, and a delivery repeated
  across the organization's address and a project's (`triggers.ts`,
  `backend/core/automations/webhook_delivery.ts`).
- **Schedules in detail**: two scans meeting the same occurrence, and a schedule that became
  unreadable (`triggers.ts`, `lib/automations/schedule/occurrences.ts`); `AUTO-R34` covers
  daylight-saving changes and `AUTO-R37` missed occurrences.
- **Triggers of an organization that no longer exists** (`triggers.ts`).
- **The wake fire end to end**: that a pending wake fires its schedule early, at most once a
  minute and never while an occurrence of it is live; that each scan visits the pending wakes
  least recently visited first, so wakes that cannot fire never keep a later one from firing; the start that captures the releases;
  the exact `retryAfter`; the lock order of a completion retried behind the audit chain
  (`automations/wakes.ts`, `tasks/slot-wakes.ts`). Only the integration lane
  (`checkStandingRoleWake` in `backend/integration-check.ts`) proves them, and the guard does
  not read it.
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
  `dispatch-store.ts`, `backend/core/automations_builder/`, `backend/domains/mcp/`); the MCP
  door's own rules are the [MCP spec](../mcp/spec.md).
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
- **Undecided: should a schedule start a run in an archived project?** `AUTO-R8` refuses
  people, API keys, webhooks and events. A schedule still starts a run of an automation
  installed in exactly one project when that project is archived, and a test holds that
  (`resolveRunProject` in `store.ts`). `TASK-R7` says nothing in an archived project can be
  changed.
- **Undecided: where does a schedule, or an event of no project, run an automation installed
  in several projects?** `AUTO-R7` refuses that start over the API and by webhook. A schedule,
  or an event that belongs to no project, starts it as a run of the organization, in no project
  (`resolveRunProject` in `store.ts`, `dispatchAutomationEvent` in `triggers.ts`). An event of a
  project starts it in that project (`AUTO-R35`). No page of the docs says which is meant.
- **Undecided: can a new automation be created inside an archived project, or one its author
  cannot read?** Creating an automation with a project, and uploading a package into one,
  check only that the project belongs to the organization (`saveVersion` and `bindProject` in
  `store.ts`). The project settings of an existing automation refuse an archived project
  (`AUTO-R8`) and answer a project the author cannot read like a missing one.
- **A webhook's body is never checked when it is saved.** `AUTO-R36` warns about what is known
  before a request comes — a required field the fixed input lacks, a `payload` the inputs do
  not take — but a delivery whose body the inputs refuse is refused only when it comes, and the
  contract debt ledger in [`.agents/repo.md`](../../../../../.agents/repo.md) records that it
  moves no trigger stamp.
