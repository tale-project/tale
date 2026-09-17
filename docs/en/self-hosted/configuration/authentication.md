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
| An upstream proxy already authenticates every request | Trusted headers | A private backend connection and a shared internal secret. |

These mechanisms are not a single deployment-wide selector. Enterprise SSO is configured per organization; trusted headers are enabled at deployment level. Plan and test changes to identity mapping before moving existing accounts to another mechanism.

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

Enable trusted headers only when your proxy owns authentication and can protect the connection to Tale. The default identity headers are `Remote-Email`, `Remote-Name`, `Remote-Role` and `Remote-Teams`.

Set `TRUSTED_HEADERS_ENABLED=true` and inject `TRUSTED_HEADERS_INTERNAL_SECRET`. Configure the proxy to supply that secret in `Remote-Internal-Secret` on forwarded requests. The [environment reference](/self-hosted/configuration/environment-reference) lists the `TRUSTED_*_HEADER` variables for changing those names.

<Warning>

The proxy must remove client-supplied identity headers and set its own authenticated values. Restrict backend access to that proxy. Anyone who can submit matching identity headers and the internal secret can impersonate the named user.

</Warning>

`Remote-Teams` contains comma-separated `id:name` entries, for example `t-fin:Finance,t-ops:Operations`. An omitted header leaves team management alone; a present empty header removes memberships previously granted by this synchronization. Invalid entries can therefore remove synchronized memberships. Manually granted memberships are preserved.

## Diagnose sign-in failures

| Symptom | Check first |
| --- | --- |
| IdP rejects a redirect | Compare its registered URL with the URL shown by Tale, including scheme, host and path. |
| Redirect returns but sign-in fails | Check callback reachability, cookies and the configured claim names. |
| Member receives the wrong role | Check default role and mapping rules with that person’s actual claims. |
| Synchronized teams disappear | Inspect the groups claim or `Remote-Teams` value; distinguish absent from empty. |
| Trusted-header sign-in is refused | Check enablement, the shared secret and proxy header names. |

Use a staging organization for mapping changes and keep a tested administrative recovery path. Authentication changes can affect every member whose identity depends on the connection.
