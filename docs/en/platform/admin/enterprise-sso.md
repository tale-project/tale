---
title: Enterprise SSO and provisioning
description: Connect your identity provider, test sign-in, and manage member roles and teams with SSO, SCIM or a trusted proxy.
---

Enterprise SSO lets members sign in through your identity provider (IdP). SCIM lets that provider create, update, and deactivate members without waiting for them to sign in. An organization has one connection; you can enable sign-in, provisioning, or both in **Settings > Enterprise SSO** as an Admin or Owner.

## Before you start

You need permission to register an application with your IdP, its client credentials or SAML metadata, and the public Tale address members will use. Keep a working administrator session open while testing so you can correct the connection if a test sign-in fails.

Choose a **Display name** members will recognize. It appears in the organization picker on the public sign-in page, so avoid internal or confidential information.

<Frame caption="Choose the protocol first. Tale shows the relevant fields and the callback address to register with your identity provider.">

![Enterprise SSO settings with Microsoft Entra ID selected, a redirect URL, and issuer and client credential fields.](/images/platform/settings-enterprise-sso.webp)

</Frame>

## Choose the protocol

| Protocol | Use it when | Information to prepare |
| --- | --- | --- |
| **Microsoft Entra ID** | Your organization uses Entra; optional team sync uses Microsoft Graph. | Tenant issuer URL, client ID, client secret. |
| **Generic OIDC** | Your provider supports OpenID Connect discovery. | Issuer URL, client ID, client secret. |
| **OAuth2** | Your provider has no OIDC discovery document. | Client credentials and authorization, token, and userinfo endpoint URLs. |
| **SAML 2.0** | Your IdP uses SAML assertions. | IdP metadata or its entity ID, sign-on URL, and signing certificate. |

## Connect an OIDC or OAuth2 provider

1. Select the protocol in Tale and open **Setup guide** to find the callback URL.
2. Register a web application with your IdP. Copy the callback URL exactly, including scheme, host, and path. Register each additional callback URL Tale shows if members use several deployment domains.
3. Enter the client ID and secret in Tale. For OIDC, enter the issuer URL; Tale discovers the endpoints. For OAuth2, enter the three endpoint URLs yourself.
4. Review **Scopes** and **Advanced**. Request the identity claims your provisioning rules need. Map nonstandard claim names where necessary; claim paths can use dots, such as `realm_access.roles`.
5. Select **Test connection**, resolve any error, then **Save** in the header. Continue with a real sign-in test below.

For Entra, use a tenant-specific issuer such as `https://login.microsoftonline.com/{tenant-id}/v2.0`, register the callback as a Web redirect URI, and copy the client secret's value rather than its ID. Microsoft's [application registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) explains the provider-side setup. Group-to-team sync requires the Microsoft Graph `GroupMember.Read.All` permission and admin consent.

For Google, choose **Generic OIDC** with issuer `https://accounts.google.com`; see Google's [OpenID Connect setup](https://developers.google.com/identity/openid-connect/openid-connect). Standard Google OIDC does not provide group memberships, so signing in with Google alone does not enable group-to-team sync.

<Note>
Microsoft 365 file import has a separate consent flow under Knowledge. Do not add `Files.Read` or `Sites.Read.All` to SSO scopes just to let members sign in. Configure import access through [connector OAuth apps](/platform/admin/connectors).
</Note>

## Connect a SAML provider

1. Choose **SAML 2.0**. Copy the **SP metadata URL** and **ACS (reply) URL** into your IdP's SAML application. Use the service-provider metadata for its entity ID/audience and set the Name ID format to email address.
2. Under **Import IdP metadata**, import the IdP's metadata URL or select **Upload XML**. Review the entity ID, sign-on URL, and signing certificate filled in by the import. You can also enter them manually.
3. Under **Advanced**, map email, name, and groups if the IdP uses different attribute names. Keep **Require signed assertions** enabled.
4. Save the connection, then test a sign-in through the IdP.

If your IdP encrypts assertions, add a matching **SP certificate (PEM)** and **SP private key (PEM)** under **Advanced**. The certificate is published in SP metadata; the private key is stored as a secret and is not shown again. Configure the IdP to encrypt before enabling **Require encrypted assertions**. Tale refuses that setting without a decryption key and rejects unencrypted assertions when it is enabled.

