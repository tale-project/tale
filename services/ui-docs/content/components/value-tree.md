---
title: Value tree
description: Show a JSON value a person can read and walk with the keyboard, with what a recorder left out as chips and highlights by JSON pointer.
---

`ValueTree` shows a value the way a person reads it: each key with its value, text, numbers and constants in the colours of the code palette, lists and objects that open, a page of children at a time, and long text cut to one line until asked for. Use it for what a step received and returned, a run's input and output, the parameters of an approval, or any JSON a reader needs to look into. `JsonViewer` draws its trees with it.

```tsx
import {
  ValueTree,
  formatValueInline,
  pathText,
  pointerOf,
  summarizeValue,
  summaryWords,
} from '@tale/ui/value-tree';
import { JsonViewer } from '@tale/ui/json-viewer';
```

## Read a value

<Demo name="value-tree/basic" />

Pass the `value` and an `aria-label`. The tree reads the value as JSON first: a missing key and `undefined` are the same, a date reads as its text. The top level shows; lists and objects below it stay closed. `defaultExpandDepth` opens more levels: `2` opens the containers of the top level, `Infinity` opens everything.

A list or an object shows its size in words, such as "a list of 3 items", and opens with its chevron, a click or the → key. A container with more than `pageSize` children (50) shows that many and a **Show 50 more** row. Text longer than `maxStringChars` (240) shows as one cut line with **Show all 400 characters**; → shows it whole and ← cuts it again.

Pass `onSelectPointer` to let the reader pick a place: a click or Enter calls it with the row's JSON pointer, and `selectedPointer` marks that row as selected. The tree opens and pages its way to the selected place, and scrolls it into view when the selection changes from outside. Without `onSelectPointer`, a click opens and closes a container.

Every row offers **Copy value** and **Copy path** on hover, and ⌘C or Ctrl+C copies the focused row's value, ⇧⌘C or Ctrl+Shift+C its path, such as `issues[0].title`. Text copies as the text itself, anything else as JSON. Set `copyable={false}` to leave both out. `density="compact"` makes 24px rows for an inspector; the default rows are 28px.

## Show what a recorder left out

<Demo name="value-tree/recorded" />

