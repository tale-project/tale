---
title: Member
description: The read-only consumer seat — sign in, chat with AI and agents, browse the knowledge base, read shared conversations and approvals. The Member's day-one orientation.
---

A **Member** in Tale is the read-only consumer seat. You sign in, chat with AI models and agents your team has set up, browse the knowledge base your Editors curate, and read the conversations and approvals shared with you. You do not upload documents, create agents, or change any setting that affects other people — those surfaces are gated to Editors, Developers, and Admins. This page is for people stepping into Tale for the first time and for anyone who only ever needs the consumer side of the product.

There is nothing to install — Tale runs entirely in the browser. If you also need to install or operate a Tale instance yourself, [Local quickstart](/self-hosted/install/quickstart) and [Production deployment](/self-hosted/install/linux-server) cover that, and the rest of the self-hosted tab covers running the platform.

## A Member's day

A typical day starts on the home screen with a fresh chat. You ask the model a question the team has documented; the agent picks up the relevant document automatically and answers with the citation linked back to the original. Later, an Editor drops a new product PDF into the knowledge base; your next question about that product threads the new information into the answer without you doing anything. If a teammate shares a conversation, it shows up under **Conversations**; if a workflow is waiting on a human decision your role is allowed to see, it surfaces under **Approvals** (read-only — the verdict belongs to an Editor).

## Sign in

Your Admin gets you in via one of three methods, depending on how your organisation is configured.

- **Email and password.** Your Admin creates the account from **Settings > Members** with an initial password and shares it with you. You are required to change it on first sign-in.
- **SSO (Microsoft Entra ID).** You sign in with your existing Microsoft account; your Tale account is provisioned automatically the first time.
- **Reverse proxy (trusted headers).** When Tale sits behind Authelia, Authentik, oauth2-proxy, or similar, the proxy authenticates you and your account is auto-provisioned on first request.

If you cannot sign in, ask your Admin which method is enabled. Admins: see [Authentication](/self-hosted/admin/authentication) for the instance-wide configuration.

## What you can do

### Chat

Start a conversation from the home screen. Pick a model from the selector, type a message, and send. The input also accepts:

- File attachments — images, PDFs, audio, video. See [Chat attachments](/platform/chat/attachments) for the full list and the per-type processing.
- An `@`-mention of an agent your Editor or Developer has published. See [Agents in chat](/platform/chat/agents-in-chat).
- Two-model side-by-side in [Arena Mode](/platform/chat/arena-mode) when the question is "which model answers this better?".

Full reference: [Chat basics](/platform/chat/basics).

### Browse the knowledge base

The knowledge base holds the documents your organisation has uploaded or crawled. You can search it, open documents, and reference them from chat. As a Member you cannot upload or delete — that is an Editor task. See [Knowledge base](/platform/workspace/knowledge-base).

### Read conversations and approvals

- **[Conversations](/platform/workspace/conversations)** — customer threads shared with you. Read-only at the Member role; Editors and above can reply.
- **[Approvals](/platform/workspace/approvals)** — outputs from automations awaiting a human verdict. You can read; Editors and above decide.

## Personalise your account

Set your display name, language, theme, and notification preferences from the avatar menu. The details are on [Your preferences](/platform/member/preferences).

## Where this fits

Members are the read-only consumers — the seat designed for people who use the AI without curating it. To create agents, edit knowledge, or run automations, ask an Admin to upgrade your role to Editor or Developer. The canonical role matrix is at [Members and roles](/platform/admin/members-and-roles); the role-specific landings ([Editor](/platform/editor/overview), [Developer](/platform/developer/overview)) describe what each upgrade unlocks.
