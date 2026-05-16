---
title: Chat effectively
description: Combine agents, attachments, dictation, and Canvas into a daily Tale workflow.
---

Most Members use Tale chat the same way every day: pick the right agent, drop in context, ask, iterate. This tutorial walks that loop end to end so your answers are grounded in your organisation's knowledge instead of generic model output. Feature reference for each step lives at [Chat](/platform/chat/basics); this page stitches the pieces into one repeatable workflow.

The whole flow takes under five minutes once you've done it once. The outcome at the end is a conversation that produces answers you'd trust to forward.

## Before you begin

You need Member access or higher in the Tale instance you're signed in to — every signed-in account except `Disabled` can use chat. At least one agent has to exist in the org; the general chat agent ships by default, so this prerequisite is met on every instance. No external setup, no API key, no admin permission required.

## Step 1 — Pick the right agent

A purpose-built agent searches a narrower slice of the knowledge base and follows a tighter system prompt, which almost always produces a sharper answer than the general chat agent. Open **Chat** from the sidebar and click the agent selector at the bottom-left of the composer; the dropdown lists every agent your role can see.

Pick the one whose description matches your task closest — a `product-support` agent for a customer question, a `legal-review` agent for a contract clause, the default chat agent for everything else. If you're not sure, start with the closest match and switch mid-conversation: the new agent keeps the message history.

You'll know the step worked when the agent's display name shows above the composer and the placeholder text reflects its conversation starters.

## Step 2 — Give it context via attachments

Attachments let the agent read the exact file you're asking about, instead of guessing from what it remembers. Drop a file or image onto the chat window, or click the paperclip icon in the composer. Supported types — PDFs, Office documents, images, audio, video, and most code files — are listed in [Attachments](/platform/chat/attachments); files outside the list are rejected before upload.

Attachments stay scoped to the conversation, not the shared knowledge base. If the file is something everyone should be able to ask about later, upload it through the [Knowledge base](/platform/workspace/knowledge-base) instead — that way it's indexed once and reused by every agent.

The step worked when the file appears as a chip under the composer with its name and size, and the agent's first response cites or quotes content from it.

## Step 3 — Dictate when speaking is faster than typing

The microphone icon in the composer turns on browser dictation; the audio is processed locally by the Web Speech API and the transcript streams into the input as you speak. Audio bytes don't reach Tale's servers — the only thing that leaves your device is the recognised text.

Toggle the microphone on, speak the question, toggle it off, and edit the transcript before sending. Dictation is a per-request tool, not a mode: there's no preference to set, and it leaves no trace once the message is sent.

The step worked when the transcript appears in the input while you speak.

## Step 4 — Iterate on the answer

The first answer is rarely the final one. Short follow-ups are the fastest way to narrow: `summarise in three bullets`, `now in French`, `cite the document you used`, `rewrite for a non-technical reader`. The agent keeps the whole thread in context, so each follow-up benefits from the previous turn — no need to repeat what you've already said.

When you land on a result worth reusing, save the prompt to the [Prompt library](/platform/workspace/prompt-library). Next time, the same starting point is one click away from the composer.

The step worked when the agent's next response visibly responds to the constraint you added in the follow-up.

## Step 5 — See artifacts in Canvas when it's more than text

A long markdown document, a runnable HTML page, an SVG, or a Mermaid diagram is hard to read inside a chat bubble. When the agent produces one, Tale auto-opens it as an artifact in the [Canvas](/platform/workspace/canvas) side pane and lists it in the Artifacts bar above the chat — live preview, source view, and export are all in the Canvas pane.

Ask the agent to revise the artifact in place (`make the diagram horizontal`, `add a second column`) and Canvas updates without producing a new chat bubble.

The step worked when the Canvas pane opens on the right with the artifact rendered, and the chat bubble shows a short summary instead of the full content.

## Troubleshooting

- **The agent answers from the wrong knowledge** — the agent has access to too broad a folder set. Switch to a narrower agent, or ask the agent's owner to scope its **Knowledge** tab. The full mapping lives in [Agent concepts — Knowledge](/platform/agents/concepts#knowledge).
- **The attachment was uploaded but the agent ignores it** — the file is bigger than the model's context budget, or its type isn't in the supported set. Try a smaller file or convert to PDF; [Attachments](/platform/chat/attachments) lists the supported types and limits.
- **The microphone icon doesn't appear** — the browser doesn't support the Web Speech API (older Firefox builds, some embedded WebViews) or the site doesn't have microphone permission. Switch to Chrome, Edge, or Safari, and grant permission when prompted.
- **The Canvas pane doesn't open** — the agent's output isn't long enough or doesn't match any artifact format. Ask explicitly for an HTML, Mermaid, or markdown artifact in the prompt.

## Where this gets used

The same five-step loop covers most of the day-to-day chat work a Member does: agent, context, ask, iterate, pull artifacts out of the bubble when they belong somewhere bigger. The shortcuts that make it feel fast — drag-drop attachments, dictation, agent switcher, Prompt library — all live in the composer; muscle memory turns the loop into something close to a search bar over your org's knowledge.

When you find yourself wanting a tighter-fit agent than what's available, [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end) walks through creating one — that requires the Editor role. For the keyboard shortcuts that compress this loop further, [Chat basics — Keyboard shortcuts](/platform/chat/basics#keyboard-shortcuts) carries the full list.
