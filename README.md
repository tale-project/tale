<!-- TALE664 disposable strict-base advancement probe. -->

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
  <img alt="Tale" src=".github/assets/logo-light.svg" width="150">
</picture>

[![Build](https://github.com/tale-project/tale/actions/workflows/build.yml/badge.svg?branch=main&event=push)](https://github.com/tale-project/tale/actions/workflows/build.yml)
[![Tests](https://github.com/tale-project/tale/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/tale-project/tale/actions/workflows/checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

</div>

# Tale — The open-source workspace for teams and AI agents

**Turn company problems into tasks your team and AI agents can solve together.**

Tale gives teammates and AI agents a shared project workspace. Add tasks to the board, assign people or agents, follow the work, and review reports and delivered files. Keep the brief, discussions, project knowledge, and results together. Use agents to research a question, review documents, prepare reports and marketing materials, or build a website, app, or internal tool.

Choose each agent’s runtime, model, skills, and tools. Equip a manager agent to delegate ready tasks and coordinate follow-up work. Agents run in persistent sandbox workspaces, with concurrency limited by your configured capacity.

Use your own provider API keys or supported subscriptions with compatible agent runtimes. See [runtime and credential support](https://docs.tale.dev/platform/agents/harnesses) for the available combinations.

Self-host Tale on your own infrastructure or use the managed Cloud service. The code is MIT-licensed. Community and Enterprise include the same product features; Enterprise adds professional operation and support. See [plans and pricing](https://tale.dev/pricing) for the current offer.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/projects-task-board.webp"><img src=".github/assets/readme-gallery-tasks.webp" alt="The Website relaunch task board groups cards by status." width="100%"></a>
      <br><a href="https://docs.tale.dev/platform/projects/tasks"><b>Project tasks</b></a><br><sub>Organize work and review its progress.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/project-agents-models.webp"><img src=".github/assets/readme-gallery-project-agents.webp" alt="The project Agents tab lists named agents with their runtime and model." width="100%"></a>
      <br><a href="https://docs.tale.dev/platform/projects/project-agents"><b>Project agents</b></a><br><sub>Choose instructions, runtime, model and tools.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/automation-editor-canvas.webp"><img src=".github/assets/readme-gallery-workflow-editor.webp" alt="The automation editor shows connected steps and the selected node’s settings." width="100%"></a>
      <br><a href="https://docs.tale.dev/platform/automations/editor"><b>Workflow editor</b></a><br><sub>Inspect steps, test inputs and review runs.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/chat-arena-split.webp"><img src=".github/assets/readme-gallery-chat-arena.webp" alt="Arena displays two responses to the same prompt and the voting controls." width="100%"></a>
      <br><a href="https://docs.tale.dev/platform/chat/arena-mode"><b>Chat and Arena</b></a><br><sub>Compare two model responses side by side.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/connectors-add-credential.webp"><img src=".github/assets/readme-gallery-connectors.webp" alt="The Add credential dialog lists available connector integrations." width="100%"></a>
      <br><a href="https://docs.tale.dev/platform/connectors/overview"><b>Connectors</b></a><br><sub>Choose the services your workspace uses.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/governance-guardrails.webp"><img src=".github/assets/readme-gallery-guardrails.webp" alt="The Guardrails settings page shows policy status and configuration controls." width="100%"></a>
      <br><a href="https://docs.tale.dev/platform/admin/governance/guardrails"><b>Governance</b></a><br><sub>Review content safety and data policies.</sub>
    </td>
  </tr>
</table>

Select a screenshot to view it at full size. The captures show the English interface.

## From tasks to reviewed results

1. **Describe the work.** Create a [project task](https://docs.tale.dev/platform/projects/tasks) with the problem, source files, and completion criteria.
2. **Assign people and agents.** Configure [project agents](https://docs.tale.dev/platform/projects/project-agents) for the work, choose their tools, and start the tasks you want them to handle.
3. **Coordinate and review.** Follow progress on the board, steer agents with @mentions in task comments, and inspect their reports and files. A [manager agent](https://docs.tale.dev/platform/projects/task-automation#let-a-manager-agent-keep-the-queue-moving) can delegate ready work when granted the required tools.
4. **Repeat a defined process.** Use a versioned [automation](https://docs.tale.dev/platform/automations/concepts) when the work needs scheduled starts, workflow steps, or connector approvals.

### Example: review a launch brief

With a project agent and compatible model credentials configured, adapt this illustrative task brief to your own source files:

> Compare the attached launch brief and meeting notes. Produce a Markdown report listing conflicting dates, missing owners, and open decisions. Cite the source file and passage for each finding. Separate confirmed facts from questions, and leave the source files unchanged.

Before accepting the result, open the delivered report, verify its citations against both files, and check that each requested category is covered. Ask for corrections in the task when evidence is missing. The [task review guide](https://docs.tale.dev/platform/projects/task-automation) explains how to request changes or accept completed work.

## Evaluate Tale for your team

**Which agent runtimes can I use?** Tale includes Claude Code, Codex, Cursor, Gemini CLI, Hermes, OpenClaw, OpenCode, Pi, and Qwen Code. Availability depends on your deployment, credentials, and sandbox capacity. Check the [runtime compatibility matrix](https://docs.tale.dev/platform/agents/harnesses) for credential paths, tools, and conversation limits.

**Can I use an API key or an existing subscription?** Stored provider API keys use Tale's model gateway. Supported vendor subscriptions work only with compatible runtimes, cannot power ordinary Chat, and bypass Tale's gateway metering and spending caps. Read the [credential and cost details](https://docs.tale.dev/platform/agents/harnesses#understand-credential-exposure-and-cost) before choosing a connection.

**What does self-hosting require?** Start with Docker and Compose, storage for images and persistent data, and credentials for a supported model provider. Production also needs DNS, TLS, backups, and access controls. The [self-hosted quickstart](https://docs.tale.dev/self-hosted/install/quickstart) covers the local setup and links to production preparation.

**Where does my data go?** Application records, searchable knowledge, and original files have separate storage settings. Model providers, connectors, and external tools can process data outside those stores; self-hosting alone does not keep every request local. Review [data residency](https://docs.tale.dev/self-hosted/configuration/data-residency) and the [runtime's credential and network behavior](https://docs.tale.dev/platform/agents/harnesses).

**What differs between Community and Enterprise?** Both include the same product features under the MIT license. Enterprise adds professional operation and support. See [plans and pricing](https://tale.dev/pricing) for the current service terms.

## Start here

| Your goal | Follow this guide |
| --- | --- |
| Use a workspace your team already has | [Send your first message](https://docs.tale.dev/get-started/quickstart) |
| Install Tale | [Self-hosted quickstart](https://docs.tale.dev/self-hosted/install/quickstart) |
| Get a managed instance | [Request a demo](https://tale.dev/request-demo) |
| Build an agent for a project | [Create and test a project agent](https://docs.tale.dev/get-started/editors) |
| Connect another application | [API getting started](https://docs.tale.dev/get-started/developers) |
| Change the source code | [Contributor setup](docs/en/develop/contributor-setup.md) |
| Build with Tale’s UI components | [Component guides and live examples](https://ui.tale.dev/docs/getting-started/introduction) |

### Run a local instance

Use the published CLI on macOS or Linux; no repository clone or Bun installation is needed:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale init my-project
cd my-project
tale dev
```

You need Docker with Compose, space for several GB of images and your data, and a model provider credential for your first reply. Docker Desktop includes the amd64 emulation needed by the bundled object store on Apple Silicon. On ARM64 Linux, configure emulation before starting.

The CLI can help install or start Docker. On startup, open the printed URL, create the first account and organization, then add a credential under **Settings > AI providers** and [send your first message](https://docs.tale.dev/get-started/quickstart).

Press `Ctrl-C` to stop; run `tale dev` in the same directory to resume with your data.

The [installation quickstart](https://docs.tale.dev/self-hosted/install/quickstart) covers Windows, certificates, architecture requirements and recovery. Use the [CLI guide](tools/cli/README.md) for commands. Before serving a team, follow [production preparation](https://docs.tale.dev/self-hosted/install/quickstart#prepare-a-production-deployment); `tale deploy` uses separate data volumes from the local development instance.

### Develop from source

Use the Bun version in [package.json](package.json), a compatible Node.js runtime, and Docker for the backing services. Python and uv are also needed for the full repository checks. The [contributor setup guide](docs/en/develop/contributor-setup.md) covers versions, environment variables, and ports.

```bash
bun install --frozen-lockfile
bun run setup:check
bun run dev
```

Wait for the platform’s readiness message, then open the address it prints. The setup check covers only part of the environment; a passing check does not establish that databases, storage, or a model provider are configured.

To work on documentation alone, no platform database or provider is needed. The first command previews the product docs, the second the design-system guide:

```bash
bun run --filter @tale/docs dev
bun run --filter @tale/ui-docs dev
```

## What you can do

- **[Chat](https://docs.tale.dev/platform/chat/basics):** draft, explain, and work with information in a conversation. Compare models in Arena and inspect sources when an answer uses knowledge.
- **[Projects](https://docs.tale.dev/platform/projects/overview):** keep related tasks, files, instructions, and chats together. Choose which chats to share with the project.
- **[Project agents](https://docs.tale.dev/platform/projects/project-agents):** define an agent’s instructions, harness, model, and tools. Assign a task, start the agent, and review the result.
- **[Knowledge](https://docs.tale.dev/platform/knowledge/overview):** prepare documents, knowledge entries, and website content for retrieval. Upload completion and indexing are separate steps.
- **[Automations](https://docs.tale.dev/platform/automations/concepts):** connect steps into a workflow, test it, and run it manually or through configured triggers.
- **[Connectors](https://docs.tale.dev/platform/connectors/overview):** connect external services using credentials your workspace controls.
- **[Administration](https://docs.tale.dev/platform/admin/overview):** manage members, roles, providers, policies, usage, and audit records.

Features depend on your role and deployment configuration. A local model keeps inference on your infrastructure; connected services and external tools still have their own data flows. See [data residency](https://docs.tale.dev/self-hosted/configuration/data-residency) before choosing a deployment boundary.

## Documentation

The documentation is available in [English](https://docs.tale.dev), [German](https://docs.tale.dev/de), and [French](https://docs.tale.dev/fr).

Start with a guided task, use the Platform pages for everyday work, and consult the operator or API references when you need exact configuration details. The [screenshot gallery](SCREENSHOTS.md) gives a visual overview. To improve the docs, read [the docs workspace README](services/docs/README.md).

Building an interface with Tale’s components? The [design-system guide](https://ui.tale.dev) documents `@tale/ui` and `@tale/marketing-ui` with live examples, in English. Its pages live in [services/ui-docs](services/ui-docs/README.md).

## Contribute or get help

Read [CONTRIBUTING.md](.github/CONTRIBUTING.md) and the [repository contract](AGENTS.md) before changing code. Run `bun run check` before submitting a pull request; follow the guide for additional checks appropriate to your change.

- Ask questions in [GitHub Discussions](https://github.com/tale-project/tale/discussions).
- Report reproducible bugs in [GitHub Issues](https://github.com/tale-project/tale/issues), including the version, steps, expected result, and actual result.
- Report vulnerabilities through [private security reporting](https://github.com/tale-project/tale/security).

## License

Tale is available under the [MIT license](LICENSE).

<!-- TALE664 repaired disposable Checks canary. -->
