---
title: Settings
description: Configure organization settings, teams, integrations, branding, and API keys.
---

## Organization settings

Accessible to Admins only. Configure organization-wide settings and manage team members.

### Organization name

The organization name appears in the sidebar, emails, and notification headers. Edit the name field and click Save Changes to update it.

### Member management

The member table lists all users in the organization with their email, display name, role, and join date. Admins can:

- Add members: enter an email, optional password, display name, and role. If the email already exists in Tale, the user is added to the organization without creating a new account.
- Edit members: change a member's display name, role, or set a new password for them.
- Remove members: removes the member from the organization. Their account is not deleted.

## Teams

Teams let you organize members and control knowledge base visibility. A document or conversation tagged to a team only appears when that team is active in the filter. Teams are managed from the Teams settings tab, Admin only.

## Integrations

Configure connections to external services. Tale supports the following integration types:

### REST API integrations

Connect any HTTP-based API by entering the base URL and credentials. Supported authentication methods:

- API Key: pass a key in a header or query parameter
- Bearer Token: `Authorization: Bearer <token>`
- Basic Auth: username and password
- OAuth 2.0: authorization code flow with automatic token refresh

### SQL integrations

Connect a PostgreSQL, MySQL, or Microsoft SQL Server (MSSQL) database. The AI agent and automations can query it using plain language that is translated to SQL.

### Email (conversations)

Connect an email account to enable the Conversations inbox. Incoming emails become conversation threads. Replies sent from the platform are delivered as normal email responses.

### Microsoft OneDrive

Connect a Microsoft account to enable OneDrive document sync. Users can then import files from OneDrive directly into the Knowledge Base.

## API keys

Generate API keys for programmatic access to the Tale API. Keys have the same permissions as the user who created them, scoped to their role. Keys can be revoked at any time from this tab.

## Branding

Customize the look of the platform for your organization. Admin only. Available options:

- Application Name: replaces "Tale" in the browser tab and header
- Logo: upload an image to replace the default logo in the navigation bar
- Favicon: upload a custom favicon for the browser tab, with separate images for light and dark mode
- Brand Color: the primary color used for buttons and active states
- Accent Color: secondary color used for highlights and badges

## Account settings

Available to all users. Change your password here. If you signed up via SSO, you can also set a regular password from this page to enable direct login.

## Governance

Admin only. Configure organization-wide AI policies and controls. The governance page is organized into three groups accessible from a left-hand navigation:

### Content & Models

- **System Prompt**: set a global system prompt prepended to every AI conversation in the organization.
- **Default Models**: choose the default chat, vision, and embedding models used when users don't pick one explicitly.
- **Model Access**: control which models are available to specific teams or users.

### Policies & Limits

- **Budgets**: set spending limits per user, team, or the entire organization with configurable periods and thresholds.
- **Upload Policy**: restrict file uploads by type, size, or count.
- **Retention**: configure how long conversations and files are kept before automatic deletion.
- **Feature Controls**: toggle platform features (e.g., file uploads, web search, image generation) on or off organization-wide.

### Security & Monitoring

- **PII Detection**: enable automatic detection and masking (or blocking) of personally identifiable information in messages. Supports built-in patterns and custom regex rules.
- **Usage Dashboard**: view token consumption, cost breakdowns, and usage trends across the organization.

## Audit logs

Admin only. A time-ordered record of significant actions taken in the organization. Categories include authentication events, member changes, data operations, integration updates, workflow publications, security events, and admin actions. Useful for compliance and troubleshooting.

Admins can export audit logs as **CSV** or **JSON** using the export buttons above the log table. Exports respect the currently active category filter.
