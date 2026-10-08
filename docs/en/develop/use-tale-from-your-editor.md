---
title: Use Tale from your editor or a script
description: Call your organization's models from opencode, Claude Code or the OpenAI and Anthropic SDKs, script the REST chat, or add Tale's MCP tools to your editor.
i18nLintExclude:
  - terminology-loanword
---

Tale reaches your development work in four ways. They differ in which language model runs and in how much of the work Tale governs:

| You want | Use | Model | What Tale governs |
| --- | --- | --- | --- |
| Your organization's models as the model provider of opencode, Claude Code, or an SDK script | [The model endpoints](#model-endpoints) | An organization model you name by its id in each request | Each model call: model access, input guardrails, budgets, usage under your name and key; not the answers |
| Ask the workspace assistant from a script | [The REST chat API](#script-the-rest-chat-api) | An organization model you name in each request | The whole turn: model access, budgets, usage under your name |
| Tale's knowledge and automation tools inside opencode or Claude Code | [The MCP endpoint](#connect-opencode-or-claude-code) | The model configured in your editor | Only the tool calls; the editor's model calls stay outside Tale |
| Have a script edited on your organization's models | [A project agent on a task](#let-a-project-agent-edit-scripts) | An organization model the agent is configured with | The whole run: sandbox, budgets, usage, review |

An editor can use two of them with the same key: the model endpoints as its model provider and the MCP endpoint for Tale's knowledge. [The last section](#where-the-openai-compatible-endpoint-went) explains how the model endpoints differ from the OpenAI-compatible layer of Tale 0.3.

## Create an API key

Every path from outside the app starts with a personal API key. Owners, Admins, and Developers create one under **Settings > API > REST** with **Create API key**, choosing a name and an expiration, and so can a member an Admin granted a competence that is used with a key, such as **Call models over the API**. The secret is shown once; copy it into your secret store or a private shell environment before closing the dialog. [API keys](/platform/admin/api-keys) covers creation, rotation, and revocation.

A key acts as you. It carries your current role and project access, and the usage it causes is booked under your name. Chat turns, model calls, and automation runs you start with the key also record the key, so API-key limits apply to them as well; a project-agent run is booked to you alone. An Admin can cap what you spend with a personal, team, or role budget under [Policies and limits](/platform/admin/governance/policies-and-limits); a request over a cap is refused with `429 BUDGET_EXCEEDED`.

The examples on this page read three environment variables. `TALE_URL` is your instance's origin without `/api/v1`. `TALE_ORG_SLUG` is the organization slug, shown under **Settings > API > MCP**, under **Settings > API > Models** once the model endpoints are on, and returned by `GET /api/v1/me`. Export all three in your shell, and keep `TALE_API_KEY` out of files you commit.

## Use your organization's models from your tools {#model-endpoints}

The model endpoints let opencode, Claude Code, and scripts built on the OpenAI or Anthropic SDKs use your organization's approved models as their model provider. Tale speaks the OpenAI Chat Completions and Anthropic Messages interfaces these tools already use, so you change a base URL, a key, and a model name rather than your code. Each request is a bare model call: no workspace assistant, thread, or Tale tool is involved, and the answer comes back as the model sent it.

### Before you start

The endpoints are off until an Admin turns on **Model endpoints for API keys** under **Settings > Governance > Models**; [Models](/platform/admin/governance/content-models#model-endpoints) describes the switch. Owners, Admins, and Developers may then call them through their role; any other member needs the competence **Call models over the API**, which an Admin grants under [Competences](/platform/admin/governance/competences). `GET /api/v1/me` answers `capabilities.modelApi: true` once your key may call them.

**Settings > API > Models** collects what your tools need: both base URLs, the organization slug, the models you can call with a copy button for each id, and configuration to copy for opencode, Claude Code, and the OpenAI SDK for Python. While your organization has not turned the endpoints on, the tab reads **Model endpoints are not enabled for your organization**, and Owners and Admins find **Open model access** there.

<Frame caption="Settings > API > Models — the base URLs, the organization slug, and the models you can call.">

![The Models tab under Settings > API showing the OpenAI- and Anthropic-compatible base URLs, the Authorization header for an API key, the organization slug northlight-labs, and five model ids, each with a copy button.](/images/develop/settings-api-models.webp)

</Frame>

### Connection settings

| Setting | Value |
| --- | --- |
| OpenAI-compatible base URL | `https://<host>/api/v1/openai`; the OpenAI SDKs and opencode append `/chat/completions` |
| Anthropic-compatible base URL | `https://<host>/api/v1/anthropic`; the Anthropic SDKs and Claude Code append `/v1/messages` |
| Key | Your personal API key as `Authorization: Bearer <key>`. Tale refuses the `x-api-key` header with `401`, so an Anthropic client must send the key as an auth token |
| Organization | `X-Organization-Slug: <slug>`, required when you belong to several organizations |
| Model | `<providerSlug>/<modelId>`: the provider's slug, a slash, and the model's id in that provider's catalog, such as `openrouter/anthropic/claude-sonnet-4.6` or `deepseek/deepseek-v4-flash` |

The same id works on both endpoints. Check the key and list the ids you may call, with your own host and slug in place of `tale.example.com` and `acme`:

```bash
curl https://tale.example.com/api/v1/openai/models \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: acme"
```

The answer is an OpenAI model list: `owned_by` is the provider slug, and `created` is always `0`. It looks like this, with the ids your organization offers you:

```json
{
  "object": "list",
  "data": [
    { "id": "openrouter/anthropic/claude-sonnet-4.6", "object": "model", "created": 0, "owned_by": "openrouter" },
    { "id": "deepseek/deepseek-v4-flash", "object": "model", "created": 0, "owned_by": "deepseek" }
  ]
}
```

The list holds your organization's chat models that a provider credential of type **API key** or **Environment variable** serves, narrowed by each credential's model allowlist and by your model access. Models served through a subscription credential are not listed, and neither are models of a provider whose endpoint is set per credential, such as Azure, or models whose tool calls work only through OpenAI's Responses API, such as GPT-6.1 Sol, which these endpoints do not relay. `GET /api/v1/models` gives each of these models' context window, capabilities, and prices under the same `providerSlug` and `id`.

### Point opencode at Tale

Add Tale as a provider in your global `opencode.json` or the project's. opencode reaches it through its OpenAI-compatible package and reads the key from `TALE_API_KEY`. List every model you want to choose under `models`, keyed by its id; `model` sets the default as `tale/` followed by that id.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "tale": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Tale",
      "options": {
        "baseURL": "https://tale.example.com/api/v1/openai",
        "apiKey": "{env:TALE_API_KEY}",
        "headers": { "X-Organization-Slug": "acme" }
      },
      "models": {
        "openrouter/anthropic/claude-sonnet-4.6": { "name": "Claude Sonnet 4.6" }
      }
    }
  },
  "model": "tale/openrouter/anthropic/claude-sonnet-4.6"
}
```

The `provider` block can sit beside the `mcp` block from [the MCP configuration](#opencode) in the same file. Start opencode from a shell where `TALE_API_KEY` is set.

### Point Claude Code at Tale

Claude Code reads its model provider from environment variables. Set them in the shell you start it from:

```bash
export ANTHROPIC_BASE_URL="https://tale.example.com/api/v1/anthropic"
export ANTHROPIC_AUTH_TOKEN="$TALE_API_KEY"
export ANTHROPIC_CUSTOM_HEADERS="X-Organization-Slug: acme"
export ANTHROPIC_MODEL="openrouter/anthropic/claude-sonnet-4.6"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="openrouter/anthropic/claude-haiku-4.5"
unset ANTHROPIC_API_KEY
claude
```

`ANTHROPIC_AUTH_TOKEN` sends the key as a bearer token. Leave `ANTHROPIC_API_KEY` unset: Claude Code would send it as `x-api-key`, which Tale refuses. `ANTHROPIC_DEFAULT_HAIKU_MODEL` is the model Claude Code uses for background tasks; both model variables must name ids from your list. Claude Code's WebSearch tool asks the model vendor to run the search, so Tale refuses those requests; the tools Claude Code runs on your machine work as usual.

### Call the models from a script

The OpenAI SDK for Python needs a different base URL and the organization header. This example reads the key from `TALE_API_KEY`, asks once for a whole answer, then streams a second one:

```python
import os

