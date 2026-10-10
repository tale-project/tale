# Model API — who can call a model with an API key, and what a call is held to

> **Prefix** `MAPI-` · **Docs** [`admin/api-keys`](../../../../../docs/en/platform/admin/api-keys.md)

An organization can let its members call its AI models directly, with a Tale API key, through
endpoints that look like OpenAI's and Anthropic's. A call goes through the organization's
guardrails and spending limits like any other use of a model. These rules cover who can call,
which models, what a call is refused for, and how it is charged. The exact request and answer
formats are not covered; see Not yet.

## Who can call

### MAPI-R1 · The model endpoints are off until the organization turns them on

Until then every call is refused (`MODEL_API_DISABLED`), for owners too. When the
organization's policy cannot be read, the endpoints count as off.

- **Example**: Ada's organization has not turned the model endpoints on. Ada calls one with
  her API key → refused.

### MAPI-R2 · Owners, admins and developers can call; other members need the right granted

A member or editor without the right is refused (`MODEL_API_FORBIDDEN`). An admin can grant
the right to a member. A disabled seat can never call, whatever it holds.

- **Example**: Mia is a member. She calls a model with her API key → refused. An admin grants
  her the right → her next call goes through.

### MAPI-R3 · A call without a valid API key is refused

The refusal comes in the format of the endpoint that was called, so an OpenAI or Anthropic
client library reads it as its own kind of error.

- **Example**: A script calls the OpenAI-style endpoint with no key → refused, with an error
  its OpenAI library understands.

## Which model

### MAPI-R4 · A person can call only the models their model access allows

A model the organization's rules block for that person is refused
(`MODEL_API_MODEL_FORBIDDEN`). A model the organization does not offer is refused as unknown
(`MODEL_API_MODEL_UNKNOWN`). The list of models an API key gets names the callable ones.

- **Example**: Mia's team is limited to two models. She calls a third → refused.

### MAPI-R5 · An image is refused for a model that cannot read images

(`MODEL_API_VISION_UNSUPPORTED`)

- **Example**: A script sends a picture to a text-only model → refused, instead of the model
  answering as if there were no picture.

## Guardrails and spending

### MAPI-R6 · A call the guardrails block is refused before anything is sent or charged

(`MODEL_API_GUARDRAIL_BLOCKED`). Where the guardrails mask text instead of blocking it, the
model receives the masked text.

- **Example**: The organization masks credit card numbers. A script sends a prompt that
  contains one → the model receives the prompt with the number masked.

### MAPI-R7 · A call over a spending limit is refused before it is paid for

The refusal (`BUDGET_EXCEEDED`) says how long to wait and that retrying at once will not help.
Before a call is sent, the most it could cost is set aside against the limits of the key's
holder and of the key, so calls made at the same moment cannot overrun a limit together.

- **Example**: Mia's monthly limit is used up. She calls a model → refused, with the time
  after which her limit resets.

### MAPI-R8 · A call is charged to the key's holder and to the key, once

What the call cost is booked when it ends, under the person the key belongs to and under the
key. A call that ends early, because the caller hung up or the answer was cut off, is charged
at least for what was sent and received until then.

- **Example**: A script asks for a long answer and disconnects half-way → Mia, whose key it
  used, is charged for the half that was produced.

## Not yet

- **The request and answer formats**: which fields of OpenAI's and Anthropic's formats are
  accepted, streaming, and tool calls (`openai.ts`, `anthropic.ts`, `relay.ts`).
- **How many calls can run at once**, and the request limits (`MODEL_API_CONCURRENCY_EXCEEDED`,
  `RATE_LIMITED`).
- **What a failure of the model provider is answered with** (`MODEL_API_UPSTREAM_ERROR`,
  `MODEL_API_UNAVAILABLE`).
- **How long records of calls are kept**, and their handling in an erasure: see the erasure
  spec.
- **A call cut short is booked at a local estimate**, not the provider's own figure; the
  contract debt ledger in [`.agents/repo.md`](../../../../../.agents/repo.md) records it.
