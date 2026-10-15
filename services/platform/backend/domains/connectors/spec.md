# Connectors — whom a connector call acts for, and how an account gets connected

> **Prefix** `CONN-` · **Suite** [`connectors`](../../../tests/manual/suites/connectors.md) · **Docs** [`connectors/overview`](../../../../../docs/en/platform/connectors/overview.md)

A connector lets an agent or an automation act in an outside system: read a mailbox, file a
ticket, fetch issues. These rules cover whom such a call acts for, when it is refused, how an
account is connected by signing in at the outside system, what importing tasks through a
connector may write, where an agent's call runs, and which mailbox an Outlook credential
reaches. The catalog of connectors and what each
one can do are not covered; see Not yet.

## Whom a connector call acts for

### CONN-R1 · An agent's connector call acts for the person who started its run

For a run started over the API with a key, that is the member the start named. The call is
counted as theirs too, under the agent, as a connector call and never a model request
(`GOV-R15`).

- **Example**: Mia starts an agent on her task, and the agent reads a ticket through a
  connector → the call is made as Mia.

### CONN-R2 · A connector must be granted to the turn before anything else is looked at

A call to a connector the turn was not granted is refused first, whoever the caller is.

- **Example**: An agent's turn was granted the mail connector. It calls the ticketing
  connector → refused, without a check of who started the run.

### CONN-R3 · A call from a run nobody started is refused

A run that a schedule or another automation started has no person behind it. Its connector
calls are refused (`no_user_context`), and the refusal says how to start a run that acts for
a member.

- **Example**: A scheduled automation's agent calls a connector that acts for a person →
  refused, with the advice to start the run as a member.

### CONN-R4 · A call from a run that has ended is refused

This holds for a run that finished, failed or was cancelled, and for an earlier attempt of a
run that was restarted (`run_ended`). Nobody's membership is read for it.

- **Example**: A tool call arrives from a sandbox whose run was cancelled a minute ago →
  refused as `run_ended`.

### CONN-R5 · A call for someone who is no longer an active member is refused

When the person who started the run has left the organization, or their membership was
disabled, the run's connector calls are refused (`access_denied`).

- **Example**: Noah starts a long agent run and is removed from the organization while it
  works → the run's next connector call is refused.

### CONN-R6 · A request over the size limit is refused before it is read

(`PAYLOAD_TOO_LARGE`)

- **Example**: A sandbox sends a connector call with a body far over the limit → refused, and
  nothing is passed on to the outside system.

## Connecting an account

Some connectors are connected by signing in at the outside system and approving Tale's
access there. The person is sent to the outside system and comes back with an answer that
Tale turns into a stored credential.

### CONN-R7 · Only the person who started a connection can finish it

An answer that comes back in another person's session, or with no session, is refused
(`invalid_state`), and the attempt cannot be used again. A person who lost the right to
manage connectors while they were away is refused too (`forbidden`).

- **Example**: Ada starts connecting a mail account and sends the link she was redirected to
  to Noah. Noah opens it → refused, and Ada has to start again.

### CONN-R8 · Adding an account stores a new credential; reconnecting renews the one named

Adding a second account never renews the first: it is stored beside it under its own name.
Reconnecting renews exactly the credential it was started for, not the connector's default,
and keeps a paused credential paused. When that credential was deleted in the meantime, the
reconnect is refused (`credential_missing`) instead of landing on another one.

- **Example**: A connector has two accounts. Ada reconnects the second → the second is
  renewed, and the first, the default, is untouched.

### CONN-R9 · The answer from the outside system cannot choose which credential is written

Which credential a connection writes is fixed when the connection is started, by someone who
is allowed to manage connectors. Nothing in the returning request can change it.

- **Example**: Someone alters the returning address to name another credential → the
  credential that was fixed at the start is the one written.

### CONN-R10 · A Slack workspace has one credential, however often it is connected

Connecting a workspace that is already connected renews its credential, even when the person
chose to add an account. A second workspace gets a credential of its own, named after the
workspace.

- **Example**: Ada connects the same Slack workspace a second time through **Add** → the
  existing credential is renewed, and no duplicate appears.

