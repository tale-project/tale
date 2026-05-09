'use client';

import { Button } from '@tale/ui/button';
import { cva } from 'class-variance-authority';
import * as React from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { Dialog } from './dialog';

const confirmButtonVariants = cva('', {
  variants: {
    variant: {
      default: '',
      destructive: 'bg-red-600 hover:bg-red-700',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface ConfirmDialogProps {
  /** Whether the dialog is open */
  open?: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Dialog title */
  title: string;
  /** Confirmation message - can be string or JSX */
  description?: React.ReactNode;
  /** Optional additional content (e.g., preview of item being deleted) */
  children?: React.ReactNode;
  /** Text for the cancel button (defaults to common.actions.cancel) */
  cancelText?: string;
  /** Text for the confirm button (defaults to common.actions.confirm) */
  confirmText?: string;
  /** Text shown when loading (defaults to common.actions.loading) */
  loadingText?: string;
  /** Whether the dialog is in a loading state */
  isLoading?: boolean;
  /** Whether the confirm button is disabled (without affecting cancel/close) */
  disableConfirm?: boolean;
  /** Callback when confirmed */
  onConfirm: () => void;
  /** Variant of the dialog - affects confirm button styling */
  variant?: 'default' | 'destructive';
  /** Additional className for DialogContent */
  className?: string;
  /**
   * When set, render an `<Input>` between description and footer; the
   * confirm button stays disabled until the trimmed input matches the
   * phrase exactly. Used for high-stakes destructive flows like
   * restoring a retention-expired row, where we want the admin to
   * deliberately type a confirmation token.
   */
  requireConfirmPhrase?: string;
  /** Optional label shown above the type-to-confirm input. */
  requireConfirmPhraseLabel?: string;
}

/**
 * Confirmation dialog for actions like delete, archive, etc.
 * Provides a consistent confirmation UI with optional preview content.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  cancelText,
  confirmText,
  loadingText,
  isLoading = false,
  disableConfirm = false,
  onConfirm,
  variant = 'default',
  className,
  requireConfirmPhrase,
  requireConfirmPhraseLabel,
}: ConfirmDialogProps) {
  const { t: tCommon } = useT('common');
  const [phraseInput, setPhraseInput] = React.useState('');

  // Reset the type-to-confirm input whenever the dialog re-opens, so a
  // previously-typed phrase doesn't auto-enable a fresh confirm step.
  React.useEffect(() => {
    if (open) setPhraseInput('');
  }, [open, requireConfirmPhrase]);

  const phraseSatisfied =
    requireConfirmPhrase === undefined ||
    phraseInput.trim() === requireConfirmPhrase;

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange?.(false);
    }
  };

  const footer = (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
        disabled={isLoading}
      >
        {cancelText ?? tCommon('actions.cancel')}
      </Button>
      <Button
        type="button"
        variant={variant === 'destructive' ? 'destructive' : 'primary'}
        onClick={(e) => {
          e.stopPropagation();
          onConfirm();
        }}
        disabled={isLoading || disableConfirm || !phraseSatisfied}
        className={cn(confirmButtonVariants({ variant }))}
      >
        {isLoading
          ? (loadingText ?? tCommon('actions.loading'))
          : (confirmText ?? tCommon('actions.confirm'))}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open ?? false}
      onOpenChange={handleClose}
      title={title}
      description={description}
      footer={footer}
      className={className}
    >
      {children}
      {requireConfirmPhrase !== undefined && (
        <div className="mt-3 flex flex-col gap-1">
          <Input
            label={
              requireConfirmPhraseLabel ??
              tCommon('confirmDialog.typeToConfirmLabel', {
                phrase: requireConfirmPhrase,
              })
            }
            value={phraseInput}
            onChange={(e) => setPhraseInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            size="sm"
          />
        </div>
      )}
    </Dialog>
  );
}