Both IdP-initiated and Tale-initiated SAML are supported. For a sign-in started in Tale, finish in the same browser so the callback can validate the cookie created at the start.

## Assign roles and teams at sign-in

| Setting | What it controls |
| --- | --- |
| **Default role** | Role for newly provisioned members when no role rule matches; initially Member. |
| **Auto-assign roles from the IdP** | Maps groups, app roles, job titles, or claims to Tale roles. Review who could match an Admin rule before enabling it. |
| **Sync IdP groups to teams** | Creates or joins teams from group membership at sign-in. |
| **Exclude groups** | Comma-separated group names to leave out of team sync. |

Team sync removes memberships it previously granted when groups disappear and deletes teams it created once empty. It preserves memberships created manually or through SCIM, and leaves excluded groups alone. See [teams](/platform/admin/teams) for manual membership management.

## Provision members through SCIM

1. In **SCIM provisioning**, select **Generate token** and copy it immediately; it is shown once.
2. Enter the token as a bearer credential and the displayed **SCIM base URL** in your IdP's provisioning configuration.
3. Provision a test user and group. Confirm the member and team appear in Tale, then test updates and deactivation before enabling a wider rollout.

SCIM Users map to members and Groups to teams. Deactivation (`active: false`) disables the member's access; reactivation restores their previous role. Deleting a SCIM user removes their organization membership but preserves their account. Provisioning them again starts with the connection's default role.

The organization owner cannot be deactivated or removed through SCIM. Groups can contain only members of this organization. A username change is refused if the new email is in use or the account belongs to multiple organizations, protecting its shared sign-in identity.

## Sign members in through an authenticating proxy

An application that already authenticates its users can hand them into this organization through its reverse proxy, so members never see Tale's sign-in form. The **Trusted headers** card on the same page holds the switch, the role ceiling and the keys the proxy presents.

1. Turn on **Accept sign-ins from a trusted proxy** and choose the **Highest role a proxy may assert**. The role header is capped at this role; Owner is never assertable.
2. Select **Create key**, name it after the proxy that will hold it, and copy the key immediately; it is shown once. An organization holds at most 10 live keys.
3. Configure the proxy to send its sign-ins to the **Hand-off URL** with the key as the `Authorization` bearer token (or in the key header) and the identity headers listed under **Header names**. Point the proxy's `/log-in` at the same address.

To show the pages inside the application's own page, turn on **Allow embedding in a frame** under **Embedding** and list the page's origin under **Allowed origins**; Tale then admits that origin as a frame ancestor. A frame carries the signed-in session only when the surrounding page is on the same site as Tale.

The key decides the organization: a member signs in, an address Tale has never seen becomes a new member with the asserted role, and an existing account from another organization is refused. Turning the switch off refuses every key without revoking one. **Revoke** stamps a key so the proxy can no longer sign anyone in; sessions it already started stay signed in. The operator's [authentication configuration](/self-hosted/configuration/authentication) covers header names and proxy requirements.

## Verify and troubleshoot

Open a separate browser session, choose **Continue with SSO**, and select the organization by its display name. Complete sign-in, then check the expected role and team memberships. **Test connection** checks connection details; it does not prove that a real user receives the right access.

| Symptom | What to check |
| --- | --- |
| Redirect mismatch, including `AADSTS50011` | Compare the registered callback with Tale's exact URL; check domain, scheme, path, and trailing slash. |
| Connection test fails | Check issuer/endpoints, client ID, secret value and expiry, and required provider consent. |
| Browser-binding error | Start sign-in again in the same browser and allow the cookies needed across redirects. |
| Wrong role or missing team | Inspect the IdP's actual claims, role rules, exclusions, and group permissions. |
| SCIM cannot connect | Check the base URL, bearer token, and whether provisioning is enabled. |
| Proxy sign-in is refused | Check that the card is on, the key is not revoked, and the proxy sends the email header and the key on the hand-off request. |
| Missing redirect URL or server-configuration warning | Ask the deployment operator to check [authentication configuration](/self-hosted/configuration/authentication). |

**Disable sign-in** stops new SSO sign-ins while keeping active sessions. **Remove** deletes the connection configuration and credentials. Arrange another working sign-in method before using either action.
