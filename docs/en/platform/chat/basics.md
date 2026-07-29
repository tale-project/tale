---
title: Chat basics
description: What happens between hitting send and the reply landing — the composer's choices, what the model is given, how a reply streams, and how a chat is stored.
---

This page is the mental model for everything in the Chat tab. It names the parts of the screen, traces a message from key-press to streamed reply, says exactly what the model is handed along the way, and explains how a chat is stored once it lands. Read it once and the rest of the chat pages are variations on the same flow.

<Frame caption="The Chat tab with a streamed reply above the composer.">

![A chat thread showing a user question about onboarding feedback and an assistant reply containing a markdown table of three themes.](/images/platform/chat-thread-reply.webp)

</Frame>

## The composer

The composer is the input strip at the bottom of the screen. Three controls decide what comes back: the agent picker, the model picker beside it, and the message field with send. Attachments arrive by paste, drag-and-drop, or the attach control — [Attachments](/platform/chat/attachments) covers what is accepted and where uploads land.

Two of those three controls are choices you make deliberately, and neither of them has a default that thinks for you. The picker shows what will run; what the picker shows is what runs.

## Picking an agent

The agent picker filters by name as you type and lists the agents you have access to that are marked visible in chat. An agent carries a name, a description, instructions, a visibility setting, the tools and skills it may call, and the knowledge it may reach — [Agents in chat](/platform/chat/agents-in-chat) covers the picking rules in full.

Switching agents mid-chat keeps the conversation. The next message goes to the agent now named in the picker, and that agent reads everything that came before.

## Picking a model

You always name the model. There is no automatic routing, no complexity score deciding for you, and no chain that quietly swaps in a different model when the first one is slow — the reply in front of you came from the entry you selected, every time.

The picker sorts its entries into two groups:

- **Models** — models the platform calls directly through its own chat loop. This is the ordinary path: the platform assembles the context, streams the reply, and runs the tool calls.
- **Sandbox agents** — models that run inside a coding-agent harness in a sandbox instead of the platform's chat loop. The harness is a command-line agent with its own file tools and its own turn loop; the platform starts it, feeds it the prompt, and streams its output back into the chat.

A model from the first group can also be pushed into a sandbox: switch sandboxed execution on for the turn and the model runs under a harness rather than the direct loop. The harness defaults to the provider's own and can be overridden with another one.

<Note>

Some credentials force the choice. A vendor subscription credential only works inside that vendor's own command-line agent — an Anthropic subscription, for example, runs only under the `claude-code` harness — so sandboxed execution is switched on and locked for it, and asking for a different harness is refused with a reason rather than silently redirected.

</Note>

## What the model is given

The prompt is assembled in one fixed order, and the list is short by design: the organisation's mandatory instructions, the agent's instructions, the rules for handling untrusted content, one short line of documentation per available tool, then the current timestamp with the response-language directive, then the full message history — including tool messages, approval cards, and human-input cards, with attachments riding along as content parts.

Nothing else is added. There is no personalisation blob, no memories slipped in behind your back, no automatic knowledge retrieval, no automatic web context, and no branding or tuning text appended to your instructions. Everything the model learns beyond its instructions, it learns by calling something — which means it shows up in the transcript, attributable and refusable.

<Info>

When the conversation outgrows the model's context window, the oldest messages are dropped and a visible notice takes their place. They are not summarised: a summary is a second model call that can invent the history it was meant to preserve, and dropping messages is lossy in a way you can see.

</Info>

## What the model can call

Built-in tools, connector actions, skills, automations, and tools from connected MCP servers all live in one registry behind one dispatcher. The model searches that surface and invokes an entry by its id, so an org's own automations are as discoverable as the platform's built-in tools. Every call has its input validated before anything runs.

Knowledge retrieval is deliberately a separate call rather than another search result — finding a fact and finding a tool are different questions. An automation that can only be started by an event is listed with that fact attached, and invoking it is refused with a hint instead of being hidden from view.

## Reading the reply

The reply streams in as it is generated. When the model reasons before answering, a collapsible thinking line appears above the reply. Tool calls render as collapsed cards you can expand to read what ran and what came back; code the model executed sends its output to the Canvas on the right. When the model retrieves knowledge, citations attach to the sentences they support — hovering shows the source, clicking opens it. The agent's instructions never appear in the rendered reply; they sit one layer down, shaping behaviour rather than text.

## Questions from the agent

An agent with the human-input tool can pause mid-task and ask you something. A question card appears in the chat with the fields the agent needs, and generation waits until you answer. Fill the form and submit, or reply in free text instead if the form is the wrong shape for what you want to say. If your answer was wrong or incomplete, reopen the answered card — the form comes back prefilled, and resubmitting re-runs the agent with the corrected answer superseding the earlier one. The card keeps every previous answer, so you can flip through the versions the way edited messages work.

## Conversations versus chats

Within Chat, the unit is a **chat** — that is the word every button and toast uses. The data model behind it is called `threads` and the URL carries `threads/$threadId`; the docs follow the UI and say "chat" in body prose. The contact-channel inbox an installed email automation adds is a different surface: a conversation there is a contact thread, not a chat — see [Built-in automations](/platform/automations/builtin) for that sense of the word.

## History and search

The chat history sidebar lists every chat you can resume in this org, newest first; selecting one opens the full transcript. Searching there filters by title, and full-text search across message bodies is a per-chat operation rather than an org-wide one. Renaming a chat sets a custom title that overrides the generated one. Deleting a chat moves it into [Trash](/platform/admin/governance/trash), where retention sweeps it after the grace window.

## Where this fits

Chat basics is the page the rest of this section refines: [Agents in chat](/platform/chat/agents-in-chat) goes deeper on the picker and on switching mid-chat, [Attachments](/platform/chat/attachments) on what an upload becomes, [Voice mode](/platform/chat/voice-mode) on speaking instead of typing, and [Canvas pane](/platform/chat/canvas-pane) on where long output lands. If you came here to build an agent rather than use one, [Agent concepts](/platform/agents/concepts) is the next read — the shape of an agent is what every chat with one depends on.
