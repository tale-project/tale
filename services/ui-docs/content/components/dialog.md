---
title: Dialog
description: The modal surface and its specialised forms — confirm, delete, form and view.
---

`Dialog` is the base modal: a title, an optional description, a body and a
footer. Four specialised dialogs build on it, and reaching for the right one
saves you from re-deciding button order, destructive colour and focus handling
every time.

By the end of this page you will know which dialog to open for a given
decision, and what the component guarantees about focus.

```tsx
import { Dialog } from '@tale/ui/dialog/dialog';
```

## A dialog with a form inside

<Demo name="dialog/basic" />

`title` is required — it is the dialog's accessible name. `trigger` is
optional: pass it when the opener lives right there, or drive `open` yourself
when the opener is a menu item several levels away.

The footer is yours, and the order is fixed by convention: the dismissing
action on the left, the confirming action on the right.

## Confirming something destructive

<Demo name="dialog/confirm" />

`ConfirmDialog` takes the decision rather than the markup: a title, a
description, a confirm label and an `onConfirm`. `variant="destructive"` colours
the confirm button and nothing else — the dialog itself is not red.

For a decision that must not be made by muscle memory, `requireConfirmPhrase`
renders an input between the description and the footer and keeps the confirm
button disabled until the typed phrase matches exactly.

## The family

| Component | Use it for |
| --- | --- |
| `dialog/dialog` | Anything custom — the base |
| `dialog/confirm-dialog` | A yes/no decision, including destructive ones |
| `dialog/delete-dialog` | Deleting a named entity, with its name in the copy |
| `dialog/form-dialog` | A form whose submit closes the dialog |
| `dialog/view-dialog` | Read-only detail, no confirming action |
| `overlays/responsive-dialog` | A dialog on desktop, a drawer on a phone |

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `open` | `boolean` | Required |
| `onOpenChange` | `(open: boolean) => void` | Required |
| `title` | `string` | Required — the accessible name |
| `description` | `ReactNode` | Under the title |
| `children` | `ReactNode` | The body |
| `footer` | `ReactNode` | Omit for no footer |
| `size` | `DialogSize` | |
| `trigger` | `ReactNode` | Renders the opener for you |
| `icon` | `ReactNode` | Before the title |
| `headerActions` | `ReactNode` | Beside the title |
| `onBack` + `backLabel` | | Turns the dialog into a drill-in surface |
| `customHeader` | `ReactNode` | Replaces the header entirely |
| `hideClose` | `boolean` | |
| `bodyClassName` | `string` | The scrollable body wrapper |
| `restoreFocusRef` | `RefObject<HTMLElement>` | When the opener unmounts before close |

> [!WARNING]
> If your dialog body uses hooks, render it conditionally rather than leaving
> it mounted. Radix keeps content mounted through the closing animation, and a
> body whose hooks keep running against unmounting state throws "Maximum update
> depth exceeded".

## Accessibility

- Focus moves into the dialog on open and **returns to the opener** on close.
  When the opener itself unmounts — a dropdown menu item, typically — pass
  `restoreFocusRef` so focus has somewhere stable to land.
- Escape closes. A nested tooltip layer can swallow the first Escape, which is
  why a drawer's own close control should be a plain `Button` rather than an
  `IconButton` with its automatic tooltip.
- `title` is announced as the dialog's name even when `customHeader` hides it
  visually.

## When to use something else

| Instead of | Use |
| --- | --- |
| A side panel that keeps the page visible | `Sheet` |
| A transient confirmation of something done | `toast` |
| A choice attached to a control | `DropdownMenu` or `Popover` |
| A destructive action inside a row | `entity/entity-delete-dialog` |

## Where to go next

[Toast](/docs/components/toast) is the other half of feedback — what you show
after the dialog closes.
