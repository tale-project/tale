# Model relay — what a sandbox agent may call, and what each call costs its turn

> **Prefix** `RELAY-` · **Docs** [`agents/harnesses`](../../../../../docs/en/platform/agents/harnesses.md)

An agent that runs in a sandbox — Claude Code, Codex, pi, Gemini CLI and the other harnesses —
reaches its models through the model relay, never with the organization's provider keys. Each
turn of the agent gets a key of its own. With it the agent may call the models the turn was
given, until the turn's spend allowance is used up, and every call is booked on the turn. These
rules cover who can call, which models, the allowance, and how the provider's answer comes back.
How a turn is given its key, and how its spend reaches the usage ledger, are the sandbox spec's.

## Who can call

### RELAY-R1 · A call without a live turn key is refused

A key belongs to one turn. It stops working when the turn ends or its key is revoked, within
seconds. A key that is only good for the platform's tools (a subscription turn's) calls no model.
The refusal comes in the format of the endpoint that was called, so the agent's client reads it as
its own kind of error.

- **Example**: Lena's task agent finished its turn an hour ago. A script in the sandbox replays the
  turn's key → refused as an unknown key.

### RELAY-R2 · The relay listens only where sandbox sessions reach it

On a deployment `tale deploy` runs, the relay answers on the backend's address in the sandbox
network alone: a browser, the public address and the application's other services cannot reach
it. Where no sandbox network is named it listens beside the API, and its keys are all it trusts.

- **Example**: Omar sends a request to the relay's port from the server's public address → the
  connection is refused. His agent's turn, in a sandbox, reaches it.

## Which model

### RELAY-R3 · A turn calls only the models it was given

The turn's models are the agent's model and the ones its tools use (the vision model). Any
other model is refused, including the same model of another organization.

- **Example**: Lena's agent runs on Claude Sonnet. Its sandbox asks the relay for GPT-6 →
  refused: not one this turn may call.

## Spending

### RELAY-R4 · A call is refused once the turn's spend allowance is used up

The allowance is the turn's, less the images the turn generated or holds for generating. A call
that starts within the allowance runs to its end, even if it ends past it; the next one is refused
with the status the agents read as a spent allowance (402).

- **Example**: Omar's automation gives its agent node 50 cents. Its turn has spent 50 cents → its
  next model call is refused, and the turn ends as over budget.

### RELAY-R5 · Each call is booked on its turn when it ends, at the model's catalog price

Every kind of token counts at its own price: input, prompt-cache reads and writes, and output with
the model's reasoning. A call that ends early — the agent stopped it, or it broke off — is booked
at what the provider reported and what the relay counted by then. A call the provider refused costs
nothing. Two calls of one turn on two backends are both booked.

- **Example**: Lena's agent calls Claude Sonnet 5.5 and reads 4,000 tokens from the prompt cache
  → the call costs those 4,000 tokens at the cache price, not the input price.

## The provider's answer

### RELAY-R6 · An agent on the provider's own format gets the answer as it was sent

Claude Code on a Claude model, or pi on an OpenAI-compatible model, gets every byte the provider
streamed. Only the model's name is changed on the way up, and fields meant for the old gateway are
dropped.

- **Example**: Omar's Claude Code agent calls Claude Opus 5.5 → the stream it reads is
  Anthropic's own.

### RELAY-R7 · An agent that speaks another format gets the answer translated into its own

Text, the model's thinking and tool calls come back in the agent's format, and the thinking's proof
travels with the turn, so a later step of a tool loop sends it back.

- **Example**: Lena's pi agent runs on Claude Sonnet 5.5 → pi reads the answer as an OpenAI-style
  stream, and its next tool step carries Claude's thinking back to Claude.

### RELAY-R8 · An agent that stops a call stops it at the provider

The relay cancels its call to the provider when the agent hangs up, and a call that stays silent
past the stream budget is ended.

- **Example**: Omar stops his agent mid-answer → the provider's stream is closed, and the turn is
  booked for the part the agent received.

### RELAY-R9 · A refused provider credential is never mistaken for the agent's own key

When the provider refuses the organization's credential, the agent is told the provider refused
it, with a status that does not tell the agent to sign in again.

- **Example**: An admin revoked the organization's OpenAI key at the vendor. Lena's agent calls a
  GPT model → told that the provider refused the organization's credential.

### RELAY-R10 · A provider is called only at an address the provider host policy admits

The relay checks a provider's URL before it calls, and the address the provider's name resolves
to when it connects: never a cloud metadata address, and a private, loopback or link-local one
only where the operator admitted private provider hosts. A refused address is never connected,
and the agent is told the provider could not be reached.

- **Example**: A custom provider's name `models.example.com` resolves to `10.0.0.5` on a
  deployment that admits no private provider hosts → Kai's agent is told the provider could not be
  reached, and nothing is sent to that address.

## Not yet

- **Images a tool returns, on a provider that takes only text from tools**: they reach the model
  as a user message right after the tool's answer, not inside it.
- **A per-credential endpoint (Azure) and a subscription credential** are not served through the
  relay: a subscription runs only in its vendor's own harness.
- **The thinking's proof is carried only by agents that keep the field it travels in**; an
  OpenAI-style client that drops unknown fields loses it, and a Claude model with thinking may then
  refuse the next step of a tool loop.
