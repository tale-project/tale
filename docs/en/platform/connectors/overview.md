---
title: Connect Tale to external services
description: Choose a connector, connect the intended account and understand where its read and write actions can run.
---

Use a connector when Tale needs to read or change data in an external service. The connector defines supported actions; a credential authorizes the account those actions use. A Developer, Admin or Owner manages credentials under **Settings > Connectors**.

<Video src="/videos/en/tutorials/ep7-connectors/ep7-connectors.en.mp4" poster="/videos/en/tutorials/ep7-connectors/ep7-connectors.en.webp" captions="/videos/en/tutorials/ep7-connectors/ep7-connectors.en.vtt" lang="en" title="Episode 7 — Connectors & the outside world" caption="Episode 7 — Connectors & the outside world (2:30)">

</Video>

## Choose the connection for the task

| Connector | Typical use | Authentication |
| --- | --- | --- |
| Confluence | Import Confluence Cloud pages into knowledge. | Username and password/token pair. |
| Discord | Work with messages and channels. | Token. |
| GitHub | Read or manage repositories, issues and pull requests. | Token. |
| Gmail | Read, send and organize mail. | OAuth. |
| Google Drive | Import files into knowledge. | OAuth. |
| IMAP / SMTP Mailbox | Read or send mail through a private mail service. | Username and password. |
| Microsoft Outlook | Work with mail, calendars and contacts. | OAuth. |
| Shopify | Work with products, customers and orders. | API key. |
| Slack | Work with messages and channels. | OAuth. |
| Tavily | Search the web and extract pages. | API key. |
| Microsoft Teams | Work with messages and channels. | OAuth. |
| Twilio | Send SMS and make voice calls. | Username and password/token pair. |
| WebDAV Files | Read, write and list the organization’s WebDAV files. | Username and password. |

The deployed catalog’s cards show the current actions and authentication methods. These definitions arrive with the platform; adding an account does not install arbitrary new connector code.

Knowledge imports use the [document indexing pipeline](/platform/knowledge/documents). OneDrive and SharePoint use the import flow in **Knowledge > Documents**, with per-user consent, rather than a separate organization connector. Mounting Tale’s documents on your own device is the other direction; use [WebDAV](/platform/connectors/webdav).

## Add the intended account

Select **Add credential**, search for the service and choose its card. Connectors with existing credentials appear first, but you can add another account for the same service. The form asks for the authentication that connector supports.

<Frame caption="Add credential opens on the catalog — the thirteen shipped connectors, with the ones you already hold a credential for listed first.">

![The Add credential dialog over the Settings > Connectors table, listing the shipped connectors as cards with their category tags and action counts, a search field at the top, and the already-configured Tavily connector at the head of the list.](/images/platform/connectors-add-credential.webp)

</Frame>

Give the credential a name that identifies its purpose, such as `Support inbox` or `Release bot`. Use the external service’s credentials, not a Tale API key. For OAuth, complete the provider consent flow and check the returned account. If consent cannot start, an administrator may need to configure its OAuth app first.

Confluence and Shopify require an **Instance URL** per credential. Use the Atlassian site origin or the store’s `myshopify.com` origin, rather than an unrelated page or customer-facing domain. [Connector credentials](/platform/admin/connectors) covers setup fields, reconnection and rotation.

## Choose which account an action uses

An action uses the credential it explicitly names, or the connector’s default when no name is supplied. Only one credential per connector is the default. With no default, an unnamed call fails even if other credentials exist.

For example, two support mailboxes are two credential rows. Choose names that distinguish them and inspect a workflow’s resolved input before running it live. A default is a fallback for selection, not proof that every job should use that account. Mailbox operations designed to inspect all active accounts are a separate case.

Disabling a credential retains its configuration but stops use through it. Replacing its secret updates the account connection used by existing references. Check dependent workflows before disabling, deleting or changing the default.

## Understand reads and writes

Automations use connector actions as workflow nodes. Each action declares an input schema, output and read or write effect. In a test run, connector responses are mocked. In a live run, a write can send a message or change external data and is subject to the organization’s approval policy.

Equipped project agents receive supported read actions through Tale’s connector broker. It keeps those connector credentials outside the sandbox and returns results. The broker refuses connector writes. Direct GitHub tooling or explicit agent secrets use separate paths and must be reviewed separately.

Adding a credential does not add arbitrary tools to the ordinary Chat assistant. Use [automations](/platform/automations/editor) for a defined connector workflow and [project agents](/platform/projects/project-agents) for sandbox work.

## When the service is missing

An equipped agent can use a narrowly scoped secret to call a service from its sandbox. A `transform` node only reshapes data and cannot make an external API request. Review the permissions and expected effects before choosing a direct integration.

If the external application needs to call Tale, use the [REST API](/develop/api-reference) or [MCP endpoint](/develop/mcp-endpoint). [MCP and custom integrations](/platform/connectors/mcp-servers) explains that distinction.
