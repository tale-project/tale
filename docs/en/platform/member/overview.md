---
title: Getting started as a Member
description: Sign in, chat, browse the knowledge base, and read shared conversations and approvals — the day-one orientation for Members.
---

Welcome to Tale. As a **Member** you have read-only access to your organisation's workspace: you can chat with AI models and agents, browse the knowledge base, and read conversations and approvals shared with you. Editors and Developers in your org create the content; Members consume it.

If you also need to install or run a Tale instance yourself, see [Local quickstart](/self-hosted/install/quickstart) or [Production deployment](/self-hosted/install/linux-server).

## Sign in

There is nothing to install — Tale runs entirely in the browser. Your admin gets you in via one of three methods, depending on how your organisation is configured.

- **Email and password.** Your admin creates the account from **Settings → Members** with an initial password and shares it with you. You will be required to change it on first sign-in.
- **SSO (Microsoft Entra).** Sign in with your existing Microsoft account; your Tale account is provisioned automatically the first time.
- **Reverse proxy (trusted headers).** If Tale sits behind Authelia, Authentik, oauth2-proxy, or similar, the proxy authenticates you and your account is auto-provisioned on first request.

If you cannot sign in, ask your admin which method is enabled. (Admins: see [authentication](/self-hosted/admin/authentication) for the instance-wide configuration.)

## What you can do

### Chat

Start a conversation from the home screen. Pick a model, type a message, and reply. The chat input also supports:

- Attaching files (images, PDFs, docs) — see [attachments](/platform/chat/attachments).
- Mentioning an agent created by an Editor or Developer — see [agents in chat](/platform/chat/agents-in-chat).
- Comparing two models side-by-side in [Arena Mode](/platform/chat/arena-mode).

Full feature reference: [chat basics](/platform/chat/basics).

### Browse the knowledge base

The knowledge base holds documents your org has uploaded or crawled. Search it, open documents, and reference them from chat. As a Member you cannot upload or delete — that is an Editor task. See [knowledge base](/platform/workspace/knowledge-base).

### Read conversations and approvals

- **[Conversations](/platform/workspace/conversations)** — shared chat threads from teammates.
- **[Approvals](/platform/workspace/approvals)** — outputs from automations awaiting human review. Members can read; only Editors and above can decide.

## Personalise your account

Set your display name, language, theme, and notification preferences from the avatar menu. Details: [preferences](/platform/member/preferences).

## Where this fits

Members are the read-only consumers — the role designed for people who use the AI without curating it. To create agents, edit knowledge, or run automations, ask an Admin to upgrade your role to Editor or Developer. The full role matrix is on [Members and roles](/platform/admin/members-and-roles); the role-specific landing pages ([Editor](/platform/editor/overview), [Developer](/platform/developer/overview)) describe what each upgrade unlocks.
