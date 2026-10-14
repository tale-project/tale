# Sandbox — who can manage a workspace, what it can reach, and what its work costs

> **Prefix** `SBX-` · **Docs** [`admin/sandboxes`](../../../../../docs/en/platform/admin/sandboxes.md)

A sandbox is the isolated environment an agent works in, and its workspace is the files it
keeps between turns. These rules cover who can see and manage workspaces, what an agent in a
sandbox can reach, how many sandboxes run at once, what is left of a workspace whose sandbox
disappears, when a workspace is deleted, how a turn's spend is booked, the light sandboxes
chats run code in, and the leases agent runs take before a heavy phase. Connected devices
and agent secrets have their own specs. Egress, the health checks, image generation and how
waiting work resumes are not covered; see Not yet.

## Who can do what

|                                 | Read limits and capacity | See the workspace list | Stop, pin or destroy a workspace |
| ------------------------------- | ------------------------ | ---------------------- | -------------------------------- |
| An owner or admin               | yes                      | yes                    | yes                              |
| A developer                     | yes                      | no                     | no                               |
| An editor, a member or a viewer | no                       | no                     | no                               |

### SBX-R1 · Owners, admins and developers can read sandbox limits and capacity

This covers the organization's workload limits, how many of each are in use, and the capacity
of the deployment. Anyone else is refused (HTTP 403).

- **Example**: Mia is a member. She opens **Settings > Sandboxes** → refused, and she sees
  neither the limits nor the capacity.

### SBX-R2 · Only owners and admins can see, stop, pin or destroy a workspace

The workspace list can name projects a developer cannot open, so a developer gets totals only:
the capacity reading leaves out which sandboxes are running and where. Stopping a workspace's
running work, pinning it and destroying it are refused for everyone else (HTTP 403), and
nothing changes.

- **Example**: Noah has the developer role. He opens the workspace list → refused. He can
  still read the limits and the capacity totals.
- **Example**: Mia is a member. She sends a Destroy for an agent's workspace → refused, and
  the workspace stays.

### SBX-R3 · An owner or admin can act only on workspaces of their own organization

The organization is always the one the person is signed in to; one named in the request is
ignored. A workspace of another organization is answered as not found (`SESSION_NOT_FOUND`
for a stop), and nothing is stopped, pinned or deleted.

- **Example**: Zoe is an admin of another organization. She sends a Destroy with the ID of a
  workspace in Ada's organization → not found, and the workspace stays.

### SBX-R4 · An automation run's agent log is shown only to people who can read the run

The log of what an agent step did follows the run's own read rule. Someone who cannot read
the run gets the same empty answer as for a run that does not exist, so a hidden run cannot be
told from a missing one. A run of another organization is answered the same way.

- **Example**: A project is restricted to a team Mia is not in. She asks for the agent log of
  a run in that project → an empty answer, as if there were no such run.

## What an agent in a sandbox can reach

An agent calls the platform's tools from inside its sandbox. Each turn gets a session token,
and that token, not the call, decides who the agent is and what it can do.

### SBX-R5 · A sandbox acts only as the organization and run its token names

The organization, the session, the person and the run a tool call acts for are read from the
turn's session token. Whatever the call itself claims about them is ignored. A call without a
live token is refused (HTTP 401) and learns nothing, not even which version of the platform
answered.

- **Example**: An agent in Ada's organization sends a tool call whose body names Zoe's
  organization → the call runs for Ada's organization, as its token says.

### SBX-R6 · An agent can call only the tools granted to its turn

A tool outside the grant is refused (`not_granted`) and does not run. When the agent asks
which tools it has, it is told the granted ones and no others.

- **Example**: An agent whose turn was granted document search calls the image tool → refused
  as `not_granted`, and no image is made.

### SBX-R7 · An agent run acts with the reach of the person who started it

