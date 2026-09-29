---
title: Use Tale from your editor or a script
description: Script the REST chat, connect opencode or Claude Code to Tale's MCP endpoint, or let a project agent edit your scripts on your organization's models.
i18nLintExclude:
  - terminology-loanword
---

Tale reaches your development work in three ways. They differ in where the language model runs and in how much of the work Tale governs:

| You want | Use | Model | What Tale governs |
| --- | --- | --- | --- |
| Ask the workspace assistant from a script | [The REST chat API](#script-the-rest-chat-api) | An organization model you name in each request | The whole turn: model access, budgets, usage under your name |
| Tale's knowledge and automation tools inside opencode or Claude Code | [The MCP endpoint](#connect-opencode-or-claude-code) | The model configured in your editor | Only the tool calls; the editor's model calls stay outside Tale |
| Have a script edited on your organization's models | [A project agent on a task](#let-a-project-agent-edit-scripts) | An organization model the agent is configured with | The whole run: sandbox, budgets, usage, review |

Tale has no OpenAI-compatible model endpoint, so an editor cannot use Tale as its model provider. [The last section](#where-the-openai-compatible-endpoint-went) explains what happened to `/api/v1/chat/completions`.

## Create an API key

Every path from outside the app starts with a personal API key. Owners, Admins, and Developers create one under **Settings > API > REST** with **Create API key**, choosing a name and an expiration. The secret is shown once; copy it into your secret store or a private shell environment before closing the dialog. [API keys](/platform/admin/api-keys) covers creation, rotation, and revocation.

A key acts as you. It carries your current role and project access, and the usage it causes is booked under your name. Chat turns and automation runs you start with the key also record the key, so API-key limits apply to them as well; a project-agent run is booked to you alone. An Admin can cap what you spend with a personal, team, or role budget under [Policies and limits](/platform/admin/governance/policies-and-limits); a request over a cap is refused with `429 BUDGET_EXCEEDED`.

The examples on this page read three environment variables. `TALE_URL` is your instance's origin without `/api/v1`. `TALE_ORG_SLUG` is the organization slug, shown under **Settings > API > MCP** and returned by `GET /api/v1/me`. Export all three in your shell, and keep `TALE_API_KEY` out of files you commit.

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

## Connect opencode or Claude Code

Tale's [MCP endpoint](/develop/mcp-endpoint), `/api/v1/mcp`, gives an editor agent Tale's tools. The most useful for script work is `get_knowledge`, which retrieves passages from your organization's documents and crawled web pages. The endpoint also exposes the automation tools: validate, test, save, deploy, and run automations, and read their runs. Saving, deploying, setting or deleting a trigger, cancelling a run, and live runs require the Developer capability. The endpoint has no chat tool and no skills tool; to copy your organization's skills into a local skills folder, read them with `GET /api/v1/skills` as described in [Save and synchronize skill bundles](/develop/api-reference#save-and-synchronize-skill-bundles).

The language model on this path is the one configured in your editor, not one of your organization's models. Tale authenticates the tool calls and applies your permissions to them, but the prompts, your code, and every passage a Tale tool returns travel to that editor's model provider. Tale's budgets, usage records, and model-access rules do not apply to those model calls. Check that your organization allows its knowledge to reach that provider before you connect.

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

When the model must be one of your organization's, hand the script to a [project agent](/platform/projects/project-agents) instead. Tale runs a coding harness such as OpenCode in a sandbox, on the model the agent is configured with. The run counts against the budgets of the member who started it and is recorded under that person; a run you start over REST is booked to you, not to the API key. The edited files come back as the task's deliverables, and the task waits in review for a person. [Choose an agent runtime](/platform/agents/harnesses) compares the harnesses; OpenCode runs only through Tale's model gateway, so it never receives a provider key.

Creating the agent needs edit access to the project, which starts at the Editor role; any member who can open the project can then create the task and start the agent on it. The organization needs a model the harness can use and available sandbox capacity. In the app, open the project's **Agents** tab, select **New agent**, choose OpenCode as the agent type and a model, then create a task with the script attached, assign it to the agent, and start the agent.

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

`externalSystem` and `externalId` make the task idempotent: sending the same pair again returns the existing task. A description holds up to 20,000 characters; for a longer script, upload it to the project as described in [Upload a file in two steps](/develop/api-reference#upload-a-file-in-two-steps). An agent answers to its ID and to its name in lower case with spaces replaced by dots or removed, so `@script.editor` also works.

The mention assigns the task to the agent and starts a run, and the task moves to `in_progress`. A mention that cannot start a run is saved as an ordinary comment without an error, for example when the task is not yours to change, task automation is turned off, or another run already holds the task. Set `TASK_ID` to the value the script printed, check the task, and read the agent's report once the task reaches `in_review`:

```bash
tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID" | jq -r '.task.status'
tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID/comments?limit=20" \
  | jq -r '.comments[] | select(.authorType == "agent") | .body'
```

Review the edited files under the task's deliverables in the app before you approve the task. To send the agent back with changes, post another comment that mentions it.

## Where the OpenAI-compatible endpoint went

From 0.2.10 through 0.3, Tale served an OpenAI-compatible layer: `POST /api/v1/chat/completions`, `POST /api/v1/images/generations`, and an OpenAI-shaped `GET /api/v1/models`. Tale 0.4 rebuilt the platform without it. On a current release, an OpenAI SDK pointed at `/api/v1` receives `404 NOT_FOUND` for chat completions, or `400 ORG_SLUG_REQUIRED` when your key belongs to several organizations, because the SDK sends no `X-Organization-Slug` by default. `GET /api/v1/models` is now Tale's own listing of models and agent harnesses, not the OpenAI shape.

Use the REST chat API for scripted questions, the MCP endpoint for Tale's knowledge inside your editor, and a project agent when the work must run on your organization's models. [Upgrade and recover a deployment](/self-hosted/operate/upgrades#03-04-the-openai-compatible-api-was-removed) lists the removal for operators moving from 0.3.
