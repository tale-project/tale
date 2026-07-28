'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useT } from '@/lib/i18n/client';

/**
 * Promise-shaped confirm for the choreography's cancel verb: dragging (or
 * re-statusing) a card out of In progress while a run is live is a real act
 * with a consequence — the run stops — so it asks before it acts. The caller
 * renders `dialog` once and passes `confirmCancel` into the status
 * choreography; resolution follows the user's choice, and an unmount/close
 * resolves false (nothing cancelled).
 */
export function useRunCancelConfirm(): {
  confirmCancel: () => Promise<boolean>;
  dialog: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const { t } = useT('tasks');

  const settle = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setOpen(false);
  }, []);

  const confirmCancel = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      // A second ask while one is pending settles the first as declined —
      // only one drop can be in flight anyway.
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setOpen(true);
    });
  }, []);

  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
      title={t('subject.cancelConfirmTitle')}
      description={t('subject.cancelConfirmMove')}
      confirmText={t('subject.cancel')}
      variant="destructive"
      onConfirm={() => settle(true)}
    />
  );

  return { confirmCancel, dialog };
}