## Importing tasks

### CONN-R11 · An import of tasks writes only into the project of the run that does it

An automation that imports tasks from an outside system writes into the project its run
belongs to. A run of another project, and an import with no run, are refused
(`PROJECT_NOT_FOUND`). A run a member started imports within what that member can do
(`RBAC_FORBIDDEN` otherwise).

- **Example**: An automation in the project Support imports issues and names the project
  Billing as the target → refused.

### CONN-R12 · Importing the same items again keeps the progress made on them here

A task that was imported before is matched within its project, not duplicated. A repeat
leaves the task's status and its description as they are in Tale.

- **Example**: An issue was imported and Mia moved its task to Done. The import runs again →
  the task is still Done, and there is one task for the issue.

## Where a connector call runs

### CONN-R13 · An agent's connector call runs on the platform, never inside the agent's sandbox

The connector's code runs in the platform with the organization's credential, and the
sandbox gets back only the result. No process of the agent's sandbox is handed the
credential for the call.

- **Example**: Mia's agent searches the web through the Tavily connector → the search runs
  on the platform with the organization's Tavily key, and nothing in Mia's sandbox sees
  the key.

### CONN-R14 · An agent's connector calls are bounded on the platform

One sandbox session's agents have at most four connector calls running at once; a further
call is refused as busy and can be tried again. A call that outlives its time limit can no
longer reach the outside system, and an agent's call stores no files in the organization's
file store.

- **Example**: Mia's agent starts five Google Drive listings at once → four run and the
  fifth is refused as busy; a listing still paging after its minute is cut off at its next
  request, and a Gmail attachment the agent reads is not saved to the organization's files.

## Calling any HTTPS API

The HTTP connector lets an automation step call an outside API it has no connector for:
`http.get` reads and `http.send` writes, behind an approval like every write. A credential of
the connector holds the API's base URL and signs the call with a bearer token, an API key in a
header, or a user name and password.

### CONN-R15 · A call without a credential carries none, and reaches public HTTPS hosts only

A step that names no credential is never signed with the organization's default one. It may
call a public address over HTTPS, and never a private network address or a cloud metadata
address.

- **Example**: Ada's step reads `https://status.example.com/api` without a credential → the
  call goes out unsigned. Her step on `http://169.254.169.254/latest` is refused before any
  request leaves (`HTTP_BLOCKED_HOST`).

### CONN-R16 · A credentialed call stays under its credential's base URL, redirects included

A path is placed under the base URL; a full address must start with it, with the same scheme,
host and port. A redirect may not leave the base's host, and an answer whose redirects ended
outside the base is refused (`HTTP_OFF_ORIGIN`).

- **Example**: The credential Shop API holds `https://api.shop.example/v2`. Noah's step reads
  `/orders` → `https://api.shop.example/v2/orders`. His step on `/../admin` is refused before
  any request leaves.

### CONN-R17 · Only the credential signs an HTTP call, and nothing handed back carries it

A step may not set `Authorization`, `Cookie` or the API key header (`HTTP_HEADER_RESERVED`).
The answer keeps an allowlist of headers, and every value of the credential is replaced with
`[redacted]` wherever the answer or a failure would carry it.

- **Example**: An API echoes the request's bearer token in its body → the step's output and
  the run's record read `[redacted]` where the token was.

### CONN-R18 · An organization's HTTP calls are bounded

An organization's steps make at most 120 HTTP calls a minute across the deployment and 10 at
once in one server process; a call over the minute's budget is refused, and one over the
number at once waits for a slot as long as its own timeout allows (`HTTP_RATE_LIMITED`).

- **Example**: A step loops over 500 orders, calling the API for each → the 121st call within
  the minute fails, saying the organization made too many HTTP calls.

### CONN-R19 · A connector step acts as the credential it names

A step's `credential` names the stored credential by id or by name, whatever its case. A step
that names none acts as the organization's default credential for the connector — or, where
the connector's credential is optional, as none (`CONN-R15`).

- **Example**: Mia's automation has two GitHub credentials, Release bot and Triage bot. Her
  step names `release bot` → the call is made as Release bot.

