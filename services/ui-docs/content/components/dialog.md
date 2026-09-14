---
title: Dialog
description: Open a labelled modal, manage confirmation state, and return focus to a useful place.
---

Use a dialog when someone needs to complete a focused task or make a decision before returning to the current page. `Dialog` supplies the modal structure; your application supplies its state, content, and callbacks.

```tsx
import { Dialog } from '@tale/ui/dialog/dialog';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
```

## Open and close a dialog

<Demo name="dialog/basic" />

Choose **Invite a member**, enter a sample email, and press Escape or **Cancel**. Focus returns to the opener. **Send invitation** only closes this local example; it sends no email and performs no validation or persistence.

`open`, `onOpenChange`, and `title` are required by `Dialog`. Pass a `trigger` when the opener is available in the same composition. Otherwise update `open` from your own button or menu and let the dialog capture the active opener.

The title is the accessible name. `description` gives context under it. Place required instructions where they remain visible, and label every form control independently. The footer is caller-owned: dismissing action first, confirming action second.

## Explain a consequential decision

<Demo name="dialog/confirm" />

Choose **Delete project**, then cancel or confirm. Confirmation updates only the example's local message. The sample consequence text demonstrates where an application would explain its own deletion rules; it is not a specification of Tale project deletion.

`ConfirmDialog` renders Cancel and Confirm actions for you. `confirmText` and `cancelText` override shared translated defaults. `variant` selects `default`, `destructive`, or `warning` styling; it does not implement the underlying operation.

Your `onConfirm` handler owns the request and closing behavior. Set `isLoading` while it runs: confirmation, cancellation, and close requests are blocked until it settles. On failure, keep the decision context and explain the problem. `disableConfirm` disables confirmation without disabling cancellation.

For a type-to-confirm decision, set `requireConfirmPhrase`. The trimmed input must match the phrase exactly, including case. It resets when the dialog opens again. This deliberate UI step is additional confirmation, not a substitute for authorization.

## Choose the right wrapper

| Component subpath | Use |
| --- | --- |
| `dialog/dialog` | Custom content and footer. |
| `dialog/confirm-dialog` | A decision with paired cancel/confirm actions. |
| `dialog/delete-dialog` | Entity-specific deletion wording. |
| `dialog/form-dialog` | A form with submission state and actions. |
| `dialog/view-dialog` | Read-only detail. |
| `overlays/responsive-dialog` | The responsive wrapper's dialog/drawer composition. |

The base Dialog itself uses a bottom-sheet layout below `md` and a centered modal above it. Its header and footer remain outside the scrollable body. Test long content on a phone; choosing a large desktop size does not remove the need for that check.

## Base dialog options

| Prop | Purpose |
| --- | --- |
| `size` | `sm`, `default`, `md`, `lg`, `xl`, `3xl`, or `wide`; default `default`. |
| `children`, `footer` | Body and action content; either may be omitted. |
| `icon`, `headerActions` | Additional header content. |
| `onBack`, `backLabel` | A labelled back control for an in-dialog subview. |
| `customHeader` | Replaces the visible header; the required title remains available to assistive technology. |
| `hideClose` | Hides the close control; provide an accessible dismiss path unless the current operation deliberately blocks it. |
| `className`, `headerClassName`, `bodyClassName`, `footerClassName` | Targeted layout adjustments. |
| `restoreFocusRef` | Stable fallback when the captured opener unmounts, for example after a menu closes. |
| `preventCloseAutoFocus` | Opt out of automatic restoration only when the caller explicitly manages the next focus target. |

## Handle lifecycle and focus deliberately

The modal traps focus while open. Escape and the close control request dismissal; controlled state determines whether the request is accepted. Restore focus to a useful surviving control after close, especially when a successful action removes the original row.

Content can remain mounted through a closing animation. Do not assume `open=false` immediately stops its subscriptions or requests. If hook-heavy content has a closing-lifecycle problem, move it into a separate component and conditionally mount that component; do not call hooks conditionally inside one component.

Use an inline error for repairable form problems and a [toast](/docs/components/toast) for an optional completion notice. Use a persistent page or side panel when the task needs more room or the reader needs to refer to the surrounding content continuously.
