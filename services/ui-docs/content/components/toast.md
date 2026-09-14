---
title: Toast
description: Transient feedback — one toast at a time, announced politely, dismissed on its own.
---

A toast confirms that something happened. It is not a place to put information
the reader needs, because it leaves on its own and cannot be recalled: five
seconds, paused while the pointer is over it or the window is unfocused.

By the end of this page you will know how to fire one, which variant to pick,
and where the `Toaster` belongs.

```tsx
import { Toaster } from '@tale/ui/toaster';
import { useToast } from '@tale/ui/use-toast';
```

## Fire a toast

<Demo name="toast/basic" />

`useToast()` returns `{ toast, dismiss, toasts }`. Call `toast(...)` from an
event handler; the return value carries `{ id, dismiss, update }` if you need
to close or change it yourself.

```tsx
const { toast } = useToast();

toast({
  title: 'Settings saved',
  description: 'Members see the new name on their next request.',
});
```

## Variants

<Demo name="toast/variants" />

| Variant | Use it for |
| --- | --- |
| `default` | A neutral confirmation. Copy only, no icon |
| `success` | A positive terminal state, with a check |
| `destructive` | A failure the reader has to know about |

`position` is `'top-right'` (default) or `'top-center'`, and is read from the
first toast in the queue.

## Mount the `Toaster` once

`Toaster` renders the viewport that holds the toasts. Mount it once per app,
high in the tree — usually next to the router inside `AppShell`. The demos on
this page mount their own so the example is self-contained.

Only **one toast is visible at a time**. A second call replaces the first
rather than stacking, which keeps the corner from turning into a log.

## Accessibility

- The viewport is a live region: a toast is announced without moving focus.
- There is **no close button** by design — toasts dismiss themselves, pause on
  hover and focus, and can be swiped away. A control that steals focus for a
  transient message costs more than it gives.
- Five seconds is the auto-dismiss window. It is long enough to read a title
  and a description without rushing, which is what WCAG 2.2.1 asks for, and the
  timer pauses whenever the reader is looking at it.
- A destructive toast carries an icon **and** its text. Colour alone is never
  the message.

## When to use something else

| Instead of | Use |
| --- | --- |
| A decision the reader must make | `ConfirmDialog` |
| A persistent condition on the page | `Alert` |
| Field-level validation | `Input`'s `errorMessage` with `isInvalid` |
| Progress of something long-running | `ProgressBar` or an inline status |

A toast that the reader must read to continue is a dialog in disguise. Move it.

## Where to go next

[App shell](/docs/components/app-shell) shows where the `Toaster` and the rest
of the cross-cutting providers are mounted.
