---
title: Authentication
description: How authentication works in Tale, including password login, Microsoft Entra ID SSO, and trusted headers.
---

Tale is an offline-first platform. There is no self-service sign-up or password reset. The first user to open the app creates the owner account. All subsequent users are created by an admin in **Settings → Members**.

To enable self-service login and automatic account provisioning, connect Tale to an SSO provider or configure trusted headers.

## Password (default)

No configuration required. Admins create users with an email, password, and role in **Settings → Members**. Users log in with their credentials on the login page.

Users who joined via SSO or trusted headers can also set a password from **Account Settings** to enable direct login.

## Microsoft Entra ID (SSO)

Single sign-on with Microsoft 365 / Azure AD. Users log in with their existing Microsoft accounts and are provisioned automatically on first sign-in.

### Azure setup

1. Go to [Azure Portal](https://portal.azure.com) → Microsoft Entra ID → App registrations.
2. Create a new registration (or use an existing one).
3. Add a redirect URI: `https://yourdomain.com/api/sso/callback`
4. Note the Application (client) ID, Directory (tenant) ID, and create a client secret.

### Tale setup

1. Go to **Settings → Integrations** in the Tale admin panel.
2. Select **Microsoft Entra ID** as the SSO provider.
3. Enter your client ID, client secret, and issuer URL.
4. Optionally enable group sync, role mapping, auto-provisioning, and OneDrive access.

The SSO button appears on the login page once configured.

> **Note:** SSO and password login can be used at the same time. Users who existed before SSO was set up keep using their passwords.

## Trusted headers

For deployments behind an authenticating reverse proxy such as Authelia, Authentik, or oauth2-proxy. The proxy authenticates users externally; Tale reads identity from the HTTP headers the proxy sets and provisions accounts automatically on first request.

When trusted headers are enabled, the login page is bypassed — users are authenticated transparently on every request.

### Configuration

Add this variable to your `.env` file:

```dotenv
TRUSTED_HEADERS_ENABLED=true
```

### Header names

By default, Tale reads these headers:

| Header         | Required | Default name    | Description                                                                                    |
| -------------- | -------- | --------------- | ---------------------------------------------------------------------------------------------- |
| Email          | Yes      | `Remote-Email`  | User's email address                                                                           |
| Display name   | No       | `Remote-Name`   | User's display name (falls back to email username)                                             |
| Role           | No       | `Remote-Role`   | One of `admin`, `developer`, `editor`, or `member` (defaults to `member`)                      |
| Teams          | No       | `Remote-Teams`  | Comma-separated list in `id:name` format (e.g., `abc123:Engineering, def456:Design`)           |

Every proxy uses different header names. Override the defaults with environment variables to match your proxy:

```dotenv
TRUSTED_EMAIL_HEADER=X-Forwarded-Email
TRUSTED_NAME_HEADER=X-Forwarded-User
TRUSTED_ROLE_HEADER=X-Forwarded-Role
TRUSTED_TEAMS_HEADER=X-Forwarded-Teams
```

Common proxy configurations:

| Proxy          | Email header                | Name header                 | Groups/Role header          |
| -------------- | --------------------------- | --------------------------- | --------------------------- |
| Authelia       | `Remote-Email`              | `Remote-Name`               | `Remote-Groups`             |
| Authentik      | `X-authentik-email`         | `X-authentik-name`          | `X-authentik-groups`        |
| oauth2-proxy   | `X-Forwarded-Email`         | `X-Forwarded-User`          | `X-Forwarded-Groups`        |

### How it works

1. The reverse proxy authenticates the user and sets identity headers.
2. The browser is redirected to `/api/trusted-headers/authenticate`.
3. Tale reads the headers, finds or creates the user, and sets a session cookie.
4. The browser is redirected to the dashboard.

On subsequent requests, the existing session cookie is reused. The session is refreshed and header values (role, teams) are updated on each authentication.

### Teams

The external IdP is the single source of truth for teams — team IDs are passed through directly without any internal database lookup. Omit the teams header to leave teams unchanged, or send it empty to remove the user from all teams.

### Internal secret (optional)

For defense-in-depth, set a shared secret that the Convex endpoint validates:

```dotenv
TRUSTED_HEADERS_INTERNAL_SECRET=your-random-secret
```

This ensures the authentication endpoint can only be called through the trusted proxy chain.

> **Security:** Only enable trusted headers when Tale is behind a trusted proxy that strips these headers from external requests. If external clients can set these headers directly, they can impersonate any user.
