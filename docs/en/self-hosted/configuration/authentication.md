---
title: Authentication
description: The four sign-in modes Tale ships with — local password, Microsoft Entra, generic OIDC, and trusted headers — and how an operator switches between them.
---

Tale ships four sign-in modes that an operator picks per instance. The default is local password, with one user per email; Microsoft Entra and generic OIDC delegate identity to an external provider; trusted headers hands the responsibility to a reverse proxy already terminating SSO upstream. The decision is permanent in the sense that it shapes how users are provisioned — switching modes after rollout is possible, but every existing user has to be re-mapped to the new identity source.

Local password and trusted headers are switched by env vars ([Environment reference](/self-hosted/configuration/environment-reference)); Microsoft Entra and generic OIDC are configured per organisation inside the running app. This page is the mode-by-mode walkthrough — when to choose each, what it changes for the user, what breaks when it is misconfigured.

## Local password (default)

Local password is the mode you get if you set nothing. The platform stores a bcrypt hash in Postgres, signs the session with `BETTER_AUTH_SECRET`, and the user signs in with an email and password the admin invites them with. No external identity provider is involved.

Reach for it on small instances and air-gapped deployments where adding an IdP is more friction than it solves. The cost: password reset goes through the admin (or through email if `SMTP_*` is configured), and there is no SSO story.

```bash
# .env — no flags needed for local password
HOST=localhost
SITE_URL=https://localhost
BETTER_AUTH_SECRET=...
```

## Microsoft Entra

The Microsoft Entra mode adds a **Continue with SSO** button to the sign-in screen and accepts users from a tenant you control. There is no env-var switch: the connection is configured per organisation under **Settings > Enterprise SSO** once the platform is up — pick the **Microsoft Entra ID** protocol and enter the client ID, client secret, and issuer URL from your app registration. The full walkthrough, including role mapping and group-to-team sync, is [Enterprise SSO and provisioning](/platform/admin/enterprise-sso).

Two deployment values must be right before the flow can work: `SITE_URL`, because the sign-in redirect URL is derived from it, and `BETTER_AUTH_SECRET`, which signs the OAuth state. The redirect URI to register in Entra is `${SITE_URL}${BASE_PATH}/http_api/api/sso/callback` — the settings page shows the exact URL to copy, and it must match byte-for-byte or Entra rejects the sign-in with `AADSTS50011`. The tenant ID in the Entra app registration narrows who can sign in; a multi-tenant registration accepts anyone with a Microsoft account, which is rarely what you want.

## Generic OIDC

Generic OIDC accepts any spec-compliant identity provider — Keycloak, Authentik, Okta, Google Workspace. Configuration lives on the **Single Sign-On** card under **Settings > Connectors**: pick the **Generic OIDC** provider type, enter the issuer URL, client ID, and client secret, and Tale reads the authorization, token, and userinfo endpoints from the issuer's `.well-known/openid-configuration` document. The flow uses the standard Authorization Code grant with PKCE (S256). Tale stores no secret on disk for OIDC; the client ID and client secret live in the encrypted credential store. The redirect URI to register with your provider is `${SITE_URL}/http_api/api/sso/callback`.

Identity providers disagree on where claims live, so the card lets you point Tale at yours. The **Email claim**, **Name claim**, and **Groups claim** fields take a claim name or a dot path into the userinfo response — Keycloak's realm roles, for example, sit at `realm_access.roles`. Role mapping rules assign platform roles at sign-in: a **Group** rule matches the user's groups against a wildcard pattern (`platform-admin*` → Admin), a **Claim** rule matches any claim resolved by dot path. **Auto-provision teams** mirrors the groups your provider returns as Tale teams on every sign-in, minus the groups you exclude.

A worked Keycloak example: create a confidential client `tale-platform` with the redirect URI above, add a Group Membership mapper so the client emits `groups` in userinfo, then in Tale set the issuer to `https://keycloak.example.com/realms/<realm>`, add a group rule `platform-admin*` → Admin, and click **Test connection** — it validates discovery before anything is saved.

This is the mode for teams that already run an IdP and want their existing identity surface in Tale.

## Trusted headers

Trusted headers is the mode for sites that terminate SSO at an upstream reverse proxy — oauth2-proxy, Pomerium, Authelia. The proxy authenticates the user and forwards identity headers; Tale reads `Remote-Email`, `Remote-Name`, `Remote-Role` and `Remote-Teams` by default, trusts them, and creates or updates the user record on the fly. A proxy that names its headers differently (oauth2-proxy sends `X-Auth-Request-Email`) is mapped with the `TRUSTED_*_HEADER` variables in the [environment reference](/self-hosted/configuration/environment-reference).

```bash
# .env
TRUSTED_HEADERS_ENABLED=true
TRUSTED_HEADERS_INTERNAL_SECRET=<long random value>
```

The secret is not optional: the identity headers alone are forgeable by anything that can reach the backend, so the endpoint refuses to run until `TRUSTED_HEADERS_INTERNAL_SECRET` is set. Configure the authenticating proxy to send the same value in the `Remote-Internal-Secret` header on every request it forwards to Tale (rename the header with `TRUSTED_SECRET_HEADER` if your proxy dictates its own naming) — a request arriving without the matching value is refused before any user is looked up.

`Remote-Teams` carries team memberships as comma-separated `id:name` entries — `t-fin:Finance, t-ops:Operations`. On every sign-in Tale creates each named team in the organization if it does not exist yet and puts the user in it; a team the header stops naming is left again. The sync only touches memberships it granted itself — a membership an admin assigned by hand stays. Leave the header out to keep Tale out of team management; send it present but empty to revoke every membership the proxy granted. A present value with no `id:name` entry in it (bare names, for instance) counts as empty and leaves a warning in the platform container's log — check there when users lose their teams after a proxy change.

The threat model is still delicate. Anything that can reach the platform container with those headers **and** the secret becomes the user named in them. Restrict the platform port so only the proxy can speak to it (a Docker network or a host firewall rule), and never expose the platform container directly to the internet when this mode is on.

## Where this fits

The four modes are mutually exclusive in spirit but technically additive — Microsoft Entra and trusted headers can coexist on the same instance if your IdP story is mid-migration. The full per-mode trade-off table lives in [Members and roles](/platform/admin/members-and-roles) on the user side; this page covers the operator's switch. The next configuration page worth reading is [Providers](/self-hosted/configuration/providers) — once users can sign in, you still need at least one model provider wired up before they can do anything.