from openai import OpenAI

client = OpenAI(
    base_url="https://tale.example.com/api/v1/openai",
    api_key=os.environ["TALE_API_KEY"],
    default_headers={"X-Organization-Slug": "acme"},
)
MODEL = "openrouter/anthropic/claude-sonnet-4.6"

reply = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "What does the cron expression 0 3 * * 1 mean?"}],
)
print(reply.choices[0].message.content)

stream = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "Write a commit message for a typo fix."}],
    stream=True,
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

Tools, `tool_calls`, and images work as they do with OpenAI, and the answer's `model` is the id you sent. A stream ends with `data: [DONE]`; its closing usage chunk arrives only when you pass `stream_options={"include_usage": True}`.

The Anthropic SDK for Python takes the key as an auth token. Run it with `ANTHROPIC_API_KEY` unset, because the SDK would send that variable's value as `x-api-key`, which Tale refuses:

```python
import os

import anthropic

client = anthropic.Anthropic(
    base_url="https://tale.example.com/api/v1/anthropic",
    auth_token=os.environ["TALE_API_KEY"],
    default_headers={"X-Organization-Slug": "acme"},
)

message = client.messages.create(
    model="openrouter/anthropic/claude-sonnet-4.6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Explain the error ECONNRESET in one paragraph."}],
)
print(message.content[0].text)
```

