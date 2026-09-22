'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';

import { useIsMobile } from '../../hooks/use-is-mobile';
import { useRestoreFocus } from '../../hooks/use-restore-focus';
import { cn } from '../../lib/cn';

/**
 * Whether the dialog is open right now, for `ResponsiveDialogContent`. Radix
 * and vaul know, but neither exposes it to a child; the content needs it to
 * capture the opener the moment the dialog opens (`useRestoreFocus`).
 */
const ResponsiveDialogOpenContext = createContext(false);

/**
 * Portaled date calendars (platform DatePicker) sit on `document.body`
 * so dialog overflow cannot clip them. Clicks on that layer must not
 * count as outside the modal or the dialog closes under the calendar.
 */
function isDatePickerPopperEvent(event: {
  target: EventTarget | null;
}): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest('[data-tale-datepicker-popper]') !== null
  );
}

function preventDatePickerDismiss(event: Event): void {
  if (isDatePickerPopperEvent(event)) event.preventDefault();
}

export interface ResponsiveDialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Adaptive modal: renders as a centered Radix Dialog on `md+` viewports and a
 * bottom Drawer (via vaul) on mobile. Pass the same children to either form —
 * the sub-component exports (`ResponsiveDialogContent`, `…Title`,
 * `…Description`, `…Trigger`) dispatch on viewport. This is the canonical
 * replacement for any platform dialog whose content is form-like or has
 * vertical scroll.
 */
export function ResponsiveDialog({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();
  // Mirror the open state for the content: the controlled `open` when the
  // caller drives it, otherwise the uncontrolled state as Radix/vaul report it.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    defaultOpen ?? false,
  );
  const isOpen = open ?? uncontrolledOpen;
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  if (isMobile) {
    return (
      <ResponsiveDialogOpenContext.Provider value={isOpen}>
        <DrawerPrimitive.Root
          open={open}
          defaultOpen={defaultOpen}
          onOpenChange={handleOpenChange}
        >
          {children}
        </DrawerPrimitive.Root>
      </ResponsiveDialogOpenContext.Provider>
    );
  }
  return (
    <ResponsiveDialogOpenContext.Provider value={isOpen}>
      <DialogPrimitive.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
      >
        {children}
      </DialogPrimitive.Root>
    </ResponsiveDialogOpenContext.Provider>
  );
}

export const ResponsiveDialogTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>((props, ref) => {
  const isMobile = useIsMobile();
  if (isMobile) return <DrawerPrimitive.Trigger ref={ref} {...props} />;
  return <DialogPrimitive.Trigger ref={ref} {...props} />;
});
ResponsiveDialogTrigger.displayName = 'ResponsiveDialogTrigger';

export const ResponsiveDialogClose = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>((props, ref) => {
  const isMobile = useIsMobile();
  if (isMobile) return <DrawerPrimitive.Close ref={ref} {...props} />;
  return <DialogPrimitive.Close ref={ref} {...props} />;
});
ResponsiveDialogClose.displayName = 'ResponsiveDialogClose';

interface ResponsiveDialogContentProps {
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  hideClose?: boolean;
  /**
   * Radix `onOpenAutoFocus` passthrough. Call `event.preventDefault()` to stop
   * the focus scope from focusing (and text-selecting) the first tabbable
   * element — e.g. a dialog whose first control is an inline-editable title.
   */
  onOpenAutoFocus?: (event: Event) => void;
  /**
   * Stable element to restore focus to when the captured opener cannot hold
   * focus past the close (a dropdown menu item, an element that unmounted).
   * Passed to `useRestoreFocus`; mirrors `Dialog`'s prop of the same name.
   */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export const ResponsiveDialogContent = forwardRef<
  HTMLDivElement,
  ResponsiveDialogContentProps
>(
  (
    {
      children,
      className,
      closeLabel = 'Close',
      hideClose,
      onOpenAutoFocus,
      restoreFocusRef,
    },
    ref,
  ) => {
    const isMobile = useIsMobile();
    // Most consumers open this dialog from state (a task card, a row) and
    // render no `ResponsiveDialogTrigger`, so Radix has nothing to focus on
    // close and the document falls to <body> (WCAG 2.4.3). Capture the opener
    // and refocus it — the same contract `Dialog` carries.
    const open = useContext(ResponsiveDialogOpenContext);
    const restoreFocus = useRestoreFocus(open, restoreFocusRef);

    if (isMobile) {
      return (
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="bg-bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 duration-[var(--duration-short)] motion-reduce:animate-none" />
          <DrawerPrimitive.Content
            ref={ref}
            aria-modal="true"
            onOpenAutoFocus={onOpenAutoFocus}
            onCloseAutoFocus={restoreFocus}
            onPointerDownOutside={preventDatePickerDismiss}
            onInteractOutside={preventDatePickerDismiss}
            onFocusOutside={preventDatePickerDismiss}
            className={cn(
              'bg-background fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[92dvh] flex-col rounded-t-2xl',
              'pr-(--safe-right) pb-(--safe-bottom) pl-(--safe-left)',
              'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4 duration-[var(--duration-standard)]',
              'motion-reduce:animate-none',
              className,
            )}
          >
            <div
              aria-hidden="true"
              className="bg-muted mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full"
            />
            <div className="overflow-y-auto px-4 pt-4 pb-6">{children}</div>
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      );
    }

    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'bg-bg-overlay fixed inset-0 z-50',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-[var(--duration-short)]',
            'motion-reduce:animate-none',
          )}
        />
        <DialogPrimitive.Content
          ref={ref}
          aria-modal="true"
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={restoreFocus}
          onPointerDownOutside={preventDatePickerDismiss}
          onInteractOutside={preventDatePickerDismiss}
          onFocusOutside={preventDatePickerDismiss}
          className={cn(
            'bg-background fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border p-6 shadow-lg',
            // Never exceed the viewport: cap at 90dvh and scroll internally so a
            // tall dialog (long form, comment/activity feeds) stays fully usable
            // instead of overflowing off-screen.
            'max-h-[90dvh] overflow-x-hidden overflow-y-auto',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 duration-[var(--duration-standard)]',
            'motion-reduce:animate-none',
            className,
          )}
        >
          {children}
          {!hideClose && (
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className="ring-offset-background focus-visible:ring-ring absolute top-3 right-3 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-1 focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
ResponsiveDialogContent.displayName = 'ResponsiveDialogContent';

export const ResponsiveDialogTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => {
  const isMobile = useIsMobile();
  const Component = isMobile ? DrawerPrimitive.Title : DialogPrimitive.Title;
  return (
    <Component
      ref={ref}
      className={cn('text-foreground text-lg font-semibold', className)}
      {...props}
    />
  );
});
ResponsiveDialogTitle.displayName = 'ResponsiveDialogTitle';

export const ResponsiveDialogDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => {
  const isMobile = useIsMobile();
  const Component = isMobile
    ? DrawerPrimitive.Description
    : DialogPrimitive.Description;
  return (
    <Component
      ref={ref}
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
});
ResponsiveDialogDescription.displayName = 'ResponsiveDialogDescription';
