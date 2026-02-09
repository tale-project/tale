'use client';

import { useCallback, useRef } from 'react';

import { DialogErrorBoundary } from '@/app/components/error-boundaries/boundaries/dialog-error-boundary';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { Stack } from '../layout/layout';
import { Button } from '../primitives/button';
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
  /** Form submit handler (optional when customFooter is provided) */
  onSubmit?: (e: React.FormEvent) => void;
  /** Whether the submit button is disabled (in addition to submitting state) */
  submitDisabled?: boolean;
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
  onSubmit,
  submitDisabled = false,
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

  // Use refs to track values so handleClose has a stable reference
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const handleClose = useCallback((open: boolean) => {
    // Block closing while submitting, but always allow opening
    if (open || !isSubmittingRef.current) {
      onOpenChangeRef.current?.(open);
    }
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
        variant="outline"
        onClick={() => handleClose(false)}
        disabled={isSubmitting}
      >
        {cancelText ?? tCommon('actions.cancel')}
      </Button>
      <Button type="submit" disabled={isSubmitting || submitDisabled}>
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
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          {footer}
        </div>
      </form>
    </Dialog>
  );
}
