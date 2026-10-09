---
title: Data view
description: Show one recorded value as its values or its shape, hold it against the shape it should have, and copy, download or open it full screen.
---

`DataView` shows one recorded value two ways: **Values**, a [value tree](/docs/components/value-tree) of the value with what the recorder left out as chips, and **Shape**, the fields the value has, read from the value itself. Against an expected shape it says whether the value matches and, in Shape, marks what differs. Use it for what a step received or returned, a run's input or output, or a test's actual result. `ShapeView` is the Shape half on its own.

```tsx
import { DataView, ShapeView, compareShape } from '@tale/ui/data-view';
```

## Show a value two ways

<Demo name="data-view/basic" />

Pass the `value` and an `aria-label`. **Values** and **Shape** switch in place; the view fades from one to the other, and holds still under reduced motion. When several views show the parts of one thing, such as what a step received, read and returned, give them one `mode` and `onModeChange` so one switch turns them all. `showModeSwitch={false}` leaves the switch out.

The toolbar copies the value as JSON (`toolbar.copy`, on by default), downloads it (`toolbar.download: { fileName }`) and opens it full screen (`toolbar.fullScreen`, with an optional `title`). Full screen shows the same view at the comfortable density in a dialog, a bottom sheet on a phone, and gives focus back to its button when it closes. Copy and download keep what the recorder hid: a hidden secret is `null` in the JSON too.

Pass the recorder's lists as `recorded={{ elided, redacted, bytes }}`. The tree shows the cuts and the hidden secrets as chips, and `bytes` adds a line such as "2 KB recorded". `marks` passes highlights through to the tree.

Without a value (`undefined`) the view says "Nothing recorded"; pass `empty` for your own words, such as "Its input appears when it finishes". `null` is a value, and shows as one.

## Hold a value against its expected shape

Pass `expected`, a [schema tree](/docs/components/schema-tree) schema, and a line above the value says "Matches the expected shape" or "Differs from the expected shape in 3 fields", with **Compare** to open Shape. `expectedLabel` says where the expected shape comes from, such as "From the analysis of v4". In Shape, each field that differs says how, in words beside its kind and with a glyph:

| Mark         | Says                        | When                                                              |
| ------------ | --------------------------- | ----------------------------------------------------------------- |
| added        | "not in the expected shape" | The value has a field the expected shape does not name.           |
| removed      | "expected, but not there"   | A required field is missing; it is listed anyway, struck through. |
| type-changed | "not the expected kind"     | The field holds another kind of value.                            |
| optional     | "not always there"          | A required field only some list items hold.                       |

The comparison accepts what the expected shape allows: a whole number where a number is expected, a value its `enum` or `anyOf` names, a field it leaves optional and absent. Where the expected shape declares no fields, such as an object without `properties` or "anything", nothing under it is judged. `compareShape(expected, actual)` gives a host the same answer: the shape to draw, the marks and how many fields differ.

## Show a shape on its own

`ShapeView` draws the inferred shape of `value` with the [schema tree](/docs/components/schema-tree): each field's kind in words and, for the items of a list, in how many of them a field was there ("in 9 of 12 items"; `counts={false}` leaves it out). With `expected`, it marks the fields that differ and lists the required ones the value lacks.

## Accessibility

The view is a group named by its `aria-label`, so its toolbar buttons have the context of the value they act on. **Values** and **Shape** are a segmented control: one tab stop, the arrow keys move between them. The verdict is words with an icon, never a colour alone. A copy is announced as "Copied". The marked rows of a shape keep their notes in the full foreground colour, so they read at 4.5:1 on every tint, in both themes.

## Props

| Prop                         | Type or default                  | Purpose                                                            |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `value`                      | `unknown`                        | The value; `undefined` shows `empty`.                              |
| `aria-label`                 | `string`                         | Names the view and its tree or field list.                         |
| `recorded`                   | `{ elided?, redacted?, bytes? }` | What the recorder left out, and the size.                          |
| `mode` / `onModeChange`      | `'values'`                       | `'values'` or `'shape'`, controlled.                               |
| `showModeSwitch`             | `true`                           | The Values / Shape switch.                                         |
| `expected` / `expectedLabel` | —                                | The shape to hold the value against, and where it comes from.      |
| `toolbar`                    | `{ copy: true }`                 | `copy`, `download: { fileName }`, `fullScreen: true \| { title }`. |
| `empty`                      | "Nothing recorded"               | Shown without a value.                                             |
| `marks`                      | —                                | Highlights for the tree, by pointer.                               |
| `density`                    | `'comfortable'`                  | `'compact'` for an inspector.                                      |
