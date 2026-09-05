---
title: Enterprise SSO and provisioning
description: Configure single sign-on (OIDC, OAuth2, SAML 2.0) and SCIM user and group provisioning for your organisation. Step-by-step setup for Microsoft Entra ID, Google, generic OIDC, and SAML, plus role mapping, group-to-team sync, and deactivation. Read this when wiring enterprise identity for the org.
---

Enterprise SSO lets your members sign in with your identity provider (IdP) instead of a Tale password, and SCIM lets the IdP provision, update, and deactivate members and groups automatically — no manual invites. One connection per organisation carries the sign-in protocol, the provisioning policy, and the SCIM token together. Everything lives on one page: **Settings > Enterprise SSO** (admins only).

Tale speaks four protocols: **OIDC**, plain **OAuth2**, **SAML 2.0** for sign-in, and **SCIM 2.0** for provisioning. You can enable sign-in, provisioning, or both.

<Frame caption="Settings > Enterprise SSO — the protocol picker and sign-in fields on one page, with the redirect URL to register in the IdP shown ready to copy.">

![The Enterprise SSO settings page with the Protocol dropdown set to Microsoft Entra ID and a matching display name, and a sign-in section carrying the redirect URL to register, an issuer URL and client ID filled in from the app registration, an empty client secret, and the requested scopes.](/images/platform/settings-enterprise-sso.webp)

</Frame>

## Choosing a protocol

Open **Settings > Enterprise SSO**, pick a **Protocol**, and fill in only that protocol's fields — the rest stay hidden. A **Setup guide** on the same page lists the exact steps and shows the URLs you paste into your IdP. Use **Test connection** before saving to validate the configuration, and **Save** to enable sign-in.

- **Microsoft Entra ID** — Microsoft's OIDC, with group-to-team sync over Microsoft Graph.
- **Generic OIDC** — any OpenID Connect provider (Google, Okta, Auth0, Keycloak, …). Endpoints are discovered from the issuer.
- **OAuth2** — providers without OIDC discovery; you configure the authorization, token, and userinfo endpoints by hand.
- **SAML 2.0** — XML-based SSO; you exchange metadata with the IdP.

## Microsoft Entra ID

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) as at least an Application Developer.
2. Go to **Entra ID > App registrations > New registration**, name it, and choose **Single tenant**.
3. Under **Redirect URI**, select the **Web** platform and paste the **Redirect URL** shown on the Tale settings page, then **Register**.
4. On the app's **Overview**, copy the **Application (client) ID** and **Directory (tenant) ID**. Your issuer URL is `https://login.microsoftonline.com/{tenant-id}/v2.0`.
5. Open **Certificates & secrets > New client secret** and copy the secret **Value** (not the Secret ID).
6. In Tale, choose **Microsoft Entra ID**, and enter the client ID, client secret, and issuer URL.
7. For group-to-team sync, add the Microsoft Graph **GroupMember.Read.All** permission under **API permissions** and grant admin consent.
8. OneDrive and SharePoint file import is **not** part of SSO. Members authorize it from **Knowledge → Documents → From Microsoft 365 → Connect Microsoft 365**, which requests Graph **Files.Read** and **Sites.Read.All** on that consent screen alone. Do not add those scopes to the SSO **Scopes** field.

## Google

Google is configured as a generic OIDC provider.