### What Tale checks on every call

Each call is governed like a chat request, for the person whose key sent it:

- **The switch and your right.** The organization has turned the endpoints on, and your role or competence lets you call them.
- **The model.** It must be on your list, and the organization's model access must allow it for you at the moment of the call. The model allowlist of the provider credential applies as well.
- **What the model can read.** Images need a model with vision, and tools a model that takes them. Images travel as OpenAI `image_url` parts with a `data:` or `https:` URL, or as Anthropic `image` blocks in base64 or with an `https:` URL, also inside tool results. Documents travel as OpenAI `file` parts or Anthropic `document` blocks.
- **The input guardrails.** The organization's content safety, personal-data protection, and moderation provider read every text the request carries before it is sent on: system and developer instructions, your turns and the assistant's, tool calls, tool results and tool definitions, and documents given as text. A block refuses the request, and a mask sends the model the masked text. The model's answers, and images and documents that are not text, are not filtered. [Guardrails](/platform/admin/governance/guardrails#model-endpoints) has the details.
- **The budgets.** Before the call, Tale works out its worst case, the estimated prompt plus the most output it may produce at the model's catalog price. It refuses the call with `429 BUDGET_EXCEEDED` when that worst case does not fit what is left under a budget cap that applies to you, your teams, the organization, or the key — or, for a project's own key, its project — and holds it against those caps while the call runs; a lower `max_tokens` fits more. Afterwards it books the cost the model gateway measured and the reported tokens under your name and the key. A call you break off while Tale is still checking it is never sent on and is not booked. Breaking it off once it has been sent cancels its request to the provider as well, and the call is still booked: at least for its prompt and the output that had reached you, at the model's catalog price. Each call counts as one request and appears as **Direct API** in usage analytics.
- **Eight calls at a time.** You, and each of your keys, may have eight calls running at once. A ninth is refused with `429 MODEL_API_CONCURRENCY_EXCEEDED` and a `Retry-After` of two seconds.

Your tools never see a provider key. Tale relays each call through its model gateway with a key minted for that one request and that one model. Revoking your API key under **Settings > API > REST** ends its access with the next request; an answer that is already streaming finishes.

### What the endpoints do not serve

