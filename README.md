<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
  <img alt="Tale" src=".github/assets/logo-light.svg" width="150">
</picture>

### The Orchestrator for AI Agents

Connect **OpenClaw**, **Hermes Agent**, **Claude Code**, **Codex**, **Cursor**, **Gemini CLI**, **OpenCode**, and **Pi**.<br/>
Pool their knowledge, delegate real work — on infrastructure you run.

[![Build](https://github.com/tale-project/tale/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/tale-project/tale/actions/workflows/build.yml)
[![Test](https://github.com/tale-project/tale/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/tale-project/tale/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/tale-project/tale)](https://github.com/tale-project/tale/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-tale.dev-0a0a0a.svg)](https://tale.dev/docs)
[![Self-hosted](https://img.shields.io/badge/self--hosted-Docker-2496ed.svg)](https://tale.dev/docs/self-hosted/install/quickstart)

[Get started](#get-started) · [See it in action](#see-it-in-action) · [What's in the box](#whats-in-the-box) · [Docs](https://tale.dev/docs) · [Contributing](#contributing)

**Read this in:** [English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

</div>

---

<table>
  <tr>
    <td width="33.33%"><a href="https://tale.dev/docs/platform/chat/overview"><img src=".github/assets/readme-gallery-chat-arena.webp" alt="Arena mode running the same prompt through two models side by side" width="100%"></a></td>
    <td width="33.33%"><a href="https://tale.dev/docs/platform/projects/task-automation"><img src=".github/assets/readme-gallery-tasks.webp" alt="A project task board with task cards in all six columns, from Backlog to Cancelled" width="100%"></a></td>
    <td width="33.33%"><a href="https://tale.dev/docs/platform/agents/concepts"><img src=".github/assets/readme-gallery-agent-editor.webp" alt="The agent editor bundling instructions, knowledge, tools, and a model" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Chat & Arena</b> — one prompt, two models side by side</sub></td>
    <td align="center"><sub><b>Tasks</b> — assign a card to an agent and it goes to work</sub></td>
    <td align="center"><sub><b>Agents</b> — instructions, knowledge, tools, and a model as one unit</sub></td>
  </tr>
  <tr>
    <td width="33.33%"><a href="https://tale.dev/docs/platform/automations/concepts"><img src=".github/assets/readme-gallery-workflow-editor.webp" alt="The workflow editor canvas with the typed, branching steps of an automation" width="100%"></a></td>
    <td width="33.33%"><a href="https://tale.dev/docs/platform/connectors/overview"><img src=".github/assets/readme-gallery-connectors.webp" alt="The connectors catalog with Confluence, GitHub, Gmail, Google Drive, Shopify, and more" width="100%"></a></td>
    <td width="33.33%"><a href="https://tale.dev/docs/platform/approvals/concepts"><img src=".github/assets/readme-gallery-guardrails.webp" alt="Guardrails settings layering content safety, PII detection, and moderation" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Workflow editor</b> — typed steps, schedules, and approval gates</sub></td>
    <td align="center"><sub><b>Connectors</b> — Slack, Gmail, GitHub, MCP servers, and more</sub></td>
    <td align="center"><sub><b>Governance</b> — guardrails, PII filters, audit trail, spend limits</sub></td>
  </tr>
</table>

<p align="center"><a href="SCREENSHOTS.md"><b>Browse the full screenshot gallery →</b></a></p>

Tale is an open-source, self-hosted platform that orchestrates AI agents. It connects the agents and CLIs your team already uses, pools their knowledge into one governed knowledge base, and runs automations with human approval — on your own infrastructure or in a managed cloud. Tale is not another chat UI: it is the orchestration, knowledge, and governance layer over the agents you already run. Everything is MIT-licensed, and the free Community edition ships the identical feature set.

- **Self-hosted by default** — runs on your VPC, on-premises, or fully air-gapped; pair it with local models and no data leaves your network.
- **Fully open source** — the entire codebase is public under the MIT license. Read it, audit it, change what you need.
- **Security built in** — human-in-the-loop approvals, audit logs, guardrails, PII filters, and budget controls; ISO 27001 and SOC 2 Type II certified, GDPR-compliant.
- **Vendor-neutral** — OpenRouter out of the box, any OpenAI-compatible provider, bring your own models.

## Get started

### Self-host in three commands

No prerequisites: the CLI installs Docker if it's missing and generates every secret. An [OpenRouter](https://openrouter.ai) key (or any OpenAI-compatible provider) is optional — you add it later, in-app.

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale init my-project && cd my-project
tale dev
```

On Windows, install the CLI with `irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex` (PowerShell).

Ready for a server? `tale deploy` gives you blue-green, zero-downtime deployments — see the [self-hosted quickstart](https://tale.dev/docs/self-hosted/install/quickstart) and the [CLI reference](tools/cli/README.md).

### Or use Tale Cloud

Let Tale operate the stack: every organization gets its own managed instance, with your data pinned to a region you control. Request one at [tale.dev/request-demo](https://tale.dev/request-demo).

### Or run from source

Bun ≥ 1.3 is the only prerequisite — no Docker, no cloud account. See [Contributing](#contributing).

```bash
bun install
bun run setup:check
bun run dev
```

## See it in action

<img src=".github/assets/readme-tour.webp" alt="Tale product tour cycling through the agent editor, a project task board, the automation workflow canvas, the connectors catalog, and governance guardrails" width="100%">

Agents → Projects → Automations → Connectors → Governance — one lap around the platform. Take the full tour in the [docs](https://tale.dev/docs).

## What's in the box

- **[Chat](https://tale.dev/docs/platform/chat/overview)** — the everyday entry point: agents, attachments, citations, voice — and Arena, which runs one prompt through two models side by side.
- **[Projects](https://tale.dev/docs/platform/projects/overview)** — shared workspaces that bundle the chats, files, instructions, and discussions around one piece of work — with project-scoped agents.
- **[Tasks](https://tale.dev/docs/platform/projects/task-automation)** — kanban boards where assigning a card to an agent puts it to work — triage, execution, human review gates, budgets, and a kill switch.
- **[Knowledge](https://tale.dev/docs/platform/knowledge/overview)** — documents, crawled websites, and typed records that agents retrieve and cite, so answers reflect your reality.
- **[Agents](https://tale.dev/docs/platform/agents/concepts)** — instructions, knowledge, tools, and a model as one unit; run them on the platform, or dock Claude Code, Codex, and Cursor in isolated sandboxes.
- **[Automations](https://tale.dev/docs/platform/automations/concepts)** — typed workflows (LLM, Action, Condition, Loop, and Sandbox steps) on schedules, webhooks, and events — with human approval gates.
- **[Connectors](https://tale.dev/docs/platform/connectors/overview)** — Slack, Teams, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, GitHub, Shopify, and MCP servers.
- **[Unified inbox](https://tale.dev/docs/platform/automations/builtin)** — turn a shared mailbox (Gmail, Outlook, IMAP/SMTP) into a team inbox with AI-assisted replies.
- **[Governance](https://tale.dev/docs/platform/approvals/concepts)** — approvals before actions ship, a full audit trail, guardrails, PII filters, and spend limits — plus SSO via [Microsoft Entra ID or trusted headers](https://tale.dev/docs/platform/admin/enterprise-sso).

## Documentation

The docs ship in English, Deutsch, and Français — start at [tale.dev/docs](https://tale.dev/docs).

- [Quickstart](https://tale.dev/docs/get-started/quickstart) — first steps, for every role
- [Platform reference](https://tale.dev/docs/platform) — every feature, module by module
- [Build an agent](https://tale.dev/docs/platform/agents/create) — specialised assistants end to end
- [Self-hosted operations](https://tale.dev/docs/self-hosted/overview) — architecture, install, upgrades
- [Developer surface](https://tale.dev/docs/develop/overview) — REST API, webhooks, custom tools
- [CLI reference](tools/cli/README.md) — every `tale` command and flag

## Community and support

- **Questions and ideas** — [GitHub Discussions](https://github.com/tale-project/tale/discussions)
- **Bugs** — [GitHub Issues](https://github.com/tale-project/tale/issues)
- **Vulnerabilities** — use [private security reporting](https://github.com/tale-project/tale/security), never a public issue

## Contributing

Tale is built in the open and welcomes contributions. Bun alone boots the full stack (`bun install && bun run dev`); Python 3.12 and uv are only needed for the full gate and the bundled Python skills. Run `bun run check` before every PR.

Start with the [contributing guide](.github/CONTRIBUTING.md) and [contributor setup](docs/en/develop/contributor-setup.md); [`AGENTS.md`](AGENTS.md) is the engineering contract for every workspace.

## License

Tale is [MIT-licensed](LICENSE).

## Star History

<a href="https://www.star-history.com/?repos=tale-project%2Ftale&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=tale-project/tale&type=date&theme=dark&legend=top-left&sealed_token=QQ7jRkA-kcGWHW7hES6gDAnN_iUmNNiNL1WJAcUCDEPJGpUMe5rwPOHP2IQV4k17HGAd83jhXu3Tc1Oi8sFuqd-gEM_rAf92ixz0vKdM1H29A7TGueyNB0FfAStEcq0nlKl1wpm-neReULNnZ7LqMbm4y9qAReoOLF1Aho8gy-jDt_hKAmMDS8gZbEbl" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=tale-project/tale&type=date&legend=top-left&sealed_token=QQ7jRkA-kcGWHW7hES6gDAnN_iUmNNiNL1WJAcUCDEPJGpUMe5rwPOHP2IQV4k17HGAd83jhXu3Tc1Oi8sFuqd-gEM_rAf92ixz0vKdM1H29A7TGueyNB0FfAStEcq0nlKl1wpm-neReULNnZ7LqMbm4y9qAReoOLF1Aho8gy-jDt_hKAmMDS8gZbEbl" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=tale-project/tale&type=date&legend=top-left&sealed_token=QQ7jRkA-kcGWHW7hES6gDAnN_iUmNNiNL1WJAcUCDEPJGpUMe5rwPOHP2IQV4k17HGAd83jhXu3Tc1Oi8sFuqd-gEM_rAf92ixz0vKdM1H29A7TGueyNB0FfAStEcq0nlKl1wpm-neReULNnZ7LqMbm4y9qAReoOLF1Aho8gy-jDt_hKAmMDS8gZbEbl" />
 </picture>
</a>