A run that an editor of the project started can change any task of the project. A run that a
member started can change only its own task and the subtasks under it, and can save no
document to the project and no knowledge entry; anything else is refused (`member_run`). It stays limited when an
editor steers it later, and a starter who loses the editor role during the run is treated as
a member from then on. Reading the project's tasks stays possible. Once a run has ended, its
tools act for nobody (`run_ended`).

- **Example**: Mia, a member, starts an agent on her task. The agent tries to close another
  task of the project → refused as `member_run`, and the other task is unchanged.
- **Example**: A tool call arrives with the token of a run that has already ended → refused
  as `run_ended`.

## How many sandboxes run at once

Four kinds of work are counted separately, each against a limit the organization can change:

| Kind of work | Limit unless changed |
| --- | --- |
| Agent workers | 2 |
| Workflow sessions (automation runs) | 2 |
| Render sessions (website crawling) | 2 |
| Light sandboxes (code a chat runs) | 2 |

### SBX-R8 · Each kind of work has its own limit of sandboxes running at once

A sandbox that is starting or working holds a slot of its kind. A stopped workspace holds
none, and takes a slot again when it resumes. At the limit, the next start or resume is
refused (`QUOTA_EXCEEDED`) before any sandbox is created; the other kinds are not affected.
The refusal means "no room yet, ask again", not that the work failed.

- **Example**: Ada's organization keeps the limit of 2 agent workers, and two agents
  are working. A third agent is started on a task → refused as `QUOTA_EXCEEDED`. An
  automation run can still get its sandbox.

### SBX-R9 · Nothing new starts in a workspace that is being destroyed

From the moment a Destroy is asked for until it has finished, or until its last attempt has
failed, a start or a resume in that workspace is refused (`QUOTA_EXCEEDED`, with the reason
`destroy_pending`) and nothing is reserved for it. The refusal is told apart from a full
limit, because what frees is an empty workspace, not room.

- **Example**: Ada destroys an agent's workspace. While its row reads **Destroying**, Mia
  starts the agent on a task → the start is refused with the reason `destroy_pending`.

## Agent workers

Every run of a project agent that works at the same time as another works in a sandbox of its
own, a worker. One agent working three tasks at once has three workers.

### SBX-R18 · Every agent worker is one sandbox and holds one agent-worker slot

The limit of agent workers counts workers, not agents: one agent working three tasks at once
holds three slots. A run that would need one more worker than the limit allows waits for a
slot; a burst of starts opens no more workers than there are slots left.

- **Example**: Ada's organization allows 2 agent workers. Scribe works two tasks → 2 of 2 are
  in use. Lector is started on a task → its run waits until one of Scribe's workers frees.

### SBX-R19 · A worker gives its slot back as soon as its own run ends

A worker stops and frees its slot once no run of its own is left: none working in it, and none
that has taken it and not started yet. The agent's other workers do not keep it up. A pinned
worker keeps its slot (`SBX-R10`), and a worker whose last process is still ending keeps it
until that process has ended.

- **Example**: Ada's agent Scribe works "Release notes" in one worker and "Changelog" in
  another. "Release notes" finishes → its worker stops and its slot is free at once, while
  "Changelog" keeps working.

### SBX-R20 · A run takes a free worker before a new one is opened

A starting run takes, in order: its task's previous worker, a worker that is still up, a
stopped worker (lowest number first), and only then a new one. When the only free worker is
being destroyed, the run waits for the Destroy (`SBX-R9`) instead of opening a worker beside
it.

- **Example**: Scribe's workers 1 and 2 are stopped. Ada starts Scribe on a new task → it
  works in worker 1, and no worker 3 is created.

### SBX-R21 · A member's runs work in that member's own workers

The runs a member starts work in workers kept for that member and the agent, apart from the
workers of the runs editors start, and stay limited to their own task (`SBX-R7`) in whichever
of them they work. A run whose starter lost the editor role while it waited moves into that
member's workers when it starts. An editor's run never lands in a member's worker.

