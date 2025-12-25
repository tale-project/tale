'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

export interface BaseModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when the modal open state changes */
  onOpenChange: (open: boolean) => void;
  /** Modal title */
  title: string;
  /** Optional description below the title - can be string or JSX */
  description?: React.ReactNode;
  /** Modal content */
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
}

/**
 * Base modal component that provides a consistent structure for all modals.
 * Use this as the foundation for more specific modal types or directly for custom modals.
 */
export function BaseModal({
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
}: BaseModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className} hideClose={hideClose}>
        <DialogHeader className={headerClassName}>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {footer && (
          <DialogFooter className={footerClassName}>{footer}</DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface ModalButtonsProps {
  /** Text for the cancel button */
  cancelText: string;
  /** Text for the confirm button */
  confirmText: string;
  /** Text shown when loading */
  loadingText?: string;
  /** Whether the modal is in a loading state */
  isLoading?: boolean;
  /** Callback when cancel is clicked */
  onCancel: () => void;
  /** Callback when confirm is clicked (for non-form modals) */
  onConfirm?: () => void;
  /** Whether the confirm button submits a form */
  isSubmit?: boolean;
  /** Variant for the confirm button */
  confirmVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  /** Additional className for confirm button */
  confirmClassName?: string;
  /** Whether the confirm button is disabled (in addition to loading state) */
  confirmDisabled?: boolean;
  /** Whether to use grid layout (equal width buttons) */
  gridLayout?: boolean;
}

/**
 * Standard modal button layout with cancel and confirm buttons.
 * Can be used as footer prop for BaseModal.
 */
export function ModalButtons({
  cancelText,
  confirmText,
  loadingText,
  isLoading = false,
  onCancel,
  onConfirm,
  isSubmit = false,
  confirmVariant = 'default',
  confirmClassName,
  confirmDisabled = false,
  gridLayout = false,
}: ModalButtonsProps) {
  return (
    <div
      className={cn(
        gridLayout
          ? 'grid grid-cols-2 gap-2'
          : 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2'
      )}
    >
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={isLoading}
      >
        {cancelText}
      </Button>
      <Button
        type={isSubmit ? 'submit' : 'button'}
        variant={confirmVariant}
        onClick={isSubmit ? undefined : onConfirm}
        disabled={isLoading || confirmDisabled}
        className={confirmClassName}
      >
        {isLoading && loadingText ? loadingText : confirmText}
      </Button>
    </div>
  );
}
