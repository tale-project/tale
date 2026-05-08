---
title: Word & Excel add-in
description: Route an AI panel inside Word and Excel through your Tale instance using Office Agents.
---

Microsoft Word and Excel have no built-in way to bring your own LLM endpoint — most Office AI add-ins are locked to their vendor's cloud. [Office Agents](https://github.com/hewliyang/office-agents) is an MIT-licensed add-in that exposes an AI chat panel inside Word, Excel, and PowerPoint, and accepts any OpenAI-compatible endpoint for the backing model. That makes it the best current fit for Tale: users edit their document, the panel calls a Tale agent, every request lands in your own execution logs.

Office Agents is explicitly **not production-ready** and is **not published to Microsoft AppSource** — installation is sideload-only via local development servers. Treat this as a power-user / pilot workflow today, not a one-click org-wide rollout. The section at the bottom covers the path to scaled deployment.

## What you will build

A sideloaded AI chat panel inside Word and Excel that routes every request through your Tale instance to an agent you control. The model, knowledge scope, tone, and audit trail all live in Tale — the add-in is just the editor-side UI.

## Prerequisites

- A Tale instance reachable on HTTPS, with Admin access.
- One [agent](/platform/agents/create) configured for the document-writing work you want — summarise, rewrite, extract, draft. Tuning this well is the difference between a useful add-in and a gimmick.
- Node.js + git on the workstation where Office Agents will run.
- Microsoft 365 desktop apps installed (Office.js sideloading needs the installed clients — web-based Office works, but with different sideload steps).

## Step 1 — Create a Tale API key

Navigate to **Settings > API Keys** and click **Create**. Name it after the workstation or team (`office-agents-lab`), copy the `tale_...` token, and keep it handy. See [Members and roles](/platform/admin/members-and-roles) — only Admins and Owners can create API keys.

## Step 2 — Clone and run Office Agents locally

Follow the project README at [github.com/hewliyang/office-agents](https://github.com/hewliyang/office-agents). The short version:

```bash
git clone https://github.com/hewliyang/office-agents.git
cd office-agents
# follow the README install + start commands
```

The repository is a monorepo with one package per Office host (Word, Excel, PowerPoint). Start the dev server for the host you need — Excel and Word have their own commands; the README is authoritative.

## Step 3 — Sideload into Word and Excel

Office Agents ships as a dev-server add-in you register with Microsoft's sideloading flow. Microsoft's current docs are at [Sideload an Office add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/test-debug-office-add-ins). The flow differs per OS:

- **Windows:** drop the manifest into `%LOCALAPPDATA%\Microsoft\Office\OfficeAddins`.
- **macOS:** place the manifest in `~/Library/Containers/com.microsoft.<Office-app>/Data/Documents/wef/`.
- **Office on the web:** upload the manifest from the **Home** ribbon's **Add-ins** menu.

After sideloading, open Word or Excel and look for the Office Agents button in the ribbon.

## Step 4 — Point the add-in at Tale

Open the Office Agents panel, then its **Settings** dialog, and set:

| Field      | Value                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| Provider   | **OpenAI-compatible** (or "Custom" — label varies)                                           |
| Base URL   | `https://<your-tale-instance>/api/v1`                                                        |
| API key    | The `tale_...` token from Step 1                                                             |
| Model      | An agent slug returned by `GET /api/v1/models` — see [API reference](/develop/api-reference) |
| CORS proxy | Enable if Tale is on a different origin from the sideloaded add-in                           |

Save the settings. The panel is now talking to Tale.

## Step 5 — Test end to end

- **Excel:** open a sheet with a short table, select a range, and in the panel type "Summarise this data in three bullets". The agent should respond using your Tale model.
- **Word:** open a document, select a paragraph, and type "Rewrite this for a non-technical audience". Same expected result.
- **Verify in Tale:** open the agent's conversation history and confirm the request appears as a new thread. The thread, the model used, and any tool calls are logged exactly as if the user had chatted from the Tale UI.

## Troubleshooting

- **401 Unauthorized** — API key was revoked or mistyped; regenerate in **Settings > API Keys**.
- **404 on `chat/completions`** — base URL is missing the `/api/v1` suffix.
- **Model not found** — slug is case-sensitive and must match `GET /api/v1/models` exactly.
- **CORS errors in the add-in console** — either enable the CORS proxy in Office Agents settings or add the add-in's origin to your Tale reverse proxy's allowed origins.
- **Sideload manifest rejected** — check the manifest XML against [Microsoft's schema](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests); the dev server in Office Agents prints validation errors on start.

## Org-wide rollout

Sideloading is fine for a pilot but does not scale. For a whole organisation, the durable path is:

1. Fork Office Agents internally and publish its manifest through [Microsoft 365 Centralized Deployment](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins) or Intune so every seat gets it automatically.
2. Ship an agent-level audit policy in Tale — all requests already land in the agent's conversation history, so governance is handled centrally.
3. Track upstream: once Office Agents reaches production status and publishes to AppSource, switch to the hosted manifest.

## Fully OSS alternatives

If Office Agents does not fit, two narrower add-ins follow the same base-URL + API-key pattern from Step 4:

- **Excel only** — [LLMExcel](https://github.com/liminityab/LLMExcel) (MIT).
- **Word only** — [gptlocalhost](https://gptlocalhost.com) / LocPilot.

Configuration is identical: point them at `https://<your-tale-instance>/api/v1` with a `tale_...` key and an agent slug as the model.
