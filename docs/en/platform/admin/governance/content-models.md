---
title: Models
description: Set default models, restrict access, choose separate models for images and audio transcription, and set up the standard agent for projects without agents.
---

Use **Settings > Governance > Models** as an Admin or Owner to choose the models members start with and the models they may use. Defaults guide a choice; access rules enforce a restriction. Configure [provider credentials](/platform/admin/providers) first so the intended models are available.

## Set a default model

1. Under **Default models**, select **Add rule**.
2. Choose **Default** for the baseline, **Role** for a role, or **Team** for a team. Select the target when needed.
3. Choose a provider and model, then **Confirm**. Save the page's pending changes in the header.
4. Start a chat as a member of the target group with its model on **Auto**, and check the resolved model.

The default is used when there is no explicit model choice. A team rule takes precedence over a role rule, followed by the baseline default; when someone belongs to several teams with a rule, the first matching team rule in the table wins (see [How rules combine](/platform/admin/governance/policies-and-limits#how-rules-combine)). A default does not prevent someone from selecting another permitted model.

The model list offers the models that can answer in chat. An image model that can't use tools, such as Gemini 2.5 Flash Image, is not among them, nor in the chat's model picker: chat sends every message with tools, such as a document search. Choose such a model under [image generation](#let-agents-generate-images), and the assistant creates pictures with it.

## Restrict model access

Under **Model access**, choose the mode and add rules for the users, teams, roles, or default scope you want to cover.

User, team and role rules require a target before you can confirm them, in either mode. The default scope applies to everyone and needs no target. Changing scope clears the previous target; select a target in the new scope.

Older rules saved without a target remain visible as **Missing target**, with a warning: they do not apply to anyone. Edit each affected rule to select its intended target, or delete it. Changes are not saved until every targeted rule has a target; completing the last repair saves the corrected policy. Tale does not guess targets or discard existing rules automatically.

| Mode | Effect for a matching rule |
| --- | --- |
| **Allowlist** | Only listed allowed models may be used; a blocked model remains denied. |
| **Blocklist** | Models are permitted unless listed as blocked. |

Access resolves user rules before team rules, then role rules, then the default. Multiple matching team rules combine their lists; an explicit block still wins for that model. If no rule matches, the policy does not restrict that user. Add a baseline rule when you intend to cover everyone.

For chat, access is checked when a model is used, including an explicitly selected or pinned model. A configured default must also pass the check. If it is denied, automatic selection can fall back to an allowed model. The editor warns about a default that conflicts with access rules; resolve that warning so the intended default is actually used.

<Tip>
Test both cases after changing access: an allowed model should work and a denied model should be refused for the affected member. Testing only as the admin does not prove a role-specific rule.
</Tip>

### Let API keys call the organization's models {#model-endpoints}

**Model endpoints for API keys** lets people use the models this policy allows from their own tools, such as opencode, Claude Code, or scripts built on the OpenAI or Anthropic SDKs, with a personal API key over OpenAI- and Anthropic-compatible endpoints. It is off by default. Turn on the **Model endpoints for API keys** switch; the change saves at once.

- **Who may call.** Owners, Admins, and Developers through their role. Any other member only with the right **Call models over the API**, granted under [Rights and qualifications](/platform/admin/governance/rights-and-qualifications).
- **Which models.** The chat models your provider credentials serve with an API key or an environment variable, narrowed by each credential's model allowlist. The access rules above apply to every call, for the person whose key sent it. The switch works independently of **Enable model access policy**: with that policy off, only the credentials' allowlists narrow the list.
- **What each call passes.** The budgets under [Policies and limits](/platform/admin/governance/policies-and-limits) and the input guardrails under [Guardrails](/platform/admin/governance/guardrails#model-endpoints). The models' answers are not filtered.
- **Where it shows.** Each call is booked under the person and the key, as **Direct API** in [Usage analytics](/platform/admin/governance/usage-analytics).

<Frame caption="Governance > Models — Model endpoints for API keys, switched on.">

![The Model endpoints for API keys section on the Models page with its switch on, explaining that Owners, Admins, Developers, and members granted Call models over the API may use the organization's models from their own tools.](/images/platform/governance-model-endpoints.webp)

</Frame>

Turning the switch off refuses the next call with `403 MODEL_API_DISABLED`. [Use Tale from your editor or a script](/develop/use-tale-from-your-editor#model-endpoints) shows members how to connect their tools.

### Process prompts only in the EU/EEA {#eu-processing}

**Process prompts only in the EU/EEA** keeps the organization's model calls on the EU endpoints of the vendors Tale knows and on the endpoints you attest as processing in the EU/EEA. It is off by default and works independently of **Enable model access policy**.

1. Under **Endpoints attested as processing in the EU/EEA**, list the hosts of your own endpoints that process there, one per line, as each appears in its provider's base URL or endpoint URL: the server of a [custom provider](/platform/admin/providers#define-a-custom-provider), or an Azure OpenAI resource whose deployments process in the EU/EEA, such as `my-resource.openai.azure.com`. Select **Save endpoints**.
2. Turn on the **Process prompts only in the EU/EEA** switch. The change saves at once.

Attest the hosts before you turn the switch on, so that no call to them is refused in between.

- **What counts.** The EU endpoints of the vendors Tale knows, `eu.openrouter.ai`, `eu.api.openai.com` and `api.eu.mistral.ai`, and the hosts you attest. A vendor's global endpoint, such as `openrouter.ai` or `api.openai.com`, never counts: the editor doesn't attest it and names the vendor's EU endpoint instead. To use such a vendor, define a custom provider whose base URL is its EU endpoint, such as `https://eu.openrouter.ai/api/v1`. Attest an Azure resource only when its deployments are Regional deployments in an EU/EEA region or Data Zone EU deployments: a Global deployment can process a request in any region. The vendors' EU endpoints and Data Zone EU may also process in Switzerland, and OpenRouter's in the UK: [Keep prompts on EU endpoints](/cloud/data-residency#eu-processing) shows where each kind of endpoint processes a prompt.
- **What it covers.** Chat replies and their titles, **Improve with AI** in the inbox, task turns an agent works with the chat's tools, the `llm` steps of automations, document embeddings and search, image generation, audio transcription, voice output, the text the [moderation provider](/platform/admin/governance/guardrails#moderation) checks, the [model endpoints for API keys](#model-endpoints), and coding agents such as Claude Code or Codex that work a task or an automation step in a sandbox, through the model gateway or a subscription: a refused agent run fails before the agent starts, without a key or credential. Over the model endpoints and the model gateway of coding agents, a model of a catalog provider that the gateway serves itself, such as OpenAI, Azure OpenAI, Mistral or OpenRouter, is refused even on an EU endpoint, because the gateway calls the vendor's own endpoint: serve the model through a custom provider instead. When the provider's definition sets a coding-agent endpoint, Claude Code calls that endpoint, and it is the one that counts.
- **What is refused.** A call to any other endpoint, or through a provider that names none, is refused before anything is sent. The person sees why and what an admin can change, and the refusal is recorded in the [audit log](/platform/admin/governance/audit-logs) as **Model access denied**. While the model access policy can't be read, every model call is refused until an admin saves a valid policy.
- **What is offered.** While the switch is on, the model pickers offer only models whose endpoint it lets through: the chat's model list and its automatic choice, the model selects of agents and automations, **Default models**, image generation, audio transcription, the embedding model under **Settings > Data residency**, and the models of the [model endpoints](#model-endpoints). A picker that leaves models out says why. While the model access policy can't be read, they offer none.
- **Not covered yet.** The picker for the model that reads images still offers every model.

**Message information** under a reply says where it was processed when that is known; [See how a reply was produced](/platform/chat/basics#reply-details) explains the **Region** line.

## Choose the image-reading model

A text-only agent needs help reading an image, such as a screenshot or scanned page. **Vision model** selects the model that describes it for the agent. An agent whose own model reads images reads them itself; the vision model still serves the image tools that scripts and coding agents call inside their sandbox, such as batch transcription of scanned pages, so every managed agent gets one when a reachable model exists.

Leave **Model that reads images** on **Automatic** to follow the available provider catalog. Tale prefers a recommended vision model and otherwise selects a reachable low-cost option; while [Process prompts only in the EU/EEA](#eu-processing) is on, it passes over providers the switch refuses. The text below the picker identifies the current choice and reason.

Pin a model if you need a stable choice. The picker offers models that can read images. If a pin later becomes unavailable, restore its provider access or explicitly choose **Automatic** and save. Tale does not silently switch a pinned model. Review the current choice after rotating credentials or changing model availability.

## Allow image generation {#let-agents-generate-images}

**Image generation** lets the chat assistant, [project agents](/platform/projects/project-agents) working on tasks, and agent nodes in [automations](/platform/automations/concepts) create images, such as a cover for a report or a visual for a campaign. It is off until you turn it on.

1. Turn on **Allow image generation**. The switch saves at once.
2. Leave **Image model** on **Automatic**, or select a model and save the page's pending changes in the header.
3. Check the line below the picker. It names the model that creates the images.

<Frame caption="Governance > Models — image generation on, with a pinned image model.">

![The Image generation section with its switch on, the Image model picker set to OpenRouter · google/gemini-2.5-flash-image, and the line below it naming the model that currently creates images.](/images/platform/governance-image-generation.webp)

</Frame>

**Automatic** uses the first model of a short recommended list that your provider credentials reach: Gemini 2.5 Flash Image, GPT Image 2.5 Flare, GPT Image 1 Mini until OpenAI shuts it down on December 1, 2026, then FLUX.2 Pro. It considers OpenRouter and OpenAI credentials. The picker lists every image model your credentials can serve, including those of other compatible providers. It leaves out vector models, which return SVG files that Tale does not store. An edit model, which needs a picture to start from in every request, can be selected, but **Automatic** never picks one, and Tale refuses a request without a picture before anything is billed. A selected model stays fixed until you change it; if it becomes unavailable, Tale reports it and does not switch to another model. OpenAI shut down GPT Image 1 on October 23, 2026 and shuts down GPT Image 1 Mini on December 1, 2026: if you selected either, choose another model or **Automatic**. Turning image generation off keeps the selected model for the next time you turn it on.

While image generation is on and a model is available, every agent turn that starts on a runtime with Tale's MCP channel gets an image tool. Agents on other runtimes, and every agent while image generation is off, do not see the tool at all; [Choose an agent runtime](/platform/agents/harnesses) shows which runtimes have the channel. Turning image generation off also stops a running agent's next image request. An agent saves its images among its files, so a task's images appear with its deliverables and an automation step's images with the step's output. In chat, the assistant gets the same image tool, and its images appear below the reply; see [Make files and use skills in chat](/platform/chat/files-and-skills).

Images come in three shapes: square, landscape at 3:2, and portrait at 2:3. An agent that asks for another shape, such as a 16:9 banner, gets the one with the same orientation. A model that draws no 3:2 or 2:3, such as Recraft, gets the closest shape it draws instead, such as 4:3 or 3:4. The image model decides the exact size in pixels, and the image tool tells the agent the size of each image it saved.

An agent can also start from up to four existing images, such as a photo to restyle, when the image model accepts pictures. A model that takes fewer, such as Gemini 2.5 Flash Image with three, gets no request with more: Tale refuses it before anything is billed and tells the agent the limit.

Each image is billed to your organization and counts against the person who started the run, like the rest of the run; in chat, against the person chatting, and one reply creates at most 16 images. One agent turn creates at most 16 images, one request at a time, and its images draw on the same allowance as the turn's model use: each image's cost comes out of what the model may still spend, and once the turn has used the allowance up, Tale refuses the next image. A budget limit that applies to that person refuses the image before the image model is called. Set cost or request limits for images under [Policies and limits](/platform/admin/governance/policies-and-limits); [How usage is counted](/platform/admin/governance/usage-attribution) explains who each image counts against. For the policy file and custom image endpoints, see the [self-hosted provider reference](/self-hosted/configuration/providers#configure-image-generation).

## Provide a standard agent {#standard-agent}

Only Editors and higher roles can add agents to a project. So that a project without agents can still take on agent work, Tale offers the organization's **standard agent** there: anyone who can open the project can give it a task, Members included. It is on by default.

<Frame caption="Governance > Models — the standard agent, on, with its agent runtime and model chosen automatically.">

![The Standard agent section with its switch on, Agent runtime and Model both set to Automatic, an empty Instructions field showing Built-in instructions, and the line For you, it works with Claude Haiku 4.5 and hands over to Claude Code when a task needs a full workspace.](/images/platform/governance-standard-agent.webp)

</Frame>

- **Where it appears.** In a project without agents, **Assignee** offers **Standard agent**, and [Create task from chat](/platform/chat/basics#create-task-from-chat) assigns it for you. Tale sets it up in a project the first time someone chooses it there or hands a chat's task to that project; the project's **Agents** tab then lists it with the **Standard** badge, and [The standard agent](/platform/projects/project-agents#standard-agent) explains how it behaves there.
- **What it runs on.** With **Agent runtime** and **Model** on **Automatic**, Tale picks a recommended model the person starting the task may use under your [model access](#restrict-model-access) rules. When that person starts the task, the agent works with the model and the same tools as the chat, makes files in a light sandbox, and hands over to Claude Code, or to the agent runtime a subscription model is bound to, only when a task needs a full workspace; [How a standard agent run works](/platform/projects/project-agents#standard-agent-runs) describes it. Runs that an automation, a schedule or another agent starts, and runs on a model only a runtime can serve, work in that runtime from the start. The line at the end of the section names which of the two applies for you. Choose an agent runtime to run every task in it, or a model to use it for everyone, then save the page's pending changes in the header.
- **What it knows.** Its built-in instructions tell it to do what the task asks with the task's files and comments, deliver a requested document, presentation, spreadsheet or PDF as a task output, write in the task's language, and ask in a comment when the task is unclear. Text under **Instructions** replaces them.
- **What it may use.** The document skills `docx`, `pptx`, `xlsx` and `pdf` that are available to the project, and none of the connectors, platform tools or secrets an Editor can grant to other agents. When a person starts it, it also has what a chat has: knowledge search, page fetching, files, and images when [image generation](#let-agents-generate-images) is on.

Every run starts with the settings in force at that moment; a running agent keeps the ones it started with. A chosen model stays in effect even when it becomes unavailable, and so does one that a person's model access denies: the standard agent then doesn't start for them and says why, and Tale doesn't switch to another model. Choose another model or **Automatic** and save. When no model a person may use can run it, it doesn't start for them either: add a credential under [AI providers](/platform/admin/providers), or check their model access.

Turn off **Provide a standard agent** to stop offering it; the change saves at once and keeps your choices. Projects without agents then offer no agent, and tasks already given to a standard agent can't start until you turn it back on. For the policy file, see the [self-hosted provider reference](/self-hosted/configuration/providers#configure-the-standard-agent).

## Choose the audio transcription model

**Audio transcription model** controls server transcription for audio and video attachments, the audio fallback for video links, and dictation in browsers without built-in speech recognition. Browser speech recognition uses its own service and keeps priority when supported.

<Frame caption="Audio transcription has its own organization-wide automatic or fixed model selection.">

![The Audio transcription model section shows Automatic and identifies the current server transcription model.](/images/platform/governance-content-models.webp)

</Frame>

An active default credential for OpenRouter also makes its dedicated speech-to-text models available here. Tale discovers them from the OpenRouter catalog. Check that the credential’s allowed models include your intended transcription model, then use **Automatic** or select that model explicitly.

1. Under **Model that transcribes audio**, leave **Automatic** selected to let Tale choose an available compatible model, or select a specific provider and model.
2. Save the page's pending changes in the header. Until you save, the selection is a draft; discard it to keep the saved setting.
3. Check the current model shown below the picker. Test a short recording before relying on the setup for a longer upload.

A model change applies to new transcription work; completed attachments keep their existing transcript. Uploading the same bytes again reuses completed work for the same transcription target, but transcribes them again when the target provider or model differs.

An explicit selection stays fixed. If that model becomes unavailable, Tale reports it and does not switch to another model. Choose another available model or **Automatic**, then save. If no compatible model is available, configure an active credential in [AI providers](/platform/admin/providers) and check the credential’s allowed models. A temporary failure to check the configuration calls for a retry, not a new model selection.

If unavailable server transcription prevents a member’s attempt to dictate or attach audio or video, a dismissible dialog explains the problem. Settings actions appear according to their access; otherwise, they are asked to contact an admin. A temporarily failed availability check can be retried. For deployment-managed selection and custom audio endpoints, see the [self-hosted provider reference](/self-hosted/configuration/providers#configure-audio-transcription).

## Diagnose an unexpected choice

Check the member's roles and teams, the explicit chat selection, the matching default, the access rule, and the provider credential's model list. A model appearing in a catalog does not establish that the organization has usable credentials for it. Spending and token caps still apply through [Policies and limits](/platform/admin/governance/policies-and-limits).
