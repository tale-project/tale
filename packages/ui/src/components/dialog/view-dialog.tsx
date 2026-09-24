'use client';

import { cn } from '@tale/ui/cn';
import { DialogErrorBoundary } from '@tale/ui/error-boundaries/dialog-error-boundary';
import { useErrorScope } from '@tale/ui/error-boundaries/error-scope';
import * as React from 'react';

import type { DialogSize } from './dialog';
import { Dialog } from './dialog';

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
  /** Custom identity header; supply a labelled close control. */
  customHeader?: React.ReactNode;
  /** Custom footer content */
  customFooter?: React.ReactNode;
  /** Dialog size variant */
  size?: DialogSize;
  /** Actions to display in the header (next to the title) */
  headerActions?: React.ReactNode;
  /**
   * Where `headerActions` sit. `end` (default) packs them with Close.
   * `inline` places them on the title row; Close stays on the far right.
   */
  headerActionsPlacement?: 'end' | 'inline';
  /** Back-navigation handler — renders a back control top-left for drill-in sub-views. */
  onBack?: () => void;
  /** Visible + accessible label for the back control (see `onBack`). */
  backLabel?: string;
  /** Additional className for DialogHeader */
  headerClassName?: string;
  /** Enable error boundary (default: true) */
  enableErrorBoundary?: boolean;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
  /**
   * Stable element to restore focus to when the captured opener unmounts before
   * close (e.g. a dropdown menu item).
   */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Catalog view card. `size="default"` (384px) is the house measure —
 * view and the in-place edit morph share this shell so the backdrop
 * never blinks. Focus lands on the scroll body (`openAutoFocus=
 * "container"`) so header Edit/Close don't open a tooltip the pointer
 * never asked for.
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
  customHeader,
  size,
  headerActions,
  headerActionsPlacement,
  onBack,
  backLabel,
  headerClassName,
  enableErrorBoundary = true,
  onError,
  restoreFocusRef,
}: ViewDialogProps) {
  const { organizationId: orgId } = useErrorScope();

  return (
    <Dialog
      open={open ?? false}
      onOpenChange={onOpenChange ?? (() => {})}
      title={title}
      description={description}
      footer={customFooter}
      customHeader={customHeader}
      hideClose={hideClose}
      className={cn('max-h-[90vh] overflow-y-auto', className)}
      size={size}
      headerActions={headerActions}
      headerActionsPlacement={headerActionsPlacement}
      onBack={onBack}
      backLabel={backLabel}
      headerClassName={headerClassName}
      openAutoFocus="container"
      restoreFocusRef={restoreFocusRef}
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
