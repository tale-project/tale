'use client';

import { useState, useCallback } from 'react';

export interface UseDialogReturn {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Open the dialog */
  open: () => void;
  /** Close the dialog */
  close: () => void;
  /** Toggle the dialog open state */
  toggle: () => void;
  /** Set the open state directly */
  setOpen: (open: boolean) => void;
}

export interface UseDialogOptions {
  /** Initial open state (default: false) */
  defaultOpen?: boolean;
  /** Callback when dialog opens */
  onOpen?: () => void;
  /** Callback when dialog closes */
  onClose?: () => void;
}

/**
 * Simple hook for managing dialog open/close state.
 * For dialogs with forms and submission state, use useFormDialogState instead.
 *
 * @example
 * ```tsx
 * const dialog = useDialog();
 *
 * return (
 *   <>
 *     <Button onClick={dialog.open}>Open Dialog</Button>
 *     <ViewDialog
 *       open={dialog.isOpen}
 *       onOpenChange={dialog.setOpen}
 *       title="Details"
 *     >
 *       <Content />
 *     </ViewDialog>
 *   </>
 * );
 * ```
 */
export function useDialog(options: UseDialogOptions = {}): UseDialogReturn {
  const { defaultOpen = false, onOpen, onClose } = options;

  const [isOpen, setIsOpenState] = useState(defaultOpen);

  const open = useCallback(() => {
    setIsOpenState(true);
    onOpen?.();
  }, [onOpen]);

  const close = useCallback(() => {
    setIsOpenState(false);
    onClose?.();
  }, [onClose]);

  const toggle = useCallback(() => {
    setIsOpenState((prev) => {
      const next = !prev;
      if (next) {
        onOpen?.();
      } else {
        onClose?.();
      }
      return next;
    });
  }, [onOpen, onClose]);

  const setOpen = useCallback(
    (open: boolean) => {
      if (open) {
        setIsOpenState(true);
        onOpen?.();
      } else {
        setIsOpenState(false);
        onClose?.();
      }
    },
    [onOpen, onClose],
  );

  return {
    isOpen,
    open,
    close,
    toggle,
    setOpen,
  };
}