1. In the [Google Cloud Console](https://console.cloud.google.com), open **APIs & Services > Credentials > Create credentials > OAuth client ID**.
2. Choose the application type **Web application**.
3. Under **Authorized redirect URIs**, add the **Redirect URL** shown on the Tale settings page, and save.
4. Copy the **Client ID** and **Client secret** from the top of the client page.
5. In Tale, choose **Generic OIDC**, enter the client ID and secret, and set the issuer URL to `https://accounts.google.com`. Endpoints are discovered automatically.

Google's standard OIDC does **not** return group memberships, so group-to-team sync is unavailable with Google alone — it needs the Admin SDK / Cloud Identity API with a Workspace admin. Sign-in and role-by-claim mapping work normally.

## Generic OIDC and OAuth2

For any other OIDC provider (Okta, Auth0, Keycloak), choose **Generic OIDC**, paste the **issuer URL** and the client ID/secret — Tale reads the authorization, token, and userinfo endpoints from the issuer's `.well-known/openid-configuration`.

If a provider exposes OAuth2 but no discovery document, choose **OAuth2** and enter the **authorization**, **token**, and **userinfo** endpoint URLs by hand. When the provider uses non-standard claim names, map **email**, **name**, and **groups** under the connection's advanced fields (dot-paths are supported, e.g. `realm_access.roles`).

## SAML 2.0

1. In Tale, choose **SAML 2.0**. The page shows your **SP metadata URL** and **ACS (reply) URL** — copy them.
2. In your IdP, create a new SAML 2.0 application. Set its **ACS URL** and **Entity ID / Audience** to the SP values shown (or upload the SP metadata URL), and set the **Name ID** format to email address.
3. Under **Import IdP metadata**, paste the IdP's federation-metadata URL and click **Import** — or click **Upload XML** if your IdP only offers a downloadable file. Tale parses the metadata and fills the entity ID, sign-on URL, and signing certificate fields below, so there's nothing to retype by hand. All three stay editable, so review the imported values (or fill them in yourself, if your IdP publishes no metadata document) before saving.
4. Map the **email**, **name**, and **group** attributes in your IdP; if their names differ from the defaults, open **Advanced** and enter the matching names under **Email attribute**, **Name attribute**, and **Groups attribute**.

Tale supports both IdP-initiated SAML (the IdP posts an assertion to the ACS URL) and SP-initiated SAML (a member clicks **Sign in with SSO** and Tale redirects to the IdP). Signed assertions are required (**Require signed assertions**, on by default). To receive encrypted assertions, paste an **SP certificate (PEM)** and its **SP private key (PEM)** under **Advanced** — the certificate is published in the SP metadata for your IdP to encrypt to, the key is stored as a secret and never shown again — then turn on **Require encrypted assertions** once the IdP encrypts; a connection that requires them refuses any assertion that arrives unencrypted, and Tale refuses to save that switch without a key to decrypt with.

A sign-in Tale starts — SP-initiated SAML, and every OIDC and OAuth2 sign-in — is bound to the browser it started in: Tale sets a short-lived cookie when it redirects to your IdP and refuses a response that comes back in a different browser, so a captured sign-in link cannot sign someone else in. An IdP-initiated assertion answers no request from Tale and carries no such binding. A member who is told the sign-in did not finish in the browser it started in has a browser that dropped that cookie (typically a privacy setting that blocks cookies on cross-site redirects); signing in again from a browser that keeps it resolves it.

## Several organizations on one deployment

A deployment can host more than one organization, each with its own connection. Click **Continue with SSO** on the login page, then pick your organization from the list — each entry shows the connection's **Display name**. That name is visible to anyone on the login page, so set a clear display name per connection in **Settings > Enterprise SSO**.

## Provisioning: roles and teams

Every protocol shares one provisioning policy:

- **Default role** — the role a newly provisioned member receives (Member by default).
- **Auto-assign roles from the IdP** — when on, role-mapping rules map a job title, app role, group, or claim to a platform role; the default role applies when nothing matches.
- **Sync IdP groups to teams** — when on, each of the user's IdP groups becomes (or joins) a team of the same name on sign-in; **Exclude groups** skips noisy groups (comma-separated). The sync only ever takes back what it added: when a group disappears from the user's claim, the membership the sync granted is removed, and a team the sync created is deleted once it empties. Teams and memberships created by admins or through SCIM are never touched, and excluded groups are left alone entirely.

## SCIM provisioning (users and groups)

SCIM lets your IdP push changes without anyone signing in. In the **SCIM provisioning** section, click **Generate token** — copy it once (it is never shown again) — and paste it, along with the **SCIM base URL** shown, into your IdP's provisioning settings. The IdP authenticates with the token as a bearer credential; Tale resolves the organisation from the token, so it is the tenant boundary.

Tale implements SCIM 2.0 **Users** and **Groups**: create, read, list (with `userName`/`displayName` filters), replace, patch, and delete. Provisioned users map to organisation members; groups map to teams. **Deactivation is soft** — when the IdP sets a user inactive (`active: false`), the member's role is set to `disabled` (which removes their access), and re-activation restores their prior role. A SCIM **delete** removes the membership from the organisation; the user account itself is kept, and re-provisioning attaches it again at the connection's default role. The organisation owner can never be de-provisioned or deactivated via SCIM. Group members must be members of the organisation — a user from another organisation is refused. A `userName` change is applied only when the address is free and the account belongs to this organisation alone; an account that is also a member elsewhere keeps its sign-in identity, and the IdP receives a refusal instead.

## Verifying

Use **Test connection** for OIDC/OAuth2 to confirm discovery and credentials before saving. For SAML, download the SP metadata into your IdP and run a test login. For SCIM, most IdPs offer a "test" or "provision now" action that creates a sample user — confirm it appears under **Settings > Members**. End-to-end SSO sign-in is best verified against your real IdP in a staging organisation.