- **Tools the model vendor runs.** OpenAI's `web_search_options` and any tool whose type is not `function` or `custom`, and Anthropic's web search, web fetch, code execution, and MCP toolsets, with the `mcp_servers` and `container` fields, are refused with `400 MODEL_API_VENDOR_TOOL_UNSUPPORTED`: Tale could neither meter nor audit them. Your own tools are relayed and come back as `tool_calls` or `tool_use`, including Anthropic's client tools `bash`, `text_editor`, `computer`, and `memory`.
- **Audio input.** Requests with `input_audio` parts are refused.
- **Requests Tale cannot bill or keep in your organization.** More than eight answers per request (`n`), files stored in the vendor account (an OpenAI `file_id`, an Anthropic `file` source), a `service_tier` other than `auto` or `default` (`auto` or `standard_only` on Anthropic), audio output, and `store: true` are refused with `400 INVALID_BODY`.
- **Other routes.** Anthropic's `count_tokens` and every other Anthropic route are not served, and neither are OpenAI routes beyond chat completions and the model list, such as embeddings, Responses, or image generation.
- **Tale's own assistant and tools.** For those, use [the REST chat API](#script-the-rest-chat-api) or [the MCP endpoint](#connect-opencode-or-claude-code).

### Troubleshoot a refused call

Every refusal comes in the error shape of the interface you called, so your SDK reports it as an OpenAI or Anthropic error. Its `code` field carries Tale's stable code; the [API reference](/develop/api-reference#model-endpoints) lists them all.

| Status and code | What to do |
| --- | --- |
| `401 UNAUTHORIZED` | Send the key as `Authorization: Bearer`, never as `x-api-key`. For Claude Code, set `ANTHROPIC_AUTH_TOKEN` and unset `ANTHROPIC_API_KEY`; for the Anthropic SDKs, pass the key as `auth_token` or `authToken`. A revoked or expired key answers `401` too. |
| `400 ORG_SLUG_REQUIRED` | You belong to several organizations. Send `X-Organization-Slug`. |
| `403 MODEL_API_DISABLED` | The organization has not turned the endpoints on. Ask an Admin. |
| `403 MODEL_API_FORBIDDEN` | Your role cannot call them. Ask an Admin to grant **Call models over the API**. |
| `404 MODEL_API_MODEL_UNKNOWN` | The id is not on your list. Copy one from `GET /api/v1/openai/models` or the **Models** tab, provider slug included. |
| `403 MODEL_API_MODEL_FORBIDDEN` | Model access blocks this model for you. Choose another model or ask an Admin. |
| `400 MODEL_API_VISION_UNSUPPORTED`, `400 MODEL_API_TOOLS_UNSUPPORTED` | Choose a model that reads images or takes tools, or send the request without them. |
| `400 MODEL_API_VENDOR_TOOL_UNSUPPORTED` | Remove the tool the vendor would run, such as a web search. In Claude Code, the WebSearch tool causes it. |
| `400 MODEL_API_GUARDRAIL_BLOCKED` | A guardrail refused the system prompt or a message, and nothing reached the model. Rephrase, or ask an Admin about the rule. |
| `403 MODEL_API_GUARDRAIL_UNSUPPORTED` | The organization's personal-data protection tokenizes, which the model endpoints cannot honour. An Admin can switch it to mask or block. |
| `429 RATE_LIMITED` | You sent more than your API keys' shared request budget allows. Wait for `Retry-After`; see [Rate limits](/develop/rate-limits). |
| `429 BUDGET_EXCEEDED` | A budget cap is reached. `Retry-After` names the time until it resets, and the answer carries `x-should-retry: false` so the SDKs do not retry. Wait, or ask an Admin to raise the cap. |
| `503 MODEL_API_UNAVAILABLE`, `503 MODEL_API_GUARDRAIL_UNAVAILABLE` | A service the call needs is unavailable, such as the model gateway or the moderation provider. Retry later; if it persists, ask an Admin to check the provider credential or the moderation provider. |
| `MODEL_API_UPSTREAM_ERROR` | The model vendor refused the call, and the message is the vendor's. `400`, `413`, `422`, `429`, `503`, and `529` keep their status; any other refusal arrives as `502`. |

## Script the REST chat API

The REST chat API gives a script the same assistant members use in the app's chat. It is not a bare model call: every turn runs the built-in workspace assistant, which searches your organization's knowledge when the question calls for it and redirects requests for documents or other deliverables to Tasks. The API is asynchronous. A send answers `202` with the ID of the reply, and you poll until the turn settles.

The examples share one helper, which sends the key and the organization header on every request. Save it as `tale-api.sh`:

