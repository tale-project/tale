# MCP — what a coding agent can do through Tale's MCP endpoint

> **Prefix** `MCP-` · **Suite** [`mcp`](../../../tests/manual/suites/mcp.md) · **Docs** [`automations/assistant`](../../../../../docs/en/platform/automations/assistant.md)

The rules of the door a coding agent uses to work in Tale, `/api/v1/mcp`: whom a call acts as and
what the key holder's role lets it change, how a refusal or a bad argument reaches the agent, what a
request and a batch of calls cost, what is kept of a call, and which protocol revisions the endpoint
speaks. What a call does once it reaches an automation or the capability surface, and the tool
inventory itself, are not covered; see Not yet.

## Who can do what

A call acts as the person who holds the API key, in the organization the key names, with that
person's role in it at the time of the request.

| | Owner, admin or developer | Any other member |
| --- | --- | --- |
| Save a version, deploy one, set a trigger | yes | no |
| Read, validate and test automations | yes | yes |

### MCP-R17 · Only owners, admins and developers can save, deploy or set a trigger over MCP

Saving a version, deploying one and setting a trigger take the owner, admin or developer role.
Anyone else's agent gets a refusal it can read (`FORBIDDEN_DEVELOPER_SETTINGS`), and nothing is
saved, deployed or bound. Reading, validating and testing stay open to every member. Starting and
stopping live runs follow the [automation rules](../automations/spec.md) (`AUTO-R1`).

- **Example**: Mia is an ordinary member. Her coding agent saves a new version of
  `billing/dunning` → refused, and no version is saved; it then lists the automations → they are
  listed.
- **Example**: Noah is a developer. His agent saves the same version → it is saved.

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
Anything else that goes wrong is answered as `INTERNAL_ERROR` with the request id the agent can
quote, and the error itself is logged and reported on the server, never sent to the agent.

- **Example**: Ada's agent cancels a run while the database is unreachable → the answer is
  `INTERNAL_ERROR` with `data.requestId`, and nothing about the database; the operator finds the
  error under that request id.

## Requests and batches

### MCP-R19 · A batch of calls costs as many requests as the calls it carries

One request may carry up to 20 messages; a larger batch is refused whole. The request is charged
to the key holder's request budget, and every tool call after the first is charged again. Once the
budget is spent, each remaining call is answered with the wait (`retryAfterMs`) and nothing runs
for it, while the calls before it stand.

- **Example**: Ada's budget has room for two more requests. Her script sends one request carrying
  three tool calls → the first two run, and the third is answered with the time to wait.

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
itself when it connected. No argument, result or address is kept, so nothing an agent pasted into a
call ends up in the counters or in the log line the call writes. The same key in two organizations
counts twice, once in each. Counters are kept 90 days, and an erasure of the person removes theirs.

- **Example**: Ada's agent calls `get_run` three times in Acme and once in Beta → Acme counts three
  `get_run` calls of Ada's key that day, Beta one, and neither holds the run id she asked for.

## Protocol versions

### MCP-R16 · A protocol revision it does not speak is answered with the revisions it does

The endpoint speaks the MCP revisions 2025-06-18 and 2025-03-26. A client whose `initialize`
proposes another revision is answered with the newest one the endpoint speaks; a request whose
`MCP-Protocol-Version` header names another revision is refused with the revisions it speaks.

- **Example**: Ada's client sends `MCP-Protocol-Version: 2024-11-05` → refused, naming 2025-06-18
  and 2025-03-26; its `initialize` proposing 2024-11-05 is answered with 2025-06-18.

## Not yet

- What a call does once it reaches an automation (saving, versions, deployment, runs and triggers)
  is held by the [automations spec](../automations/spec.md); the capability surface's own rules
  (searching and invoking capabilities, retrieving knowledge) are not covered.
- The tool inventory and each tool's arguments (`lib/mcp/tools.ts`, `lib/mcp/args.ts`).