- **Example**: Mia, a member, starts Scribe on two of her tasks → both work at once, each in
  one of Mia's workers, without Scribe's secrets.

## Pinning and destroying a workspace

An owner or admin can pin a workspace, so that it stays on, and destroy one, to delete it at
once (`SBX-R2`).

### SBX-R10 · A pinned workspace is kept running and exempt from automatic cleanup

It is not stopped when its agent's turn ends, its session does not expire, and it is not
deleted for being unused (`SBX-R12`), for disk space or for its size (`SBX-R35`). A pinned workspace can therefore go on holding a slot.
If its sandbox disappears, for example after a host restart, a sandbox is started again for
the same workspace and pinned again; a crawler's temporary sandbox is the exception and is
closed instead. Destroy (`SBX-R11`) and the removal of what the workspace belongs to
(`SBX-R13`) still delete a pinned workspace.

- **Example**: Ada pins an agent's workspace. Nobody uses it for a year → it is still there.
- **Example**: The host restarts and the sandbox of a pinned workspace is gone → a sandbox is
  started again for that workspace and pinned.

### SBX-R11 · Destroy unpins a workspace, deletes it and revokes its gateway keys

A Destroy is queued and answered at once, and the workspace's row says that it is under way.
The workspace is unpinned first, then its sandbox and files are deleted, then the gateway
keys its turns used to reach their models are revoked. If the sandbox service cannot confirm
the deletion, the workspace stays listed and unpinned, and is left for another attempt; when
every attempt has failed, its row says so.

- **Example**: Ada destroys a pinned workspace while the sandbox service is down → the
  workspace stays in the list, now unpinned, and the Destroy is tried again.

## When a sandbox disappears

A sandbox can end without a Destroy, for example when its host restarts or it runs out of
memory. A pinned workspace gets a new sandbox (`SBX-R10`); this covers the others.

### SBX-R17 · A workspace outlives the sandbox it ran in

When the sandbox of a project agent or an automation run on the Tale server disappears
without a Destroy, for example because the host restarted or the sandbox ran out of memory, its
workspace is kept and reads as stopped. The next turn goes on in its files. A start that fails
after that removes only the sandbox it began, never the files. A crawler's temporary sandbox is
closed instead, and so is a workspace the sandbox service no longer holds, or one on a
connected device, which it does not list.

- **Example**: Ada's agent is working on a task when the host restarts → the workspace reads
  **Stopped**, and the agent's next turn finds its files and goes on with its conversation.

## Automatic deletion

Tale deletes a workspace on its own in two cases: nobody has used it for a while, or what it
belongs to is gone. An idle one can also go for the room it takes; see Reclaim by size and
disk pressure. A legal hold keeps every workspace it covers, whatever the two rules below
say; see Not yet.

### SBX-R12 · A workspace nobody used for the set number of days is deleted

This covers a project agent's workspaces. The number of days is the organization's, 30 unless
it was changed, and the organization can switch the rule off. A workspace that is in use,
pinned or has a run waiting to use it is kept. Nothing is deleted for being unused until the
full number of days has passed since the rule, as it stands, took effect. The workspace list
shows the day a stopped workspace will be deleted.

- **Example**: Ada's organization keeps 30 days. An agent's workspace was last used 31 days
  ago → it is deleted. One last used 29 days ago is kept.
- **Example**: The rule took effect 29 days ago, and a workspace has been unused for a year →
  it is kept for one more day.

### SBX-R13 · A workspace is deleted with the agent, member or organization it belongs to

Deleting a project agent deletes its workspaces, without waiting for the unused period.
Removing a member from the organization deletes the workspaces kept for that member's runs.
A pinned workspace goes too. Deleting the organization deletes every sandbox it had, whatever
is running in it, revokes the gateway keys issued to them, removes the provider keys it gave the
gateway and disconnects its devices; the deletion counts as finished only once the files are
confirmed deleted and the gateway holds none of its provider keys.

- **Example**: Ada deletes an agent whose workspace is pinned → the workspace is deleted with
  the agent.
