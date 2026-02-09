'use client';

import { cva } from 'class-variance-authority';
import * as React from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { Button } from '../primitives/button';
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
  /** Callback when confirmed */
  onConfirm: () => void;
  /** Variant of the dialog - affects confirm button styling */
  variant?: 'default' | 'destructive';
  /** Additional className for DialogContent */
  className?: string;
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
  onConfirm,
  variant = 'default',
  className,
}: ConfirmDialogProps) {
  const { t: tCommon } = useT('common');

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange?.(false);
    }
  };

  const footer = (
    <>
      <Button
        type="button"
        variant="outline"
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
        variant={variant === 'destructive' ? 'destructive' : 'default'}
        onClick={(e) => {
          e.stopPropagation();
          onConfirm();
        }}
        disabled={isLoading}
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
    </Dialog>
  );
}