## Searching the organization's knowledge

The Knowledge connector lets an automation step search the organization's documents and its
indexed web pages: `knowledge.search` returns the passages that match a query best, for a
later step to use. It changes nothing.

### CONN-R20 · A knowledge search searches as its automation run, and only as one

Which run a search belongs to comes from the call itself, never from the step's input. A call
that is not a step of an automation run — a person's, the system's — is refused before
anything is searched.

- **Example**: Ada's step searches for "refund window" in her automation's run → the search
  runs as that run. A call naming no run is refused (`CALLER_UNKNOWN`).

### CONN-R21 · A refused knowledge search says why

A search with no embedding model to use fails with `KNOWLEDGE_NOT_CONFIGURED`, one the
embedding provider refused or failed with `KNOWLEDGE_UNAVAILABLE`, and one a usage limit
refused with `BUDGET_EXCEEDED` — a refusal the run counts as a limit, not as a connector that
always fails.

- **Example**: The organization has no embedding model → Noah's run fails at its search step,
  saying knowledge search isn't set up and where an administrator chooses a model.

### CONN-R22 · A knowledge search reads what its run may read, and spends as the run

A run in a project reads that project's documents; a run of an automation bound to projects,
started for the whole organization, reads those projects'; an automation bound to none reads
only the documents every member shares. Never a team library the run is not given, and never
a conversation's uploads or mail. Embedding the query counts toward the limits that bind the
run, as an `llm` step's call does.

- **Example**: Mia's automation runs in the project Website relaunch → its search finds the
  project's files and the shared documents, and never a file of Customer onboarding portal.

## Creating tasks from an automation

The Tasks connector's `task.create` lets an automation step create a task in a project — from
an email, a form or a failed check — without an agent step.

### CONN-R23 · An automation step creates one task per execution, as the automation

The task is created in a project the automation is installed in (and only the run's own project,
for a run started in one), with the rights of the person who started the run, or of the
automation alone for a run a trigger started. It names the automation as its creator. Its id comes
from the execution's ledger key, so a retry of the same execution answers the task it already
made, and another execution — another item, another pass — makes another.

- **Example**: Ada's support automation runs for an email and creates "Reply to Ada about the
  refund" in Customer onboarding portal. The run is interrupted after the write and resumes → the
  step answers the same task, and the board shows one.

### CONN-R24 · A refused task creation says why, and writes nothing

A project the automation is not installed in, or another project than the run's own, fails the
step with `TASK_PROJECT_NOT_BOUND`; an assignee no member of the organization and no agent of the
project answers to, or one who may not work in the project, with `TASK_ASSIGNEE_UNKNOWN`. Nothing
the call began — a label it minted — stays written.

- **Example**: Noah's step assigns the task to `nobody@example.com` → the run fails at the step,
  saying the task's assignee isn't known and how to name one.

### CONN-R27 · A task listing reads only a project its run may read, and lists each task once

A `task.list` step lists a project's tasks, newest first and archived ones left out, narrowed to
the statuses it names and to the tasks created at or after one moment and before another, so two
windows that follow each other never list a task twice; at most 200 per call with `hasMore` when
more match. Asked for the oldest first, a listing with more to come also answers `next`, the place
behind its last task (its creation moment, then its id), and a listing handed that place as
`after` carries on behind it — so a window read call by call lists every task in it once, even
tasks created in the same millisecond. It reads a project as the run creates there: one its
automation is installed in, or any when it is installed in none, within the rights of the person
who started the run. Any other project fails the step with `TASK_PROJECT_NOT_BOUND`.

- **Example**: Noah's morning digest lists the To do tasks of Website relaunch created since
  yesterday → it gets them newest first; pointed at Customer onboarding portal, where it is not
  installed, the run fails at the step and says so.
- **Example**: A busy day leaves 130 new tasks and the digest lists 50 at a time, oldest first →
  each listing carries on behind the last task the one before it listed, and the three listings
  hold all 130, each once.

## Telling members from an automation

A `notify.member` step sends a message to members of the organization, as its automation run:
the run names the automation in the message's frame, and `run-starter` means the run's own
starter.

