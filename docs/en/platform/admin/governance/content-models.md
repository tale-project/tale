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

## Restrict model access

Under **Model access**, choose the mode and add rules for the users, teams, roles, or default scope you want to cover.

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

- **Who may call.** Owners, Admins, and Developers through their role. Any other member only with the competence **Call models over the API**, granted under [Competences](/platform/admin/governance/competences).
- **Which models.** The chat models your provider credentials serve with an API key or an environment variable, narrowed by each credential's model allowlist. The access rules above apply to every call, for the person whose key sent it. The switch works independently of **Enable model access policy**: with that policy off, only the credentials' allowlists narrow the list.
- **What each call passes.** The budgets under [Policies and limits](/platform/admin/governance/policies-and-limits) and the input guardrails under [Guardrails](/platform/admin/governance/guardrails#model-endpoints). The models' answers are not filtered.
- **Where it shows.** Each call is booked under the person and the key, as **Direct API** in [Usage analytics](/platform/admin/governance/usage-analytics).

<Frame caption="Governance > Models — Model endpoints for API keys, switched on.">

![The Model endpoints for API keys section on the Models page with its switch on, explaining that Owners, Admins, Developers, and members granted Call models over the API may use the organization's models from their own tools.](/images/platform/governance-model-endpoints.webp)

</Frame>

Turning the switch off refuses the next call with `403 MODEL_API_DISABLED`. [Use Tale from your editor or a script](/develop/use-tale-from-your-editor#model-endpoints) shows members how to connect their tools.

## Choose the image-reading model

A text-only agent needs help reading an image, such as a screenshot or scanned page. **Vision model** selects the model that describes it for the agent. An agent whose own model reads images reads them itself; the vision model still serves the image tools that scripts and coding agents call inside their sandbox, such as batch transcription of scanned pages, so every managed agent gets one when a reachable model exists.

Leave **Model that reads images** on **Automatic** to follow the available provider catalog. Tale prefers a recommended vision model and otherwise selects a reachable low-cost option. The text below the picker identifies the current choice and reason.

Pin a model if you need a stable choice. The picker offers models that can read images. If a pin later becomes unavailable, restore its provider access or explicitly choose **Automatic** and save. Tale does not silently switch a pinned model. Review the current choice after rotating credentials or changing model availability.

## Let agents generate images

**Image generation** lets [project agents](/platform/projects/project-agents) working on tasks and agent nodes in [automations](/platform/automations/concepts) create images, such as a cover for a report or a visual for a campaign. It is off until you turn it on. Chat never creates images: a member who needs one assigns a task to a project agent.

1. Turn on **Let agents generate images**. The switch saves at once.
2. Leave **Image model** on **Automatic**, or select a model and save the page's pending changes in the header.
3. Check the line below the picker. It names the model agents use.

<Frame caption="Governance > Models — image generation on, with a pinned image model.">

![The Image generation section with its switch on, the Image model picker set to OpenRouter · google/gemini-2.5-flash-image, and the line below it naming the model agents currently use.](/images/platform/governance-image-generation.webp)

</Frame>

**Automatic** uses the first model of a short recommended list that your provider credentials reach: Gemini 2.5 Flash Image, GPT Image 1 Mini, GPT Image 1, then FLUX.2 Pro. It considers OpenRouter and OpenAI credentials. The picker lists every image model your credentials can serve, including those of other compatible providers. A selected model stays fixed until you change it; if it becomes unavailable, Tale reports it and does not switch to another model. Turning image generation off keeps the selected model for the next time you turn it on.

While image generation is on and a model is available, every agent turn that starts on a runtime with Tale's MCP channel gets an image tool. Agents on other runtimes, and every agent while image generation is off, do not see the tool at all; [Choose an agent runtime](/platform/agents/harnesses) shows which runtimes have the channel. Turning image generation off also stops a running agent's next image request. An agent saves its images among its files, so a task's images appear with its deliverables and an automation step's images with the step's output.

Images come in three shapes: square, landscape at 3:2, and portrait at 2:3. An agent that asks for another shape, such as a 16:9 banner, gets the one with the same orientation. The image model decides the exact size in pixels, and the image tool tells the agent the size of each image it saved.

Each image is billed to your organization and counts against the person who started the run, like the rest of the run. One agent turn creates at most 16 images, one request at a time, and its images draw on the same allowance as the turn's model use: each image's cost comes out of what the model may still spend, and once the turn has used the allowance up, Tale refuses the next image. A budget limit that applies to that person refuses the image before the image model is called. Set cost or request limits for images under [Policies and limits](/platform/admin/governance/policies-and-limits); [How usage is counted](/platform/admin/governance/usage-attribution) explains who each image counts against. For the policy file and custom image endpoints, see the [self-hosted provider reference](/self-hosted/configuration/providers#configure-image-generation).

## Provide a standard agent {#standard-agent}

Only Editors and higher roles can add agents to a project. So that a project without agents can still take on agent work, Tale offers the organization's **standard agent** there: anyone who can open the project can give it a task, Members included. It is on by default.

<Frame caption="Governance > Models — the standard agent, on, with its agent type and model chosen automatically.">

![The Standard agent section with its switch on, Agent type and Model both set to Automatic, an empty Instructions field showing Built-in instructions, and the line For you, it runs on Claude Code with Claude Haiku 4.5.](/images/platform/governance-standard-agent.webp)

</Frame>

- **Where it appears.** In a project without agents, **Assignee** offers **Standard agent**, and [Create task from chat](/platform/chat/basics#create-task-from-chat) assigns it for you. The first task sets it up in that project; the project's **Agents** tab then lists it with the **Standard** badge, and [The standard agent](/platform/projects/project-agents#standard-agent) explains how it behaves there.
- **What it runs on.** With **Agent type** and **Model** on **Automatic**, Tale picks a recommended model the person starting the task may use under your [model access](#restrict-model-access) rules, and runs it on Claude Code, or on the agent type a subscription model is bound to. The line at the end of the section names what it runs on for you. Choose an agent type or a model to use it for everyone, then save the page's pending changes in the header.
- **What it knows.** Its built-in instructions tell it to do what the task asks with the task's files and comments, deliver a requested document, presentation, spreadsheet or PDF as a task output, write in the task's language, and ask in a comment when the task is unclear. Text under **Instructions** replaces them.
- **What it may use.** The document skills `docx`, `pptx`, `xlsx` and `pdf` that are available to the project, and none of the connectors, platform tools or secrets an Editor can grant to other agents.

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