```bash
# tale-api.sh: source it from your shell or from a script
: "${TALE_URL:?Set TALE_URL to your Tale origin, without /api/v1}"
: "${TALE_API_KEY:?Set TALE_API_KEY}"
: "${TALE_ORG_SLUG:?Set TALE_ORG_SLUG}"
tale_api() {
  curl --fail-with-body -sS \
    -H "Authorization: Bearer $TALE_API_KEY" \
    -H "X-Organization-Slug: $TALE_ORG_SLUG" \
    -H 'Content-Type: application/json' "$@"
}
```

Load it in your shell, check the key, and list the models you can call. The examples need curl and `jq`.

```bash
source ./tale-api.sh

# Who the key acts as, and in which organization
tale_api "$TALE_URL/api/v1/me" | jq '{email: .user.email, organization: .organization.slug, role: .organization.role}'

# The models you can name: id and providerSlug
tale_api "$TALE_URL/api/v1/models" | jq -r '.models[] | "\(.id)\t\(.providerSlug)"'
```

Export `MODEL_ID` and `PROVIDER` from one line of that list. The conversation is a script, `ask-tale.sh`, saved next to the helper and run with `bash ask-tale.sh`. It creates a personal thread, sends one question, waits for the turn to settle, and prints the reply's text. `set -euo pipefail` stops it at the first failed request, so it never goes on with an empty ID.

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tale-api.sh"
: "${MODEL_ID:?Set MODEL_ID to an id from /models}"
: "${PROVIDER:?Set PROVIDER to the providerSlug listed with it}"

THREAD_ID=$(tale_api -X POST "$TALE_URL/api/v1/threads" -d '{"title":"Script help"}' | jq -er '.id')

BODY=$(jq -n --arg model "$MODEL_ID" --arg provider "$PROVIDER" \
  '{content: "What does our runbook say about rotating database passwords?", model: $model, providerSlug: $provider}')
MESSAGE_ID=$(tale_api -X POST "$TALE_URL/api/v1/threads/$THREAD_ID/messages" -d "$BODY" | jq -er '.messageId')

# Poll every three seconds, for up to ten minutes, until the turn settles
STATUS=queued
for _ in $(seq 200); do
  STATUS=$(tale_api "$TALE_URL/api/v1/threads/$THREAD_ID/generation" | jq -r '.status')
  [ "$STATUS" = idle ] && break
  sleep 3
done
if [ "$STATUS" != idle ]; then
  echo "No reply within ten minutes; stopping the turn." >&2
  tale_api -X DELETE "$TALE_URL/api/v1/threads/$THREAD_ID/generation" > /dev/null
  exit 1
fi

# Read the reply the send named, then check how it ended
REPLY=$(tale_api "$TALE_URL/api/v1/threads/$THREAD_ID/messages/$MESSAGE_ID")
if [ "$(jq -r '.status' <<< "$REPLY")" != complete ]; then
  jq -r '"Turn \(.status): \(.errorCode // "") \(.error // "")"' <<< "$REPLY" >&2
  exit 1
fi
if [ "$(jq -r '.finishReason // ""' <<< "$REPLY")" = length ]; then
  echo "The reply reached its output limit and may be cut off." >&2