- **Example**: Noah is removed from the organization → the workspaces kept for his runs are
  deleted.
- **Example**: An organization that brought its own OpenRouter key is deleted while one of its
  devices is offline → the gateway drops that key at once; the device is let go once it is back.

## What a turn costs

A turn that reaches its model through Tale's gateway gets a gateway key of its own with an
allowance. What that key spent is the turn's spend.

### SBX-R14 · A turn's spend is booked to whoever started the run

The person who started the run is booked, under the agent or the automation that did the
work. A run started with an API key — an automation's or an agent's — is booked to the key's
holder and to the key. An agent's run is started with a key when a call made with the key
starts it: a task's start, a comment or a review that names the agent, or an automation run
started with the key whose step puts the agent to work. Its automatic retry is booked as the
run it retries was. A comment that restarts a running turn makes the turn its writer's, and
the key's it was written with, if any. A run that a schedule or another trigger started has
no person behind it: it is booked to automations, and only the organization's spending limits
are checked for it. How the run was started is never booked in a person's place.

- **Example**: Mia starts an agent on her task, and the turn costs 25 cents → 25 cents are
  booked to Mia under that agent.
- **Example**: Mia's script comments `@Researcher` on a task with her API key → the agent's
  turns are booked to Mia and to that key, and count toward the key's limits.
- **Example**: A schedule starts an automation at night → its agent step is booked to
  automations, and nobody's personal limit is touched.

### SBX-R15 · A turn's spend is booked once, before its gateway key is deleted

When a turn ends or its sandbox is torn down, what its gateway key spent is read and booked
first, and only then is the key deleted. If the spend cannot be read, the key is kept and
both steps are tried again later. A later attempt books nothing a second time. A key that no
longer exists when its spend is read is closed without an amount.

- **Example**: A sandbox is destroyed while the gateway cannot be reached → its key is kept.
  Once the gateway answers, the spend is booked and the key is deleted.

### SBX-R16 · A turn or image a spending limit refuses holds no budget

Before a turn starts, its allowance is set aside against every spending limit that applies to
its starter, together with what other work in flight already holds. When a limit refuses it,
nothing is set aside and the refusal carries the limit's own sentence. An agent's image
request is refused the same way (`budget_exceeded`) and holds nothing either. A turn on a
provider subscription sets aside one request and no cost (`GOV-R16`).

- **Example**: Mia's monthly cost limit is used up. She starts an agent whose model the gateway
  serves on a task → the turn is refused with the limit's sentence, and nothing is held against
  her limit.

## Light sandboxes for chat

A light sandbox runs the code of one conversation. It starts in about a second, keeps no
workspace, and is removed once it idles; [`chat`](../chat/spec.md) states what its files become.

### SBX-R22 · Each conversation has one light sandbox of its own

A conversation finds its own light sandbox for as long as it lives, and never another
conversation's or another organization's.

- **Example**: Mia's chat runs code twice → both runs work in the same sandbox. Noah's chat in
  the same organization runs code → a sandbox of its own.

### SBX-R23 · At the limit, a new light sandbox takes the slot of the longest-idle one

When the organization runs as many light sandboxes as its limit allows, a new one takes the slot
of the one idle longest, if it has been idle for at least 30 seconds; a busy one is never taken.
When none is idle, the request is answered as busy, and nothing waits in line.

- **Example**: The limit is 1, and Noah's chat finished its code a minute ago. Mia's chat runs
  code → Noah's sandbox is removed and Mia's starts. Had Noah's still been running, Mia's chat
  would be told to try again.

### SBX-R24 · A light sandbox unused for five minutes is removed

One still running code is spared until it is done.

- **Example**: Mia's chat last ran code at 10:00 → after 10:05 its sandbox is removed, and her
  next request at 10:20 starts a fresh one.

### SBX-R25 · A light sandbox cannot be pinned

