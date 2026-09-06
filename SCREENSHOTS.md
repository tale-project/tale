<!-- Images are the committed docs screenshots under services/docs/public/images/. When the
pipeline regenerates them, re-vet every frame here (no Failed badges, no loading skeletons,
no bare empty states) before shipping. The README gallery uses separate snapshot tiles in
.github/assets/ on purpose — keep it that way. -->

# Tale in screenshots

A visual lap around the platform. Every image is the real product, captured by the same
pipeline that illustrates the [docs](https://tale.dev/docs) — click any screenshot to view it
full-size, or follow a section's docs link for the guided version.

Back to the [README](README.md).

## Chat

The everyday entry point: agents, attachments, citations, voice — and Arena.
[Chat docs →](https://tale.dev/docs/platform/chat/overview)

<table>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/chat-starters-empty.webp"><img src="services/docs/public/images/platform/chat-starters-empty.webp" alt="The empty new-chat screen showing the Assistant's four conversation starters above the composer" width="100%"></a>
      <br/><sub><b>New chat</b> — an agent's conversation starters, one click from work</sub>
    </td>
    <td width="50%">
      <a href="services/docs/public/images/platform/chat-arena-split.webp"><img src="services/docs/public/images/platform/chat-arena-split.webp" alt="Arena Mode with the same prompt answered in two columns headed by different models — a numbered checklist on the left, a grouped answer on the right — and four verdict buttons underneath" width="100%"></a>
      <br/><sub><b>Arena</b> — the same prompt streamed through two models, with a verdict bar</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/chat-thread-reply.webp"><img src="services/docs/public/images/platform/chat-thread-reply.webp" alt="A chat thread showing a user question about onboarding feedback and an assistant reply containing a markdown table of three themes" width="100%"></a>
      <br/><sub><b>Rich replies</b> — markdown tables, citations, and follow-up context</sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Projects and tasks

Shared workspaces that bundle the chats, files, instructions, and discussions around one piece
of work — with task boards agents work from.
[Projects docs →](https://tale.dev/docs/platform/projects/overview) ·
[Task automation docs →](https://tale.dev/docs/platform/projects/task-automation)

<table>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/projects-task-board.webp"><img src="services/docs/public/images/platform/projects-task-board.webp" alt="A kanban task board inside the Website relaunch project, its seven task cards spread across the Backlog, To do, In progress, In review, Done, and Cancelled columns" width="100%"></a>
      <br/><sub><b>Task board</b> — assign a card to an agent and it goes to work</sub>
    </td>
    <td width="50%">
      <a href="services/docs/public/images/platform/project-general-tab.webp"><img src="services/docs/public/images/platform/project-general-tab.webp" alt="The General tab of the Website relaunch project showing the name and description fields, the filled-in Instructions editor, and the Sharing section below" width="100%"></a>
      <br/><sub><b>Project home</b> — name, description, standing instructions, and sharing</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/project-agents-models.webp"><img src="services/docs/public/images/platform/project-agents-models.webp" alt="The Agents tab of the Website relaunch project listing two named agents, Content editor on Claude Code and Redirect auditor on Codex, each with its provider and model" width="100%"></a>
      <br/><sub><b>Project agents</b> — a named crew, each with a harness, a model, and standing instructions</sub>
    </td>
    <td width="50%">
      <a href="services/docs/public/images/platform/project-knowledge-files.webp"><img src="services/docs/public/images/platform/project-knowledge-files.webp" alt="The Knowledge tab of the Website relaunch project showing two indexed files in the file tree, a New folder button, and the Add file dropzone" width="100%"></a>
      <br/><sub><b>Project files</b> — reference material available to every chat in the project</sub>
    </td>
  </tr>
</table>

## Knowledge

Documents, crawled websites, and typed records that agents retrieve and cite.
[Knowledge docs →](https://tale.dev/docs/platform/knowledge/overview)

<table>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/websites-add-dialog.webp"><img src="services/docs/public/images/platform/websites-add-dialog.webp" alt="The Add website dialog on the Websites tab, asking for a domain and a scan interval that defaults to every six hours" width="100%"></a>
      <br/><sub><b>Website crawling</b> — point Tale at a domain; it rescans on an interval</sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Automations

Typed workflows on schedules, webhooks, and events — with human approval gates.
[Automations docs →](https://tale.dev/docs/platform/automations/concepts)

<table>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/automation-editor-canvas.webp"><img src="services/docs/public/images/platform/automation-editor-canvas.webp" alt="The workbench for the Triage the Gmail inbox automation: a canvas with its fetch, inbox, and triage steps, the llm step selected, and the node inspector beside it showing the step's prompt, system prompt, model, output schema, and input" width="100%"></a>
      <br/><sub><b>Workflow editor</b> — the typed step graph, with the node inspector a click away</sub>
    </td>
    <td width="50%">
      <a href="services/docs/public/images/platform/automations-catalog.webp"><img src="services/docs/public/images/platform/automations-catalog.webp" alt="The Automations catalog on its All automations tab, cards grouped by source — Sync Confluence pages, Archive idle conversations, Resolve GitHub issues, Sync Gmail emails" width="100%"></a>
      <br/><sub><b>Catalog</b> — ready-made automations, installable per organization</sub>
    </td>
  </tr>
</table>

## Connectors

Connect the systems your team already uses.
[Connectors docs →](https://tale.dev/docs/platform/connectors/overview)

<table>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/settings-mcp-endpoint.webp"><img src="services/docs/public/images/platform/settings-mcp-endpoint.webp" alt="The MCP endpoint settings page listing the deployment's MCP URL and the tools an MCP client can call, grouped into authoring, run and trigger management, and skills and knowledge" width="100%"></a>
      <br/><sub><b>MCP endpoint</b> — point any MCP client at the deployment to author and run automations</sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Governance

Approvals before actions ship — and the controls around them.
[Governance docs →](https://tale.dev/docs/platform/approvals/concepts)

<table>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/governance-guardrails.webp"><img src="services/docs/public/images/platform/governance-guardrails.webp" alt="The Guardrails governance page showing three status cards — content safety off, PII detection off, the moderation provider not configured — above the recent-events feed and the organization's custom instructions" width="100%"></a>
      <br/><sub><b>Guardrails</b> — content safety, PII detection, and a moderation provider, layered per message</sub>
    </td>
    <td width="50%">
      <a href="services/docs/public/images/platform/governance-security-monitoring.webp"><img src="services/docs/public/images/platform/governance-security-monitoring.webp" alt="The Security and Monitoring governance page showing login-attempt limit fields and the password-policy character-class requirements" width="100%"></a>
      <br/><sub><b>Security & monitoring</b> — login-attempt limits and password policy</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/governance-data-subject-requests.webp"><img src="services/docs/public/images/platform/governance-data-subject-requests.webp" alt="The Data subject requests governance page showing the cooling-off window, dual-approval toggle, and daily-limit fields above the erasure-requests table, which holds one pending request with 24 hours left before execution" width="100%"></a>
      <br/><sub><b>Data subject requests</b> — GDPR Art. 17 erasure with cooling-off and dual approval</sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Admin and settings

The operator's side: models, members, branding, SSO, and your documents as a network drive.
[Platform reference →](https://tale.dev/docs/platform)

<table>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/get-started/settings-organization-members.webp"><img src="services/docs/public/images/get-started/settings-organization-members.webp" alt="The Members settings page listing five people with their roles — an owner, an admin, an editor, and two members — beside an Add member button" width="100%"></a>
      <br/><sub><b>Members</b> — the organization's people and their roles</sub>
    </td>
    <td width="50%">
      <a href="services/docs/public/images/platform/settings-branding.webp"><img src="services/docs/public/images/platform/settings-branding.webp" alt="The Branding settings page with logo and favicon uploads, an accent colour field, and a live preview pane on the right" width="100%"></a>
      <br/><sub><b>Branding</b> — logo, favicon, accent color, live preview</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="services/docs/public/images/platform/settings-enterprise-sso.webp"><img src="services/docs/public/images/platform/settings-enterprise-sso.webp" alt="The Enterprise SSO settings page showing the Protocol dropdown set to Microsoft Entra ID, the display name field, and a sign-in section with redirect URL, issuer URL, client ID, and scopes" width="100%"></a>
      <br/><sub><b>Enterprise SSO</b> — Microsoft Entra ID or trusted headers</sub>
    </td>
    <td width="50%">
      <a href="services/docs/public/images/platform/settings-webdav.webp"><img src="services/docs/public/images/platform/settings-webdav.webp" alt="The WebDAV settings page showing the connection URL and username, and an app-passwords table listing two generated device passwords next to a Generate button" width="100%"></a>
      <br/><sub><b>WebDAV</b> — mount Tale documents as a network drive</sub>
    </td>
  </tr>
</table>

---

Want the guided version? Take the tour in the [docs](https://tale.dev/docs) — or head back to the
[README](README.md) to get Tale running in three commands.
