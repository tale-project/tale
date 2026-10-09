---
title: Code diff
description: Compare two versions of a text line by line, with the changed words marked, folds for what stayed the same, a keyboard path from change to change and the patch to copy.
---

`CodeDiff` compares two versions of a text: a document's YAML, a prompt, a script. Each changed line carries a sign and a tint, and the words that changed inside it a stronger tint. The unchanged stretches between changes fold away, and the reader steps from change to change and copies the patch. Use it for a version against the one before it, or wherever a reader asks "what exactly changed in this text". To compare two JSON values field by field, use [Data diff](/docs/components/data-diff); to list what changed in words, use [Change list](/docs/components/change-list).

```tsx
import {
  CodeDiff,
  preloadCodeDiff,
  type CodeDiffHandle,
} from '@tale/ui/code-diff';
import { computeLineDiff, toUnifiedPatch } from '@tale/ui/code-diff/compute';
```

## Show what changed in a document

<Demo name="code-diff/yaml" />

Pass `before`, `after`, their `language`, the names of the two sides (`beforeLabel` and `afterLabel`, such as "v4" and "v5") and an `aria-label`. `language` takes the code editor's languages: `yaml`, `json`, `javascript`, `expression`, `markdown`, `template` and `text`. Set `templates` when the text may hold `{{ … }}` expressions, as an automation's YAML does, so they are highlighted as code.

A removed line has a minus and the red tint, and the line added in its place a plus and the green tint, right below it. Where the two share words, the words that differ get a stronger tint: in the demo, "and label" in the description and "sonnet" in the model. A line with nothing in common with the one it replaced, such as a new line of a prompt, is tinted whole. Each line shows its number in each version that has it, so a removed line has only its old number; `lineNumbers={false}` leaves the numbers out.

Each change keeps three unchanged lines above and below it (`context`). The lines between two changes fold into one row, **Show 15 unchanged lines**, which opens them in place; a fold never hides a single line. Each change starts with a header that says where it is, such as "Lines 21–33 in v5", or in the older version for a change that only removes lines.

Each whole text is highlighted once, in the same colours as the code editor, so a line inside a YAML block reads as part of its block. The lines show as plain text until the highlighter is ready, and a text longer than 64,000 characters stays plain.

## Move from change to change

The toolbar above the diff says how many changes there are, or which one the reader is at, such as "Change 1 of 2". **Next change** and **Previous change** move to the following or previous change, and so do `]` and `[` while the focus is anywhere in the diff. The diff focuses the change's header, scrolls it to the middle of the view and says "Change 2 of 5" to a screen reader. Past the last change it stays there.

A ref on `CodeDiff` gets the same moves for your own controls: `nextChange()`, `previousChange()` and `focusChange(index)`, counting from 0. Use them to start a reader at the first change when your page opens on the diff. `toolbar={false}` leaves out the toolbar, for a small diff inside another component; the keys still work.

Pass `maxHeight`, such as `"24rem"`, to scroll the diff inside a region of that height instead of the page. The region takes the focus so the keyboard can scroll it.

## Set the texts side by side

<Demo name="code-diff/split" />

`layout="split"` puts the older text on the left and the newer one on the right, each removed line facing the line added in its place. Where one side has no line, the other faces a hatched cell. Side by side needs room for two columns of code: it shows from a 64rem wide container, and a narrower one shows the unified layout. This page's column is narrower, so the demo sets the diff in a wider stage that scrolls sideways.

The toolbar offers **Unified** and **Side by side** whenever there is room for both. Without `onLayoutChange` the diff keeps the reader's choice itself and `layout` is only where it starts; with it, `layout` is yours to keep, such as in the page's address.

## When nothing changed

<Demo name="code-diff/identical" />

Two equal texts show "No differences". Replace the words with `emptyMessage`, for example to say what did change instead, such as only a version's note.

## Copy the patch

**Copy patch** copies the unified patch from one version to the other: `--- v4` and `+++ v5` as file names, then each change with the diff's `context`, in the format `git apply` and `patch` read. The diff then says "Copied". The patch is the one `toUnifiedPatch` writes, the function the automation engine also writes its patches with for MCP and REST, so the same two texts and context give the same bytes. `toUnifiedPatch` stops at 256 KiB unless told otherwise; **Copy patch** copies the whole patch, however long.

## Keep large diffs fast

The diff's code is loaded when one is first shown: until then, placeholder rows as tall as its lines pulse in its place. Call `preloadCodeDiff()` when a reader is about to open one, such as on hover over a version, to have it ready. If the code cannot be loaded, the diff says "The comparison didn't load." with **Try again**.

A diff with more than 5,000 changed lines shows the first 2,000 and a row, **Show the remaining 4,214 changes**, that shows the rest; the next and previous change reach them too. Lines longer than 500 characters are compared as whole lines rather than word by word. Two texts more than 10,000 changed lines apart read as one text removed and one added, so a complete rewrite never freezes the page.

## Compare without the component

`@tale/ui/code-diff/compute` is the diff alone: plain functions with no React and no DOM, safe to run on a server.

- `computeLineDiff(before, after, options)` answers every line of both texts in reading order with its numbers, the changed words of each pair of lines, the changes with their context (`hunks`) and the counts of added and removed lines. Options: `context` (3), `words` (true) and `maxEditLength` (10,000).
- `toUnifiedPatch(before, after, { from, to, context, maxBytes })` answers `{ patch, truncated }`. Two equal texts have no patch (`''`). A patch longer than `maxBytes` (262,144 by default, measured in UTF-8) stops at the last whole line that fits and says `truncated: true`; such a patch shows what changed but no longer applies. Pass `Infinity` for the whole patch.

## Accessibility

The diff is a table named by its `aria-label`, with column headers for a screen reader: "Line in v4", "Line in v5", "Change" and "Text", for each side when side by side. Each changed line says "Added" or "Removed" in words beside its sign, and the changed words are `ins` and `del` elements, never underlined or struck through. A fold is a button that says how many lines it hides or shows, with `aria-expanded`. The current change is announced politely, once per move, and so is a copied patch.

Every code colour keeps 4.5:1 on both tints in both themes. Opened lines fade in and a move to another change scrolls smoothly; under reduced motion both happen at once. In a forced-colours theme, such as Windows contrast themes, the tints drop and a 2 px edge in the text colour marks each changed line beside its sign.

## Props

| Prop                         | Type or default  | Purpose                                                                   |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `before` / `after`           | `string`         | The two texts.                                                            |
| `language`                   | `CodeLanguage`   | What the texts hold, highlighted as the code editor does.                 |
| `templates`                  | `false`          | Highlights `{{ … }}` expressions.                                         |
| `beforeLabel` / `afterLabel` | `string`         | The two sides' names, in headers, columns and the patch.                  |
| `aria-label`                 | `string`         | Names the diff.                                                           |
| `layout` / `onLayoutChange`  | `'unified'`      | `'split'` from a 64rem container; with the callback, you keep the choice. |
| `context`                    | `3`              | Unchanged lines kept round each change.                                   |
| `wordDiff`                   | `true`           | Marks the words that changed in a changed line.                           |
| `lineNumbers`                | `true`           | Shows each line's numbers.                                                |
| `toolbar`                    | `true`           | The change counter, the moves, the layout switch and **Copy patch**.      |
| `maxHeight`                  | —                | Scrolls the diff inside a region of this height.                          |
| `emptyMessage`               | "No differences" | What equal texts say.                                                     |