A pin would keep a sandbox that is removed as soon as it idles, so it is refused as if the
workspace did not exist (404).

- **Example**: Ada pins the light sandbox of Mia's chat → not found; nothing changes.

### SBX-R26 · A failed start never costs the conversation its working sandbox

When a start fails and a retry works, the failed attempt's age is no reason to remove the
working sandbox. It is removed only once it has itself been unused for five minutes.

- **Example**: Mia's chat could not start a sandbox at 10:00 (the host was busy) and got one at
  10:01, last used at 10:04 → at 10:06 the sandbox is still there, with its files.

## Current execution discovery

### SBX-R27 · Discovery binds self identity without changing grants

`workspace_status` may return `currentExecution` only after the existing task-run authority reader matches the token’s organization, session and exec to a live queued/running task run and its agent/project, with schedule revocation retained. Body claims and earlier guidance do not supply it. Ended, superseded or unavailable task identity is null; chat, workflow and legacy discovery can omit it. Expired authentication is still refused. Tool grants and mutation authority stay unchanged. This read is an observation, not a capacity reservation or start, command or publication allowance.

- **Example**: A resumed turn’s old token names its superseded exec → discovery keeps identity unknown rather than reporting that exec as current.

## Heavy-phase leases

A sandbox host is admitted into when work starts, but what presses it comes later: installing
dependencies, building an image, checking a whole workspace, running a full test suite. Before
such a phase, an agent asks the host for a lease.

### SBX-R28 · A task run asks the host for a lease before a heavy phase

Before such a phase, a project agent's task run asks the sandbox host for a lease on its own
sandbox (`host_lease_acquire`). Every task run has the tool where its agent runtime can reach the
platform's tools; no grant is needed. The host grants the lease while it is not under pressure,
runs fewer heavy phases than its limit, and keeps room on disk and in memory beside the others;
the platform records which run holds it. A run holds one lease at a time: asking again while it
holds one answers that lease (`held`).

- **Example**: Ada's agent is about to run `npm ci` while the host is calm → it gets a lease with
  its ID and expiry, runs the install, then releases the lease.

### SBX-R29 · A refused lease says why and when to ask again

The answer names the reason — the host is under pressure (`pressure`), as many heavy phases as it
runs at once already run (`limit`), disk or memory would run short beside them (`disk`,
`memory`), or its readings are out of date (`stale`) — and how many seconds to wait
(`retryAfterSeconds`). The agent waits and asks again instead of running the phase. A host that
does not answer is asked again the same way (`unreachable`).

- **Example**: Two builds hold the host's two leases. Ada's agent asks for a third → refused as
  `limit`, to ask again in 30 seconds; it waits, asks again once a build has ended, and gets the
  lease.

### SBX-R30 · Where the host cannot be judged, the agent works without a lease

On Kubernetes, on Incus, with a remote Docker daemon, with a sandbox service that has no leases,
or when the service's answer cannot be read, the answer is `unavailable`: leases do not exist
there, so the agent runs the phase without one instead of waiting. No run waits for a lease
that cannot come.

- **Example**: Ada's organization runs its sandboxes on Kubernetes. Her agent asks for a lease →
  `unavailable`, and it starts the build at once.

### SBX-R31 · A run releases only its own leases, on its own sandbox

The run, its sandbox and its organization come from the turn's session token; whatever the call
names is ignored. A lease of another run, even one on the same sandbox, is answered as not found
and stays held. Only a project agent's live task run takes leases: any other session is refused
(`not_a_project_agent_run`), and so is a run that has ended (`run_ended`).

- **Example**: Ada's agent releases the lease ID of a run of Noah's agent → not found, and Noah's
  lease stays held.

### SBX-R32 · Every lease of a run ends when the run ends

When a run settles, fails or is cancelled, every lease it still holds is released on the host. A
lease the host no longer holds — expired, its sandbox gone, the service restarted — counts as
released. When the host cannot be asked, the release is tried again, and the sandbox sweep ends
what is left five minutes after the run ended. A lease also ends by itself at its expiry, at most
two hours after it was granted.

