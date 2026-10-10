---
title: Choose an agent runtime
description: Match an agent runtime to its credentials, tools and sandbox behavior before assigning real work.
---

An agent runtime is the coding program that runs an agent’s session in a sandbox. It asks the model what to do, reads and writes files, runs commands, and returns a report. Choose it for project-agent tasks or an automation’s `agent` node; the ordinary Chat model picker does not select an agent runtime.

## Select the runtime and check access

In a project’s **Agents** tab, open an agent and choose **Agent runtime**. An automation’s agent node uses the same **Agent runtime** field. Then choose the model and provider. Under **Settings > AI providers**, **Agent runtimes** shows which execution paths the organization can currently serve.

A runtime needs both compatible credentials and [sandbox capacity](/platform/admin/sandboxes). A working chat model is not enough. If a runtime is missing or has no models, inspect its status and provider credential before changing the task prompt. A model whose tool calls need OpenAI’s Responses API, such as GPT-6 Astra or GPT-6.1 Sol, runs only on Codex, so the model picker offers it for no other runtime.

## Compare supported runtimes

“Managed” means the runtime calls through Tale’s model gateway. “Direct” means the session receives a credential for the provider’s own tooling. The built-in definitions support these combinations; your deployment and credentials determine what is available.

| Agent runtime | Credential path | Receives new instructions in the running process | Tale’s MCP channel |
| --- | --- | --- | --- |
| Claude Code | Managed or direct | Yes | Yes |
| Codex | Managed or direct | No | Yes |
| Cursor | Direct only | No | No |
| Gemini CLI | Managed or direct | No | Yes |
| Hermes | Managed or direct | No | No |
| OpenClaw | Managed or direct | No | Yes |
| OpenCode | Managed only | No | Yes |
| Pi | Managed or direct | No | No |
| Qwen Code | Managed or direct | No | Yes |

**Claude Code (compact prompt)** is an optional choice for focused workflows that already supply complete task instructions. It shortens the runtime’s built-in instructions and some tool descriptions while retaining tools, hooks, MCP and Tale’s added guidance. Check task results and elapsed time with your model before adopting it; a smaller prompt does not guarantee a faster run. Choose ordinary **Claude Code** to restore its full prompt on the next fresh run. A provider subscription restricted to Claude Code does not automatically support the compact choice.

To guide project work, comment on the task and mention its agent. Claude Code receives that guidance at a tool boundary. For the other runtimes, Tale stops the current process and continues the conversation in a new process with the comment. This is why a running task may restart its process after you give it direction.

Gemini CLI is the exception: Tale never continues one of its conversations. A later comment, an automatic retry, or an answer to a question it asked starts a fresh conversation over the same workspace, with the task brief and the earlier rounds restated, because the runtime cannot resume a conversation in which it ran a tool. Its files and output are preserved; only the conversation starts over.

## Understand credential exposure and cost

With a stored API key or deployment-environment credential, Tale supplies a session-scoped gateway key. The original model-provider key stays at the platform. Calls through this gateway are metered and subject to the applicable spending rules, including allowance already assigned to other running turns.

Vendor subscriptions use their supported agent runtime and receive the subscription credential in the session environment. Gemini is the exception: its Google sign-in is written to a file in the session’s home folder for the turn, and removed when the turn ends. They cannot be used as ordinary chat credentials or with an incompatible agent runtime, because the vendors permit subscription tokens only in their own runtime; [AI providers](/platform/admin/providers#use-subscriptions-in-tasks-not-in-chat) explains this. Their direct provider calls bypass Tale’s gateway metering and spending caps; review usage with the subscription provider.

These model-credential rules do not mean the sandbox contains no secrets. Explicitly granted **Secrets**, and the token supplied for an equipped GitHub connection, can be available inside it. Grant only the access the task needs.

## Understand files and connected tools

A project agent reuses a persistent workspace across its tasks. Task attachments are available read-only under `/agent/inputs/<task>/attachments/`. The workspace keeps this copy only while the task can still use it: Tale removes it once the task is **Done** or **Cancelled**, archived or deleted, or hasn’t changed for 30 days, and the task’s next run copies the files in again. Files written to `/agent/output/<task>/` are collected as task **Deliverables** when the turn ends. Automation agent output is collected from `/agent/output/`.

Equipped skill bundles are staged as files and named in the run’s instructions. Review their instructions and scripts before granting them; [Skills on agents](/platform/agents/skills) explains staging and visibility.

Every runtime also finds Tale’s built-in `visual-aspect-analyzer` skill among its own skills, without equipping it. It drives a real browser over a finished UI change and reports layout shifts, flicker and other visual regressions. A skill of the same name in the workspace repository’s `.claude/skills` and `.agents/skills` folders takes its place in every runtime that reads a repository’s skills.

Tale’s connector broker keeps ordinary connector credentials at the platform and returns action results. It exposes read actions to agents, and refuses writes through that broker. Use an automation connector node for a governed connector write. GitHub tooling and explicitly granted secrets have their own access paths, so the broker’s read-only rule is not a general ban on all shell writes.

Agents with Tale’s MCP channel can also look up which Tale release the platform reports. Along with the platform tools granted to the agent, `workspace_status` returns `platform.version`, the release number that the answering backend’s build is labelled with: for example `0.5.64` for the release whose tag is `v0.5.64`. The backend reads nothing from the request for this value. A build without a release number, such as a development build, returns `null` with a short note instead. Treat the value as a label rather than proof, because any build can carry a release number. It also describes that backend only and does not show whether the rest of the deployment is healthy; the deployment’s [status page](/develop/status-page) reports on its services.

Outbound access normally permits package installation and repository cloning while blocking private addresses and cloud metadata targets. Operators can restrict permitted hosts further. If a command cannot reach a site, check the network policy instead of assuming the credential is wrong.

Tale’s built-in document skills `docx`, `pptx`, `xlsx` and `pdf` find the libraries they call already installed in the sandbox, so an agent equipped with them creates and reads Word, PowerPoint, Excel and PDF files even where package installation is blocked. Their instructions still include install commands such as `npm install -g docx`; where the registry is blocked, that step fails while the preinstalled library stays available. Text recognition (OCR) for scanned PDFs is not included.

## Check the result

The runtime determines when its turn is finished; Tale collects the report and output. Read both before marking the task complete. Confirm which checks actually ran and which depend on services unavailable in the sandbox. [Task automation](/platform/projects/task-automation) explains the review loop; [execution logs](/platform/automations/execution-logs) explains an automation’s agent-step result.

If the runtime cannot start at all — a configuration it refuses, a state directory it cannot find — the run fails at once and its reason quotes the last lines the runtime wrote, so the cause is named rather than a bare exit code. Such a run is not retried automatically; fix the cause, then retry.
