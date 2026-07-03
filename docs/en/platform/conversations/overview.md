---
title: Conversations
description: Conversations is the unified inbox for everything that arrives from a customer channel — Slack messages, emails, web chats, SMS. Editors and Members work here; agents triage and reply; Admins watch the queue health.
---

Conversations is the unified inbox of Tale. Every customer-channel message that lands — a Slack DM, an inbound email, a web-chat session, an SMS — surfaces here as a conversation thread an agent can read, reply to, and route. Where the Chat tab is where an internal user talks to an agent, Conversations is where the outside world talks to the org and the agents in it. Editors and Members are the day-to-day operators of the inbox; Admins watch the queue.

This section covers what a conversation is, how routing and status work, how an agent triages and replies, and how the inbox connects to Approvals and the knowledge base. The overview names the pieces and points at the per-piece pages; the concept-level model lives one click in.

## What a conversation is

A conversation is the thread Tale builds around a single external participant on a single channel. It carries every message exchanged, every agent reply, every routing decision, every approval that fired during it, and every link to the knowledge base the agent cited. The conversation is the unit of audit and the unit of work — closing it ends the thread; reopening it picks up where it left off.

Conversations flow through three lifecycle states: **open** (active, waiting for someone to act), **snoozed** (parked until a reminder time), and **closed** (resolved). Each state filters the inbox view differently; the default filter is Open, which is what an operator wants to see when they sit down at the inbox.

## Channels that produce conversations

The channels that feed Conversations are the same channels listed under [Integrations](/platform/integrations/overview) in the Communication group: Slack, Microsoft Teams, Discord, Gmail, Outlook, IMAP/SMTP (any private mailbox), Twilio (SMS and WhatsApp). An installed channel integration routes incoming traffic into the inbox; the routing rules under **Settings > Conversations** decide which team or agent each incoming thread lands on.

The web-chat channel is built in and does not require an integration; it surfaces as an embeddable widget the org can drop into its own site.

## Routing, status, and assignment

Each conversation has an assignee (a team, an agent, or unassigned), a status (open, snoozed, closed), and an optional priority. Routing rules under **Settings > Conversations** decide the initial assignee based on the channel and the message content; the assignee can be reassigned at any time from the conversation view.

Agents in the assignee role automatically triage — they read the latest message, decide whether they can reply, and either reply directly or hand the conversation back to a human. The handoff is logged: the conversation history shows every agent decision alongside every human reply.

## Pages in this section

This section is short — the inbox is mechanically simple once the model is clear. The full conversations concept page and per-feature pages are the next layer down.

## Where this fits

Conversations is the sibling of Chat: same agent-and-model stack underneath, different audience above. The natural next read depends on the role — Members read [Chat](/platform/chat/overview) for the internal-conversation surface, Editors read [Approval concepts](/platform/approvals/concepts) for how the inbox interacts with human review, Admins read [Integrations (admin view)](/platform/admin/integrations) for the channel credentials that feed the queue.
