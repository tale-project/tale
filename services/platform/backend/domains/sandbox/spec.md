# Sandbox — who can manage a workspace, what it can reach, and what its work costs

> **Prefix** `SBX-` · **Docs** [`admin/sandboxes`](../../../../../docs/en/platform/admin/sandboxes.md)

A sandbox is the isolated environment an agent works in, and its workspace is the files it
keeps between turns. These rules cover who can see and manage workspaces, what an agent in a
sandbox can reach, how many sandboxes run at once, when a workspace is deleted, and how a
turn's spend is booked. Connected devices and agent secrets have their own specs. Egress, the
health checks, image generation and how waiting work resumes are not covered; see Not yet.

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
document to the project; anything else is refused (`member_run`). It stays limited when an
editor steers it later, and a starter who loses the editor role during the run is treated as
a member from then on. Reading the project's tasks stays possible. Once a run has ended, its
tools act for nobody (`run_ended`).

- **Example**: Mia, a member, starts an agent on her task. The agent tries to close another
  task of the project → refused as `member_run`, and the other task is unchanged.
- **Example**: A tool call arrives with the token of a run that has already ended → refused
  as `run_ended`.

## How many sandboxes run at once

Three kinds of work are counted separately, each against a limit the organization can change:

| Kind of work                        | Limit unless changed |
| ----------------------------------- | -------------------- |
| Project agent sessions              | 2                    |
| Workflow sessions (automation runs) | 2                    |
| Render sessions (website crawling)  | 2                    |

### SBX-R8 · Each kind of work has its own limit of sandboxes running at once

A sandbox that is starting or working holds a slot of its kind. A stopped workspace holds
none, and takes a slot again when it resumes. At the limit, the next start or resume is
refused (`QUOTA_EXCEEDED`) before any sandbox is created; the other kinds are not affected.
The refusal means "no room yet, ask again", not that the work failed.

- **Example**: Ada's organization keeps the limit of 2 project agent sessions, and two agents
  are working. A third agent is started on a task → refused as `QUOTA_EXCEEDED`. An
  automation run can still get its sandbox.

### SBX-R9 · Nothing new starts in a workspace that is being destroyed

From the moment a Destroy is asked for until it has finished, or until its last attempt has
failed, a start or a resume in that workspace is refused (`QUOTA_EXCEEDED`, with the reason
`destroy_pending`) and nothing is reserved for it. The refusal is told apart from a full
limit, because what frees is an empty workspace, not room.

- **Example**: Ada destroys an agent's workspace. While its row reads **Destroying**, Mia
  starts the agent on a task → the start is refused with the reason `destroy_pending`.

## Pinning and destroying a workspace

An owner or admin can pin a workspace, so that it stays on, and destroy one, to delete it at
once (`SBX-R2`).

### SBX-R10 · A pinned workspace is kept running and exempt from automatic cleanup

It is not stopped when its agent's turn ends, its session does not expire, and it is not
deleted for being unused (`SBX-R12`). A pinned workspace can therefore go on holding a slot.
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

## Automatic deletion

Tale deletes a workspace on its own in two cases: nobody has used it for a while, or what it
belongs to is gone. A legal hold keeps every workspace it covers, whatever the two rules
below say; see Not yet.

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
is running in it, revokes the gateway keys issued to them and disconnects its devices; the
deletion counts as finished only once the files are confirmed deleted.

- **Example**: Ada deletes an agent whose workspace is pinned → the workspace is deleted with
  the agent.
- **Example**: Noah is removed from the organization → the workspaces kept for his runs are
  deleted.

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

## Not yet

- **Egress**: which addresses a sandbox can reach is decided by the sandbox service, outside
  this workspace. Nothing here states or tests it.
- **Waiting for room**: what a task run, an automation step and a crawl do after `SBX-R8` and
  `SBX-R9` belongs to the tasks, automations and websites domains. Not covered here: a
  deployment that is full or short of memory, the place in line a waiting start gets, giving a
  slot back when a turn ends, and waking the waiting runs (`sessions.ts`, `idle-release.ts`,
  `core/node_only/sandbox/capacity_refusal.ts`).
- **Health checks and repair**: ending a session after its lifetime while sparing a turn that
  is still working, closing a workspace whose sandbox disappeared, collecting failed starts,
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
- **A session token stops working once it is revoked or has expired.** No unit test holds the
  check (`getSessionTokenByHash` in `sessions.ts`).
- **A run carries no figure of its own for `SBX-R14`**, and **a call cut short is booked at
  what the gateway kept** against `SBX-R15`; the contract debt ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records both.
