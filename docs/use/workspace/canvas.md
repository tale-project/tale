---
title: Canvas
description: View, edit, and export AI-generated code, HTML, diagrams, and markdown in a dedicated pane.
---

Canvas is a side pane that opens next to the chat, giving you a focused workspace for viewing and editing AI-generated content. Instead of scrolling through code blocks in the conversation, you can open them in Canvas for syntax highlighting, live preview, editing, and export.

## Opening canvas

When the AI generates a code block, HTML snippet, Mermaid diagram, or markdown block, an **Open in Canvas** button appears on the block. Click it to open the content in the Canvas pane on the right side of the chat.

## Supported content types

| Type         | Preview                                     | Edit                   | Notes                                       |
| ------------ | ------------------------------------------- | ---------------------- | ------------------------------------------- |
| **Code**     | Syntax-highlighted display (Shiki)          | Plain text editor      | Supports all common programming languages   |
| **HTML**     | Live rendered preview in a sandboxed iframe | HTML source editor     | Scripts run in a sandboxed environment      |
| **SVG**      | Rendered vector graphic                     | SVG source editor      | Uses the same renderer as HTML              |
| **Mermaid**  | Rendered diagram                            | Mermaid DSL editor     | Lazy-loads the Mermaid library on first use |
| **Markdown** | Formatted rich text                         | Markdown source editor | Renders with standard markdown formatting   |

## Toolbar actions

The Canvas header includes:

- **Edit / Preview toggle** — switch between editing the source and viewing the rendered output.
- **Apply** — save your edits back to the original message in the chat. Only appears when you have made changes.
- **Copy** — copy the content to your clipboard.
- **Download** — download the content as a file with the appropriate extension (`.html`, `.mmd`, `.svg`, `.md`, or the original code file extension).
- **Close** — close the Canvas pane.

## Editing and applying changes

1. Click the **pencil** icon to enter edit mode.
2. Make your changes in the text editor.
3. Click the **eye** icon to preview the result.
4. Click **Apply** to write the changes back to the source message in the conversation.

The Apply button only appears when the content differs from the original. A confirmation toast shows when changes are applied successfully.

## Resizing

Drag the left edge of the Canvas pane to resize it. The pane has a minimum width of 320 pixels and a maximum of 900 pixels.