### CONN-R25 · A message step tells the members it names, and refuses anyone who is not one

Members are named by email (any case) or user id; someone named twice is told once.
`run-starter` is the person who started the run — a run a trigger started, or whose starter
left, has none, and the step lists it as skipped. Someone who switched off messages from
automations is skipped and listed. A recipient who is not a member — or whose membership is
disabled — fails the step with `NOTIFY_NOT_A_MEMBER`, and nobody is told: a message never
quietly misses someone it names.

- **Example**: The weekly report step names `ada@example.com` and `run-starter` on a schedule's
  run → Ada is told; `run-starter` is listed as skipped, because no person started the run.

### CONN-R26 · A message step sends once per execution, and a run sends a bounded number

A retry of the same execution tells nobody twice: it answers the members the first try reached.
One run sends at most 100 messages across its steps; a step that would pass that fails with
`NOTIFY_RUN_LIMIT` and sends none.

- **Example**: A step in a loop tells the account owner about each of 150 overdue invoices → the
  run stops at the step that would send the 101st message, and says to send one message to
  several members instead.

## Native task receipt metadata

### CONN-R28 · A task read names one requested run, and comment IDs come from their rows

`task.get` with `agentRunId` returns only that run’s identity, status and clocks when it belongs to the already read task, project and organization. A missing or foreign run is `agentRun: null`, never a different or latest run. Without the option, the original response stays unchanged. `task.list_comments` with `includeIds: true` adds native message IDs beside the existing trusted author metadata; text in a comment cannot supply its ID. Reads change no grants or admission rules.

- **Example**: A checkpoint claims a run from another task → the read returns null metadata; the checker keeps identity unknown instead of borrowing the latest run.

## Reaching a shared mailbox

An Outlook credential may name a mailbox to work in, such as a shared mailbox nobody signs in
to. The organization's own app can reach it signing in as itself, and a person who has Full
Access to it can reach it through their own sign-in.

### CONN-R29 · An Outlook credential naming a mailbox acts on it, whoever signed in

Every call it makes lists, reads, drafts and sends in that mailbox, and the mailbox's address
is the identity the Inbox, the composer and the mail sync use. A credential that names none
acts on the signed-in account's own mailbox. An app that signs in as itself has no mailbox of
its own, so its credential is refused until it names one (`CREDENTIAL_CONFIG_REQUIRED`).

- **Example**: The organization's app is connected for `promotion@example.com` → the Inbox
  lists the mail that arrives there, and Lena's reply leaves from `promotion@example.com`.

### CONN-R30 · A refused call on a named mailbox says how that mailbox is granted

When Microsoft Graph denies access to the named mailbox, the refusal names the mailbox, the
Exchange application role the app needs for the action, scoped to the mailbox with RBAC for
Applications, and for a person Full Access (and Send As, to send) followed by a reconnect. A
mailbox Graph does not know is refused as such, and a throttled call still names Graph's wait.

- **Example**: The app was granted reading but not sending, and Ada's automation replies from
  `promotion@example.com` → the step fails, saying the app needs "Application Mail.Send" for
  that mailbox.

### CONN-R31 · Only a credential naming a mailbox asks for shared-mailbox permissions

A new Outlook connection asks for the account's own mailbox only, so an account that cannot
grant shared-mailbox permissions can still connect. Reconnecting a credential that names a
mailbox asks for them as well.

- **Example**: Lena connects her own mailbox, then names the shared `support@example.com` on
  the credential and reconnects → the consent screen now asks for access to mailboxes she
  can open.

## Not yet

- **The catalog of connectors**, what each can do, and which need an approval before they
  write: see the approvals spec for the approval itself.
- **A connector's credentials**: see the connector credentials spec.
- **The app registration a deployment uses** for a sign-in at the outside system
  (`oauth-apps.ts`), and reusing the one for enterprise sign-in (`sso-reuse.ts`).
- **Documents a connector reads and writes** (`document-store.ts`, `document-listing.ts`,
  `blob-sink.ts`), and events Slack sends (`slack-events.ts`).
- **The size of the limit** in `CONN-R6`.
