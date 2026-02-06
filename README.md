# Tale

Build AI-powered applications in minutes, not months.

Tale is a ready-to-run platform that gives you everything you need: intelligent AI assistants, automated data collection, and a modern web interface—all with a single command.

## Quick Start

Get Tale running in 4 steps:

### 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+)
- [OpenRouter API Key](https://openrouter.ai)

### 2. Configure Local Domain

Add `tale.local` to your hosts file so your browser can find the local server:

**macOS / Linux:**

```bash
echo "127.0.0.1 tale.local" | sudo tee -a /etc/hosts
```

**Windows (run PowerShell as Administrator):**

```powershell
Add-Content -Path "C:\Windows\System32\drivers\etc\hosts" -Value "127.0.0.1 tale.local"
```

### 3. Clone & Configure

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

## What Can You Do?

Once Tale is running, you can:

| Goal                         | How                                                          |
| ---------------------------- | ------------------------------------------------------------ |
| **Use the main app**         | Visit your configured domain (default: https://tale.local)   |
| **Chat with AI assistants**  | Built into the platform—start chatting immediately            |
| **Crawl websites for data**  | Add URLs through the interface or Crawler API                 |
| **Search your data with AI** | Use natural language queries in the app                       |
| **View backend data**        | Generate admin key (see below) and open Convex Dashboard      |
| **Test APIs directly**       | Interactive docs at RAG API endpoint                          |

## Deploy to Production

### Using Docker Compose (Simple)

Update your `.env` file and start:

```bash
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
```

```bash
docker compose up --build -d
```

SSL certificates are automatically provisioned via Let's Encrypt.

### Using the Tale CLI (Recommended)

For zero-downtime blue-green deployments, install the [Tale CLI](tools/cli/README.md) (macOS / Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Then deploy:

```bash
tale deploy
```

On first run, the CLI interactively configures your domain, TLS, API keys, and security secrets. See [Tale CLI documentation](tools/cli/README.md) for the full command reference.

## Authentication Options

Tale supports multiple authentication methods. By default, users sign up with email/password.

### Microsoft Entra ID (SSO)

Enable single sign-on with Microsoft 365 / Azure AD:

**Azure setup:**

1. Go to [Azure Portal](https://portal.azure.com) → Microsoft Entra ID → App registrations
2. Create a new registration (or use existing)
3. Add redirect URI: `https://yourdomain.com/api/sso/callback`
4. Note the Application (client) ID, Directory (tenant) ID, and create a client secret

**Tale setup:**

1. Go to **Settings → Integrations** in the Tale admin panel
2. Select **Microsoft Entra ID** as the SSO provider
3. Enter your client ID, client secret, and issuer URL
4. Optionally enable group sync, role mapping, auto-provisioning, and OneDrive access

### Trusted Headers Authentication

For deployments behind an authenticating reverse proxy (e.g., Authelia, Authentik, oauth2-proxy):

```bash
# Add to .env
TRUSTED_HEADERS_ENABLED=true
TRUSTED_EMAIL_HEADER=X-Auth-Email      # optional, default shown
TRUSTED_NAME_HEADER=X-Auth-Name        # optional, default shown
TRUSTED_ROLE_HEADER=X-Auth-Role        # optional, default shown
TRUSTED_TEAMS_HEADER=X-Auth-Teams      # optional, default shown
```

Your proxy must send these headers with every request:

- `X-Auth-Email`: User's email address
- `X-Auth-Name`: User's display name
- `X-Auth-Role`: One of `admin`, `developer`, `editor`, or `member`
- `X-Auth-Teams` (optional): Comma-separated list of teams in `id:name` format (e.g., `abc123:Engineering, def456:Design`). The external IdP is the single source of truth - team IDs are passed through directly without any internal database lookup. Omit the header to leave teams unchanged, send empty to remove from all teams.

⚠️ **Security**: Only enable this when Tale is behind a trusted proxy that strips these headers from external requests.

## Updating Tale

### Using the Tale CLI (Recommended for Production)

```bash
# Deploy with interactive version selection
tale deploy

# Or deploy a specific version
tale deploy v1.0.0

# Check current deployment status
tale status

# Rollback to the previous version if needed
tale rollback
```

See [Zero-Downtime Deployment](docs/zero-downtime-deployment.md) and [Tale CLI documentation](tools/cli/README.md) for details.

### From Source (Development)

```bash
git pull
docker compose down
docker compose up --build -d
```

## Essential Commands

### Local Development

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

## Convex Dashboard Access

To view backend data, logs, and manage environment variables, you'll need an admin key:

```bash
./scripts/get-admin-key.sh
```

The script will display the dashboard URL, deployment URL, and admin key. Follow the instructions shown to log in.

The admin key is required every time you open the dashboard. Keep it secure—anyone with this key has full access to your backend.

## Development

For local development (non-Docker):

### Prerequisites

- **Node.js**: v20.19.0 or higher (current: v20.16.0 - upgrade recommended)
- **npm**: 10.x or higher
- **Python**: 3.12.x (required for Python services: rag, graph-db, crawler)
- **uv**: Python package manager ([installation instructions](https://github.com/astral-sh/uv))

### Install uv (Python package manager)

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**Note**: Python services are configured to use Python 3.12 via `.python-version` files. When you run `uv sync` in these directories, uv will automatically use the correct Python version.

### Development Commands

```bash
# Install dependencies (Node.js)
npm install

# Install Python dev dependencies (optional, required for linting/testing Python services)
cd services/rag && uv sync --extra dev
cd ../graph-db && uv sync --extra dev
cd ../crawler && uv sync --extra dev
cd ../..

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Build all services
npm run build

# Run tests
npm run test
npm run test:watch
npm run test:coverage

# Start development servers
npm run dev
```

### Known Issues

- **xlsx security vulnerability**: The project uses xlsx@0.18.5 which has known security vulnerabilities (Prototype Pollution and ReDoS). This is the latest version available and no fix is currently released. The package is used for Excel file parsing in the documents feature. Consider the risk based on your use case.

- **ENVIRONMENT_FALLBACK warning**: During platform build, you may see an `ENVIRONMENT_FALLBACK` error. This is a Convex-specific warning and doesn't prevent successful builds.

## Documentation

### User Guides

- **[Chat Agent Guide](docs/chat-agent-guide.md)** - Learn how to use the AI-powered chat assistant to manage customers, automate workflows, and access your business data through natural conversation
- **[Workflow Guide](docs/workflow-guide.md)** - Build powerful automation workflows with AI, data processing, and customer engagement

### Administration

- **[Role-Based Access Control](docs/permissions.md)** - User roles and permission system

### Operations

- **[Tale CLI](tools/cli/README.md)** - CLI tool for production deployment, management, and zero-downtime updates
- **[Zero-Downtime Deployment](docs/zero-downtime-deployment.md)** - Blue-green deployment strategy details

## Need Help?

- **Logs (dev)**: `docker compose logs -f` to see what's happening
- **Logs (production)**: `tale logs <service>` to view service logs
- **Health checks**: Visit `{SITE_URL}/api/health`
- **Deployment status**: `tale status` to check production deployment
- **Convex Dashboard**: Generate admin key (see above) for backend data and logs
- **Detailed docs**: Check `services/*/README.md` for each component and [tools/cli/README.md](tools/cli/README.md) for CLI reference

---

**Ready to build?** Start exploring at your configured domain!
