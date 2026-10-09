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

import { useImeComposition } from '../../hooks/use-ime-composition';
import { useIsMobile } from '../../hooks/use-is-mobile';
import { useRestoreFocus } from '../../hooks/use-restore-focus';
import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import { respectEscapeClaims } from './claims-escape';
import { CLOSE_BUTTON_CLASS } from './close-button-class';
import { PagePointerPin } from './page-pointer-pin';

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
  /**
   * The close control's accessible name. Defaults to the shared translated
   * "Close"; pass a more specific verb when the close does something more
   * specific ("Hide problems").
   */
  closeLabel?: string;
  /**
   * Leave out the close control. Escape, the backdrop and (on a phone) a
   * swipe still dismiss, so give the reader another visible way out unless
   * the moment deliberately blocks one.
   */
  hideClose?: boolean;
  /**
   * Icon actions that belong to the dialog's chrome — "Open as page",
   * "Copy link" — drawn in one cluster at the top-right, just before Close,
   * on the centred dialog and on the phone's drawer alike. Each control
   * needs its own accessible name. The cluster follows the content in the
   * tab order, so Close stays the last stop and the actions the ones before
   * it. Reserve room for the cluster on the content's first row.
   */
  headerActions?: ReactNode;
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
  /**
   * Leave focus where the close puts it instead of returning it to the
   * opener — for a close that hands the reader on to somewhere else (a
   * "go to" that opens another panel and focuses a field there). Mirrors
   * `Dialog`'s prop of the same name.
   */
  preventCloseAutoFocus?: boolean;
}

export const ResponsiveDialogContent = forwardRef<
  HTMLDivElement,
  ResponsiveDialogContentProps
>(
  (
    {
      children,
      className,
      closeLabel,
      hideClose = false,
      headerActions,
      onOpenAutoFocus,
      restoreFocusRef,
      preventCloseAutoFocus = false,
    },
    ref,
  ) => {
    const isMobile = useIsMobile();
    const { t } = useT('common');
    const closeName = closeLabel ?? t('aria.close');
    const hasHeaderActions =
      headerActions !== undefined &&
      headerActions !== null &&
      headerActions !== false;
    const hasCluster = hasHeaderActions || !hideClose;
    // Most consumers open this dialog from state (a task card, a row) and
    // render no `ResponsiveDialogTrigger`, so Radix has nothing to focus on
    // close and the document falls to <body> (WCAG 2.4.3). Capture the opener
    // and refocus it — the same contract `Dialog` carries.
    const open = useContext(ResponsiveDialogOpenContext);
    const restoreFocus = useRestoreFocus(open, restoreFocusRef);
    const onCloseAutoFocus = (event: Event) => {
      if (preventCloseAutoFocus) event.preventDefault();
      else restoreFocus(event);
    };
    const { isComposing, compositionProps } = useImeComposition(open);
    const onEscapeKeyDown = (event: KeyboardEvent) => {
      if (isComposing(event)) event.preventDefault();
    };

    if (isMobile) {
      return (
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="bg-bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 duration-[var(--duration-short)] motion-reduce:animate-none" />
          <DrawerPrimitive.Content
            ref={ref}
            {...compositionProps}
            onEscapeKeyDown={onEscapeKeyDown}
            aria-modal="true"
            data-tale-modal=""
            onOpenAutoFocus={onOpenAutoFocus}
            onCloseAutoFocus={onCloseAutoFocus}
            onPointerDownOutside={preventDatePickerDismiss}
            onInteractOutside={preventDatePickerDismiss}
            onFocusOutside={preventDatePickerDismiss}
            onEscapeKeyDown={respectEscapeClaims()}
            className={cn(
              // `outline-none`, as on `Dialog`: when Radix parks focus on the
              // panel itself (nothing to start in, or the content it held
              // was swapped out) the panel is not a control and draws no ring.
              'bg-background fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[92dvh] flex-col rounded-t-2xl outline-none',
              'pr-(--safe-right) pb-(--safe-bottom) pl-(--safe-left)',
              'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4 duration-[var(--duration-standard)]',
              'motion-reduce:animate-none',
              className,
            )}
          >
            <PagePointerPin />
            {hasCluster ? (
              // The grabber shares a 40px band with the action cluster, so
              // the cluster never covers the content — at rest or scrolled
              // under it.
              <div className="flex h-10 shrink-0 justify-center">
                <div
                  aria-hidden="true"
                  className="bg-muted mt-3 h-1.5 w-12 rounded-full"
                />
              </div>
            ) : (
              <div
                aria-hidden="true"
                className="bg-muted mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full"
              />
            )}
            <div
              className={cn(
                'overflow-y-auto px-4 pb-6',
                hasCluster ? 'pt-1' : 'pt-4',
              )}
            >
              {children}
            </div>
            {hasCluster && (
              <div
                // A tap on Close must not start a swipe of the sheet.
                data-vaul-no-drag=""
                className="absolute top-1 right-[calc(var(--safe-right)+0.5rem)] flex items-center gap-1"
              >
                {headerActions}
                {!hideClose && (
                  <DrawerPrimitive.Close
                    aria-label={closeName}
                    className={CLOSE_BUTTON_CLASS}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </DrawerPrimitive.Close>
                )}
              </div>
            )}
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
          {...compositionProps}
          onEscapeKeyDown={onEscapeKeyDown}
          aria-modal="true"
          data-tale-modal=""
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
          onPointerDownOutside={preventDatePickerDismiss}
          onInteractOutside={preventDatePickerDismiss}
          onFocusOutside={preventDatePickerDismiss}
          onEscapeKeyDown={respectEscapeClaims()}
          className={cn(
            'bg-background fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border p-6 shadow-lg outline-none',
            // Never exceed the viewport: cap at 90dvh and scroll internally so a
            // tall dialog (long form, comment/activity feeds) stays fully usable
            // instead of overflowing off-screen.
            'max-h-[90dvh] overflow-x-hidden overflow-y-auto',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 duration-[var(--duration-standard)]',
            'motion-reduce:animate-none',
            className,
          )}
        >
          <PagePointerPin />
          {children}
          {/* After the content, so Close stays the last tab stop and the
              header actions the ones just before it. */}
          {hasCluster && (
            <div className="absolute top-3 right-3 flex items-center gap-1">
              {headerActions}
              {!hideClose && (
                <DialogPrimitive.Close
                  aria-label={closeName}
                  className={CLOSE_BUTTON_CLASS}
                >
                  <X className="size-4" aria-hidden="true" />
                </DialogPrimitive.Close>
              )}
            </div>
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
