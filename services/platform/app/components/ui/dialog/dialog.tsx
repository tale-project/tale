'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n/client';

// =============================================================================
// Variants
// =============================================================================

const dialogContentVariants = cva(
  'fixed left-[50%] top-[50%] z-50 grid w-full border-none translate-x-[-50%] translate-y-[-50%] gap-4 ring-1 ring-border bg-background p-4 sm:p-6 pt-5 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-2xl',
  {
    variants: {
      size: {
        sm: 'max-w-sm',
        default: 'max-w-[23.5rem]',
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-xl',
        wide: 'max-w-[1100px] w-[95vw]',
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
      className="inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
 * IMPORTANT: If your dialog content uses hooks (useQuery, useMutation, useEffect, etc.),
 * wrap the content in a conditional render pattern to prevent "Maximum update depth exceeded"
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(dialogContentVariants({ size }), className)}
          {...(customHeader || !description
            ? { 'aria-describedby': undefined }
            : {})}
          onCloseAutoFocus={
            preventCloseAutoFocus ? (e) => e.preventDefault() : undefined
          }
        >
          {!hideClose && !customHeader && (
            <div className="absolute right-4 top-4">
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
                !hideClose && !headerActions && 'pr-8',
                headerActions &&
                  'flex-row items-start justify-between pr-8 gap-4',
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
                  <DialogPrimitive.Title className="text-base font-semibold leading-none tracking-tight">
                    {title}
                  </DialogPrimitive.Title>
                  {description && (
                    <DialogPrimitive.Description className="text-sm text-muted-foreground">
                      {description}
                    </DialogPrimitive.Description>
                  )}
                </div>
              </div>
              {headerActions && (
                <div className="flex items-center">{headerActions}</div>
              )}
            </div>
          )}
          {children}
          {footer && (
            <div
              className={cn(
                'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2',
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

// =============================================================================
// DialogClose - re-export for custom headers
// =============================================================================

export const DialogClose = DialogPrimitive.Close;
