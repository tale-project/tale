---
title: Canvas
description: View, edit, and revise AI-generated artifacts — HTML, code, SVG, Mermaid diagrams, and Markdown — in a side pane that the AI can patch in place across turns.
---

Canvas is a side pane that opens next to the chat for viewing and editing AI-generated **artifacts**: runnable HTML, SVG illustrations, Mermaid diagrams, Markdown documents, or code snippets. Each artifact lives outside the message stream and has a stable identity across the whole conversation, so the AI can revise it incrementally instead of re-emitting the entire document on every fix. Picture a marketing brief the AI drafts and you tighten, a flowchart you ask the AI to extend, or a small HTML mockup that goes through three rounds of feedback — each ends with one artifact, not three messages.

The audience is anyone in chat. There's no role gate; whoever can chat can also open and edit the artifacts a conversation produces.

## How the artifact lifecycle works

When the AI decides to produce something runnable or revisable, it calls the `artifact_create` tool. The new artifact appears as a card in the **Artifacts** bar above the chat, auto-opens in the Canvas pane the first time it's created, and streams its content into the pane live as the AI types it. To revise the artifact, the AI calls `artifact_edit` against the same identity — small changes use `mode: 'patch'` (search-and-replace blocks); large rewrites use `mode: 'rewrite'`. Either way, Canvas re-renders in place, so you never scroll back to find the latest version.

While the AI is writing or patching, the card shows a spinner and the Canvas header reads **AI is writing…** or **AI is editing…**.

## Supported artifact types

Canvas renders five artifact shapes, each with its own preview and source-editor pair:

| Type         | Preview                                     | Edit                   | Notes                                      |
| ------------ | ------------------------------------------- | ---------------------- | ------------------------------------------ |
| **HTML**     | Live rendered preview in a sandboxed iframe | HTML source editor     | Scripts run in a sandboxed environment.    |
| **SVG**      | Rendered vector graphic                     | SVG source editor      | Uses the same renderer as HTML.            |
| **Mermaid**  | Rendered diagram                            | Mermaid DSL editor     | The Mermaid library loads on first use.    |
| **Markdown** | Formatted rich text                         | Markdown source editor | Renders with standard Markdown formatting. |
| **Code**     | Syntax-highlighted display (Shiki)          | Plain text editor      | Supports the common programming languages. |

## The Artifacts bar

A horizontal strip above the chat lists every artifact in the current thread. Each card shows the title, a type icon, and the current revision (`v3`, `v4`, …). Click a card to open it in Canvas. Cards stay visible across the conversation, so an artifact created twelve messages ago is one click away.

## Toolbar actions

The Canvas header carries the actions that apply to the open artifact. **Edit** switches the pane into the source editor; click **Preview** (the same toggle) to return to the rendered output. **Apply changes** commits your edits as a new revision — the button appears once you've made changes and the AI isn't currently writing. **Copy** copies the displayed content to the clipboard. **Download** saves the content as a file with the appropriate extension (`.html`, `.mmd`, `.svg`, `.md`, or the language extension for code). **Fullscreen** expands the pane to fill the viewport; **Esc** or the minimise icon returns it to the docked size. **Close canvas** closes the pane.

## Edit and apply changes

To edit the artifact by hand instead of asking the AI for the change, click the pencil icon — the settled content loads into a source editor. Make the changes, click the eye icon to preview, and click **Apply changes** to commit them as a new revision. Your edits are recorded as `editKind: 'user'` in the history, so the artifact's revision log shows who changed what.

The AI sees your edited version on the next turn and patches from there. This is the loop the Canvas pane is built around — a fast, in-place dialog between you and the AI on one persistent document.

## Resize and layout

Drag the left edge of the Canvas pane to resize it. The pane has a minimum width of 320 pixels and a maximum of 900 pixels, so the chat column never gets pushed off-screen.

## Where this fits

Canvas is the workshop pane for AI-generated artifacts. Chat is where you ask; Canvas is where the AI's structured output — an HTML mockup, a Mermaid diagram, a Markdown brief, a code snippet — takes its persistent form. Without Canvas, every revision would re-emit the full document into the chat stream; with Canvas, the artifact has a stable identity that the AI can patch in place across turns.

To trigger an artifact, ask the AI for something Canvas can render — a chart, a diagram, a small HTML page, a Markdown document. To revise an artifact yourself, open the source editor and click **Apply changes**; the AI picks up your edits on the next turn and patches from there.
