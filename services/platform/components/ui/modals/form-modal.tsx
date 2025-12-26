'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Stack } from '@/components/ui/layout';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n';

export interface FormModalProps {
  /** Whether the modal is open */
  open?: boolean;
  /** Callback when the modal open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Modal title */
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
  /** Use large modal variant with scroll support */
  large?: boolean;
  /** Optional trigger element that opens the modal */
  trigger?: React.ReactNode;
}

/**
 * Form modal for create/edit operations.
 * Wraps content in a form element with consistent header and footer.
 */
export function FormModal({
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
}: FormModalProps) {
  const { t: tCommon } = useT('common');

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange?.(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={cn(large && 'max-h-[90vh] overflow-y-auto', className)}>
        <form onSubmit={onSubmit ?? ((e) => e.preventDefault())}>
          <DialogHeader>
            {customHeader ?? (
              <>
                <DialogTitle>{title}</DialogTitle>
                {description && <DialogDescription>{description}</DialogDescription>}
              </>
            )}
          </DialogHeader>

          <Stack>
            {children}
          </Stack>

          <DialogFooter>
            {customFooter ?? (
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
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
