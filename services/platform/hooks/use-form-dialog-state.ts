'use client';

import { useState, useCallback } from 'react';

export interface FormDialogState {
  /** Whether the dialog is currently open */
  isOpen: boolean;
  /** Whether a form submission is in progress */
  isSubmitting: boolean;
  /** Current error message, if any */
  error: string | null;
}

export interface UseFormDialogStateReturn extends FormDialogState {
  /** Open the dialog */
  open: () => void;
  /** Close the dialog and reset state */
  close: () => void;
  /** Set the open state */
  setOpen: (isOpen: boolean) => void;
  /** Start submitting state */
  startSubmitting: () => void;
  /** Stop submitting state (with optional error) */
  stopSubmitting: (error?: string | null) => void;
  /** Set error message */
  setError: (error: string | null) => void;
  /** Clear error message */
  clearError: () => void;
  /** Reset all state to defaults */
  reset: () => void;
}

export interface UseFormDialogStateOptions {
  /** Initial open state (default: false) */
  defaultOpen?: boolean;
  /** Callback when dialog closes */
  onClose?: () => void;
  /** Callback when dialog opens */
  onOpen?: () => void;
}

/**
 * Hook for managing form dialog state.
 * Provides standardized state management for dialogs with forms.
 *
 * @example
 * ```tsx
 * const dialog = useFormDialogState();
 *
 * const onSubmit = async (data) => {
 *   dialog.startSubmitting();
 *   try {
 *     await saveData(data);
 *     dialog.close();
 *   } catch (err) {
 *     dialog.stopSubmitting(err.message);
 *   }
 * };
 *
 * return (
 *   <FormModal
 *     open={dialog.isOpen}
 *     onOpenChange={dialog.setOpen}
 *     isSubmitting={dialog.isSubmitting}
 *     onSubmit={handleSubmit(onSubmit)}
 *   >
 *     {dialog.error && <ErrorAlert>{dialog.error}</ErrorAlert>}
 *     <FormFields />
 *   </FormModal>
 * );
 * ```
 */
export function useFormDialogState(
  options: UseFormDialogStateOptions = {}
): UseFormDialogStateReturn {
  const { defaultOpen = false, onClose, onOpen } = options;

  const [isOpen, setIsOpenState] = useState(defaultOpen);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);

  const open = useCallback(() => {
    setIsOpenState(true);
    setErrorState(null);
    onOpen?.();
  }, [onOpen]);

  const close = useCallback(() => {
    setIsOpenState(false);
    setIsSubmitting(false);
    setErrorState(null);
    onClose?.();
  }, [onClose]);

  const setOpen = useCallback(
    (newIsOpen: boolean) => {
      if (newIsOpen) {
        open();
      } else {
        close();
      }
    },
    [open, close]
  );

  const startSubmitting = useCallback(() => {
    setIsSubmitting(true);
    setErrorState(null);
  }, []);

  const stopSubmitting = useCallback((err?: string | null) => {
    setIsSubmitting(false);
    if (err) {
      setErrorState(err);
    }
  }, []);

  const setError = useCallback((err: string | null) => {
    setErrorState(err);
  }, []);

  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  const reset = useCallback(() => {
    setIsOpenState(defaultOpen);
    setIsSubmitting(false);
    setErrorState(null);
  }, [defaultOpen]);

  return {
    isOpen,
    isSubmitting,
    error,
    open,
    close,
    setOpen,
    startSubmitting,
    stopSubmitting,
    setError,
    clearError,
    reset,
  };
}

/**
 * Hook for managing multiple form dialogs.
 * Useful when a component needs to control several dialogs.
 *
 * @example
 * ```tsx
 * const dialogs = useMultipleFormDialogs(['add', 'edit', 'delete']);
 *
 * return (
 *   <>
 *     <AddDialog {...dialogs.add} />
 *     <EditDialog {...dialogs.edit} />
 *     <DeleteDialog {...dialogs.delete} />
 *   </>
 * );
 * ```
 */
export function useMultipleFormDialogs<T extends string>(
  dialogNames: T[]
): Record<T, UseFormDialogStateReturn> {
  // Create individual hooks for each dialog
  // Using a factory pattern to maintain hook rules
  const [states, setStates] = useState<Record<T, FormDialogState>>(() =>
    dialogNames.reduce(
      (acc, name) => ({
        ...acc,
        [name]: { isOpen: false, isSubmitting: false, error: null },
      }),
      {} as Record<T, FormDialogState>
    )
  );

  const createHandlers = useCallback(
    (name: T): UseFormDialogStateReturn => ({
      ...states[name],
      open: () =>
        setStates((prev) => ({
          ...prev,
          [name]: { ...prev[name], isOpen: true, error: null },
        })),
      close: () =>
        setStates((prev) => ({
          ...prev,
          [name]: { isOpen: false, isSubmitting: false, error: null },
        })),
      setOpen: (isOpen: boolean) =>
        setStates((prev) => ({
          ...prev,
          [name]: isOpen
            ? { ...prev[name], isOpen: true, error: null }
            : { isOpen: false, isSubmitting: false, error: null },
        })),
      startSubmitting: () =>
        setStates((prev) => ({
          ...prev,
          [name]: { ...prev[name], isSubmitting: true, error: null },
        })),
      stopSubmitting: (error?: string | null) =>
        setStates((prev) => ({
          ...prev,
          [name]: { ...prev[name], isSubmitting: false, error: error || null },
        })),
      setError: (error: string | null) =>
        setStates((prev) => ({
          ...prev,
          [name]: { ...prev[name], error },
        })),
      clearError: () =>
        setStates((prev) => ({
          ...prev,
          [name]: { ...prev[name], error: null },
        })),
      reset: () =>
        setStates((prev) => ({
          ...prev,
          [name]: { isOpen: false, isSubmitting: false, error: null },
        })),
    }),
    [states]
  );

  return dialogNames.reduce(
    (acc, name) => ({ ...acc, [name]: createHandlers(name) }),
    {} as Record<T, UseFormDialogStateReturn>
  );
}
