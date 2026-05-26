---
title: Authentication
description: How authentication works in Tale, including password login, Microsoft Entra ID SSO, and trusted headers.
---

Authentication decides who gets into a Tale instance at all. The product ships three methods — password, Microsoft Entra ID SSO, and trusted-header integration with an upstream reverse proxy — and they can run side by side on the same instance. This page is for the operator wiring authentication to an identity provider; the role matrix that decides what each user can do once they're in lives at [Members and roles](/platform/admin/members-and-roles).

Tale is offline-first by default. There is no public sign-up, no password reset from a "forgot password" link, and no automatic account creation. The first user to open the app becomes the Owner; every other user is created by an Admin in **Settings > Members** or provisioned automatically by SSO or trusted headers.

## Password (default)

No configuration is required. Admins create users with an email, a password, and a role in **Settings > Members**. Users log in with those credentials on the standard login page.

Users who joined via SSO or trusted headers can also set a password from **Account Settings** to enable direct login alongside their primary method. The two paths coexist — a user with both a password and an SSO link can use either.

## Microsoft Entra ID SSO

Microsoft Entra ID is the SSO path for Microsoft 365 or Azure AD organisations. Users log in with their existing Microsoft accounts and are provisioned automatically on first sign-in. The flow uses OIDC under the hood; Tale acts as the relying party.

### Step 1 — Register the app in Azure

In the [Azure Portal](https://portal.azure.com), open **Microsoft Entra ID > App registrations** and create a new registration (or pick an existing one).

Add a redirect URI: `https://yourdomain.com/api/sso/callback`. Note the Application (client) ID and the Directory (tenant) ID; both come straight from the **Overview** blade. Generate a client secret under **Certificates & secrets** and copy the value — Azure only shows the secret once.

### Step 2 — Wire Tale to Azure

In Tale, open **Settings > Integrations** and select **Microsoft Entra ID** as the SSO provider. Paste the client ID, the tenant ID, and the secret. Optional toggles enable group sync, role mapping, auto-provisioning of new accounts, and OneDrive access for the knowledge base; turn each one on if it fits your IdP setup.

The SSO button appears on the login page once configured. SSO and password login coexist — users who existed before SSO was set up keep using their passwords; new users created through SSO can opt into a password later.

For infrastructure-as-code installs that prefer `.env` over the UI, the three values are also available as `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, and `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`. The env-var form and the UI form are equivalent; mixing them is fine but choose one as the source of truth for a given instance.

## Trusted headers

Trusted headers cover the deployment pattern where Tale sits behind an authenticating reverse proxy — Authelia, Authentik, oauth2-proxy, or anything else that authenticates users and forwards identity in HTTP headers. With trusted headers on, the login page is bypassed entirely: every request is authenticated transparently against the headers the proxy sets, and an account is provisioned on first contact.

This is the right path when your organisation already runs an SSO portal in front of every internal app and Tale needs to fit the same auth boundary.

### Enable the mode

Add the flag to `.env`:

```dotenv
TRUSTED_HEADERS_ENABLED=true
```

The mode takes effect after `tale deploy` (production) or `tale start` (local) — Convex picks up env at process start, so a live stack won't switch over until the container restarts.

### Default header names

Out of the box, Tale reads four headers. Every proxy uses different names; the overrides in the next section let you align Tale to whichever proxy is in front.

| Header       | Required | Default name   | Description                                                                |
| ------------ | -------- | -------------- | -------------------------------------------------------------------------- |
| Email        | Yes      | `Remote-Email` | User's email address.                                                      |
| Display name | No       | `Remote-Name`  | User's display name. Falls back to the email's username when absent.       |
| Role         | No       | `Remote-Role`  | One of `admin`, `developer`, `editor`, or `member`. Defaults to `member`.  |
| Teams        | No       | `Remote-Teams` | Comma-separated `id:name` list (e.g. `abc123:Engineering, def456:Design`). |

### Override the header names

Most proxies don't ship `Remote-*`. Override the defaults to match whichever proxy is in front:

```dotenv
TRUSTED_EMAIL_HEADER=X-Forwarded-Email
TRUSTED_NAME_HEADER=X-Forwarded-User
TRUSTED_ROLE_HEADER=X-Forwarded-Role
TRUSTED_TEAMS_HEADER=X-Forwarded-Teams
```

Common proxies:

| Proxy        | Email header        | Name header        | Groups/Role header   |
| ------------ | ------------------- | ------------------ | -------------------- |
| Authelia     | `Remote-Email`      | `Remote-Name`      | `Remote-Groups`      |
| Authentik    | `X-authentik-email` | `X-authentik-name` | `X-authentik-groups` |
| oauth2-proxy | `X-Forwarded-Email` | `X-Forwarded-User` | `X-Forwarded-Groups` |

### How a request flows

When trusted headers are on, every browser request follows the same path:

1. The reverse proxy authenticates the user against its own identity store and sets the identity headers on the forwarded request.
2. Tale's login page detects trusted-headers mode and navigates the browser to `/api/trusted-headers/authenticate` via a client-side redirect (not an HTTP 302).
3. The Tale backend reads the headers, finds or creates the user, and sets a session cookie scoped to your domain.
4. The browser is redirected to the dashboard.

On subsequent requests, the session cookie is reused. The session refreshes on each authentication and pulls the role and teams from the headers again, so a change in the upstream identity store propagates on the next page load — there's no manual sync.

### Team passthrough

The external identity provider is the single source of truth for teams; team IDs pass through directly with no internal database lookup. Omit the teams header to leave teams unchanged, or send it empty to remove the user from every team.

### Internal secret (optional)

For defense-in-depth, set a shared secret that the convex endpoint validates before honouring the headers:

```dotenv
TRUSTED_HEADERS_INTERNAL_SECRET=your-random-secret
```

This ensures the authentication endpoint can only be reached through the trusted proxy chain. Without the secret, any request that lands on `/api/trusted-headers/authenticate` with the right headers gets accepted; with the secret, the request also has to carry the matching internal header value.

Enable trusted headers only when the upstream proxy strips these headers from external requests. If external clients can set the headers directly, they can impersonate any user.

## Where this fits

Authentication is the strictest version of the question [Members and roles](/platform/admin/members-and-roles) answers. Members and roles decides who can do what once they're in; authentication decides who gets in at all. The three methods — password, Microsoft Entra SSO, trusted reverse-proxy headers — can run side by side on the same instance, so an organisation can use SSO for employees and trusted headers for an Authelia-fronted public surface, with the same Tale role matrix applying to both.

For the second-factor layer that sits on top of any of the three methods, [Two-factor authentication](/platform/admin/two-factor-authentication) is the page. For the env-var inventory that ties trusted headers and Entra SSO into the deployment, [Environment reference](/self-hosted/configuration/environment-reference) is the index.
