---
title: Environment variables & secrets
description: Your personal environment variables and secrets, injected into every sandbox you run in an organisation, and readable by nobody else.
---

Environment variables & secrets is your personal store of variables that Tale injects into every sandbox you run in this organisation. When a [sandbox agent](/platform/agents/external-agent) starts its container, each entry you have saved here is set in the environment before the agent runs, so a command the agent issues — or the agent itself — can read it. Reach for it when the work needs something of yours that nobody else should hold: a personal API token for a service the organization has not connected, an endpoint that differs for you, a key tied to your own account. It is a member-level page every role can open, and the entries are scoped to you and to the current organisation, so they never leak to teammates and never follow you into another org.

This page covers the two kinds of entry, how secrets are protected, the rules a name and value have to satisfy, and where the values end up.

<Frame caption="Settings > Environment — the saved entries, each with the Secret switch that decides whether its value can be read back.">

![The Environment settings page listing three saved entries — ANALYTICS_ORG and CRM_BASE_URL with their values in plain sight, and CRM_API_TOKEN masked as dots with its Secret box ticked — above an Add variable action.](/images/platform/settings-environment.webp)

</Frame>

## Variables and secrets

Open **Settings > Environment**. **Add variable** opens a dialog for a new entry, with the list of what you have saved below. Each entry is a **Name** and a **Value**, plus a **Secret** switch that decides how the value is stored and shown.

A plain variable is stored as-is and shown back in full in the list — use it for non-sensitive configuration the agent expects, a region name or an endpoint. A **secret** is encrypted the moment you save it and is write-only from then on: the list shows `••••••••` in place of the value, and there is no way to read it back. Turn the switch on for anything sensitive — an API key, an OAuth token, a password. The trade-off is that you cannot review a secret's value later, so if you are unsure it is right, delete it and add it again rather than hunting for a reveal button that does not exist.

Each row carries the name, the value or its mask, and when it was last updated. The trash icon asks for confirmation before it removes the entry, because deleting one takes it out of every sandbox of yours on the next run.

## Names, values, and limits

A **name** must start with a letter or underscore and contain only letters, numbers, and underscores — the shape of an ordinary environment variable, `MY_API_KEY` rather than `my-api.key`. Names are capped at 128 characters and values at 8,192, which is room for a long token or a multi-line key but not a file. You can keep up to 100 entries.

Tale trims spaces from the start and end of a value when you save it, because a stray newline from a copy-paste is the most common reason a token silently fails. It does not trim spaces or line breaks _inside_ the value, but it warns you when it finds them: a credential normally has none, so interior whitespace usually means a token wrapped across lines in your terminal when you pasted it. The warning does not block the save — a genuinely multi-line secret such as a PEM private key keeps its line breaks — so read it and decide.

## How the values reach the sandbox

A secret never travels in the clear except into your own sandbox. At rest it is encrypted in Tale's backend under a key the platform holds, and the list query returns only the mask, never the plaintext. When a turn starts, the platform decrypts your secrets and sets them, alongside your plain variables, in the environment of your sandbox for that run. Whenever a secret is injected for a turn, that access is recorded in the audit log.

That last step is the boundary worth understanding: the values land inside your sandbox container, so the isolation of the sandbox — not the secret store — is what stands between your credentials and anything else that runs there. This matches how the in-sandbox GitHub token works, and it is why these entries are scoped to you alone rather than shared with the org.

What does not come from here is the credential a turn uses to reach its model. That belongs to the organization's provider records under [Providers](/platform/admin/providers), where it can be rotated and audited in one place — an agent holds no keys of its own, and neither does this page on its behalf. Keep these entries for the things your own work needs and let the model credential stay where the organization can govern it.

## Where this fits

Environment variables & secrets is the one member-level page that reaches into the sandbox rather than the chat — it is how your own keys and configuration get to the work you run, without an Editor or Admin setting them for you. Read it alongside [Sandbox agents](/platform/agents/external-agent), which covers what else the container holds and what it is allowed to reach. For the rest of your personal settings — display name, password, custom instructions — see [Preferences](/platform/member/preferences).
