---
title: Workbench dock
description: Dock panels such as Problems and Tests under an editor's canvas, switch between them, and show them as a sheet where there is no room.
---

`WorkbenchDock` holds panels under an editor's canvas, such as a list of problems and the results of a run of tests. It spans the canvas column only, so an inspector beside the canvas keeps its full height. Where the dock does not fit, show the same panel in a `WorkbenchSheet`.

```tsx
import {
  WorkbenchDock,
  WorkbenchSheet,
  type WorkbenchDockPanel,
} from '@tale/ui/workbench-dock';
```

## Dock panels under the canvas

<Demo name="workbench-dock/panels" />

Open a panel with **Problems** or **Tests** above the canvas. Each panel has an `id`, a `label` and its `content`. It can also have a `badge` beside the label, such as its counts in words, and `actions` for its own controls, such as **Run all**. One panel shows its label as the dock's title; two or more show as tabs, and the arrow keys move between them. A panel that is not shown stays mounted, so it keeps its scroll position, its filter and its current row.

The dock is a region named by its title or, with tabs, by the active panel's label; pass `aria-label` to name it yourself. Give it an `id`, and point the control that opens it at that id with `aria-controls` and `aria-expanded`.

The header holds the active panel's actions, then **Expand panel** when you pass `onExpandedChange`, then the close button, which you name with `closeLabel`, such as "Hide problems". The body scrolls on its own. `expanded` switches between two heights at once; the height never animates. The dock rises into place when it opens; reduced motion shows it at once.

## Close the dock and return focus

The close button and Escape anywhere inside the dock call `onClose`. Escape leaves the dock open when an open menu inside it took the key, or when a widget inside it has claimed Escape with `data-claims-escape`, as in [dialogs](/docs/components/dialog). The dock is not a dialog and does not move focus itself: in `onClose`, hide the dock and move focus back to the control that opened it, as the example does.

A `ref` on the dock gets `focus()`, which focuses the active tab, or the dock itself when it has one panel.

## Show a panel as a sheet

Where there is no room under the canvas, show the panel in a `WorkbenchSheet`: a dialog on a tablet and a drawer on a phone. It takes `open` and `onOpenChange`, a `title`, an optional `description` under it such as the counts in words, the panel's `actions`, and the panel as its children, in a card that scrolls on its own. Name the close button with `closeLabel`.

To start on a list's current row instead of the first control, pass `onOpenAutoFocus`, call `event.preventDefault()` and focus the row yourself. When choosing a row closes the sheet and takes the reader somewhere else, such as a field in another sheet, set `preventCloseAutoFocus` so focus stays where you put it.

## Props

| Prop               | Type or default           | Purpose                                        |
| ------------------ | ------------------------- | ---------------------------------------------- |
| `panels`           | `WorkbenchDockPanel[]`    | The panels; two or more show as tabs.          |
| `activeId`         | string                    | The panel shown.                               |
| `onActiveChange`   | Optional `(id) => void`   | Called when the reader chooses a tab.          |
| `onClose`          | `() => void`              | Called by the close button and Escape.         |
| `closeLabel`       | string                    | The close button's name.                       |
| `expanded`         | `false`                   | The taller of the two heights.                 |
| `onExpandedChange` | Optional `(next) => void` | Shows **Expand panel** and **Collapse panel**. |
| `id`               | Optional string           | The region's id, for `aria-controls`.          |
| `aria-label`       | Optional string           | Names the region when the panels are tabs.     |
