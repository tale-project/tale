# Tale

Build AI-powered applications in minutes, not months.

Tale is a self-hosted AI platform with custom agents, a knowledge base, workflow automation, integrations, and a unified inbox. Install the CLI and run a single command to get started.

## Quick start

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+) and an [OpenRouter API key](https://openrouter.ai).

### 1. Install the CLI

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

### 2. Create a project

```bash
tale init my-project
cd my-project
```

The CLI prompts for your domain, API key, and TLS mode. Security secrets are generated automatically.

### 3. Start Tale

```bash
tale start
```

Visit https://localhost (or your configured domain) when you see "Tale Platform is running!"

> **Note:** Your browser will show a certificate warning for self-signed certificates. This is safe to accept.

For detailed setup instructions, see the [Quick start guide](docs/quickstart.md).

## What can you do?

| Goal                              | How                                                                      |
| --------------------------------- | ------------------------------------------------------------------------ |
| **Create custom agents**          | Edit JSON files in `agents/` — define instructions, tools, and models    |
| **Build automations**             | Edit JSON files in `workflows/` — triggers, conditions, loops, AI steps  |
| **Add integrations**              | Edit files in `integrations/` — REST APIs, SQL databases, custom connectors |
| **Chat with AI assistants**       | Built into the platform — start chatting immediately                      |
| **Build a knowledge base**        | Upload documents, crawl websites, manage products and customers           |
| **Manage conversations**          | Unified inbox for customer conversations with AI-assisted replies         |
| **View backend data**             | Run `tale convex admin` and open the Convex Dashboard                     |

All files in `agents/`, `workflows/`, and `integrations/` are live-reloaded — edit and see changes instantly.

## Command reference

### Development

```bash
tale init [directory]              # Create a new project with example configs
tale start                         # Start all services locally
tale start --detach                # Start in background
tale start --port 8443             # Use a custom HTTPS port
tale start --fresh                 # Re-seed builtin configs
tale update                        # Update project files to match CLI version
tale convex admin                  # Generate Convex dashboard admin key
tale config                        # Manage CLI configuration
```

### Production

```bash
tale deploy                        # Blue-green zero-downtime deployment
tale deploy 1.0.0                  # Deploy a specific version
tale status                        # Show deployment status
tale logs <service>                # View service logs
tale logs platform -f              # Follow log output
tale rollback                      # Rollback to previous version
tale cleanup                       # Remove inactive containers
tale reset --force                 # Remove all containers
```

See the [CLI reference](tools/cli/README.md) for all options and flags.

## Deploy to production

```bash
tale deploy
```

The CLI handles blue-green zero-downtime deployments with automatic health checks and rollback. For full production setup including reverse proxy configuration and subpath deployment, see the [Production deployment guide](docs/production-deployment.md).

## Authentication options

Tale supports multiple authentication methods. By default, users sign up with email/password. See the [Authentication guide](docs/authentication.md) for full details.

- **Microsoft Entra ID (SSO):** Single sign-on with Microsoft 365 / Azure AD
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
bun run dev                      # Start development servers
bun run typecheck                # Type checking
bun run lint                     # Linting
bun run test                     # Run tests
bun run build                    # Build all services
```

For Python services:

```bash
cd services/rag && uv sync --extra dev
cd services/crawler && uv sync --extra dev
```

### Known issues

- **xlsx security vulnerability**: The project uses xlsx@0.18.5 which has known security vulnerabilities (Prototype Pollution and ReDoS). This is the latest version available and no fix is currently released. The package is used for Excel file parsing in the documents feature.
- **ENVIRONMENT_FALLBACK warning**: During platform build, you may see an `ENVIRONMENT_FALLBACK` error. This is a Convex-specific warning and doesn't prevent successful builds.

## Documentation

### User guides

- **[AI Chat](docs/ai-chat.md)** — Use the AI chat assistant to explore data, attach files, and select agents
- **[Knowledge Base](docs/knowledge-base.md)** — Manage documents, websites, products, customers, and vendors
- **[Conversations](docs/conversations.md)** — Manage customer conversations from a unified inbox
- **[Automations](docs/automations.md)** — Build multi-step workflows with triggers, conditions, loops, and AI steps
- **[Agents](docs/agents.md)** — Create specialized AI assistants with custom instructions and tools

### Administration

- **[Roles and Permissions](docs/roles-and-permissions.md)** — User roles, permission matrix, and SSO configuration
- **[Authentication](docs/authentication.md)** — Email/password, Microsoft Entra ID SSO, and trusted headers
- **[Settings](docs/settings.md)** — Organization settings, teams, integrations, branding, and API keys

### Operations

- **[Production Deployment](docs/production-deployment.md)** — Docker Compose, zero-downtime deployments, and reverse proxy setup
- **[Tale CLI](tools/cli/README.md)** — CLI reference for all commands and options
- **[Environment Reference](docs/environment-reference.md)** — Complete reference of all environment variables
- **[Operations](docs/operations.md)** — Monitoring, error tracking, logs, backups, and health checks
- **[API Reference](docs/api-reference.md)** — REST API endpoints for all services
- **[Troubleshooting](docs/troubleshooting.md)** — Common issues and solutions

## Need help?

- **Logs**: `tale logs <service>` to view service logs
- **Health checks**: Visit `{SITE_URL}/api/health`
- **Deployment status**: `tale status` to check production deployment
- **Convex Dashboard**: `tale convex admin` to generate an admin key

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
