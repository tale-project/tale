'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Bell } from 'lucide-react';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useNotificationsUnreadCount } from '../hooks/queries';
import { NotificationListPanel } from './notification-list-panel';

interface NotificationBellProps {
  organizationId: string;
  /** Show a text label next to the bell (mobile nav uses this). */
  label?: string;
}

/**
 * Mirrors the styles from `@tale/ui/popover`'s `CONTENT_CLASSES` so the panel
 * surface matches every other popover in the platform. Inlined because this
 * component talks to `PopoverPrimitive` directly (see the trigger composition
 * note below) — `@tale/ui/popover`'s wrapper hard-codes `<Trigger asChild>`
 * one layer deep, which prevented the second `<TooltipPrimitive.Trigger
 * asChild>` from reaching the button and quietly dropped the click handler.
 */
const POPOVER_CONTENT_CLASSES =
  'z-50 min-w-[14.5rem] max-w-64 w-auto p-4 rounded-lg ring-1 ring-border bg-muted text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 motion-reduce:animate-none';

export function NotificationBell({
  organizationId,
  label,
}: NotificationBellProps) {
  const { t: tNav } = useT('navigation');
  const [open, setOpen] = useState(false);
  const { data: unread } = useNotificationsUnreadCount(organizationId);
  const unreadCount = unread ?? 0;

  const buttonNode = (
    <button
      type="button"
      aria-label={tNav('notifications')}
      className={cn(
        'hover:bg-muted relative flex items-center rounded-lg transition-colors cursor-pointer',
        label ? 'gap-3 px-3 py-2 w-full' : 'justify-center p-2',
      )}
    >
      <span className="relative inline-flex">
        <Bell className="text-muted-foreground size-5 shrink-0" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </span>
      {label && <span className="text-sm font-medium">{label}</span>}
    </button>
  );

  // The mobile-nav variant renders an inline text label next to the bell and
  // doesn't need a tooltip — skip both the Popover + Tooltip overhead, just
  // mount the plain button. (Mobile navigates via parent link logic.)
  if (label) {
    return buttonNode;
  }

  // Composing PopoverPrimitive + TooltipPrimitive directly is the only way
  // to land both `asChild` triggers on the same `<button>`. Going through the
  // `@tale/ui` `Popover` wrapper buries its `<PopoverPrimitive.Trigger
  // asChild>` one level deep — passing a Tooltip-wrapped trigger then meets
  // a non-DOM intermediary (`TooltipPrimitive.Provider`/`Root`), Radix's
  // `Slot` can't merge the `onClick` through, and the panel never opens.
  // Nested `asChild` Triggers via Slot, in contrast, merge cleanly: each
  // wraps the next, and the innermost child (the button) ends up with both
  // sets of event listeners + refs.
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <TooltipPrimitive.Provider delayDuration={300}>
        <TooltipPrimitive.Root>
          <PopoverPrimitive.Trigger asChild>
            <TooltipPrimitive.Trigger asChild>
              {buttonNode}
            </TooltipPrimitive.Trigger>
          </PopoverPrimitive.Trigger>
          <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
              side="right"
              sideOffset={8}
              collisionPadding={8}
              className="bg-foreground text-background animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-[60] overflow-hidden rounded-lg border p-2 py-1 text-xs shadow-md"
            >
              {tNav('notifications')}
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          side="right"
          sideOffset={8}
          className={cn(
            POPOVER_CONTENT_CLASSES,
            'bg-card w-96 max-w-[calc(100vw-2rem)] p-0',
          )}
        >
          <NotificationListPanel
            organizationId={organizationId}
            className="h-[28rem]"
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
