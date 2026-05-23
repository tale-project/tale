'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import * as React from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

// =============================================================================
// Variants
// =============================================================================

const dialogContentVariants = cva(
  // Mobile: bottom sheet anchored to the viewport bottom with safe-area-aware
  // padding. md+: classic centered dialog. `dvh` keeps iOS Safari's dynamic
  // chrome from clipping the dialog at the top or bottom. Header and footer
  // are rendered outside the overflow wrapper below so they stay pinned
  // while the middle section scrolls.
  'fixed z-50 flex flex-col border-none gap-4 ring-1 ring-border bg-card shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none ' +
    // Mobile: bottom sheet
    'inset-x-0 bottom-0 top-auto left-0 right-0 w-full max-w-full max-h-[88dvh] rounded-t-2xl rounded-b-none p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4 ' +
    // md+: centered dialog
    'md:left-1/2 md:right-auto md:top-1/2 md:bottom-auto md:inset-x-auto md:w-full md:-translate-x-1/2 md:-translate-y-1/2 md:max-h-[90dvh] md:p-6 md:pb-6 md:pt-5 md:rounded-2xl md:data-[state=open]:zoom-in-95 md:data-[state=closed]:zoom-out-95 md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=closed]:slide-out-to-bottom-0',
  {
    variants: {
      size: {
        sm: 'md:max-w-sm',
        default: 'md:max-w-[24rem]',
        md: 'md:max-w-md',
        lg: 'md:max-w-lg',
        xl: 'md:max-w-xl',
        wide: 'md:max-w-[1100px] md:w-[95vw]',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

export type DialogSize = NonNullable<
  VariantProps<typeof dialogContentVariants>['size']
>;

// =============================================================================
// Internal Components
// =============================================================================

function DialogCloseButton() {
  const { t } = useT('common');
  return (
    <DialogPrimitive.Close
      className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex items-center justify-center rounded-lg p-2 transition-all duration-150 focus-visible:ring-1 focus-visible:outline-none"
      aria-label={t('aria.close')}
      onClick={(e) => e.stopPropagation()}
    >
      <X className="size-4" aria-hidden="true" />
    </DialogPrimitive.Close>
  );
}

// =============================================================================
// Dialog Wrapper Component
// =============================================================================

export interface DialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Dialog title - required for accessibility, can be visually hidden with customHeader */
  title: string;
  /** Optional description below the title - can be string or JSX */
  description?: React.ReactNode;
  /** Dialog content */
  children?: React.ReactNode;
  /** Footer content - if not provided, no footer is rendered */
  footer?: React.ReactNode;
  /** Additional className for DialogContent */
  className?: string;
  /** Whether to hide the close button */
  hideClose?: boolean;
  /** Additional className for DialogHeader */
  headerClassName?: string;
  /** Additional className for DialogFooter */
  footerClassName?: string;
  /** Dialog size variant */
  size?: DialogSize;
  /** Actions to display in the header (next to the title) */
  headerActions?: React.ReactNode;
  /** Icon to display before the title */
  icon?: React.ReactNode;
  /** Custom header content - completely replaces the default header */
  customHeader?: React.ReactNode;
  /** Optional trigger element that opens the dialog */
  trigger?: React.ReactNode;
  /** Whether to prevent focus restoration when dialog closes (default: false) */
  preventCloseAutoFocus?: boolean;
}

/**
 * Base dialog component that provides a consistent structure for all dialogs.
 * Use this as the foundation for more specific dialog types or directly for custom dialogs.
 *
 * IMPORTANT If your dialog content uses hooks:
 * Wrap the content in a conditional render pattern to prevent "Maximum update depth exceeded"
 * errors. Radix UI keeps dialog content mounted during closing animations, and hooks
 * running during this phase can conflict with Radix's usePresence hook.
 *
 * @example
 * // Wrapper pattern for dialogs with hooks:
 * function MyDialogContent(props) {
 *   const data = useQuery(...);  // hooks here
 *   return <Dialog {...props}>...</Dialog>;
 * }
 *
 * export function MyDialog(props) {
 *   if (!props.open) return null;  // Prevents hooks during close animation
 *   return <MyDialogContent {...props} />;
 * }
 *
 * See: https://github.com/radix-ui/primitives/issues/3675
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  hideClose,
  headerClassName,
  footerClassName,
  size = 'default',
  headerActions,
  icon,
  customHeader,
  trigger,
  preventCloseAutoFocus = false,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
          onClick={(e) => e.stopPropagation()}
        />
        <DialogPrimitive.Content
          className={cn(dialogContentVariants({ size }), className)}
          onClick={(e) => e.stopPropagation()}
          {...(customHeader || !description
            ? { 'aria-describedby': undefined }
            : {})}
          onCloseAutoFocus={
            preventCloseAutoFocus ? (e) => e.preventDefault() : undefined
          }
        >
          {!hideClose && !customHeader && (
            <div className="absolute top-4 right-4">
              <DialogCloseButton />
            </div>
          )}
          {customHeader ? (
            <>
              <VisuallyHidden>
                <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description>
                    {description}
                  </DialogPrimitive.Description>
                )}
              </VisuallyHidden>
              {customHeader}
            </>
          ) : (
            <div
              className={cn(
                'flex flex-col space-y-2 text-left',
                !hideClose && 'pr-8',
                headerActions && 'flex-row items-start justify-between gap-4',
                headerClassName,
              )}
            >
              <div
                className={cn(
                  'flex items-center gap-3',
                  headerActions &&
                    'flex-col items-start space-y-2 gap-0 flex-1 min-w-0',
                )}
              >
                {icon && <div className="shrink-0">{icon}</div>}
                <div
                  className={cn(
                    'flex flex-col space-y-2',
                    headerActions && 'min-w-0',
                  )}
                >
                  <DialogPrimitive.Title className="text-base leading-none font-semibold tracking-tight">
                    {title}
                  </DialogPrimitive.Title>
                  {description && (
                    <DialogPrimitive.Description className="text-muted-foreground text-sm">
                      {description}
                    </DialogPrimitive.Description>
                  )}
                </div>
              </div>
              {headerActions && (
                <div className="-mt-1 flex items-center gap-1">
                  {headerActions}
                </div>
              )}
            </div>
          )}
          <div className="-mx-2 -my-1 min-h-0 flex-1 overflow-y-auto px-2 py-1">
            {children}
          </div>
          {footer && (
            <div
              className={cn(
                'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2 shrink-0',
                footerClassName,
              )}
            >
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogClose = DialogPrimitive.Close;
