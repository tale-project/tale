'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Bell } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { tooltipContentClassName } from '@/app/components/ui/overlays/tooltip';
import { useUnreadNotificationCount } from '@/app/features/inbox/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useNotificationsUnreadCount } from '../hooks/queries';
import { NotificationListPanel } from './notification-list-panel';

interface NotificationBellProps {
  organizationId: string;
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
  'z-50 min-w-[14.5rem] max-w-64 w-auto p-4 rounded-lg ring-1 ring-border bg-popover text-popover-foreground dark:bg-muted shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 motion-reduce:animate-none';

export function NotificationBell({ organizationId }: NotificationBellProps) {
  const { t: tNav } = useT('navigation');
  const { t: tNotifications } = useT('notifications');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { data: unread } = useNotificationsUnreadCount(organizationId);
  const myUnread = useUnreadNotificationCount(organizationId);
  const unreadCount = (unread ?? 0) + myUnread;

  const handleExpand = useCallback(() => {
    setOpen(false);
    setExpanded(true);
  }, []);

  const buttonNode = (
    <button
      type="button"
      aria-label={tNav('notifications')}
      className="hover:bg-muted relative flex cursor-pointer items-center justify-center rounded-md p-2 transition-colors"
    >
      <span className="relative inline-flex">
        <Bell className="text-muted-foreground size-5 shrink-0" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="text-destructive-foreground absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </span>
    </button>
  );

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
    <>
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
                className={tooltipContentClassName}
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
            // 16px = the tile's 8px inset to the rail edge + an 8px gap to
            // the nav (matches the account menu).
            sideOffset={16}
            // Radix renders the popover content as `role="dialog"`; give it an
            // accessible name so screen readers announce it as the
            // "Notifications" dialog rather than an unnamed one (WCAG 4.1.2).
            aria-label={tNav('notifications')}
            className={cn(
              POPOVER_CONTENT_CLASSES,
              'bg-card w-96 max-w-[calc(100vw-2rem)] p-0',
            )}
            // Radix auto-focuses the first tabbable element on open (the Expand
            // button, when present) — an `IconButton`, which wraps itself in
            // its own Tooltip that opens on focus. That leaves the "Expand"
            // tooltip visible by default and mounts a second Radix
            // `DismissableLayer` *after* this popover's, so Radix's escape-key
            // handling only fires on whichever layer it considers "highest"
            // (#2650). Keep focus on the bell trigger instead; handle Escape
            // here directly so the popover closes regardless of nested layers.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          >
            <NotificationListPanel
              onNavigate={() => setOpen(false)}
              onExpand={handleExpand}
              organizationId={organizationId}
              className="h-[28rem]"
            />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {/* Expanded view: the same panel in a large modal — the title lives in
          the dialog header; the panel keeps its own tabs + mark-all controls. */}
      {expanded && (
        <Dialog
          open={expanded}
          onOpenChange={setExpanded}
          title={tNotifications('title')}
          size="wide"
          className="md:h-[85dvh] md:max-h-[85dvh]"
        >
          <NotificationListPanel
            organizationId={organizationId}
            layout="expanded"
            className="-mx-2 -my-1 min-h-0 flex-1"
          />
        </Dialog>
      )}
    </>
  );
}
