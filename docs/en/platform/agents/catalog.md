---
title: Agent catalog
description: Browse the pre-installed AI workforce by department and install, enable, or disable agents for your organization.
---

A fresh organization ships with a full company of agents already at work — a C-suite and the doers under them, organized by department. The **catalog** (Agents → Catalog) is where you browse that workforce and decide which agents are live.

Each agent's JSON configuration is the source of truth for its name, description, and department labels; the catalog reads them and shows the install state on top.

## States and actions

Every card shows one of three states and the action that fits it:

- **Available** — in the catalog but not installed. **Install** adds it to your organization (enabled).
- **Enabled** — installed and live: it can be mentioned, routed to, and assigned work. **Disable** keeps the installation but takes it out of rotation; **Uninstall** removes it.
- **Disabled** — installed but out of rotation. **Enable** brings it back.

Cards are grouped by department (their primary label — Engineering, Marketing, Sales, Finance, and so on), and a search box filters by name, description, or department.

## Provenance and integration-bundled agents

Some agents are installed for you when you connect an integration — for example, connecting GitHub installs the Pull Request Reviewer and Issue Triager. Those carry an **Installed by &lt;integration&gt;** badge, and the catalog won't let you disable or uninstall them by hand (disconnect the integration instead). An agent that still needs an integration shows a **Requires &lt;integration&gt;** badge until you connect it.

## Permissions

Installing, enabling, disabling, and uninstalling are administrator actions (admin, developer, or owner). Editing an agent's model, instructions, or full configuration is done in the agent editor (Agents → All agents → an agent), not the catalog.
