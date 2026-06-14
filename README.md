<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
  <img alt="Tale" src=".github/assets/logo-light.svg" width="150">
</picture>

### The Orchestrator for AI Agents

Connect **OpenClaw**, **Hermes Agent**, **Claude Code**, **Codex**, **Cursor**, **Gemini CLI**, **OpenCode**, and **Pi**.<br/>
Pool their knowledge, delegate tasks, and build your swarm of agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-tale-0a0a0a.svg)](docs/en/index.md)
[![Self-hosted](https://img.shields.io/badge/self--hosted-Docker-2496ed.svg)](docs/en/self-hosted/install/quickstart.md)

[Quick start](#quick-start) · [What you can do](#what-can-you-do) · [Commands](#command-reference) · [Documentation](#documentation) · [Contributing](#contributing)

**Read this in:** [English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

</div>

---

Tale is a **self-hosted AI platform** that turns the agents and CLIs your team already uses into one coordinated workforce. Give them a shared knowledge base, wire up your tools and integrations, and delegate work across them — agents, automations, and a unified inbox, all running on your own infrastructure. Install the CLI and run a single command to get started.

**Pick your path:**

- **Try Tale locally** — install the CLI and run two commands on your own machine. Start with [Quick start](#quick-start) below.
- **Use Tale Cloud** — let Tale operate the stack, sign up, and onboard your team. Start with [Cloud onboarding](docs/en/cloud/onboarding.md).
- **Contribute** — run Tale from source and ship a change back. Start with [Contributor setup](docs/en/develop/contributor-setup.md).

## Quick start

Get Tale running on your machine in three commands — install the CLI, scaffold a project, start it. The CLI installs Docker if it's missing and generates every secret for you, so there is nothing to set up first and nothing to hand-edit.

**Prerequisites for a local trial: none.** The installer provisions Docker for you, and `tale init` generates every secret — you do not need to bring anything to get the stack running. An [OpenRouter API key](https://openrouter.ai) (or any OpenAI-compatible provider) is optional and only needed before an agent can answer: you add it in the app after sign-up, in the setup wizard or under **Settings → AI providers**. `tale init` does not ask for it.

> **Windows with Hyper-V backend:** Ensure your project drive is shared in Docker Desktop Settings > Resources > File Sharing. WSL2 backend (default) requires no extra configuration.

### 1. Install the CLI

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

### 2. Create a project

```bash
tale init my-project
cd my-project
```

The CLI asks one question — **local trial** or **production domain** — and configures everything for that target: TLS, all security secrets, AI-editor config files, and the platform source extracted to `.tale/reference/` so AI-powered editors can create and edit configs with full platform awareness. The same project works for both a local trial and a real deployment.

### 3. Start Tale

```bash
tale start
```

Visit https://localhost (or your configured domain) when you see "Tale Platform is running!"

> **Note:** Your browser will show a certificate warning for self-signed certificates. This is safe to accept.

For detailed setup instructions, see the [self-hosted quickstart](docs/en/self-hosted/install/quickstart.md).

## What can you do?

| Goal                        | How                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| **Create custom agents**    | Edit JSON files in `agents/` — define instructions, tools, and models                     |
| **Build automations**       | Edit JSON files in `workflows/` — triggers, conditions, loops, AI steps                   |
| **Add integrations**        | Edit files in `integrations/` — REST APIs, SQL databases, custom connectors               |
| **Use AI to build configs** | Open the project in Claude Code, Cursor, Copilot, or Windsurf — the AI knows your schemas |
| **Chat with AI assistants** | Built into the platform — start chatting immediately                                      |
| **Build a knowledge base**  | Upload documents, crawl websites, manage products and customers                           |
| **Manage conversations**    | Unified inbox for customer conversations with AI-assisted replies                         |
| **View backend data**       | Run `tale convex admin` and open the Convex Dashboard                                     |

All files in `agents/`, `workflows/`, and `integrations/` are live-reloaded — edit and see changes instantly.

## Command reference

### Development

```bash
tale init [directory]              # Create a new project with example configs (no Docker needed)
tale start                         # Start all services locally
tale start --detach                # Start in background
tale start --port 8443             # Use a custom HTTPS port
tale upgrade                       # Upgrade CLI and sync project files
tale convex admin                  # Generate Convex dashboard admin key
tale config                        # Manage CLI configuration
```

### Production

```bash
tale deploy                        # Blue-green zero-downtime deployment of the current CLI version
tale status                        # Show deployment status
tale logs <service>                # View service logs
tale logs platform -f              # Follow log output
tale backup                        # Snapshot all data volumes
tale restore                       # List snapshots / restore one (stopped stack)
tale rollback                      # Roll back to the previous patch version
tale cleanup                       # Remove inactive containers
tale reset --force                 # Remove all containers
```

See the [CLI reference](tools/cli/README.md) for all options and flags. Upgrading an existing deployment requires a one-time manual migration: run `tale migrate config-layout` then `tale deploy --override-all -y`. See [Self-hosted upgrades](docs/en/self-hosted/operate/upgrades.md) for the full runbook.

## Deploy to production

```bash
tale deploy
```

The CLI handles blue-green zero-downtime deployments with automatic health checks and rollback. For full production setup including reverse proxy configuration and subpath deployment, see the [Production deployment guide](docs/en/self-hosted/install/linux-server.md).

## Authentication options

Tale uses password-based authentication by default. The first user creates the owner account; all other users are created by an admin. To enable self-service login, connect SSO or trusted headers via Microsoft Entra ID — see the [Integrations overview](docs/en/platform/integrations/overview.md) for the Microsoft 365 connector that powers both document sync and SSO.

- **Microsoft Entra ID (SSO):** Single sign-on with Microsoft 365 / Azure AD with automatic provisioning
- **Trusted headers:** For deployments behind an authenticating reverse proxy (Authelia, Authentik, oauth2-proxy)

## Development

For local development (non-Docker):

### Prerequisites

- **Bun**: 1.3.x or higher ([installation instructions](https://bun.sh/docs/installation))
- **Python**: 3.12.x (required for Python services: rag, crawler)
- **uv**: Python package manager ([installation instructions](https://github.com/astral-sh/uv))

### Development commands

```bash
bun install                      # Install dependencies
bun run dev                      # Start development servers (spawns local Convex)
bun run typecheck                # Type checking
bun run lint                     # Linting
bun run test                     # Run tests
bun run build                    # Build all services
```

#### Optional: hybrid mode against a containerised Convex

You can run Vite locally against the dedicated `convex` container instead of spawning `bunx convex dev`:

```bash
docker compose up convex                        # in one terminal
CONVEX_EXTERNAL=true bun run dev                # in another (CONVEX_URL optional)
```

Useful when you want fast Vite reloads but a stable Convex backend that mirrors production. Set `CONVEX_URL` if your container exposes Convex on a non-default host/port.

For Python services:

```bash
cd services/rag && uv sync --extra dev
cd services/crawler && uv sync --extra dev
```

### Known issues

- **xlsx security vulnerability**: The project uses xlsx@0.18.5 which has known security vulnerabilities (Prototype Pollution and ReDoS). This is the latest version available and no fix is currently released. The package is used for Excel file parsing in the documents feature.
- **ENVIRONMENT_FALLBACK warning**: During platform build, you may see an `ENVIRONMENT_FALLBACK` error. This is a Convex-specific warning and doesn't prevent successful builds.

## Documentation

The docs site and platform UI both ship three base locales (`en`, `de`, `fr`) plus regional variants where local wording differs (today: `de-CH`; the loader picks up any new `xx-YY` bundle automatically). Variants carry only the strings that differ from their base; missing keys fall back through the base to English. Start at [`docs/en/index.md`](docs/en/index.md) to pick an entry point by persona.

<details>
<summary><strong>For everyday users</strong></summary>

- **[Chat overview](docs/en/platform/chat/overview.md)** — the four parts of the screen, where to read deeper
- **[AI chat basics](docs/en/platform/chat/basics.md)** — composer, agents, model picker, streaming, citations
- **[Deep research](docs/en/platform/chat/deep-research.md)** — the Researcher agent with live plan and PDF report
- **[Attachments](docs/en/platform/chat/attachments.md)** — files in chat, RAG vs verbatim
- **[Shared chats](docs/en/platform/chat/shared-threads.md)** — share a chat with the org, fork into your own
- **[Approvals](docs/en/platform/approvals/concepts.md)** — review AI actions

</details>

<details>
<summary><strong>For builders (agents, automations, integrations)</strong></summary>

- **[Agent concepts](docs/en/platform/agents/concepts.md)** — the four-knob model behind every agent
- **[Create an agent](docs/en/platform/agents/create.md)** — specialised AI assistants end to end
- **[Agent tools](docs/en/platform/agents/tools.md)** — the built-in tool families
- **[Projects](docs/en/platform/projects/overview.md)** — shared workspace for files, chats, project agents
- **[Automation concepts](docs/en/platform/automations/concepts.md)** — workflows, triggers, approval gates
- **[Integrations overview](docs/en/platform/integrations/overview.md)** — Slack, Teams, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily, MCP
- **[Models out of the box](docs/en/platform/models.md)** — OpenRouter as the single default provider, plus the shipped model lists

</details>

<details>
<summary><strong>For admins</strong></summary>

- **[Members and roles](docs/en/platform/admin/members-and-roles.md)** — user management and permission matrix
- **[Models out of the box](docs/en/platform/models.md)** — which models the defaults ship with; swap or add providers
- **[Integrations overview](docs/en/platform/integrations/overview.md)** — third-party connectors, MCP servers, custom configs
- **[Cloud trust and compliance](docs/en/cloud/trust-and-compliance.md)** — frameworks, shared responsibility, evidence to hand auditors

</details>

<details>
<summary><strong>For operators</strong></summary>

- **[Self-hosted overview](docs/en/self-hosted/overview.md)** — architecture and services
- **[Quickstart](docs/en/self-hosted/install/quickstart.md)** — single-host install in twenty minutes
- **[Production deployment](docs/en/self-hosted/install/linux-server.md)** — Linux server with TLS, firewall, non-root user
- **[Docker Compose reference](docs/en/self-hosted/install/docker-compose-reference.md)** — base file and overlays
- **[Tale CLI](tools/cli/README.md)** — CLI reference
- **[Environment reference](docs/en/self-hosted/configuration/environment-reference.md)** — all environment variables
- **[Container architecture](docs/en/self-hosted/operate/container-architecture.md)** — seven containers, what owns what

</details>

<details>
<summary><strong>For developers</strong></summary>

- **[API reference](docs/en/develop/api-reference.md)** — REST API for RAG, Crawler, and Platform
- **[Webhooks](docs/en/develop/webhooks.md)** — workflow and agent webhooks with signature verification
- **[Develop overview](docs/en/develop/overview.md)** — the developer surface end to end

</details>

## Need help?

- **Logs**: `tale logs <service>` to view service logs
- **Health checks**: Visit `{SITE_URL}/api/health`
- **Deployment status**: `tale status` to check production deployment
- **Convex Dashboard**: `tale convex admin` to generate an admin key
- **Issues and discussions**: [github.com/tale-project/tale/issues](https://github.com/tale-project/tale/issues)

## Contributing

New to the repo? [Contributor setup](docs/en/develop/contributor-setup.md) is the single source of truth for getting the source running locally — prerequisites, `bun install`, the `bun run setup:check` pre-flight, `bun run dev`, and the Python services. Read [`AGENTS.md`](AGENTS.md) before your first PR — it is the single contract for code style, security, testing, i18n, and documentation across every workspace. The [`docs`](.agents/docs/AGENTS.md) skill covers the documentation site; the [`translation`](.agents/translation/AGENTS.md) skill covers cross-locale translation rules. Run `bun run check` (format, lint, typecheck, tests) before opening a PR; the [pull request template](.github/pull_request_template.md) lists the rest of the pre-merge checklist.

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
