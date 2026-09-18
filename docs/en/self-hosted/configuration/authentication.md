---
title: Choose an authentication setup
description: Configure local accounts, enterprise sign-in or a trusted authentication proxy for your deployment.
---
Tale supports local email-and-password accounts, organization-specific enterprise sign-in and identity supplied by a trusted reverse proxy. Choose based on where your team’s identities are managed and who owns account provisioning. Sign-in and provisioning are separate decisions: SSO authenticates a person, while invitations, sign-in provisioning or SCIM control membership.

## Choose the right integration

| Your environment | Configure | Main prerequisite |
| --- | --- | --- |
| Local accounts managed in Tale | Local sign-in and invitations | Stable deployment secrets and a reachable instance URL. |
| An existing corporate identity provider | Enterprise SSO: Microsoft Entra ID, generic OIDC, OAuth2 or SAML 2.0 | An IdP application configured with Tale’s exact callback or metadata URLs. |
| An application or proxy already authenticates its users | Trusted headers, per organization | A key from **Settings > Enterprise SSO** and a proxy that injects it with the identity headers. |

Enterprise SSO and trusted headers are both configured per organization. Plan and test changes to identity mapping before moving existing accounts to another mechanism.

## Establish the public URL first

Set `SITE_URL` and any supported base-path configuration to the URL people will actually open. Complete [TLS and domain setup](/self-hosted/configuration/tls-and-domains) before registering redirect URLs with an identity provider.

Keep `BETTER_AUTH_SECRET` stable across the backend processes that serve the instance. Use the generated secret from your deployment tooling or inject it from your secret manager. A mismatch can interrupt authentication even when the identity provider accepts the user.

## Use local accounts

Local sign-in stores password hashes in the application database. The [first-admin setup](/self-hosted/install/first-admin) creates the initial Owner; later members join by invitation. Configure mail delivery if your onboarding and password-recovery process relies on email.

Verify the complete flow with a test account: invitation, sign-in, sign-out and recovery. A working owner session does not prove that a new member can join.

Tale sends no verification mail, so an address is confirmed by whoever provisioned it: the setup wizard’s first Owner, an admin adding a person under **Settings > Members**, and the operator’s deployment all count as that assertion, and the account is usable straight away. Connected applications read this as the `email_verified` claim on the identity Tale issues, so a colleague an admin just added can sign in to them immediately. An account that comes from enterprise SSO, SCIM or trusted headers keeps whatever its directory reports instead.

## Connect enterprise sign-in

Configure the organization under **Settings > Enterprise SSO**. Microsoft Entra ID and generic OIDC use issuer discovery; OAuth2 takes explicit authorization, token and userinfo endpoints; SAML uses metadata, an assertion-consumer URL and signing certificates.

<Frame caption="Copy the URLs from the running instance so its domain and deployment path are included.">

![The Enterprise SSO settings page shows protocol selection and the connection fields for Microsoft Entra ID.](/images/platform/settings-enterprise-sso.webp)

</Frame>

Use the callback and metadata URLs shown there rather than reconstructing them. Current native OIDC callbacks use `/api/sso/callback`; the compatibility route `/http_api/api/sso/callback` is also supported for existing registrations. The IdP registration must match the URL used by the flow.

Follow [Enterprise SSO and provisioning](/platform/admin/enterprise-sso) for protocol-specific setup, claim mapping, default roles, team synchronization and SCIM. Test sign-in in a separate browser session before ending the administrator session used to configure it. Discovery passing does not prove claims, group permissions or a complete sign-in.

## Trust an authentication proxy

An application that already signs its users in can hand them into one organization through its reverse proxy. An Admin turns the feature on under **Settings > Enterprise SSO**, in the **Trusted headers** card: choose the highest role the proxy may assert, then create a key and copy it, because it is shown once. Point the proxy's sign-in at `/api/trusted-headers/authenticate` with that key as the `Authorization` bearer token (or in the `Remote-Internal-Secret` header) and the identity headers `Remote-Email`, `Remote-Name`, `Remote-Role` and `Remote-Teams`. The [environment reference](/self-hosted/configuration/environment-reference) lists the `TRUSTED_*_HEADER` variables for renaming those headers.

The key decides the organization. A member of that organization signs in; an address the deployment has never seen becomes a new member with the asserted role; an existing account from another organization is refused. Owner is never assertable, and a role above the organization's ceiling is lowered to it. Turning the card off refuses every key without revoking one; revoking a key does not end the sessions it started.

<Warning>

The proxy must remove client-supplied identity headers, set its own authenticated values and add the key only on the hand-off request. Anyone holding the key can sign in as any member the proxy names within that organization. Treat it like a password and rotate it from the card.

</Warning>

`Remote-Teams` contains comma-separated `id:name` entries, for example `t-fin:Finance,t-ops:Operations`. An omitted header leaves team management alone; a present empty header removes memberships previously granted by this synchronization. Invalid entries can therefore remove synchronized memberships. Manually granted memberships are preserved.

Tale's sign-in page hands the browser to the hand-off address by itself when the request carries the proxy's identity header, so members never see the credential form; routing the proxy's `/log-in` straight to the hand-off address saves that round trip and is still recommended. When a hand-off does not end in a session (refused, or cookies blocked inside a frame), the page shows the form with a retry button instead of looping.

To show Tale inside the application's own page rather than in a tab, an Admin lists that page's origin under **Embedding** on the same settings page. Tale's pages then answer with a `frame-ancestors` policy naming `'self'` and the listed origins instead of refusing every frame, and the `X-Frame-Options` header is left off. The list belongs to one organization, but the sign-in shell is one document for the whole deployment, so an origin any organization admits may load it. The browser sends the session cookie into a frame only when the surrounding page is on the same site as Tale, for example a subdomain of the host or Tale served under the host's own domain; a cross-site frame shows the sign-in page instead.

## Diagnose sign-in failures

| Symptom | Check first |
| --- | --- |
| IdP rejects a redirect | Compare its registered URL with the URL shown by Tale, including scheme, host and path. |
| Redirect returns but sign-in fails | Check callback reachability, cookies and the configured claim names. |
| Member receives the wrong role | Check default role and mapping rules with that person’s actual claims. |
| Synchronized teams disappear | Inspect the groups claim or `Remote-Teams` value; distinguish absent from empty. |
| Trusted-header sign-in is refused | Check that the card is on for that organization, that the key is not revoked, and the proxy's header names. |

Use a staging organization for mapping changes and keep a tested administrative recovery path. Authentication changes can affect every member whose identity depends on the connection.
