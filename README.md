# Tale

Build AI-powered applications in minutes, not months.

Tale is a ready-to-run platform that gives you everything you need: intelligent AI assistants, automated data collection, and a modern web interface—all with a single command.

## Quick Start

Get Tale running in 3 steps:

### 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+)
- [OpenRouter API Key](https://openrouter.ai)

### 2. Clone & Configure

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Edit `.env` and add your OpenRouter API key:

```bash
OPENAI_API_KEY=your-openrouter-api-key
```

### 3. Launch

```bash
docker compose up --build
```

**That's it!** Open http://localhost:3000 when you see "Server ready".

## What Can You Do?

Once Tale is running, you can:

| Goal                         | How                                                           |
| ---------------------------- | ------------------------------------------------------------- |
| **Use the main app**         | Visit your configured domain (default: http://localhost:3000) |
| **Chat with AI assistants**  | Built into the platform—start chatting immediately            |
| **Crawl websites for data**  | Add URLs through the interface or Crawler API                 |
| **Search your data with AI** | Use natural language queries in the app                       |
| **View backend data**        | Generate admin key (see below) and open Convex Dashboard      |
| **Test APIs directly**       | Interactive docs at RAG API endpoint                          |

## Deploy to Production

Ready to go live? Add your domain:

```bash
# Update .env
DOMAIN=https://yourdomain.com

# Start with production profile
docker compose --profile production up --build
```

SSL certificates are handled automatically.

## Authentication Options

Tale supports multiple authentication methods. By default, users sign up with email/password.

### Microsoft Entra ID (SSO)

Enable single sign-on with Microsoft 365 / Azure AD:

```bash
# Add to .env
AUTH_MICROSOFT_ENTRA_ID_ID=your-client-id
AUTH_MICROSOFT_ENTRA_ID_SECRET=your-client-secret
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=your-tenant-id
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/your-tenant-id/v2.0
```

To get these values:

1. Go to [Azure Portal](https://portal.azure.com) → Microsoft Entra ID → App registrations
2. Create a new registration (or use existing)
3. Add redirect URI: `https://yourdomain.com/api/auth/callback/microsoft`
4. Copy Application (client) ID → `AUTH_MICROSOFT_ENTRA_ID_ID`
5. Create a client secret → `AUTH_MICROSOFT_ENTRA_ID_SECRET`
6. Copy Directory (tenant) ID → `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`

### Trusted Headers Authentication

For deployments behind an authenticating reverse proxy (e.g., Authelia, Authentik, oauth2-proxy):

```bash
# Add to .env
TRUSTED_HEADERS_ENABLED=true
TRUSTED_EMAIL_HEADER=X-Auth-Email      # optional, default shown
TRUSTED_NAME_HEADER=X-Auth-Name        # optional, default shown
TRUSTED_ROLE_HEADER=X-Auth-Role        # optional, default shown
```

Your proxy must send these headers with every request:

- `X-Auth-Email`: User's email address
- `X-Auth-Name`: User's display name
- `X-Auth-Role`: One of `admin`, `developer`, `editor`, or `member`

⚠️ **Security**: Only enable this when Tale is behind a trusted proxy that strips these headers from external requests.

## Essential Commands

```bash
# Start Tale
docker compose up --build

# Stop Tale (keeps data)
docker compose down

# View logs
docker compose logs -f

# Fresh start (deletes all data)
docker compose down -v
```

## Convex Dashboard Access

To view backend data, logs, and manage environment variables, you'll need an admin key:

```bash
# Generate an admin key
docker compose exec platform ./generate_admin_key.sh
```

The script will display the dashboard URL, deployment URL, and admin key. Follow the instructions shown to log in.

The admin key is required every time you open the dashboard. Keep it secure—anyone with this key has full access to your backend.

## Need Help?

- **Logs**: `docker compose logs -f` to see what's happening
- **Health checks**: Visit `{DOMAIN}/api/health`
- **Convex Dashboard**: Generate admin key (see above) for backend data and logs
- **Detailed docs**: Check `services/*/README.md` for each component

---

**Ready to build?** Start exploring at your configured domain!
