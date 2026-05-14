'use client';

import { Button } from '@tale/ui/button';
import { useCallback, useRef } from 'react';

import { DialogErrorBoundary } from '@/app/components/error-boundaries/boundaries/dialog-error-boundary';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { Stack } from '../layout/layout';
import { Dialog } from './dialog';

const preventDefaultSubmit = (e: React.FormEvent) => e.preventDefault();

export interface FormDialogProps {
  /** Whether the dialog is open */
  open?: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Dialog title */
  title: string;
  /** Optional description below the title */
  description?: React.ReactNode;
  /** Form content (fields) */
  children: React.ReactNode;
  /** Text for the cancel button (defaults to common.actions.cancel) */
  cancelText?: string;
  /** Text for the submit button (defaults to common.actions.save) */
  submitText?: string;
  /** Text shown when submitting (defaults to common.actions.saving) */
  submittingText?: string;
  /** Whether the form is being submitted */
  isSubmitting?: boolean;
  /** Whether the form has been modified (e.g. from react-hook-form formState.isDirty) */
  isDirty?: boolean;
  /** Whether the form passes validation (e.g. from react-hook-form formState.isValid) */
  isValid?: boolean;
  /**
   * If true, closing while `isDirty` shows a native discard-confirm prompt.
   * Default false — only opt in from forms that capture meaningful user input
   * (otherwise read-only dialogs spuriously confirm on every close).
   */
  confirmDiscardOnDirty?: boolean;
  /** Form submit handler (optional when customFooter is provided) */
  onSubmit?: (e: React.FormEvent) => void;
  /** Additional className for DialogContent */
  className?: string;
  /** Custom header content (replaces default title/description) */
  customHeader?: React.ReactNode;
  /** Custom footer content (replaces default buttons) */
  customFooter?: React.ReactNode;
  /** Use large dialog variant with scroll support */
  large?: boolean;
  /** Optional trigger element that opens the dialog */
  trigger?: React.ReactNode;
  /** Enable error boundary (default: true) */
  enableErrorBoundary?: boolean;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

/**
 * Form dialog for create/edit operations.
 * Wraps content in a form element with consistent header and footer.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  cancelText,
  submitText,
  submittingText,
  isSubmitting = false,
  isDirty = true,
  isValid = true,
  confirmDiscardOnDirty = false,
  onSubmit,
  className,
  customHeader,
  customFooter,
  large = false,
  trigger,
  enableErrorBoundary = true,
  onError,
}: FormDialogProps) {
  const { t: tCommon } = useT('common');
  const orgId = useOrganizationId();

  // Pre-resolve the localized prompt so the i18n scanner sees the literal
  // key. The handleClose callback below reads it from a ref to keep its
  // identity stable across re-renders.
  const discardConfirmMessage = tCommon('discardChangesConfirm');

  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const confirmDiscardOnDirtyRef = useRef(confirmDiscardOnDirty);
  confirmDiscardOnDirtyRef.current = confirmDiscardOnDirty;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const discardConfirmMessageRef = useRef(discardConfirmMessage);
  discardConfirmMessageRef.current = discardConfirmMessage;

  const handleClose = useCallback((isOpen: boolean) => {
    if (isOpen) {
      onOpenChangeRef.current?.(true);
      return;
    }
    // Block closing while submitting — user can still cancel via the Cancel
    // button which gates on `disabled={isSubmitting}` independently.
    if (isSubmittingRef.current) return;
    // Confirm before discarding unsaved edits. Opt-in via
    // `confirmDiscardOnDirty` so read-only dialogs (e.g. secret reveal) and
    // dialogs that don't wire `isDirty` don't spuriously prompt on close.
    // Native confirm avoids a nested-dialog focus-trap dance; swap for an
    // inline AlertDialog later if a richer UX is needed.
    if (
      confirmDiscardOnDirtyRef.current &&
      isDirtyRef.current &&
      !globalThis.confirm(discardConfirmMessageRef.current)
    ) {
      return;
    }
    onOpenChangeRef.current?.(false);
  }, []);

  // Memoize the error handler to prevent inline function recreation
  const handleBoundaryError = useCallback(
    (error: Error) => {
      onError?.(error);
      onOpenChangeRef.current?.(false);
    },
    [onError],
  );

  const footer = customFooter ?? (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => handleClose(false)}
        disabled={isSubmitting}
      >
        {cancelText ?? tCommon('actions.cancel')}
      </Button>
      <Button type="submit" disabled={isSubmitting || !isDirty || !isValid}>
        {isSubmitting
          ? (submittingText ?? tCommon('actions.saving'))
          : (submitText ?? tCommon('actions.save'))}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open ?? false}
      onOpenChange={handleClose}
      title={title}
      description={description}
      className={cn(large && 'max-h-[90vh] overflow-y-auto pr-2', className)}
      trigger={trigger}
      customHeader={customHeader}
    >
      <form onSubmit={onSubmit ?? preventDefaultSubmit} className="space-y-4">
        {enableErrorBoundary ? (
          <DialogErrorBoundary
            organizationId={orgId}
            onError={handleBoundaryError}
          >
            <Stack>{children}</Stack>
          </DialogErrorBoundary>
        ) : (
          <Stack>{children}</Stack>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {footer}
        </div>
      </form>
    </Dialog>
  );
}
