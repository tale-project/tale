---
title: Create the first owner account
description: Complete first-time setup, confirm ownership and prepare the instance for teammates.
---
On an empty instance, Tale’s setup flow creates the first account and organization. That account becomes the Owner. Complete this step while you still control access to the new instance, before sharing its address with others.

## Confirm the instance is ready

Open the configured `SITE_URL` and check the certificate and hostname. For a CLI deployment, run `tale status`; for a deployment you maintain yourself, inspect its services and probes. An unhealthy backend needs [troubleshooting](/self-hosted/operate/observability/troubleshooting) before account setup.

A login page instead of setup usually means an account already exists. This is expected in a seeded development environment. Do not erase the database to recover access; sign in with the existing account or ask an administrator for an invitation.

## Complete setup

Open the instance URL. Follow the setup flow to create your account and name the organization. Keep your sign-in credentials in a password manager.

The model-provider step can be completed during setup or later under **Settings > AI providers**. Without a provider you can inspect the app, but a real model reply still needs valid credentials and an available model. Follow [AI providers](/platform/admin/providers) when you are ready to connect one.

## Confirm ownership

Open **Settings > Members** and verify that your account has the **Owner** role. The organization name and account should match the instance you intended to initialize.

<Frame caption="Check the owner and each invited member’s role before giving the team access.">

![The organization members page lists people and their assigned roles.](/images/get-started/settings-organization-members.webp)

</Frame>

Sign out and sign in again to verify the credentials independently of the setup session. Keep another tested administrative recovery path before changing authentication settings.

## Invite teammates

Add people through **Settings > Members** and choose their roles deliberately. After the initial account, local account creation uses invitations rather than open self-service registration. Corporate SSO and provisioning have their own [setup and membership rules](/platform/admin/enterprise-sso).

The backend enforces that, not only the proxy in front of it: once any account exists, `/api/auth/sign-up/email` answers 403. This matters because the backend is also reachable from the agent sandbox network, which the proxy never sees, so code running in an agent session cannot create accounts either. **Settings > Members** creates accounts server-side and is unaffected. A throwaway test deployment that needs the open route sets `TALE_ALLOW_OPEN_SIGN_UP=true`; never set it on a real one.

Creating a further organization is open to every signed-in user unless you name who may do it: set `TALE_ORGANIZATION_CREATORS` to their sign-in addresses, and everyone else loses the **Create organization** entry in the organization picker and is refused at the API with `403 ORGANIZATION_CREATION_FORBIDDEN`. The first organization is always allowed, so setup is not affected. A managed deployment declares the same list as `organizations.creators` in its specification; see [Install the tale CLI](/self-hosted/install/cli-install#managed-organization-creators) and the [environment reference](/self-hosted/configuration/environment-reference).

Use [Members and roles](/platform/admin/members-and-roles) to choose access. Then [create a first agent](/tutorials/editor/first-agent-end-to-end) and test a real reply. A working dashboard confirms access to the application; it does not verify the model provider or every background service.