- **Example**: Ada cancels her agent's run in the middle of a Docker build → its lease ends with
  the run, and the next agent's build can start.

### SBX-R33 · Only owners and admins see which runs hold the host's leases

The list of the organization's active leases names runs, tasks, agents and sandboxes, so it
follows the workspace list (`SBX-R2`): anyone else is refused (HTTP 403). The capacity reading,
which developers read too (`SBX-R1`), carries only how many leases the host holds and how many it
grants at once.

- **Example**: Noah has the developer role. He asks for the active leases → refused; the
  capacity he reads says 1 of 2 leases is in use.

## Reclaim by size and disk pressure

A workspace keeps everything its agent installed and built, on a disk every organization on the
sandbox host shares; while that disk is below the free space the host keeps, every new session is
refused there. So the hourly cleanup also deletes idle workspaces for the room they take.

### SBX-R34 · While the sandbox disk is short, the largest idle workspaces go first

When the sandbox host's workspace disk is below its floor, the free space the host keeps for new
sessions, the hourly cleanup deletes idle project-agent workspaces, the largest first, whichever
organization on the host holds them. It stops once the space those deletions free brings the
disk back to twice its floor. A deletion still waiting for its workspace to stop frees nothing in
that count; one whose files are being deleted does.

- **Example**: The host has 6 GiB free and a 10 GiB floor. Ada's organization has idle workspaces
  of 26 and 4 GiB, Noah's one of 22 GiB → Ada's 26 GiB workspace is deleted; the others stay,
  since 32 GiB is more than twice the floor.

### SBX-R35 · Only an idle workspace is deleted for disk space or for its size

Idle means a live project agent's workspace that no sandbox runs in, no run waits for, and nobody
has used for the organization's idle hours, 24 unless changed. A pinned workspace, one a legal
hold keeps, and one its organization's records do not hold are never deleted for disk space or
size. The decision is taken again right before the deletion, so a workspace used again in
between stays, and the sandbox service refuses one that any compute runs in.

- **Example**: Ada's agent finished in a 30 GiB workspace two hours ago, and Noah pinned a 40 GiB
  one a month ago → both stay while the disk is short.

### SBX-R36 · A workspace without a known size is never deleted for space or size

Sizes come from the sandbox service, which measures each workspace at most every ten minutes and
at most fifty in one request. A workspace it has not measured, could not measure in time, or
last measured before the workspace was last used counts as having no size: it is skipped, and
nothing is counted for it.

- **Example**: The service has measured 50 of Noah's 60 workspaces → only those 50 can be
  deleted in this hour's cleanup.

### SBX-R37 · An idle workspace above its organization's size cap is deleted

An organization can set a maximum workspace size in GiB; there is none unless it does. The hourly
cleanup then deletes every idle workspace measured above it, the largest first, whether the disk
is short or not, and what that frees counts toward the room the disk needs.

- **Example**: Ada sets 30 GiB. An agent's workspace has been idle for two days at 34 GiB → it is
  deleted at the next hourly cleanup; one of 28 GiB stays.

### SBX-R38 · An organization can keep its workspaces out of the disk reclaim

The disk reclaim is on unless the organization switches it off. Switched off, its idle workspaces
are not deleted for disk space, and the other organizations' still are. A policy saved before
these settings existed reads their defaults, and one that cannot be read deletes nothing for disk
space or size that hour.

- **Example**: Ada switches **Free disk space when it runs short** off, and the disk runs short →
  her organization's idle workspaces stay; Noah's largest idle one goes.

### SBX-R39 · A deletion for space or size is audited with its reason and size

Like every automatic deletion, it appears in the audit log once its files are confirmed gone. Its
reason reads `disk_pressure` or `over_size`, and its details give the size measured, when it was
measured, and the disk's free space and floor, or the organization's cap.

