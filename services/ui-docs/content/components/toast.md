---
title: Toast
description: Show brief completion feedback, avoid duplicate viewports, and keep essential information on the page.
---

Use a toast for brief feedback after an action, such as a successful save. Keep instructions, repairable errors, and progress that someone must revisit in the page itself. A transient message is not a history of completed operations.

## Trigger a notification

<Demo name="toast/basic" />

Choose **Save settings**. This example shows a notification only; it does not save organization settings. The title states the result, and the optional description supplies one useful detail.

```tsx
import { Button } from '@tale/ui/button';
import { useToast } from '@tale/ui/use-toast';

export function SaveNoticeDemo() {
  const { toast } = useToast();
  return (
    <Button type="button" onClick={() => toast({ title: 'Settings saved' })}>
      Show save notice
    </Button>
  );
}
```

In an application, call `toast` after the operation succeeds, not merely when the button is pressed. For a failed save, retain the draft and show a persistent explanation near the affected fields.

## Mount one viewport

```tsx
import { Toaster } from '@tale/ui/toaster';

// Inside your AppShell, beside the router or application content:
<Toaster />;
```

Mount one `Toaster` for the application. `AppShell` does not mount it automatically. The examples on this site share the root viewport; their source files only trigger notifications.

The toast store is shared across callers and holds one current notification. A new toast replaces the previous one. Two mounted Toasters subscribe to that same store and render duplicate messages, rather than creating two isolated queues.

## Choose the message type

<Demo name="toast/variants" />

| Variant | Presentation and use |
| --- | --- |
| `default` | Neutral text, without a leading status icon. |
| `success` | A check icon for successful completion. |
| `destructive` | An error icon for a failed operation; keep actionable recovery available elsewhere. |

`position` is `top-right` by default or `top-center`. The current toast determines the viewport position. Keep placement consistent within a workflow.

## Timing and programmatic control

The default duration is five seconds. Radix pauses dismissal while the notification is hovered or focused and when the window loses focus. A toast can also be dismissed by a swipe. The component does not render a close button.

A `duration` can be supplied per toast. A longer duration alone does not make time-sensitive information accessible to everyone; information needed to continue should remain available in a persistent surface. See W3C's [timing-adjustable guidance](https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable.html).

`useToast()` returns `toast`, `dismiss`, and the current `toasts`. Creating a toast returns its `id`, a scoped `dismiss`, and `update`. Use these handles for an operation-specific change rather than relying on a notification's position in the store. An `action` can hold a React action element, but an essential action should also have a stable home in the application.

## Review the complete feedback path

Trigger two notices in quick succession and confirm only the latest remains. Check that a notice does not cover the action needed next, that keyboard focus stays where the task expects, and that the same information has a persistent location when required.

Use `Input.errorMessage` for a field issue, `Alert` for a persistent page condition, and [Dialog](/docs/components/dialog) for a decision. Use inline status for a long operation whose progress and outcome need to remain visible.
