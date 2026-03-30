---
title: Authentication
description: Configure email/password, Microsoft Entra ID SSO, and trusted headers authentication.
---

Tale supports multiple authentication methods that can be used simultaneously. By default, users sign up with email and password.

## Email and password

This is the default authentication method. No configuration is required. Users create an account on the sign-up page with their email address and a password.

Users who joined via SSO or trusted headers can also set a password from Account Settings to enable direct login.

## Microsoft Entra ID (SSO)

Enable single sign-on with Microsoft 365 / Azure AD so your users can log in with their existing Microsoft accounts.

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

The SSO button will appear on the login page once configured.

> **Note:** SSO and password login can be used at the same time. Users who joined before SSO was set up can keep using their passwords. Users who sign in via SSO can optionally add a password from Account Settings.

## Trusted headers

For deployments behind an authenticating reverse proxy such as Authelia, Authentik, or oauth2-proxy, Tale can read user identity from HTTP headers set by the proxy.

### Configuration

Add these variables to your `.env` file:

```dotenv
TRUSTED_HEADERS_ENABLED=true
```

The header names are fixed and cannot be customized via environment variables.

### Required headers

Your proxy must send these headers with every request:

| Header           | Required | Description                                                                 |
| ---------------- | -------- | --------------------------------------------------------------------------- |
| `X-Auth-Email`   | Yes      | User's email address                                                        |
| `X-Auth-Name`    | No       | User's display name                                                         |
| `X-Auth-Role`    | No       | One of `admin`, `developer`, `editor`, or `member`                          |
| `X-Auth-Teams`   | No       | Comma-separated list of teams in `id:name` format (e.g., `abc123:Engineering, def456:Design`) |

The external IdP is the single source of truth for teams — team IDs are passed through directly without any internal database lookup. Omit the `X-Auth-Teams` header to leave teams unchanged, or send it empty to remove the user from all teams.

When a user authenticates via trusted headers for the first time, Tale automatically creates their account and adds them to the organization.

> **Security:** Only enable trusted headers when Tale is behind a trusted proxy that strips these headers from external requests. If external clients can set these headers directly, they can impersonate any user.
