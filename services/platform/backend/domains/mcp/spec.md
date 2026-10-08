# MCP — what a coding agent can do through Tale's MCP endpoint

> **Prefix** `MCP-` · **Suite** [`mcp`](../../../tests/manual/suites/mcp.md) · **Docs** [`automations/assistant`](../../../../../docs/en/platform/automations/assistant.md)

The rules of the door a coding agent uses to work in Tale, `/api/v1/mcp`: whom a call acts as and
what the key holder's role lets it change, how a refusal reaches the agent, what a request and a
batch of calls cost, and which protocol revisions the endpoint speaks. What a call does once it
reaches an automation or the capability surface, the tool inventory itself, and a failure the
engine throws instead of answering are not covered; see Not yet.

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
- The tool inventory, each tool's arguments and the schemas they are checked against
  (`lib/mcp/tools.ts`), and what an agent is told when its arguments do not match.
- A failure the engine or the capability surface throws instead of answering: the tool result
  today carries the thrown message as its text (`protocol.ts`).
