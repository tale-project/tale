'use client';

import * as React from 'react';
import { Dialog } from './dialog';
import type { DialogSize } from './dialog';
import { cn } from '@/lib/utils/cn';
import { DialogErrorBoundary } from '@/app/components/error-boundaries/boundaries/dialog-error-boundary';
import { useOrganizationId } from '@/app/hooks/use-organization-id';

export interface ViewDialogProps {
  /** Whether the dialog is open */
  open?: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Dialog title */
  title: string;
  /** Optional description below the title */
  description?: React.ReactNode;
  /** Dialog content */
  children: React.ReactNode;
  /** Additional className for DialogContent */
  className?: string;
  /** Hide the close button */
  hideClose?: boolean;
  /** Custom footer content */
  customFooter?: React.ReactNode;
  /** Dialog size variant */
  size?: DialogSize;
  /** Actions to display in the header (next to the title) */
  headerActions?: React.ReactNode;
  /** Additional className for DialogHeader */
  headerClassName?: string;
  /** Enable error boundary (default: true) */
  enableErrorBoundary?: boolean;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

/**
 * View dialog for displaying read-only content.
 * Use this for viewing details, information, or content that doesn't require user action.
 */
export function ViewDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  hideClose = false,
  customFooter,
  size,
  headerActions,
  headerClassName,
  enableErrorBoundary = true,
  onError,
}: ViewDialogProps) {
  const orgId = useOrganizationId();

  return (
    <Dialog
      open={open ?? false}
      onOpenChange={onOpenChange ?? (() => {})}
      title={title}
      description={description}
      footer={customFooter}
      hideClose={hideClose}
      className={cn('max-h-[90vh] overflow-y-auto', className)}
      size={size}
      headerActions={headerActions}
      headerClassName={headerClassName}
    >
      {enableErrorBoundary ? (
        <DialogErrorBoundary
          organizationId={orgId}
          onError={(error) => {
            onError?.(error);
            onOpenChange?.(false);
          }}
        >
          {children}
        </DialogErrorBoundary>
      ) : (
        children
      )}
    </Dialog>
  );
}
