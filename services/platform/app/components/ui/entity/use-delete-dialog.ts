'use client';

import { useState, useCallback, useMemo } from 'react';

interface UseDeleteDialogOptions<TEntity> {
  /** Controlled open state (optional) */
  isOpen?: boolean;
  /** Controlled open state setter (optional) */
  onOpenChange?: (open: boolean) => void;
}

interface UseDeleteDialogReturn {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Open the dialog */
  open: () => void;
  /** Close the dialog */
  close: () => void;
  /** Toggle or set the dialog open state */
  setIsOpen: (open: boolean) => void;
}

/**
 * Hook for managing delete dialog open/close state.
 * Supports both controlled and uncontrolled modes.
 *
 * @example
 * ```tsx
 * // Uncontrolled (internal state)
 * const dialog = useDeleteDialog();
 *
 * // Controlled (external state)
 * const dialog = useDeleteDialog({
 *   isOpen: externalIsOpen,
 *   onOpenChange: setExternalIsOpen,
 * });
 *
 * return (
 *   <>
 *     <Button onClick={dialog.open}>Delete</Button>
 *     <EntityDeleteDialog
 *       isOpen={dialog.isOpen}
 *       onClose={dialog.close}
 *       {...otherProps}
 *     />
 *   </>
 * );
 * ```
 */
export function useDeleteDialog<TEntity>(
  options: UseDeleteDialogOptions<TEntity> = {},
): UseDeleteDialogReturn {
  const { isOpen: controlledIsOpen, onOpenChange: controlledOnOpenChange } =
    options;

  const [internalIsOpen, setInternalIsOpen] = useState(false);

  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;
  const setIsOpen = controlledOnOpenChange || setInternalIsOpen;

  const open = useCallback(() => setIsOpen(true), [setIsOpen]);
  const close = useCallback(() => setIsOpen(false), [setIsOpen]);

  return {
    isOpen,
    open,
    close,
    setIsOpen,
  };
}

interface DeleteDialogTranslations {
  title: string;
  description: string;
  warningText?: string;
  successMessage: string;
  errorMessage: string;
}

interface UseDeleteDialogTranslationsOptions {
  /** Translation function for the entity namespace */
  tEntity: (key: string, params?: Record<string, string>) => string;
  /** Translation function for the toast namespace */
  tToast: (key: string) => string;
  /** Translation keys */
  keys: {
    /** Key for dialog title (e.g., 'deleteCustomer') */
    title: string;
    /** Key for confirmation message with {name} placeholder (e.g., 'deleteConfirmation') */
    description: string;
    /** Key for warning text (optional) */
    warningText?: string;
    /** Key for error message (e.g., 'deleteError') */
    errorMessage: string;
  };
}

/**
 * Hook for creating memoized delete dialog translations.
 *
 * @example
 * ```tsx
 * const { t: tCustomers } = useT('customers');
 * const { t: tToast } = useT('toast');
 *
 * const translations = useDeleteDialogTranslations({
 *   tEntity: tCustomers,
 *   tToast,
 *   keys: {
 *     title: 'deleteCustomer',
 *     description: 'deleteConfirmation',
 *     warningText: 'deleteWarning',
 *     errorMessage: 'deleteError',
 *   },
 * });
 * ```
 */
export function useDeleteDialogTranslations(
  options: UseDeleteDialogTranslationsOptions,
): DeleteDialogTranslations {
  const { tEntity, tToast, keys } = options;

  return useMemo(
    () => ({
      title: tEntity(keys.title),
      description: tEntity(keys.description, { name: '{name}' }),
      warningText: keys.warningText ? tEntity(keys.warningText) : undefined,
      successMessage: tToast('success.deleted'),
      errorMessage: tEntity(keys.errorMessage),
    }),
    [tEntity, tToast, keys],
  );
}

export type { DeleteDialogTranslations };
