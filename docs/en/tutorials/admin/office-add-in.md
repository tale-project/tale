---
title: Word & Excel add-in
description: Route an AI panel inside Word and Excel through your Tale instance using Office Agents.
---

Microsoft Word and Excel have no built-in way to bring your own LLM endpoint, and most Office AI add-ins are locked to their vendor's cloud. [Office Agents](https://github.com/hewliyang/office-agents) is an MIT-licensed add-in that exposes an AI chat panel inside Word, Excel, and PowerPoint and accepts any OpenAI-compatible endpoint as the model backend. That makes it the best current fit for Tale: users edit their document, the panel calls a Tale agent, every request lands in your own execution logs.

The outcome at the end is a sideloaded panel in Word and Excel that talks to your Tale instance — the model, knowledge scope, tone, and audit trail all live in Tale; the add-in is just the editor-side UI. Office Agents is explicitly not production-grade and isn't published to AppSource, so this tutorial covers the pilot path; the closing section names the org-wide deployment route.

## Before you begin

You need Admin or Owner access in Tale (only those roles can create API keys), plus an agent already configured for document-writing work — summarise, rewrite, extract, draft. Tuning that agent well is the difference between a useful panel and a gimmick; [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end) covers the configuration.

On the workstation that will run Office Agents you need Node.js, `git`, and Microsoft 365 desktop apps installed. Office.js sideloading needs the installed clients — Office on the web works too but with different sideload mechanics. The reader of this page is the person doing the sideload, typically a power user or pilot lead.

## Step 1 — Create a Tale API key

Open **Settings > API keys** and click **Create**. Name the key after the workstation or pilot group (`office-agents-lab`), copy the `tale_...` token immediately — it's shown exactly once — and keep it ready for Step 4. Only Admins and Owners can create API keys; see [Members and roles](/platform/admin/members-and-roles).

The step worked when the API keys list shows the new entry with a last-used timestamp of "Never".

## Step 2 — Clone and run Office Agents locally

Office Agents ships as a dev-server add-in, not a packaged binary, so it runs from a local checkout. Follow the project README at [github.com/hewliyang/office-agents](https://github.com/hewliyang/office-agents) for the authoritative install steps; the short version:

```bash
git clone https://github.com/hewliyang/office-agents.git
cd office-agents
# follow the README install + start commands for the Office host you need
```

The repository is a monorepo with one package per Office host (Word, Excel, PowerPoint). Start the dev server for the host you're piloting first — both have their own commands in the README.

The step worked when the dev server prints a "ready" line and a localhost URL.

## Step 3 — Sideload the add-in into Word and Excel

Office Agents registers with Microsoft's add-in sideloading flow. The current docs are at [Sideload an Office add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/test-debug-office-add-ins); the file layout differs per OS:

- **Windows**: drop the manifest into `%LOCALAPPDATA%\Microsoft\Office\OfficeAddins`.
- **macOS**: place the manifest in `~/Library/Containers/com.microsoft.<Office-app>/Data/Documents/wef/`.
- **Office on the web**: upload the manifest from the **Home** ribbon's **Add-ins** menu.

Restart Word or Excel after the manifest is in place — the desktop apps scan the sideload directory on startup, not while they're open.

The step worked when the Office Agents button appears in the ribbon of the Office host you registered.

## Step 4 — Point the add-in at Tale

Open the Office Agents panel in Word or Excel, open its **Settings** dialog, and configure:

| Field      | Value                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| Provider   | **OpenAI-compatible** (label varies between releases — "Custom" works too)                |
| Base URL   | `https://<your-tale-instance>/api/v1`                                                     |
| API key    | The `tale_...` token from Step 1                                                          |
| Model      | A model ID returned by `GET /api/v1/models` — see [API reference](/develop/api-reference) |
| CORS proxy | Enable if Tale runs on a different origin than the sideloaded add-in                      |

Save. The panel is now talking to Tale.

The step worked when the Settings dialog closes without an error and the panel's "Test" or first request returns content.

## Step 5 — Test end to end

Run one request in each Office host to confirm both routing and rendering work:

- **Excel**: open a sheet with a short table, select a range, and ask "Summarise this data in three bullets". The agent should respond with the summary in the panel.
- **Word**: open a document, select a paragraph, and ask "Rewrite this for a non-technical audience". Same expected outcome.

Then open the agent's conversation history in Tale and confirm both requests appear as new threads. The thread, the model used, and any tool calls are logged exactly as if the user had chatted from the Tale UI.

The step worked when both Office requests produce a response and both threads appear under the agent's history.

## Trust boundary

What crosses the network in each direction:

- **From Word or Excel to Tale**: the selected text, the user's prompt, and any system instructions Office Agents adds. Office Agents reads the selected range — not the whole document — and sends only that.
- **From Tale to the model vendor**: the prompt the agent sends, the same way a chat-UI request would. To keep this hop in-network, pair this tutorial with [Connect a local provider](/tutorials/admin/connect-local-provider).
- **From the Office host to Microsoft**: telemetry already governed by your Microsoft 365 tenancy policy — Tale doesn't change this.
- **API key in transit**: the `tale_...` key sits in the Office Agents settings store on each workstation. Revoke the key (and rotate it on the workstation) the moment a laptop changes hands.

The Office host doesn't see the model's reasoning, tool calls, or knowledge-base lookups — that all stays inside Tale's execution log. The panel only ever sees the final completion.

## Troubleshooting

- **401 Unauthorized** — the API key was revoked or mistyped. Regenerate in **Settings > API keys** and re-paste into the Office Agents settings.
- **404 on `chat/completions`** — the base URL is missing the `/api/v1` suffix.
- **Model not found** — the model ID is case-sensitive and must match `GET /api/v1/models` exactly. Re-copy from the response, not from the **AI providers** UI label.
- **CORS errors in the add-in console** — either enable the CORS proxy in Office Agents' settings, or add the add-in's origin to your Tale reverse proxy's allow-list.
- **Sideload manifest rejected** — check the manifest XML against [Microsoft's schema](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests); the Office Agents dev server prints validation errors on start.

## Where this fits

The Office add-in tutorial routes Microsoft 365 traffic to a Tale agent without changing the user's editing workflow. The same OpenAI-compatible API surface the add-in uses is documented in full at [API reference](/develop/api-reference); the agent the add-in calls is built via [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end); the per-conversation audit trail lives in the chat history under [Conversations](/platform/workspace/conversations).

For an org-wide rollout beyond the pilot, the durable path is to fork Office Agents internally and publish its manifest through [Microsoft 365 Centralized Deployment](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins) or Intune so every seat gets the add-in automatically — sideloading is fine for a pilot but doesn't scale. Two narrower alternatives — Excel-only [LLMExcel](https://github.com/liminityab/LLMExcel) and Word-only [gptlocalhost](https://gptlocalhost.com) — follow the same base-URL + API-key pattern if Office Agents doesn't fit.
