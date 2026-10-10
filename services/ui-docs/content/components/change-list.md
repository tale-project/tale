---
title: Change list
description: Say what changed between two versions in words — a badge for each kind of change, the counts, each field's before and after, and the changed items in sections that open to their details.
---

`ChangeList` says what changed between two versions of something, item by item: which nodes of a workflow were added, removed, changed or renamed, and what changed in each. `ChangeSummary` gives the counts in a line, `FieldChangeRow` one field's value before and after, and `ChangeKindBadge` the kind of a change wherever it is shown. Your app works out what changed and words it; these components show it. Use them as the text view of a comparison beside a [code diff](/docs/components/code-diff) or a [workflow canvas](/docs/components/workflow-canvas#compare-two-graphs) that compares two graphs.

```tsx
import {
  ChangeKindBadge,
  ChangeList,
  ChangeSummary,
  FieldChangeRow,
  type ChangeItem,
  type ChangeSection,
} from '@tale/ui/change-list';
```

## List what changed

<Demo name="change-list/basic" />

Pass `sections` and an `aria-label`. Each section has a `title`, an optional `description` and its `items`; a section with no items is left out. Each item is one row:

| Field      | What it holds                                                            |
| ---------- | ------------------------------------------------------------------------ |
| `id`       | Stable across renders, so the focus and the open rows survive an update. |
| `kind`     | `added`, `removed`, `changed` or `renamed`: the row's badge.             |
| `title`    | What changed, such as a node's name.                                     |
| `subtitle` | A second line: what kind of item it is, such as "Language model".        |
| `summary`  | A few words on the row's trailing edge, such as "Model changed".         |
| `detail`   | What opening the row shows: its fields' changes.                         |
| `icon`     | The item's own glyph, beside its title.                                  |

A row with a `detail` opens with Enter, Space or a click, below itself, and closes the same way. The details fade in; their height is never animated, and under reduced motion they are there at once. `defaultExpanded` opens `none`, the `first` row or `all` of them at the start; pass `expanded` and `onExpandedChange` to hold the open rows yourself.

Pass `onActivate` and `activateLabel`, such as "Show on the graph", and an open row offers that action below its details. A row without details does the action when it is chosen, and a row with neither details nor an action is plain text, not a control. Pass the id of the item you show as `activeId`: its row is marked with `aria-current`, and the keyboard starts there next time.

## Move through the list with the keyboard

The list is one Tab stop, like the [issue list](/docs/components/issue-list):

| Key           | Does                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| ↓ / ↑         | Moves to the next or previous row, across sections                                         |
| Home / End    | Moves to the first or last row                                                             |
| Enter / Space | Opens or closes the row's details, or does its action                                      |
| Tab           | From an open row, reaches the controls in its details and its action, then leaves the list |

A ref on `ChangeList` gets `focus(id?)`, which focuses the row of `id`, or the current row. Use it to move the focus into the list when your page switches to it.

## Say how much changed

`ChangeSummary` gives the counts of a comparison, such as "1 added · 1 removed · 1 changed · 1 renamed · Inputs", each count with its kind's glyph and colour. A kind with no changes is left out. `flags` adds parts that changed without a count, in your words, such as "Inputs" or "Tests". The `inline` variant is one line of words; `chips` lists the same as small chips, for a bar above a comparison. Name it with `aria-label`, such as "Changes from v4 to v5". With nothing to count it says "No changes".

## Show a field's change

`FieldChangeRow` shows one field: its `label`, then what it was (`before`, on the red tint) and what it is (`after`, on the green tint). A screen reader hears "Before" and "After" before the values. An added field shows only its new value, a removed one only its old value.

- `layout="inline"`, the default, puts the label and "before → after" on one line, for short values such as a model name.
- `layout="stacked"` puts the label over a **Before** and an **After** line, for values too long to share a line.
- `note` adds a muted line under the change, such as "Also updated in the 1 node that reads it."

## Compare a field in full

<Demo name="change-list/with-diffs" />

A prompt, a script or a JSON value needs more than two values side by side. Put a comparison in the row's `detail` slot: a small [code diff](/docs/components/code-diff) with `toolbar={false}` and `context={2}` for text, or a [data diff](/docs/components/data-diff) for JSON. The row's label stays above it.

## Show a kind of change anywhere

`ChangeKindBadge` is the kind of a change as a small outlined badge: a plus for added, a minus for removed, a pen for changed and two arrows for renamed, each with its word. `size="sm"` is 20 px high, for a row as tall as a line of text, such as a box's title on the workflow canvas; `md` is 24 px. `CHANGE_KIND_ICON` and `CHANGE_KIND_TEXT` give your own surfaces the same glyphs and colours.

## Accessibility

The list is a group named by its `aria-label`. Each section is a region named by its heading. Each row is a button named by its badge's word, title, subtitle and summary, with `aria-expanded` when it opens and `aria-controls` once it is open. Colour is never the only signal: every badge and count has its glyph and its word, and every badge's colour keeps 4.5:1 on the card, the page and a row's hover fill in both themes. A value before and after is a `del` and an `ins`, never struck through.

## Props

| Prop                            | Type or default   | Purpose                                                  |
| ------------------------------- | ----------------- | -------------------------------------------------------- |
| `sections`                      | `ChangeSection[]` | The sections and their items, in the order to show them. |
| `aria-label`                    | `string`          | Names the list.                                          |
| `expanded` / `onExpandedChange` | —                 | The open rows, by item id, when you hold them.           |
| `defaultExpanded`               | `'none'`          | `'first'` or `'all'` rows open at the start.             |
| `onActivate` / `activateLabel`  | —                 | An open row's action, and a row without details.         |
| `activeId`                      | —                 | The row of the item you show.                            |
| `emptyMessage`                  | "No changes"      | What the list says with no changes.                      |