A run records values out of band: it cuts long text, drops list items past a limit, replaces values deeper than it keeps with `null`, and hides secrets, and it lists each place beside the value instead of writing a marker into it. Pass those lists as `elided` and `redacted` (a `RecordedValue`'s fields), and the tree shows each place as a chip, never as a value:

| `elided` kind | The row shows                                                      |
| ------------- | ------------------------------------------------------------------ |
| `string`      | The text that was kept, then "+3,412 characters not kept".         |
| `items`       | The list's size, then "+18 items not kept".                        |
| `depth`       | "Deeper levels not kept" in place of the `null` the recorder left. |
| `whole`       | "Too large to keep (52 KB)" in place of the value.                 |

A pointer in `redacted` shows **Hidden secret** in place of its value, with "Tale hides secrets in recorded values." on hover. A cut or a secret at the whole value's pointer (`''`) shows above the tree. A diff reads the same places as unknown rather than changed: pass them to [`DataDiff`](/docs/components/data-diff) as `unknownAt`.

## Highlight places

<Demo name="value-tree/marks" />

`marks` maps JSON pointers to a highlight: `added`, `removed`, `changed`, `type-changed`, `focus` or `missing`. Pass a kind, or `{ kind, before }` to say what a changed value was. A marked place opens up to its mark, paging far enough to show it.

| Mark           | The row                                         | Its name begins            |
| -------------- | ----------------------------------------------- | -------------------------- |
| `added`        | Green tint, a plus in the gutter                | "Added:"                   |
| `removed`      | Red tint, a minus, the key struck through       | "Removed:"                 |
| `changed`      | Blue tint, a dot                                | "Changed from 250:"        |
| `type-changed` | Amber tint, a two-way arrow                     | "Type changed from "bug":" |
| `focus`        | A ring                                          | —                          |
| `missing`      | A ghost row under its parent, "amount: missing" | —                          |

A mark never speaks by colour alone: the gutter glyph shows it and the row's name says it. Quiet text on a tinted row takes the full foreground colour, so it keeps 4.5:1 on every tint.

## Use the keyboard

The tree is one tab stop. Inside it:

| Key                | Does                                                             |
| ------------------ | ---------------------------------------------------------------- |
| ↑ / ↓              | Move to the previous or next row.                                |
| →                  | Open a container, then move into it; show long text whole.       |
| ←                  | Close a container, then move to its parent; cut long text again. |
| Home / End         | Move to the first or last row.                                   |
| `*`                | Open every closed container beside the focused one.              |
| Typing             | Move to the next key that starts with what was typed.            |
| Enter              | Select the row (`onSelectPointer`), or open and close it.        |
| ⌘C / Ctrl+C        | Copy the row's value.                                            |
| ⇧⌘C / Ctrl+Shift+C | Copy the row's path.                                             |

Text you select with the pointer inside the tree copies as text: the shortcuts step aside while a selection is there.

## Show large values

Paging keeps a large value quick: a list of 10,000 items draws its first 50 rows. When more than 500 rows are open at once, the tree draws only the rows in view (`virtualize="auto"`), scrolls itself and is 32rem tall unless you give it a height through `className`. Set `virtualize` to `true` or `false` to decide yourself. Focus stays on its row while the rows around it come and go.

## Word values in sentences

The module's helpers say a value the way a sentence names it, in the reader's language. Each takes the `t` of the `valueTree` namespace (`useT('valueTree')`) and the reader's `locale`.

| Helper                         | Answers                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `summarizeValue(t, value)`     | "a list of 12 items", "an object with 3 fields", "“Fix login”", "a text of 3,412 characters", "empty".                                          |
| `formatValueInline(t, value)`  | The same, with text cut to `maxChars` and an ellipsis instead of counted.                                                                       |
| `summaryWords(t, summary)`     | A recorded summary (`summaryOf` in the [data core](/docs/components/data-core)) in the same words, with "a hidden secret" and "52 KB not kept". |
| `formatNumberExact(n, locale)` | A number as JavaScript writes it, in the locale's separators, never rounded: `3,14159` in German.                                               |
| `pathText(path)`               | `issues[0].title`, the way an expression reads a path.                                                                                          |
| `pointerOf(path)`              | `/issues/0/title`, the RFC 6901 pointer `marks`, `elided` and `redacted` use.                                                                   |

Numbers group from five digits, so a year stays `2026` and a count reads `12,000`.

## Show JSON with JsonViewer

<Demo name="value-tree/json-viewer" />

`JsonViewer` is the drop-in viewer for a JSON value: it reads JSON text first, draws an object or a list as a value tree, and writes a plain value (`null`, a string, a number) as its JSON text. `collapsed={false}` (the default) opens everything, `true` shows the top level, and a number opens that many levels. `enableClipboard` adds a **Copy** button for the whole value as JSON, indented by `indentWidth` spaces, and the copy actions on every row. The viewer is at most 24rem tall and scrolls inside.

## Accessibility

The tree follows the WAI-ARIA tree pattern: `role="tree"` with your `aria-label`, and one `treeitem` per row with its level, its place among its siblings and their number, `aria-expanded` on containers and `aria-selected` when a row can be selected. A row's name is its key and its value in words, such as "amount, 250" or "labels, a list of 3 items", with its mark first. The keys are described once on the tree ("Arrow keys move and open. Type a field name to jump to it."), and a copy is announced as "Copied" in a polite status region. The copy and **Show all** buttons on a row are pointer shortcuts for keys the tree already has, so they stay out of the tab order and the accessibility tree. Values use the code palette, which keeps 4.5:1 on the page, a card and the elevated surface in both themes.

## Props

| Prop                                  | Type or default                                   | Purpose                                              |
| ------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| `value`                               | `unknown`                                         | The value to show.                                   |
| `aria-label`                          | `string`                                          | Names the tree.                                      |
| `elided`                              | `ValueElision[]`                                  | Places a recorder cut: `{ pointer, kind, dropped }`. |
| `redacted`                            | `string[]`                                        | Pointers of hidden secrets.                          |
| `marks`                               | `ReadonlyMap<string, ValueMarkKind \| ValueMark>` | Highlights by pointer.                               |
| `defaultExpandDepth`                  | `1`                                               | Levels open at first.                                |
| `maxStringChars`                      | `240`                                             | Longer text shows one cut line.                      |
| `pageSize`                            | `50`                                              | Children per page.                                   |
| `selectedPointer` / `onSelectPointer` | —                                                 | The selected place and the reader's choice.          |
| `copyable`                            | `true`                                            | Row copy actions and shortcuts.                      |
| `density`                             | `'comfortable'`                                   | `'compact'` for 24px rows.                           |
| `virtualize`                          | `'auto'`                                          | Draw only the rows in view above 500 rows.           |
| `className`                           | —                                                 | On the outer element; set a height here.             |
