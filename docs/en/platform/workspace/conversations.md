---
title: Conversations
description: Manage customer conversations from a unified inbox.
---

Conversations is the customer inbox. When customers contact your team through a connected channel such as email, their messages appear here as conversation threads. Your team can read, reply, close, and manage them from this one view.

Channel connections are set up once by a Developer in [Integrations overview](/platform/integrations/overview) — the email integration powers this inbox.

## Conversation statuses

| Status   | Meaning                                                            |
| -------- | ------------------------------------------------------------------ |
| Open     | Active conversation that needs a response or is in progress        |
| Closed   | Conversation that has been resolved and marked as done             |
| Spam     | Messages flagged as unsolicited or irrelevant                      |
| Archived | Conversations kept for reference but removed from the active inbox |

## Replying to a conversation

1. Click any conversation in the list to open it in the right panel.
2. The message composer loads at the bottom. It is a rich-text editor that supports bold, italic, lists, links, and code blocks.
3. Write your reply. You can attach files using the paperclip icon in the toolbar.
4. Use the AI Improve button, if enabled, to have the AI clean up your message before sending.
5. Click Send. The message is sent through whichever channel the customer used.

## Bulk actions

Select multiple conversations using the checkbox at the top of the list. Available bulk actions:

- Change status: close, reopen, archive, or mark as spam
- Send a message to all selected conversation participants at once

## Filtering

Use the filter dropdown in the toolbar to show read or unread conversations. This helps surface threads that still need attention without scrolling through the full inbox.

## Where this fits

Conversations is Tale's shared inbox for customer-facing channels — email, chat, and voice. It exists because customer reply work doesn't fit inside the AI chat: replies need a human in the loop, a single thread per customer across channels, and a record reviewers can audit. The agent that handles the AI side is the same agent the rest of the workspace uses; what changes is the surface.

For the agent-side configuration that decides which conversations get auto-drafted replies, see [Agent concepts](/platform/agents/concepts) and [Create an agent](/platform/agents/create). For approvals that fall out of customer threads (a draft reply waiting for review, an integration call waiting for a green light), [Approvals](/platform/workspace/approvals) is the surface.
