'use client';

import * as React from 'react';
import { Dialog } from './dialog';
import { Button } from '../primitives/button';
import { Form } from '../forms/form';
import { Stack } from '../layout/layout';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n/client';
import { DialogErrorBoundary } from '@/components/error-boundaries/boundaries/dialog-error-boundary';
import { useOrganizationId } from '@/hooks/use-organization-id';

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

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange?.(false);
    }
  };

  const footer = customFooter ?? (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleClose}
        disabled={isSubmitting}
      >
        {cancelText ?? tCommon('actions.cancel')}
      </Button>
      <Button
        type="submit"
        disabled={isSubmitting || submitDisabled}
      >
        {isSubmitting ? (submittingText ?? tCommon('actions.saving')) : (submitText ?? tCommon('actions.save'))}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open ?? false}
      onOpenChange={handleClose}
      title={title}
      description={description}
      className={cn(large && 'max-h-[90vh] overflow-y-auto', className)}
      trigger={trigger}
      customHeader={customHeader}
    >
      <Form onSubmit={onSubmit ?? ((e) => e.preventDefault())} className="space-y-0 contents">
        {enableErrorBoundary ? (
          <DialogErrorBoundary
            organizationId={orgId}
            onError={(error) => {
              onError?.(error);
              onOpenChange?.(false);
            }}
          >
            <Stack>
              {children}
            </Stack>
          </DialogErrorBoundary>
        ) : (
          <Stack>
            {children}
          </Stack>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2">
          {footer}
        </div>
      </Form>
    </Dialog>
  );
}
