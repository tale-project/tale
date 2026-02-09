'use client';

import { type ReactNode } from 'react';

import { ErrorBoundaryBase } from '../core/error-boundary-base';
import { ErrorDisplayCompact } from '../displays/error-display-compact';

interface DialogErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Organization ID for support links */
  organizationId?: string;
  /** Callback when error occurs (e.g., close dialog) */
  onError?: (error: Error) => void;
}

/**
 * Error boundary specifically for dialogs and modals.
 *
 * Features:
 * - Compact error display that fits dialog constraints
 * - Optional auto-close on error via onError callback
 * - Organization context support
 *
 * Used in:
 * - Integration dialogs (Shopify, Gmail, Outlook, Protel, Circuly)
 * - Import dialogs (OneDrive, document imports)
 * - Approval detail dialog
 * - Confirmation dialogs
 * - Settings dialogs
 *
 * @example
 * <Dialog open={open} onOpenChange={setOpen}>
 *   <DialogContent>
 *     <DialogErrorBoundary onError={() => setOpen(false)}>
 *       <ComplexDialogContent />
 *     </DialogErrorBoundary>
 *   </DialogContent>
 * </Dialog>
 *
 * @example
 * // Without auto-close
 * <Dialog open={open} onOpenChange={setOpen}>
 *   <DialogContent>
 *     <DialogErrorBoundary organizationId={organizationId}>
 *       <ImportDocumentsForm />
 *     </DialogErrorBoundary>
 *   </DialogContent>
 * </Dialog>
 */
export function DialogErrorBoundary({
  children,
  organizationId,
  onError,
}: DialogErrorBoundaryProps) {
  return (
    <ErrorBoundaryBase
      organizationId={organizationId}
      onError={(error) => {
        // Call custom error handler (e.g., close dialog)
        onError?.(error);
      }}
      fallback={({ error, reset, organizationId }) => (
        <ErrorDisplayCompact
          error={error}
          organizationId={organizationId}
          reset={reset}
        />
      )}
    >
      {children}
    </ErrorBoundaryBase>
  );
}
