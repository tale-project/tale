---
title: Data diff
description: Say what changed between two values in sentences, or set them side by side with every change marked, and compare their shapes.
---

`DataDiff` says what changed between two values in words a person reads: one sentence per change, in the order the value is written, the counts on top, the fields that did not change folded into one row. Side by side, it shows both values as [value trees](/docs/components/value-tree) with every change marked. Use it for what a step received against what it returned, one pass of a loop against the next, or one run against another. `DataDiffSummary` is the counts line on its own; the comparison itself is the [data core](/docs/components/data-core)'s `diffValues`, which the module exports again.

```tsx
import {
  DataDiff,
  DataDiffSummary,
  diffShapes,
  diffValues,
  suggestDiffRoot,
} from '@tale/ui/data-diff';
```

## Say what changed

<Demo name="data-diff/list" />

Pass `before`, `after` and an `aria-label`. Each change is one sentence with a glyph; the demo's read:

- `title changed from "Fix login" to "Fix login on Safari"`
- `labels changed from text to list of texts: a list of 3 items`
- `Added score: 7`
- `Removed draft (was "Users report a loop on the login page.")`

The path is set in code type and written the way an expression reads it, such as `assignee.team`; a change to the whole value says "The whole value". A list or an object that was added or removed whole is one sentence with **Show value** to open it.

The counts line reads like "1 added, 1 removed, 2 changed, 1 changed type", leaving out the kinds that did not occur. The fields no change touches fold into one row, "2 unchanged fields", which opens to list them; `showUnchanged` and `onShowUnchangedChange` control it. A diff lists its first 500 changes and says how many more there are; its counts stay exact.

Lists pair their items by a key every item carries, such as `id`, so an item that moved reads as "the same items in a different order" rather than as every item after it changing. Pass `options` for the comparison: `arrays: 'index'` to pair by position, `keyFields`, `maxChanges`, and `unknownAt` for the places a recorder cut or hid on either side, which read "not compared, part of it wasn't kept" and never as changed. A diff computed elsewhere, such as one shared by a compare page, goes in as `result`.

## Put two values side by side

<Demo name="data-diff/split" />

`layout="split"` shows the two values as trees side by side, each under its label (`labels`, "Before" and "After" by default). The right tree marks what was added and changed, with the earlier value in each changed row's name; the left marks what was removed. A list paired by key is marked in each tree at the item's own position. The trees scroll together: scroll one, and the other brings the same place to the same height.

Side by side needs room: it shows from a 48rem wide container, and a narrower one shows the list. Pass `onLayoutChange` to add a **List** / **Side by side** switch, shown whenever there is room for both.

## Choose the list or side by side

Use the list first: it reads top to bottom, works at every width, and a screen reader reads it as plain sentences. Choose side by side when the reader needs the whole of both values around the changes, such as two runs of a long output, and has a wide screen to read them on.

## Compare shapes

<Demo name="data-diff/shape" />

`mode="shape"` compares the shapes the two values have rather than their values. The demo reads `items[].id: a whole number became text`, `items[].reviewer appeared (text)`, `items[].score disappeared` and `finishedAt appeared (text)`; a field that only some items still hold reads "is no longer always there". Use it when values differ by design, such as two passes of a loop, and what matters is whether the fields kept their kinds. `diffShapes(before, after)` gives the same changes for two schemas.

## When there is nothing to compare

<Demo name="data-diff/unrelated" />

Two values that share no structure, such as an object against a list or a call against its answer, say "They don't share a structure, so there's nothing to compare field by field." instead of listing every field as added and removed. Replace the sentence with `unrelatedMessage`. Two equal values say "No changes"; replace it with `emptyMessage`. To pick which earlier value to compare with, `suggestDiffRoot(after, candidates)` answers the candidate that shares the most values with `after`, or nothing when none shares half.

## Accessibility

The changes are a list of sentences named by `aria-label`: a screen reader reads each change in full, and the glyphs are decoration. **Show value** and the unchanged row are buttons with `aria-expanded`. Side by side, each tree is named by the diff's label and its side, and the change words are in each row's name ("Added: score, 7"). Colour is never the only signal: each change has its glyph and its words. The tints keep their text at 4.5:1 in both themes.

## Props

| Prop                                      | Type or default | Purpose                                                |
| ----------------------------------------- | --------------- | ------------------------------------------------------ |
| `before` / `after`                        | `unknown`       | The two values.                                        |
| `aria-label`                              | `string`        | Names the diff.                                        |
| `result`                                  | `DiffResult`    | A diff computed elsewhere (Values mode).               |
| `options`                                 | `DiffOptions`   | List pairing, limits and `unknownAt`.                  |
| `mode`                                    | `'values'`      | `'shape'` compares the inferred shapes.                |
| `layout` / `onLayoutChange`               | `'list'`        | `'split'` from 48rem; the switch when given.           |
| `labels`                                  | Before / After  | The two sides' names.                                  |
| `showUnchanged` / `onShowUnchangedChange` | closed          | The unchanged fields' row.                             |
| `emptyMessage` / `unrelatedMessage`       | —               | Instead of "No changes" and the no-structure sentence. |
