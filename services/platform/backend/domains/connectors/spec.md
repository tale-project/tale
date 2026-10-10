# Connectors — whom a connector call acts for, and how an account gets connected

> **Prefix** `CONN-` · **Suite** [`connectors`](../../../tests/manual/suites/connectors.md) · **Docs** [`connectors/overview`](../../../../../docs/en/platform/connectors/overview.md)

A connector lets an agent or an automation act in an outside system: read a mailbox, file a
ticket, fetch issues. These rules cover whom such a call acts for, when it is refused, how an
account is connected by signing in at the outside system, what importing tasks through a
connector may write, and where an agent's call runs. The catalog of connectors and what each
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
call a public address over HTTPS; a private network address is reached only where the
deployment admits private hosts, over HTTPS or plain HTTP, and a cloud metadata address
never.

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

## Not yet

- **The catalog of connectors**, what each can do, and which need an approval before they
  write: see the approvals spec for the approval itself.
- **A connector's credentials**: see the connector credentials spec.
- **The app registration a deployment uses** for a sign-in at the outside system
  (`oauth-apps.ts`), and reusing the one for enterprise sign-in (`sso-reuse.ts`).
- **Documents a connector reads and writes** (`document-store.ts`, `document-listing.ts`,
  `blob-sink.ts`), and events Slack sends (`slack-events.ts`).
- **The size of the limit** in `CONN-R6`.
