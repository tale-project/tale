---
title: Canvas
description: View, edit, and revise AI-generated artifacts — HTML, code, SVG, Mermaid diagrams, and markdown — in a dedicated pane that the AI can patch in place.
---

Canvas is a side pane that opens next to the chat for viewing and editing AI-generated **artifacts** — runnable HTML, SVG illustrations, Mermaid diagrams, markdown documents, or code snippets. Each artifact lives outside the message stream and has a stable identity across the whole conversation, so the AI can revise it incrementally instead of re-emitting the whole document on every fix.

## Artifact lifecycle

When the AI decides to produce something runnable or revisable, it calls the `artifact_create` tool. The new artifact:

- Appears as a card in the **Artifacts bar** above the chat.
- Auto-opens in the Canvas pane the first time it's created.
- Streams its content into the iframe live as the AI types it.

To revise it, the AI calls `artifact_edit` against the same artifact. Small changes use `mode: 'patch'` (search-and-replace blocks); large rewrites use `mode: 'rewrite'`. Either way, the Canvas pane re-renders in place — no scrolling back to find the latest version.

## Supported artifact types

| Type         | Preview                                     | Edit                   | Notes                                       |
| ------------ | ------------------------------------------- | ---------------------- | ------------------------------------------- |
| **HTML**     | Live rendered preview in a sandboxed iframe | HTML source editor     | Scripts run in a sandboxed environment      |
| **SVG**      | Rendered vector graphic                     | SVG source editor      | Uses the same renderer as HTML              |
| **Mermaid**  | Rendered diagram                            | Mermaid DSL editor     | Lazy-loads the Mermaid library on first use |
| **Markdown** | Formatted rich text                         | Markdown source editor | Renders with standard markdown formatting   |
| **Code**     | Syntax-highlighted display (Shiki)          | Plain text editor      | Supports all common programming languages   |

## Artifacts bar

A horizontal strip above the chat lists every artifact in the current thread. Each card shows the title, type icon, and current revision (`v3`, `v4`, …). Click a card to open it in Canvas.

While the AI is writing or patching an artifact, the card shows a spinner and the Canvas header reads **AI is writing…** or **AI is editing…**.

## Toolbar actions

The Canvas header includes:

- **Edit / Preview toggle** — switch between editing the source and viewing the rendered output.
- **Apply** — save your edits as a new revision. Only appears when you have made changes and the AI is not currently writing.
- **Copy** — copy the displayed content to your clipboard.
- **Download** — download the content as a file with the appropriate extension (`.html`, `.mmd`, `.svg`, `.md`, or the language extension for code).
- **Fullscreen** — expand the pane to fill the viewport. Press `Esc` or click the minimise icon to exit.
- **Close** — close the Canvas pane.

## Editing and applying changes

1. Click the **pencil** icon to enter edit mode. The current settled content is loaded into a text editor.
2. Make your changes.
3. Click the **eye** icon to preview the result.
4. Click **Apply** to commit the changes as a new revision. The AI sees your edited version on the next turn and can patch it from there.

User edits are recorded as a new revision (`editKind: 'user'`) so the artifact's history shows who changed what.

## Resizing

Drag the left edge of the Canvas pane to resize it. The pane has a minimum width of 320 pixels and a maximum of 900 pixels.

## Where this fits

Canvas is the workshop pane for AI-generated artifacts. Chat is where you ask; Canvas is where the AI's structured output (an HTML mock-up, a Mermaid diagram, a code snippet) takes its persistent form. Without Canvas, every revision would re-emit the full document into the chat stream; with Canvas, the artifact has a stable identity that the AI can patch in place across turns.

To trigger an artifact, ask the AI for something Canvas can render — a chart, a diagram, a small HTML page, a Markdown brief. To revise an artifact yourself, open the source editor and click **Apply**; the AI sees the edited version on the next turn and can patch from there.
