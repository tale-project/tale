# Deployment Modes

Tale supports two deployment modes: **Local Development** (without HTTPS) and **Production** (with HTTPS via Caddy proxy).

## Local Development Mode (Default)

**Use case:** Running Tale on your local machine for development or testing.

### Setup

1. Create `.env` file:

```bash
DOMAIN=http://localhost
DB_NAME=tale
DB_USER=tale
DB_PASSWORD=change_me
OPENAI_API_KEY=sk-...
```

2. Start services:

```bash
docker compose up --build
```

3. Access the platform:

- **Main app:** http://localhost:3000
- **Other services:** See README.md for port mappings

### What happens

- ✅ All services start EXCEPT the proxy
- ✅ Platform is directly accessible on port 3000
- ✅ No SSL certificates needed
- ✅ Simple and fast for development

## Production Mode (With HTTPS)

**Use case:** Deploying Tale on a server with a domain name and HTTPS.

### Setup

1. Create `.env` file:

```bash
DOMAIN=https://yourdomain.com
ACME_EMAIL=you@example.com
DB_NAME=tale
DB_USER=tale
DB_PASSWORD=change_me
OPENAI_API_KEY=sk-...
```

2. Start services with production profile:

```bash
docker compose --profile production up -d --build
```

3. Access the platform:

- **Main app:** https://yourdomain.com (via Caddy on ports 80/443)

### What happens

- ✅ All services start INCLUDING the proxy
- ✅ Caddy handles HTTPS termination
- ✅ Automatic SSL certificate from Let's Encrypt
- ✅ Auto-renewal of certificates
- ✅ HTTP→HTTPS redirect
- ✅ Security headers added

### Prerequisites

- Domain name pointing to your server's IP
- Ports 80 and 443 open in firewall
- Valid email for ACME registration

## Switching Between Modes

### From Local to Production

1. Update `.env`:

```bash
DOMAIN=https://yourdomain.com
ACME_EMAIL=you@example.com
```

2. Restart with production profile:

```bash
docker compose down
docker compose --profile production up -d --build
```

### From Production to Local

1. Update `.env`:

```bash
DOMAIN=http://localhost
```

2. Restart without profile:

```bash
docker compose down
docker compose up --build
```

## Architecture Differences

### Local Mode

```
[Browser] → http://localhost:3000 → [Platform (Next.js)]
                                          ↓
                                    [Convex Backend]
                                          ↓
                                    [Other Services]
```

### Production Mode

```
[Browser] → https://yourdomain.com → [Proxy (Caddy)] → [Platform (Next.js)]
                                                              ↓
                                                        [Convex Backend]
                                                              ↓
                                                        [Other Services]
```

## Troubleshooting

### Local Mode Issues

**Problem:** Can't access http://localhost:3000

- Check if platform service is running: `docker ps | grep tale-platform`
- Check logs: `docker logs tale-platform`
- Verify port 3000 is not in use: `lsof -i :3000`

### Production Mode Issues

**Problem:** Proxy not starting

- Ensure you're using the production profile: `docker compose --profile production up`
- Check proxy logs: `docker logs tale-proxy`

**Problem:** SSL certificate errors

- Verify domain DNS points to your server
- Check ACME_EMAIL is set in .env
- Try staging first: `ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory`
- Check ports 80/443 are open: `sudo netstat -tlnp | grep -E ':(80|443)'`

**Problem:** "Connection refused" errors

- Ensure platform service is healthy: `docker ps` (check STATUS column)
- Check platform logs: `docker logs tale-platform`
- Verify internal networking: `docker network inspect poc2_internal`