- **Example**: Ada's 26 GiB workspace is deleted while the disk is short → the audit log lists
  **Sandbox workspace deleted** with the reason `disk_pressure` and its size.

## Not yet

- **Egress**: which addresses a sandbox can reach is decided by the sandbox service, outside
  this workspace. Nothing here states or tests it.
- **Waiting for room**: what a task run, an automation step and a crawl do after `SBX-R8` and
  `SBX-R9` belongs to the tasks, automations and websites domains. Not covered here: a
  deployment that is full or short of memory, a workspace whose runtime already runs four execs,
  the place in line a waiting start gets, and waking the waiting runs (`sessions.ts`,
  `idle-release.ts`, `core/node_only/sandbox/capacity_refusal.ts`).
- **Health checks and repair**: ending a session after its lifetime while sparing a turn that
  is still working, closing a crawler's sandbox that disappeared, collecting failed starts,
  reclaiming the sandboxes of ended runs and crawls, and picking a turn up again after a
  restart (`watchdogs.ts`, `recovery.ts`, `service.ts`, `wait-retention.ts`,
  `retirement-schedule.ts`).
- **Delivering a pin change**: it is saved first and delivered until the sandbox service
  confirms it (`service.ts`).
- **Image generation** beyond `SBX-R16`: one request at a time, 16 images a turn, and the hold
  against the turn's allowance (`image-generation.ts`).
- **The reach of the other tools**: which projects' knowledge and tasks an automation's agent
  reaches, and the task metadata and review tools (`TASK_METADATA_FORBIDDEN`,
  `TASK_REVIEW_FORBIDDEN`) (`shim.ts`, `workspace-write-shim.ts`).
- **Credentials handed into a sandbox**: the token of an equipped GitHub connection and the
  record written each time it is handed over, and the limits of a gateway key itself
  (`core/node_only/sandbox/session_credentials.ts`, `turn_equipment.ts`,
  `gateway_provisioning.ts`). Agent secrets have their own spec.
- **Size limit on a tool call**: a body over 8 MB is refused (HTTP 413)
  (`door-body-limit.ts`).
- **Leases beyond a project agent's task run**: an automation's agent step, a chat and a standard
  agent run in a light sandbox take no heavy-phase lease (`SBX-R28`), and the Sandboxes page
  does not show the active leases yet; the readback route serves them (`SBX-R33`).
- **The engine behind a turn**: rendering pages for a crawl, collecting the files a turn
  produced, connector calls made from a sandbox, administering the gateway, and the platform
  version an agent is told (`render_fetch.ts`, `session_exec.ts`, `connectors_bridge.ts` and
  `llm_gateway_admin.ts` under `core/node_only/sandbox/`, `serving-platform.ts`).
- **Harness metrics**: the harness-turn metrics and the harness health hint, and who can read
  them. No test holds who can (`routes.ts`, `external-turn-outcome.ts`).
- **A legal hold keeps every workspace it covers**, whatever `SBX-R12` and `SBX-R13` say. Only
  the integration lane proves it (`workspace-cleanup.integration.ts`), so no test title can
  name it.
- **Around `SBX-R12` and `SBX-R13`**: which changes restart the wait (switching the rule on,
  shortening the period), the audit entry of each automatic deletion, and the hourly cleanup of
  leftovers nothing owns (`unused-rule.ts`, `workspace-cleanup.ts`).
- **The reclaim between hourly cleanups, and on other hosts**: a disk that fills between two
  cleanups refuses new sessions until the next one; a Kubernetes or Incus host reports no disk,
  so nothing is reclaimed there; and no workspace is held to a size while it works
  (`workspace-reclaim.ts`).
- **A session token stops working once it is revoked or has expired.** No unit test holds the
  check (`getSessionTokenByHash` in `sessions.ts`).
- **A run carries no figure of its own for `SBX-R14`**, and **a call cut short is booked at
  what the gateway kept** against `SBX-R15`; the contract debt ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records both.
