# Tale

> **Read this in:** [English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

Build AI-powered applications in minutes, not months.

Tale is a self-hosted AI platform with custom agents, a knowledge base, workflow automation, integrations, and a unified inbox. Install the CLI and run a single command to get started.

## Quick start

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+) and an [OpenRouter API key](https://openrouter.ai).

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

The CLI prompts for your domain, API key, and TLS mode. Security secrets are generated automatically. It also generates AI editor configuration files and extracts the platform source code to `.tale/reference/` so AI-powered editors can create and edit configs with full platform awareness. See [AI-assisted development](docs/develop/ai-assisted-development.md).

### 3. Start Tale

```bash
tale start
```

Visit https://localhost (or your configured domain) when you see "Tale Platform is running!"

> **Note:** Your browser will show a certificate warning for self-signed certificates. This is safe to accept.

For detailed setup instructions, see the [Getting started guide](docs/platform/member/overview.md).

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
tale init [directory]              # Create a new project with example configs
tale start                         # Start all services locally
tale start --detach                # Start in background
tale start --port 8443             # Use a custom HTTPS port
tale start --fresh                 # Re-seed builtin configs
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
tale rollback                      # Rollback to previous version
tale cleanup                       # Remove inactive containers
tale reset --force                 # Remove all containers
```

See the [CLI reference](tools/cli/README.md) for all options and flags. Pending data migrations are detected and applied automatically on the next `tale start` or `tale deploy`.

## Deploy to production

```bash
tale deploy
```

The CLI handles blue-green zero-downtime deployments with automatic health checks and rollback. For full production setup including reverse proxy configuration and subpath deployment, see the [Production deployment guide](docs/self-hosted/install/linux-server.md).

## Authentication options

Tale uses password-based authentication by default. The first user creates the owner account; all other users are created by an admin. To enable self-service login, connect SSO or trusted headers. See the [Authentication guide](docs/self-hosted/admin/authentication.md) for full details.

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

The docs site ships in three locales (`en`, `de`, `fr`) with full coverage. The platform UI itself ships six (`en`, `de`, `de-AT`, `de-CH`, `fr`, `fr-CH`) — regional variants share the docs of their base locale. Start at [`docs/index.md`](docs/index.md) to pick an entry point by persona.

### For everyday users

- **[Getting started](docs/platform/member/overview.md)** — install Tale and open the app
- **[AI chat basics](docs/platform/chat/basics.md)** — chat, attach files, pick agents
- **[Knowledge base](docs/platform/workspace/knowledge-base.md)** — documents and websites
- **[Conversations](docs/platform/workspace/conversations.md)** — customer inbox
- **[Approvals](docs/platform/workspace/approvals.md)** — review AI actions
- **[Your preferences](docs/platform/member/preferences.md)** — password, language, theme

### For builders (agents, automations, integrations)

- **[What you can build](docs/platform/developer/overview.md)** — orientation for Editors/Developers
- **[Create an agent](docs/platform/agents/create.md)** — specialised AI assistants
- **[Workflows](docs/platform/automations/workflows.md)** — multi-step automations
- **[Structured data](docs/platform/knowledge/structured-data.md)** — products, customers, vendors
- **[Integrations overview](docs/platform/integrations/overview.md)** — REST, SQL, e-mail, OneDrive

### For admins

- **[Members and roles](docs/platform/admin/members-and-roles.md)** — user management and permission matrix
- **[Authentication](docs/self-hosted/admin/authentication.md)** — password, SSO, trusted headers
- **[AI providers](docs/platform/admin/providers.md)** — configure models in the admin UI
- **[Governance](docs/platform/admin/governance.md)** — budgets, retention, PII detection, audit logs
- **[Usage analytics](docs/platform/admin/usage-analytics.md)** — time-based token and cost reporting

### For operators

- **[Platform overview](docs/self-hosted/overview.md)** — architecture and services
- **[Production deployment](docs/self-hosted/install/linux-server.md)** — Docker Compose, zero-downtime deploys, reverse proxy
- **[Tale CLI](tools/cli/README.md)** — CLI reference
- **[Environment reference](docs/self-hosted/configuration/environment-reference.md)** — all environment variables
- **[Operations](docs/self-hosted/operate/observability/operations.md)** — monitoring, error tracking, backups
- **[Troubleshooting](docs/self-hosted/operate/observability/troubleshooting.md)** — common issues

### For developers

- **[API reference](docs/develop/api-reference.md)** — REST API for RAG, Crawler, and Platform
- **[Webhooks](docs/develop/webhooks.md)** — workflow and agent webhooks with signature verification
- **[AI-assisted development](docs/develop/ai-assisted-development.md)** — configure agents/workflows in AI editors
- **[Contributing Docker](docs/develop/contributing-docker.md)** — modify Dockerfiles and run container tests

## Need help?

- **Logs**: `tale logs <service>` to view service logs
- **Health checks**: Visit `{SITE_URL}/api/health`
- **Deployment status**: `tale status` to check production deployment
- **Convex Dashboard**: `tale convex admin` to generate an admin key
- **Issues and discussions**: [github.com/tale-project/tale/issues](https://github.com/tale-project/tale/issues)

## Contributing

Read [`AGENTS.md`](AGENTS.md) before your first PR — it is the single contract for code style, security, testing, i18n, and documentation across every workspace. [`docs/AGENTS.md`](docs/AGENTS.md) covers the Mintlify documentation site; [`.agents/TERMINOLOGY.md`](.agents/TERMINOLOGY.md) covers cross-locale translation rules. Run `bun run check` (format, lint, typecheck, tests) before opening a PR; the [pull request template](.github/pull_request_template.md) lists the rest of the pre-merge checklist.

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