fi
jq -r '[.parts[] | select(.type == "text") | .text] | join("")' <<< "$REPLY"
```

While the send waits for a worker, `GET .../messages/$MESSAGE_ID` can still answer `404 MESSAGE_NOT_FOUND`, so the script reads the reply only once the thread is idle. A turn that has not settled after ten minutes is stopped with `DELETE .../generation`. Send follow-up questions to the same `THREAD_ID` to keep the conversation's context. The send is text only, and it is refused with `409 CHAT_TURN_IN_PROGRESS` while the thread's previous turn is still running.

When a script needs the matching passages rather than an answer, `POST /api/v1/knowledge/search` returns them without the assistant; see [Search a project's files](/develop/api-reference#search-a-projects-files). [Call Tale from a script](/tutorials/developer/call-tale-from-a-script) builds the same conversation in Python with error handling, and [Send a message, then poll the turn](/develop/api-reference#send-a-message-then-poll-the-turn) covers retries, token limits, and failures.

## Bring Tale's tools into opencode or Claude Code {#connect-opencode-or-claude-code}

Tale's [MCP endpoint](/develop/mcp-endpoint), `/api/v1/mcp`, gives an editor agent Tale's tools. The most useful for script work is `get_knowledge`, which retrieves passages from your organization's documents and crawled web pages. The endpoint also exposes the automation tools: validate, test, save, deploy, and run automations, and read their runs. Saving, deploying, setting or deleting a trigger, cancelling a run, and live runs require the Developer capability. The endpoint has no chat tool and no skills tool; to copy your organization's skills into a local skills folder, read them with `GET /api/v1/skills` as described in [Save and synchronize skill bundles](/develop/api-reference#save-and-synchronize-skill-bundles).

The language model on this path is the one configured in your editor. Tale authenticates the tool calls and applies your permissions to them, but the prompts, your code, and every passage a Tale tool returns travel to that editor's model provider. When that provider is another service, Tale's budgets, usage records, and model-access rules do not apply to its model calls; check that your organization allows its knowledge to reach that provider before you connect. When the editor uses [the model endpoints](#model-endpoints) as its provider, the passages go only to models your organization approved, and each model call is governed as described there.

The endpoint authenticates with the API key in a header and has no OAuth sign-in. Turn off a client's OAuth detection where it offers the switch.

### opencode

Add a remote server to your global opencode configuration, `~/.config/opencode/opencode.json`, or to an `opencode.json` in the project. `{env:TALE_API_KEY}` makes opencode read the key from your environment, so the file never holds the secret. Replace the host and the slug with your own.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tale": {
      "type": "remote",
      "url": "https://your-host.example.com/api/v1/mcp",
      "oauth": false,
      "timeout": 60000,
      "headers": {
        "Authorization": "Bearer {env:TALE_API_KEY}",
        "X-Organization-Slug": "your-org-slug"
      }
    }
  }
}
```

`timeout` raises opencode's five-second default for MCP requests, which a knowledge search under load or a `run_deployed` call that waits up to 30 seconds can exceed. Start opencode from a shell where `TALE_API_KEY` is set. `opencode mcp list` shows whether the server is configured; opencode prefixes the tools with the server name, as in `tale_get_knowledge`.

### Claude Code

Register the endpoint as an HTTP server. The command below stores the expanded key in your private Claude Code configuration for the current project:

```bash
claude mcp add --transport http tale "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG"
```

To share the server with a team through a committed `.mcp.json`, reference the key as an environment variable so each person supplies their own:

```json
{
  "mcpServers": {
    "tale": {
      "type": "http",
      "url": "https://your-host.example.com/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${TALE_API_KEY}",
        "X-Organization-Slug": "your-org-slug"
      }
    }
  }
}
```

`claude mcp list` reports whether Claude Code can reach the server.

## Let a project agent edit scripts

To have the edit made inside Tale, in a sandbox and with a person's review, hand the script to a [project agent](/platform/projects/project-agents). Tale runs an agent runtime such as OpenCode in a sandbox, on the model the agent is configured with. The run counts against the budgets of the member who started it and is recorded under that person; a run you start over REST is booked to you, not to the API key. The edited files come back as the task's deliverables, and the task waits in review for a person. [Choose an agent runtime](/platform/agents/harnesses) compares the agent runtimes; OpenCode runs only through Tale's model gateway, so it never receives a provider key.

Creating the agent needs edit access to the project, which starts at the Editor role; any member who can open the project can then create the task and start the agent on it. The organization needs a model the agent runtime can use and available sandbox capacity. In the app, open the project's **Agents** tab, select **New agent**, choose OpenCode as the agent runtime and a model, then create a task with the script attached, assign it to the agent, and start the agent.

The same loop works from a terminal over REST, reusing `tale-api.sh` from the chat example. First check that this deployment runs OpenCode for project agents:

```bash
tale_api "$TALE_URL/api/v1/models" | jq -r '.harnesses[] | "\(.harness)\t\(.label)"'
```

