'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { IconButton } from '../icon-button';
import { useT } from '@/lib/i18n';

// =============================================================================
// Types
// =============================================================================

export type DialogSize =
  | 'sm'
  | 'default'
  | 'md'
  | 'lg'
  | 'xl'
  | 'wide'
  | 'full';

const dialogSizeClasses: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  default: 'max-w-[23.5rem]',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  wide: 'max-w-[1100px] w-[95vw]',
  full: 'max-w-[95vw] w-[95vw] h-[90vh]',
};

// =============================================================================
// Internal Components
// =============================================================================

const DialogCloseButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<'button'>
>((props, ref) => {
  const { t } = useT('common');
  return (
    <IconButton ref={ref} icon={X} aria-label={t('aria.close')} {...props} />
  );
});
DialogCloseButton.displayName = 'DialogCloseButton';

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
}

/**
 * Base dialog component that provides a consistent structure for all dialogs.
 * Use this as the foundation for more specific dialog types or directly for custom dialogs.
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
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-50 grid w-full border-none translate-x-[-50%] translate-y-[-50%] gap-4 ring-1 ring-border bg-background p-4 sm:p-6 pt-5 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl',
            dialogSizeClasses[size],
            className,
          )}
        >
          {!hideClose && !customHeader && (
            <div className="absolute right-4 top-4">
              <DialogPrimitive.Close asChild>
                <DialogCloseButton />
              </DialogPrimitive.Close>
            </div>
          )}
          {customHeader ?? (
            <div
              className={cn(
                'flex flex-col space-y-2 text-left',
                !hideClose && 'pr-8',
                headerActions && 'flex-row items-center justify-between',
                headerClassName,
              )}
            >
              <div
                className={cn(
                  'flex items-center gap-3',
                  headerActions && 'flex-col items-start space-y-2 gap-0',
                )}
              >
                {icon && <div className="shrink-0">{icon}</div>}
                <div className={cn(headerActions && 'flex flex-col space-y-2')}>
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
              {headerActions}
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
