# Tale

Build AI-powered applications in minutes, not months.

Tale is a ready-to-run, self-hosted AI platform that gives you everything you need: intelligent AI assistants, automated data collection, and a modern web interface — all with a single command.

## Quick start

Get Tale running in 4 steps:

### 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+)
- [OpenRouter API Key](https://openrouter.ai)

### 2. Configure local domain

Add `tale.local` to your hosts file so your browser can find the local server:

**macOS / Linux:**

```bash
echo "127.0.0.1 tale.local" | sudo tee -a /etc/hosts
```

**Windows (run PowerShell as Administrator):**

```powershell
Add-Content -Path "C:\Windows\System32\drivers\etc\hosts" -Value "127.0.0.1 tale.local"
```

### 3. Clone & configure

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Edit `.env` and add your OpenRouter API key:

```bash
OPENAI_API_KEY=your-openrouter-api-key
```

### 4. Launch

```bash
docker compose up --build
```

**That's it!** Open https://tale.local when you see "Server ready".

> **Note:** Your browser will show a certificate warning because Tale uses self-signed certificates for local development. This is safe to accept. To avoid the warning, run: `docker exec tale-proxy caddy trust`

For detailed setup instructions including pre-built images and daily workflow, see the [Quick start guide](docs/quickstart.md).

## What can you do?

| Goal                         | How                                                          |
| ---------------------------- | ------------------------------------------------------------ |
| **Use the main app**         | Visit your configured domain (default: https://tale.local)   |
| **Chat with AI assistants**  | Built into the platform — start chatting immediately          |
| **Crawl websites for data**  | Add URLs through the interface or Crawler API                 |
| **Search your data with AI** | Use natural language queries in the app                       |
| **View backend data**        | Generate admin key (see below) and open Convex Dashboard      |
| **Test APIs directly**       | Interactive docs at RAG API endpoint                          |

## Deploy to production

For production deployment options including Docker Compose, zero-downtime blue-green deployments, reverse proxy setup, and subpath deployment, see the [Production deployment guide](docs/production-deployment.md).

For zero-downtime blue-green deployments, install the [Tale CLI](tools/cli/README.md):

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale deploy
```

## Authentication options

Tale supports multiple authentication methods. By default, users sign up with email/password. See the [Authentication guide](docs/authentication.md) for full details.

- **Microsoft Entra ID (SSO):** Single sign-on with Microsoft 365 / Azure AD
- **Trusted headers:** For deployments behind an authenticating reverse proxy (Authelia, Authentik, oauth2-proxy)

## Essential commands

### Local development

```bash
docker compose up --build        # Start Tale
docker compose down              # Stop Tale (keeps data)
docker compose logs -f           # View logs
docker compose down -v           # Fresh start (deletes all data)
```

### Production (Tale CLI)

```bash
tale deploy                      # Deploy (interactive version selection)
tale status                      # Show deployment status
tale logs platform --follow      # View service logs
tale rollback                    # Rollback to previous version
tale cleanup                     # Remove inactive containers
```

## Convex dashboard access

To view backend data, logs, and manage environment variables, you'll need an admin key:

```bash
./scripts/get-admin-key.sh
```

The admin key is required every time you open the dashboard. Keep it secure — anyone with this key has full access to your backend.

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
- **[Tale CLI](tools/cli/README.md)** — CLI tool for production deployment and management
- **[Environment Reference](docs/environment-reference.md)** — Complete reference of all environment variables
- **[Operations](docs/operations.md)** — Monitoring, error tracking, logs, backups, and health checks
- **[API Reference](docs/api-reference.md)** — REST API endpoints for all services
- **[Troubleshooting](docs/troubleshooting.md)** — Common issues and solutions

## Need help?

- **Logs (dev)**: `docker compose logs -f` to see what's happening
- **Logs (production)**: `tale logs <service>` to view service logs
- **Health checks**: Visit `{SITE_URL}/api/health`
- **Deployment status**: `tale status` to check production deployment
- **Convex Dashboard**: Generate admin key (see above) for backend data and logs

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