Then save the script below as `hand-to-agent.sh` next to the helper and run it with `bash hand-to-agent.sh`. It reuses the project's agent named Script editor or creates it on the first run, because agent names are unique in a project regardless of case. It then files the script as a task and puts the agent to work with a comment that mentions it.

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tale-api.sh"
: "${PROJECT_ID:?Set PROJECT_ID to a project you can edit}"
: "${MODEL_ID:?Set MODEL_ID to a model the harness can use}"
: "${PROVIDER:?Set PROVIDER to the providerSlug listed with it}"
AGENT_NAME="Script editor"

AGENT_ID=$(tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/agents" \
  | jq -r --arg name "$AGENT_NAME" 'first(.agents[] | select((.name | ascii_downcase) == ($name | ascii_downcase)) | .id) // ""')
if [ -z "$AGENT_ID" ]; then
  AGENT_ID=$(tale_api -X POST "$TALE_URL/api/v1/projects/$PROJECT_ID/agents" \
    -d "$(jq -n --arg name "$AGENT_NAME" --arg model "$MODEL_ID" --arg provider "$PROVIDER" '{name: $name, harness: "opencode", model: $model, modelProvider: $provider, skills: [], connectors: [], instructions: "Edit the script from the task description. Return the changed script as a file and list every change in your report."}')" \
    | jq -er '.agent.id')
fi

TASK_ID=$(tale_api -X POST "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks" \
  -d "$(jq -n --rawfile script backup.ps1 '{externalSystem: "terminal", externalId: "backup-ps1-hardening", title: "Harden backup.ps1", description: ("Add error handling and a dry-run switch to this PowerShell script:\n\n" + $script)}')" \
  | jq -er '.task.id')

tale_api -X POST "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID/comments" \
  -d "$(jq -n --arg agent "$AGENT_ID" '{body: ("@" + $agent + " please take this task.")}')" > /dev/null
echo "TASK_ID=$TASK_ID"
```

`externalSystem` and `externalId` make the task idempotent: sending the same pair again returns the existing task. A description holds up to 20,000 characters; for a longer script, upload it to the project as described in [Upload a file in two steps](/develop/api-reference#upload-a-file-in-two-steps). The comment names the agent by its ID; its `handle` works as well, here `@script-editor`, and the agent's read carries it. Tale stores either as a mention of the agent itself, so the comment keeps naming it after a rename.

The mention assigns the task to the agent and starts a run, and the task moves to `in_progress`. A mention that cannot start a run is saved as an ordinary comment without an error, for example when the task is not yours to change, task automation is turned off, or another run already holds the task. Set `TASK_ID` to the value the script printed, check the task, and read the agent's report once the task reaches `in_review`:

```bash
tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID" | jq -r '.task.status'
tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID/comments?limit=20" \
  | jq -r '.comments[] | select(.authorType == "agent") | .body'
```

Review the edited files under the task's deliverables in the app before you approve the task. To send the agent back with changes, post another comment that mentions it.

## What changed since Tale 0.3 {#where-the-openai-compatible-endpoint-went}

From 0.2.10 through 0.3, Tale served an OpenAI-compatible layer: `POST /api/v1/chat/completions`, `POST /api/v1/images/generations`, and an OpenAI-shaped `GET /api/v1/models`, whose `model` field could name an agent. Tale 0.4 rebuilt the platform without it. The [model endpoints](#model-endpoints) take its place for model calls, with differences a client written for 0.3 has to follow:

- The base URL is `/api/v1/openai`, or `/api/v1/anthropic` for an Anthropic client, not `/api/v1`. An OpenAI SDK pointed at `/api/v1` still receives `404 NOT_FOUND` for chat completions, and `GET /api/v1/models` is Tale's own listing of models and agent runtimes, not the OpenAI shape.
- `model` names a model as `<providerSlug>/<modelId>`, never an agent. For the workspace assistant, use the REST chat API; to put an agent to work, use a project agent.
- Image generation is not served.
- The endpoints are off until an Admin turns them on, and every call passes model access, the input guardrails, and the budgets.

[Upgrade and recover a deployment](/self-hosted/operate/upgrades#03-04-the-openai-compatible-api-was-removed) lists the removal for operators moving from 0.3.
